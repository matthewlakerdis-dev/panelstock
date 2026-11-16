import copy
import hashlib
import io
import importlib.util
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import time
from types import SimpleNamespace
import urllib.error
from urllib.parse import urlencode
import unittest
from unittest.mock import patch


DIRECTORY = Path(__file__).parent
sys.path.insert(0, str(DIRECTORY))
spec = importlib.util.spec_from_file_location("nexvia_quote_attachment", DIRECTORY / "nexvia_quote_attachment.py")
quote = importlib.util.module_from_spec(spec)
spec.loader.exec_module(quote)
RAW = b"%PDF-1.7\nSynthetic supplier quote\n%%EOF"
PATH = "/staff/project-purchase-order-add/60?type=Assembly&service=8&client=225&breakdown_type=ew_734"
ENDPOINT = "https://synthetic-bucket.storage.googleapis.com/"
SIGNED = "https://storage.googleapis.com/synthetic-bucket/quote.pdf?Expires=9999999999&Signature=synthetic-signature-value"
REGISTER = quote.ORIGIN + "/staff/upload/details/419?" + urlencode({"nativeMetadata": "https://storage.googleapis.com/synthetic-bucket/quote.pdf"})


def request():
    return {"requestId": "7d913213-5be7-4271-a0fa-9ed1462367f4", "reference": "PR-12345678",
            "projectPageId": 60, "supplierId": "225", "serviceId": "8", "breakdownType": "ew_734",
            "date": "2026-11-13", "requestor": {"name": "Test", "email": "test@example.invalid"},
            "quote": {"filename": "Supplier quote.pdf", "bytes": len(RAW), "sha256": hashlib.sha256(RAW).hexdigest()},
            "lines": [], "totalCents": 110000}


def save(path, value):
    path.write_bytes(quote.canonical(value))
    path.chmod(0o600)


class QuoteEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.folder = Path(self.temporary.name)
        self.folder.chmod(0o700)
        self.request = request()
        self.source = self.folder / quote.SOURCE_FILE
        self.source.write_bytes(RAW)
        self.source.chmod(0o600)
        save(self.folder / "request.json", self.request)
        self.created_at = time.time()
        self.transfer = {"version": 1, "id": self.request["requestId"],
                         "workerId": "a4021607-322d-461f-8ca9-c60287708415",
                         "claimToken": "synthetic-private-claim-token", "quote": self.request["quote"],
                         "createdAt": self.created_at, "expiresAt": self.created_at + quote.SOURCE_TTL_SECONDS}
        save(self.folder / quote.TRANSFER_FILE, self.transfer)

    def tearDown(self):
        self.temporary.cleanup()

    def test_exact_source_is_verified_once_and_upload_payload_keeps_verified_bytes(self):
        self.assertEqual(quote.verify_source(self.folder, self.request), self.source)
        payload = quote.source_upload_payload(self.folder, self.request)
        self.source.write_bytes(b"changed after payload was frozen")
        self.assertEqual(payload, {"name": "Supplier quote.pdf", "mimeType": "application/pdf", "buffer": RAW})
        with self.assertRaises(quote.QuoteAttachmentError):
            quote.source_upload_payload(self.folder, self.request)

    def test_source_must_belong_to_the_exact_saved_request_and_fixed_child(self):
        changed = copy.deepcopy(self.request)
        changed["totalCents"] += 1
        with self.assertRaises(quote.QuoteAttachmentError):
            quote.verify_source(self.folder, changed)
        with self.assertRaises(quote.QuoteAttachmentError):
            quote.verify_source(self.folder, self.request, self.folder / "other.pdf")
        (self.folder / "request.json").chmod(0o644)
        with self.assertRaises(quote.QuoteAttachmentError):
            quote.verify_source(self.folder, self.request)

    def test_symlink_hardlink_and_unsafe_source_permissions_are_rejected(self):
        self.source.chmod(0o644)
        with self.assertRaises(quote.QuoteAttachmentError):
            quote.verify_source(self.folder, self.request)
        self.source.chmod(0o600)
        link = self.folder / "second.pdf"
        os.link(self.source, link)
        with self.assertRaises(quote.QuoteAttachmentError):
            quote.verify_source(self.folder, self.request)
        link.unlink()
        self.source.unlink()
        external = self.folder / "original.pdf"
        external.write_bytes(RAW)
        external.chmod(0o600)
        self.source.symlink_to(external)
        with self.assertRaises(quote.QuoteAttachmentError):
            quote.verify_source(self.folder, self.request)
        self.assertEqual(external.read_bytes(), RAW)

    def test_nonprivate_or_substituted_folder_is_rejected(self):
        self.folder.chmod(0o755)
        with self.assertRaises(quote.QuoteAttachmentError):
            quote.verify_source(self.folder, self.request)
        self.folder.chmod(0o700)
        alias = self.folder / "alias"
        alias.symlink_to(self.folder, target_is_directory=True)
        with self.assertRaises(quote.QuoteAttachmentError):
            quote.verify_source(alias, self.request)

    def test_pdf_size_signature_and_hash_all_match_the_same_opened_bytes(self):
        for raw in [RAW[:-1], RAW + b"extra", b"TEXT-" + RAW[5:], RAW[:-2] + b"xx"]:
            self.source.write_bytes(raw)
            with self.assertRaises(quote.QuoteAttachmentError):
                quote.source_upload_payload(self.folder, self.request)

    def test_expired_missing_or_changed_transfer_blocks_source_and_new_upload(self):
        with patch.object(quote.time, "time", return_value=self.transfer["expiresAt"]):
            with self.assertRaisesRegex(quote.QuoteAttachmentError, "expired"):
                quote.verify_source(self.folder, self.request)
            with self.assertRaises(quote.QuoteAttachmentError):
                quote.source_upload_payload(self.folder, self.request)
            with self.assertRaises(quote.QuoteAttachmentError):
                quote.begin_upload(self.folder, self.request, PATH)
        for changes in [{"id": "a4021607-322d-461f-8ca9-c60287708415"}, {"expiresAt": self.created_at + 3600},
                        {"workerId": "not-a-worker"}, {"claimToken": "short"}, {"createdAt": float("nan")}]:
            # JSON encoding intentionally rejects NaN; validate directly for that shape.
            with self.subTest(changes=changes), self.assertRaises(quote.QuoteAttachmentError):
                quote.validate_source_transfer({**self.transfer, **changes}, self.request)
        (self.folder / quote.TRANSFER_FILE).unlink()
        with self.assertRaises(quote.QuoteAttachmentError):
            quote.verify_source(self.folder, self.request)

    def test_draft_path_must_preserve_exact_native_request_context(self):
        valid = quote.binding(self.request, PATH)
        self.assertEqual(valid["requestId"], self.request["requestId"])
        self.assertEqual(valid["requestHash"], quote.digest(self.request))
        paths = ["https://foreign.invalid" + PATH, PATH.replace("/60?", "/61?"),
                 PATH.replace("client=225", "client=226"), PATH.replace("service=8", "service=9"),
                 PATH.replace("ew_734", "b_70"), PATH + "&send=true", PATH + "#sent"]
        for path in paths:
            with self.subTest(path=path), self.assertRaises(quote.QuoteAttachmentError):
                quote.binding(self.request, path)

    def test_attempt_is_durable_private_and_exclusive_before_any_upload(self):
        before = self.source.read_bytes()
        attempt = quote.begin_upload(self.folder, self.request, PATH)
        path = self.folder / quote.ATTEMPT_FILE
        self.assertEqual(json.loads(path.read_bytes()), attempt)
        self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
        with self.assertRaisesRegex(quote.QuoteAttachmentError, "do not upload again"):
            quote.begin_upload(self.folder, self.request, PATH)
        self.assertEqual(self.source.read_bytes(), before)
        self.assertFalse((self.folder / quote.RECEIPT_FILE).exists())

    def test_partial_or_linked_attempt_also_blocks_replay(self):
        path = self.folder / quote.ATTEMPT_FILE
        path.write_bytes(b"{")
        path.chmod(0o600)
        with self.assertRaises(quote.QuoteAttachmentError):
            quote.begin_upload(self.folder, self.request, PATH)
        with self.assertRaises(quote.QuoteAttachmentError):
            quote.complete_upload(self.folder, self.request, PATH, [419])
        path.unlink()
        path.symlink_to(self.source)
        with self.assertRaises(quote.QuoteAttachmentError):
            quote.begin_upload(self.folder, self.request, PATH)
        self.assertEqual(self.source.read_bytes(), RAW)

    def test_receipt_matches_attempt_request_source_and_exact_native_identity(self):
        quote.begin_upload(self.folder, self.request, PATH)
        receipt = quote.complete_upload(self.folder, self.request, PATH, [419])
        self.assertEqual(quote.load_receipt(self.folder, self.request, PATH), receipt)
        self.assertEqual(quote.receipt_fields(receipt), [["form[Files][]", "419"]])
        self.assertEqual(quote.file_ids_from_fields([["form[Lines]", "[]"], ["form[Files][]", ""],
                                                    ["form[Files][]", "419"]]), [419])
        self.assertEqual(stat.S_IMODE((self.folder / quote.RECEIPT_FILE).stat().st_mode), 0o600)
        # Metadata remains usable after the independently acknowledged byte purge.
        self.source.unlink()
        with patch.object(quote.time, "time", return_value=self.transfer["expiresAt"] + 1):
            self.assertEqual(quote.load_receipt(self.folder, self.request, PATH), receipt)
        with self.assertRaises(quote.QuoteAttachmentError):
            quote.complete_upload(self.folder, self.request, PATH, [420])

    def test_receipt_mutation_and_other_request_context_are_rejected(self):
        quote.begin_upload(self.folder, self.request, PATH)
        receipt = quote.complete_upload(self.folder, self.request, PATH, [419])
        for changes in [{"nativeFileIds": [420]}, {"quote": {**self.request["quote"], "sha256": "0" * 64}},
                        {"requestId": "2c2eaf70-1735-4b17-b48b-acb65c38bdc2"}, {"uploadedAt": "no date"},
                        {"extra": True}]:
            with self.subTest(changes=changes), self.assertRaises(quote.QuoteAttachmentError):
                quote.validate_receipt({**receipt, **changes}, self.request, PATH)
        changed = copy.deepcopy(self.request)
        changed["reference"] = "PR-other"
        with self.assertRaises(quote.QuoteAttachmentError):
            quote.load_receipt(self.folder, changed, PATH)

    def test_only_one_positive_js_safe_native_file_id_is_accepted(self):
        for values in [[], [1, 2], [True], [0], [-1], ["419"], [9007199254740992]]:
            with self.subTest(values=values), self.assertRaises(quote.QuoteAttachmentError):
                quote.native_file_ids(values)
        for fields in [[], [["form[Files][]", "0"]], [["form[Files][]", "0419"]],
                       [["form[Files][]", "419"], ["form[Files][]", "419"]],
                       [["form[Files][]", "9007199254740992"]]]:
            with self.subTest(fields=fields), self.assertRaises(quote.QuoteAttachmentError):
                quote.file_ids_from_fields(fields)

    def test_synology_permission_inheritance_is_corrected_before_evidence_write(self):
        real_open, real_fchmod, real_write = os.open, os.fchmod, os.fdopen
        opened = []

        def inherited_open(path, flags, mode=0o777, **kwargs):
            descriptor_fd = real_open(path, flags, mode, **kwargs)
            if flags & os.O_CREAT:
                real_fchmod(descriptor_fd, 0o666)
                opened.append(descriptor_fd)
            return descriptor_fd

        def checked_fdopen(descriptor_fd, mode):
            stream = real_write(descriptor_fd, mode)
            original_write = stream.write

            def write(raw):
                self.assertEqual(stat.S_IMODE(os.fstat(descriptor_fd).st_mode), 0o600)
                return original_write(raw)

            if "w" in mode:
                stream.write = write
            return stream

        with patch.object(quote.os, "open", side_effect=inherited_open), \
                patch.object(quote.os, "fdopen", side_effect=checked_fdopen):
            quote.begin_upload(self.folder, self.request, PATH)
            quote.complete_upload(self.folder, self.request, PATH, [419])
        self.assertEqual(len(opened), 2)


def native_state():
    return {"url": quote.ORIGIN + PATH, "formCount": 1, "formMethod": "POST", "inputCount": 1,
            "widgets": [{"index": 0, "url": ENDPOINT, "method": "POST", "autoUpload": True,
                         "chunkSize": 0, "disabled": False}], "policyNames": sorted(quote.POLICY_FIELDS),
            "registrationPrefixes": [quote.REGISTRATION_PREFIX], "binding": True, "ids": [],
            "malformedIds": False, "cards": [], "linesEmpty": True, "numbers": [],
            "service": "8", "comment": "", "pending": 0}


def blank_native_snapshot():
    row = {"id": "native-draft-opaque", "is_new": True, "item_description": "",
           "job_purchase_order_id": None, "job_id": 262, "default_job_id": 262,
           "breakdown_type": "ew_734", "budget_item_id": 1,
           "currency_id": 8, "curr_alpha3": "AUD", "curr_rate": 1,
           "quantity": 1, "unit_price": 0, "amount": 0, "curr_amount": 0,
           "tax_rate": 10, "tax_rate_id": 1, "chart_of_account_id": 401,
           "received_qty": 0, "qty_received": 0, "qty_received_modified": False,
           "received": None, "comment": ""}
    return {"fields": [["form[ServiceId]", "8"], ["form[CurrencyId]", "8"], ["form[Lines]", "[]"]],
            "rows": [row], "bindings": [],
            "nativeNewRowProof": {"startedEmpty": True, "addedByNativeControl": True}}


def serialized_native_state(original=None):
    current = copy.deepcopy(original or blank_native_snapshot())
    # Nexvia finance editing serializes its existing blank row into Lines.
    current["fields"] = [[key, json.dumps(current["rows"]) if key == "form[Lines]" else value]
                         for key, value in current["fields"]]
    current.pop("nativeNewRowProof", None)
    return {**native_state(), "linesEmpty": False, "lines": copy.deepcopy(current["rows"]),
            "currency": "8", "nativeSnapshot": current}


def kendo_serialized_native_state(original=None):
    original = copy.deepcopy(original or blank_native_snapshot())
    original["rows"][0]["_editable"] = {"item_description": True, "qty_received": False}
    state = serialized_native_state(original)
    wire = state["lines"][0]
    wire.pop("_editable")
    wire["uid"] = original["rows"][0]["id"]
    wire["id"] = None
    state["nativeSnapshot"]["fields"][2][1] = json.dumps(state["lines"])
    state["nativeRowUid"] = original["rows"][0]["id"]
    return original, state


class NativePage:
    def __init__(self, state=None):
        self.state = copy.deepcopy(state or native_state())
        self.url = self.state["url"]
        self.context = SimpleNamespace(cookies=lambda urls: [])
        self.guards = []
        self.file_selections = 0
        self.actions = []
        self.raw = None
        self.registration = REGISTER
        self.extra_requests = []

    def evaluate(self, source, arg=None):
        return copy.deepcopy(self.state)

    def route(self, pattern, guard):
        self.guards.append(guard)

    def unroute(self, pattern, guard):
        self.guards.remove(guard)

    def dispatch(self, method, url, headers=None):
        route = SimpleNamespace(request=SimpleNamespace(method=method, url=url, headers=headers or {}),
                                continue_=lambda: self.actions.append((method, url, True)),
                                abort=lambda: self.actions.append((method, url, False)))
        self.guards[-1](route)

    def locator(self, selector):
        if selector == 'input[type="file"]':
            return SimpleNamespace(set_input_files=self.set_files)
        return SimpleNamespace(wait_for=lambda **kwargs: None)

    def set_files(self, payload):
        self.file_selections += 1
        self.raw = payload["buffer"]
        self.dispatch("OPTIONS", ENDPOINT, {"access-control-request-method": "POST"})
        self.dispatch("POST", ENDPOINT)
        self.dispatch("GET", self.registration)
        for method, url, headers in self.extra_requests:
            self.dispatch(method, url, headers)
        self.state.update(ids=["419"], cards=[{"url": SIGNED, "pathIds": []}])

    def wait_for_function(self, source, **kwargs):
        pass


class NativeFlowTests(unittest.TestCase):
    setUp = QuoteEvidenceTests.setUp
    tearDown = QuoteEvidenceTests.tearDown

    def test_native_input_uploads_exact_verified_bytes_once_and_freezes_receipt(self):
        page = NativePage()
        receipt = quote.upload_quote(page, self.folder, self.request, PATH,
                                     downloader=lambda context, url, descriptor: page.raw)
        self.assertEqual(page.file_selections, 1)
        self.assertEqual(page.raw, RAW)
        self.assertEqual(receipt["nativeFileIds"], [419])
        self.assertEqual(page.actions, [("OPTIONS", ENDPOINT, True), ("POST", ENDPOINT, True), ("GET", REGISTER, True)])
        self.assertEqual(page.guards, [])
        # A local retry with completed native UI can reuse proof, never select again.
        self.assertEqual(quote.upload_quote(page, self.folder, self.request, PATH,
                                           downloader=lambda context, url, descriptor: RAW), receipt)
        self.assertEqual(page.file_selections, 1)

    def test_native_serialized_blank_row_is_proven_before_one_upload_and_on_receipt_reuse(self):
        original = blank_native_snapshot()
        before = copy.deepcopy(original)
        page = NativePage(serialized_native_state(original))
        receipt = quote.upload_quote(page, self.folder, self.request, PATH, native_snapshot=original,
                                     downloader=lambda context, url, descriptor: page.raw)
        self.assertEqual(page.file_selections, 1)
        self.assertEqual(receipt["nativeFileIds"], [419])
        self.assertEqual(original, before, "blank draft evidence must remain unchanged")
        self.assertEqual(quote.upload_quote(page, self.folder, self.request, PATH, native_snapshot=original,
                                           downloader=lambda *args: RAW), receipt)
        self.assertEqual(page.file_selections, 1, "receipt reuse must never select the file again")

    def test_kendo_cleared_id_uid_and_editable_map_preserve_proven_native_blank_row(self):
        original, state = kendo_serialized_native_state()
        before = copy.deepcopy(original)
        page = NativePage(state)
        receipt = quote.upload_quote(page, self.folder, self.request, PATH, native_snapshot=original,
                                     downloader=lambda *args: RAW)
        self.assertEqual(page.file_selections, 1)
        self.assertEqual(receipt["nativeFileIds"], [419])
        self.assertEqual(quote.upload_quote(page, self.folder, self.request, PATH, native_snapshot=original,
                                           downloader=lambda *args: RAW), receipt)
        self.assertEqual(page.file_selections, 1)
        self.assertEqual(original, before)

    def test_recomputed_boolean_editability_map_does_not_change_blank_business_proof(self):
        original, state = kendo_serialized_native_state()
        state["nativeSnapshot"]["rows"][0]["_editable"] = {"item_description": False, "qty_received": True}
        page = NativePage(state)
        receipt = quote.upload_quote(page, self.folder, self.request, PATH, native_snapshot=original,
                                     downloader=lambda *args: RAW)
        self.assertEqual(receipt["nativeFileIds"], [419])
        self.assertEqual(page.file_selections, 1)

    def test_kendo_identity_normalization_rejects_wrong_or_unproven_metadata(self):
        changes = [lambda o,s: s.update(nativeRowUid="another-model"),
                   lambda o,s: s["lines"][0].update(uid="another-model"),
                   lambda o,s: s["lines"][0].update(id=1421),
                   lambda o,s: s["lines"][0].update(id="another-draft"),
                   lambda o,s: s["lines"][0].pop("id"),
                   lambda o,s: s["lines"][0].pop("uid"),
                   lambda o,s: o.pop("nativeNewRowProof"),
                   lambda o,s: s["nativeSnapshot"]["rows"][0].update(_editable=True),
                   lambda o,s: s["nativeSnapshot"]["rows"][0].update(_editable={"amount": 1}),
                   lambda o,s: s["nativeSnapshot"]["rows"][0].update(_editable={"amount": {"editable": True}}),
                   lambda o,s: s["lines"][0].update(unit_price=1),
                   lambda o,s: s["lines"][0].update(budget_item_id=True),
                   lambda o,s: s["lines"][0].update(unrecognized_business_field="populated"),
                   lambda o,s: s.update(formFieldsValid=False)]
        for change in changes:
            original, state = kendo_serialized_native_state()
            change(original, state)
            state["nativeSnapshot"]["fields"][2][1] = json.dumps(state["lines"])
            page = NativePage(state)
            with self.subTest(change=change), self.assertRaises(quote.QuoteAttachmentError):
                quote.upload_quote(page, self.folder, self.request, PATH, native_snapshot=original)
            self.assertEqual(page.file_selections, 0)
            self.assertFalse((self.folder / quote.ATTEMPT_FILE).exists())

    def test_nonempty_lines_without_original_native_proof_never_select_a_file(self):
        page = NativePage(serialized_native_state())
        with self.assertRaisesRegex(quote.QuoteAttachmentError, "proof"):
            quote.upload_quote(page, self.folder, self.request, PATH)
        self.assertFalse((self.folder / quote.ATTEMPT_FILE).exists())
        self.assertEqual(page.file_selections, 0)

    def test_populated_or_changed_serialized_drafts_fail_before_attempt_or_selection(self):
        original = blank_native_snapshot()
        changes = [{"item_description": "Existing work"}, {"comment": "Existing note"},
                   {"contractor_comments": "Existing contractor note"},
                   {"unit_price": 1}, {"amount": "0.01"}, {"curr_amount": -1},
                   {"amount_inc": 1}, {"curr_amount_inc": 1}, {"curr_cost": 1},
                   {"curr_base_cost": 1}, {"curr_converted_cost": 1},
                   {"received_qty": 1}, {"quantity": 2}, {"quantity": True},
                   {"quantity": float("inf")}, {"job_purchase_order_id": 1421},
                   {"received": 1}, {"qty_received_modified": True},
                   {"id": 1421}, {"id": "another-native-draft"},
                   {"budget_item_id": True},
                   {"job_id": 263, "default_job_id": 263}, {"breakdown_type": "ew_735"},
                   {"currency_id": 1, "curr_alpha3": "GBP"}]
        for change in changes:
            with self.subTest(change=change):
                state = serialized_native_state(original)
                state["nativeSnapshot"]["rows"][0].update(change)
                state["lines"] = copy.deepcopy(state["nativeSnapshot"]["rows"])
                state["nativeSnapshot"]["fields"][2][1] = json.dumps(state["lines"])
                page = NativePage(state)
                with self.assertRaises(quote.QuoteAttachmentError):
                    quote.upload_quote(page, self.folder, self.request, PATH, native_snapshot=original)
                self.assertEqual(page.file_selections, 0)
                self.assertFalse((self.folder / quote.ATTEMPT_FILE).exists())

    def test_serialized_grid_disagreement_extra_rows_currency_and_birth_proof_are_rejected(self):
        original = blank_native_snapshot()
        mutations = [lambda s: s["lines"][0].update(amount=1),
                     lambda s: s["lines"].append(copy.deepcopy(s["lines"][0])),
                     lambda s: s["nativeSnapshot"]["rows"].append(copy.deepcopy(s["lines"][0])),
                     lambda s: s["nativeSnapshot"]["fields"][2].__setitem__(1, "[]"),
                     lambda s: s.update(currency="1"),
                     lambda s: s["nativeSnapshot"]["fields"].__setitem__(1, ["form[CurrencyId]", "1"])]
        for mutate in mutations:
            state = serialized_native_state(original)
            mutate(state)
            page = NativePage(state)
            with self.assertRaises(quote.QuoteAttachmentError):
                quote.upload_quote(page, self.folder, self.request, PATH, native_snapshot=original)
            self.assertEqual(page.file_selections, 0)
            self.assertFalse((self.folder / quote.ATTEMPT_FILE).exists())
        missing = copy.deepcopy(original)
        missing.pop("nativeNewRowProof")
        with self.assertRaises(quote.QuoteAttachmentError):
            quote.upload_quote(NativePage(serialized_native_state(original)), self.folder, self.request,
                               PATH, native_snapshot=missing)
        self.assertFalse((self.folder / quote.ATTEMPT_FILE).exists())

    def test_native_contract_change_fails_before_attempt_or_file_selection(self):
        for change in [{"numbers": ["PO7413"]}, {"ids": ["999"]}, {"inputCount": 2},
                       {"policyNames": ["key", "file"]}, {"binding": False},
                       {"widgets": [{**native_state()["widgets"][0], "url": "https://foreign.invalid/"}]}]:
            state = {**native_state(), **change}
            page = NativePage(state)
            with self.subTest(change=change), self.assertRaises(quote.QuoteAttachmentError):
                quote.upload_quote(page, self.folder, self.request, PATH)
            self.assertEqual(page.file_selections, 0)
            self.assertFalse((self.folder / quote.ATTEMPT_FILE).exists())

    def test_native_guard_blocks_extra_upload_registration_actions_and_invalid_options(self):
        page = NativePage()
        blocked = [("POST", ENDPOINT, {}), ("GET", REGISTER, {}),
                   ("OPTIONS", ENDPOINT, {"access-control-request-method": "DELETE"}),
                   ("POST", quote.ORIGIN + PATH, {}),
                   ("GET", quote.ORIGIN + "/staff/project-purchase-order-print/1421/sent/1", {}),
                   ("GET", "https://foreign.invalid/", {})]
        page.extra_requests = blocked
        quote.upload_quote(page, self.folder, self.request, PATH,
                           downloader=lambda context, url, descriptor: RAW)
        self.assertEqual([row[2] for row in page.actions[-len(blocked):]], [False] * len(blocked))

    def test_wrong_draft_download_keeps_attempt_but_never_creates_receipt_or_reuploads(self):
        page = NativePage()
        with self.assertRaises(quote.QuoteAttachmentError):
            quote.upload_quote(page, self.folder, self.request, PATH,
                               downloader=lambda context, url, descriptor: RAW + b"wrong")
        self.assertTrue((self.folder / quote.ATTEMPT_FILE).exists())
        self.assertFalse((self.folder / quote.RECEIPT_FILE).exists())
        next_page = NativePage()
        with self.assertRaises(quote.QuoteAttachmentError):
            quote.upload_quote(next_page, self.folder, self.request, PATH,
                               downloader=lambda context, url, descriptor: RAW)
        self.assertEqual(next_page.file_selections, 0)
        self.assertEqual(next_page.guards, [])

    def test_saved_multiple_ids_need_explicit_quote_download_id_binding(self):
        state = {**native_state(), "ids": ["419", "777"], "cards": [{"url": SIGNED, "pathIds": []}]}
        with self.assertRaises(quote.QuoteAttachmentError):
            quote.verify_file_cards(None, state, self.request["quote"], [419], saved=True,
                                    downloader=lambda *args: RAW)
        state["cards"] = [{"url": quote.ORIGIN + "/staff/file-download/60/419", "pathIds": ["60", "419"]}]
        self.assertEqual(quote.verify_file_cards(None, state, self.request["quote"], [419], saved=True,
                                               downloader=lambda *args: RAW), [419])
        state["ids"] = ["777"]
        with self.assertRaises(quote.QuoteAttachmentError):
            quote.verify_file_cards(None, state, self.request["quote"], [419], saved=True,
                                    downloader=lambda *args: RAW)

    def test_native_metadata_query_is_bounded_to_the_upload_bucket(self):
        self.assertTrue(quote.registration_url(REGISTER, ENDPOINT))
        self.assertTrue(quote.registration_url(REGISTER + "&_=123", ENDPOINT))
        for url in [REGISTER.replace("synthetic-bucket", "different-bucket"),
                    REGISTER + "&send=true", REGISTER.replace("https%3A%2F%2Fstorage.googleapis.com", "http%3A%2F%2Fforeign.invalid"),
                    quote.ORIGIN + "/staff/upload/details/delete", REGISTER.replace("/419?", "/419/another?")]:
            with self.subTest(url=url):
                self.assertFalse(quote.registration_url(url, ENDPOINT))


class Response(io.BytesIO):
    def __init__(self, raw=RAW, status=200, headers=None):
        super().__init__(raw)
        self.status = status
        self.headers = {"Content-Type": "application/pdf", "Content-Length": str(len(raw)), **(headers or {})}


class DownloadTests(unittest.TestCase):
    def test_cookie_free_gcs_get_is_bounded_and_matches_exact_source(self):
        context = SimpleNamespace(cookies=lambda urls: self.fail("External download must not request cookies"))
        requests = []
        opener = SimpleNamespace(open=lambda req, timeout: (requests.append(req), Response())[1])
        self.assertEqual(quote.download_quote(context, SIGNED, request()["quote"], opener=opener), RAW)
        self.assertNotIn("Cookie", requests[0].headers)
        self.assertEqual(requests[0].method, "GET")

    def test_authenticated_native_link_can_redirect_once_to_gcs_without_forwarding_cookie(self):
        native = quote.ORIGIN + "/staff/file-download/60/419"
        requests = []

        def open_response(req, timeout):
            requests.append(req)
            if len(requests) == 1:
                raise urllib.error.HTTPError(native, 302, "redirect", {"Location": SIGNED}, io.BytesIO())
            return Response()

        context = SimpleNamespace(cookies=lambda urls: [{"name": "session", "value": "synthetic-private-cookie"}])
        self.assertEqual(quote.download_quote(context, native, request()["quote"],
                                             opener=SimpleNamespace(open=open_response)), RAW)
        self.assertIn("Cookie", requests[0].headers)
        self.assertNotIn("Cookie", requests[1].headers)

    def test_download_rejects_wrong_body_oversize_encoding_redirect_and_action_link(self):
        cases = [Response(RAW + b"excess"), Response(RAW[:-1]), Response(RAW[:-2] + b"xx"),
                 Response(headers={"Content-Encoding": "gzip"}), Response(headers={"Content-Type": "text/html"})]
        for response in cases:
            with self.subTest(headers=response.headers), self.assertRaises(quote.QuoteAttachmentError):
                quote.download_quote(SimpleNamespace(), SIGNED, request()["quote"],
                                     opener=SimpleNamespace(open=lambda req, timeout: response))
        for url in [quote.ORIGIN + "/staff/project-purchase-order-print/1421/sent/1", "https://foreign.invalid/a.pdf",
                    "http://storage.googleapis.com/bucket/quote.pdf", SIGNED + "&send=1"]:
            with self.subTest(url=url), self.assertRaises(quote.QuoteAttachmentError):
                quote.validated_download_url(url)


class NativeSnapshotScriptTests(unittest.TestCase):
    def test_browser_readers_scope_fields_and_model_uid_to_the_exact_native_form(self):
        script = """
const fs=require('node:fs'), input=JSON.parse(fs.readFileSync(0,'utf8'));
global.location={origin:'https://lennox.nexvia.com.au',pathname:'/staff/project-purchase-order-add/60',href:'https://lennox.nexvia.com.au/staff/project-purchase-order-add/60?type=Assembly'};
const fields=[{name:'form[Lines]',value:'[{"id":null,"uid":"bound-model"}]'},
 {name:'form[ServiceId]',value:'8'},{name:'form[CurrencyId]',value:'8'},{name:'form[Comment]',value:''}];
const model={uid:'bound-model',toJSON:()=>({id:'bound-model',is_new:true})};
const grid={columns:[{field:'item_description'}],dataSource:{data:()=>[model]}};
const form={action:location.href,method:'post',querySelector:()=>fields[0],
 querySelectorAll:selector=>selector==='[name]'?fields:selector==='[data-role="grid"],.k-grid'?[{grid}]:[]};
const other={action:'https://lennox.nexvia.com.au/staff/source',querySelector:()=>({value:'wrong form'})};
global.window={jQuery:element=>({data:()=>element.grid})};
global.document={forms:[other,form],scripts:[],body:{innerText:''},querySelectorAll:()=>[],
 getElementsByName:()=>{throw Error('Global named fields must not be read');}};
const upload=new Function('return ('+input.upload+');')(), identity=new Function('return ('+input.identity+');')();
const valid=upload({filename:'quote.pdf'}), bound=identity();
fields.push({name:'form[Lines]',value:'[]'});
const duplicated=upload({filename:'quote.pdf'});
process.stdout.write(JSON.stringify({valid,bound,duplicated}));
"""
        completed = subprocess.run(["node", "-e", script], input=json.dumps({
            "upload": quote._UPLOAD_STATE_JS, "identity": quote._NATIVE_MODEL_IDENTITY_JS,
        }), text=True, capture_output=True, timeout=15, check=True)
        result = json.loads(completed.stdout)
        self.assertTrue(result["valid"]["formFieldsValid"])
        self.assertEqual(result["valid"]["service"], "8")
        self.assertEqual(result["valid"]["currency"], "8")
        self.assertEqual(result["valid"]["lines"], [{"id": None, "uid": "bound-model"}])
        self.assertEqual(result["bound"], {"uid": "bound-model", "row": {"id": "bound-model", "is_new": True}})
        self.assertFalse(result["duplicated"]["formFieldsValid"], "duplicate Lines controls must fail closed")

    def test_browser_snapshot_compiles_and_binds_exact_selected_file_to_live_grid(self):
        cases = [
            {"path": "/staff/project-purchase-order-add/60", "state": {"linesEmpty": False, "lines": [{"id": None, "uid": "native-id"}], "numbers": [], "ids": []},
             "args": {"filename": "Supplier quote.pdf", "bytes": len(RAW)}},
            {"path": "/staff/project-purchase-order-add/60", "state": {"linesEmpty": False, "lines": [{"id": None, "uid": "native-id"}], "numbers": [], "ids": ["419"]},
             "args": {"filename": "Supplier quote.pdf", "bytes": len(RAW)}},
            {"path": "/staff/project-purchase-order-modify/60/1421", "state": {"linesEmpty": False, "numbers": ["PO7413"], "ids": ["419"]},
             "args": {"filename": "Supplier quote.pdf", "bytes": len(RAW)}},
            {"path": "/staff/project-purchase-order-add/60", "state": {"linesEmpty": True, "lines": [], "numbers": [], "ids": []},
             "afterState": {"linesEmpty": False, "lines": [{"id": None, "uid": "native-id"}], "numbers": [], "ids": []},
             "args": {"filename": "Supplier quote.pdf", "bytes": len(RAW)}},
            {"path": "/staff/project-purchase-order-add/60", "state": {"linesEmpty": False, "lines": [{"id": None, "uid": "native-id"}], "numbers": [], "ids": []},
             "staleFields": True, "args": {"filename": "Supplier quote.pdf", "bytes": len(RAW)}},
        ]
        script = """
const fs=require('node:fs'), input=JSON.parse(fs.readFileSync(0,'utf8'));
// Compile the complete real reader before replacing its DOM readers.
if(typeof new Function('return ('+input.source+');')()!=='function')throw Error('reader missing');
const results=input.cases.map(c=>{
 global.location={pathname:c.path};
 global.fixtureState=c.state;global.afterState=c.afterState;global.staleFields=c.staleFields;
 const source=input.source.split(input.uploadReader).join('args => global.fixtureState')
   .split(input.allocationReader).join('(attachment=null) => {if(global.afterState)global.fixtureState=global.afterState;return {attachment,rows:[{id:"native-id"}],fields:[["form[Lines]",JSON.stringify(global.staleFields?[]:global.fixtureState.lines)]]};}')
   .split(input.identityReader).join('() => ({uid:"native-id",row:{id:"native-id"}})');
 return new Function('return ('+source+');')()(c.args);
});
process.stdout.write(JSON.stringify(results));
"""
        completed = subprocess.run(["node", "-e", script], input=json.dumps({
            "source": quote.NATIVE_STATE_JS, "uploadReader": quote._UPLOAD_STATE_JS,
            "allocationReader": quote.ALLOCATION_STATE_JS,
            "identityReader": quote._NATIVE_MODEL_IDENTITY_JS, "cases": cases,
        }), text=True, capture_output=True, timeout=15, check=True)
        results = json.loads(completed.stdout)
        self.assertEqual(results[0]["nativeSnapshot"]["attachment"], None)
        self.assertEqual(results[0]["nativeRowUid"], "native-id")
        self.assertEqual(results[1]["nativeSnapshot"]["attachment"], {
            "filename": "Supplier quote.pdf", "bytes": len(RAW), "nativeFileIds": [419]})
        self.assertNotIn("nativeSnapshot", results[2], "saved-PO inspection must not capture a draft proof")
        self.assertFalse(results[3]["linesEmpty"], "the hidden-field snapshot must follow native FormData serialization")
        self.assertEqual(json.loads(results[3]["nativeSnapshot"]["fields"][0][1]), results[3]["lines"])
        self.assertIsNone(results[4]["nativeSnapshot"], "conflicting FormData and hidden Lines must remain rejected")


class SavedProofTests(unittest.TestCase):
    setUp = QuoteEvidenceTests.setUp
    tearDown = QuoteEvidenceTests.tearDown

    def saved_fixture(self):
        quote.begin_upload(self.folder, self.request, PATH)
        receipt = quote.complete_upload(self.folder, self.request, PATH, [419])
        target = quote.ORIGIN + "/staff/project-purchase-order-modify/60/1421"
        result = {"state": "CREATED_VERIFIED", "requestReference": self.request["reference"],
                  "projectPageId": 60, "purchaseOrderId": 1421, "purchaseOrderNumber": "PO7413", "url": target,
                  "totalCents": self.request["totalCents"], "verifiedAt": "2026-11-14T00:00:00.123456+00:00",
                  "jobId": 262, "requestorEmailSent": False}
        save(self.folder / "nexvia-result.json", result)
        from nexvia_requests import verified_result
        result = verified_result(self.folder, self.request)
        state = {**native_state(), "url": target, "numbers": ["PO7413"], "comment": "Request reference: " + self.request["reference"],
                 "ids": ["419", "777"], "cards": [{"url": quote.ORIGIN + "/staff/file-download/60/419", "pathIds": ["60", "419"]}]}
        page = NativePage(state)
        page.goto = lambda url, **kwargs: SimpleNamespace(status=200)
        page.wait_for_timeout = lambda value: None
        closed, options, guards = [], {}, []
        context = SimpleNamespace(route=lambda pattern, callback: guards.append(callback),
                                  route_web_socket=lambda *args: None, add_init_script=lambda source: None,
                                  new_page=lambda: page, close=lambda: closed.append(True))

        def owned_context(**kwargs):
            options.update(kwargs)
            return context

        original = SimpleNamespace(pages=[SimpleNamespace(url=quote.ORIGIN + PATH)],
                                   storage_state=lambda: {"cookies": [{"domain": ".nexvia.com.au", "value": "private"},
                                                                      {"domain": "foreign.invalid", "value": "private"}], "origins": []})
        browser = SimpleNamespace(contexts=[original], new_context=owned_context)
        return receipt, result, page, browser, closed, options, guards

    def test_saved_quote_is_read_back_without_source_bytes_or_another_upload(self):
        receipt, result, page, browser, closed, options, guards = self.saved_fixture()
        self.source.unlink()
        with patch.object(quote.time, "time", return_value=self.transfer["expiresAt"] + 1):
            proof = quote.verify_saved_quote(self.folder, self.request, result, receipt, browser=browser,
                                             downloader=lambda *args: RAW)
        self.assertEqual(proof["nativeFileIds"], [419])
        self.assertEqual(proof["uploadReceiptHash"], receipt["receiptHash"])
        self.assertEqual(proof["sha256"], self.request["quote"]["sha256"])
        self.assertEqual(closed, [True])
        self.assertEqual(page.file_selections, 0)
        self.assertEqual(options["service_workers"], "block")
        self.assertFalse(options["accept_downloads"])
        self.assertEqual(len(options["storage_state"]["cookies"]), 1)
        actions = []
        for method, url, kind in [("POST", result["url"], "document"),
                                  ("GET", quote.ORIGIN + "/staff/project-purchase-order-print/1421/sent/1", "document")]:
            guards[0](SimpleNamespace(request=SimpleNamespace(method=method, url=url, resource_type=kind),
                                      continue_=lambda: actions.append("allowed"), abort=lambda: actions.append("blocked")))
        self.assertEqual(actions, ["blocked", "blocked"])

    def test_saved_quote_rejects_wrong_number_ids_bytes_and_changed_result(self):
        receipt, result, page, browser, closed, options, guards = self.saved_fixture()
        original = copy.deepcopy(page.state)
        for changes in [{"numbers": ["PO9999"]}, {"ids": ["777"]}, {"comment": "Different request"}]:
            page.state = {**original, **changes}
            with self.subTest(changes=changes), self.assertRaises(quote.QuoteAttachmentError):
                quote.verify_saved_quote(self.folder, self.request, result, receipt, browser=browser,
                                          downloader=lambda *args: RAW)
        page.state = original
        with self.assertRaises(quote.QuoteAttachmentError):
            quote.verify_saved_quote(self.folder, self.request, result, receipt, browser=browser,
                                      downloader=lambda *args: RAW + b"wrong")
        with self.assertRaises(quote.QuoteAttachmentError):
            quote.verify_saved_quote(self.folder, self.request, {**result, "purchaseOrderId": 999}, receipt,
                                      browser=browser, downloader=lambda *args: RAW)
        self.assertEqual(page.file_selections, 0)

    def test_preflight_checks_policy_and_completion_without_file_selection(self):
        report = {"readOnly": True, "fileSelectionInvoked": False, "uploadOrSaveInvoked": False,
                  "addPage": {"available": True, "emptyUnsavedPostForm": True,
                              "fileInputs": [{"widgets": [{"params": {"type": "POST", "autoUpload": True},
                                                           "routes": [{"destination": {"provider": "gcs", "scheme": "https", "pathClass": "root"}}]}]}],
                              "handlers": [{"formDataFields": sorted(quote.POLICY_FIELDS), "mentionsFilesField": True,
                                            "routes": [{"path": "/staff/upload/details/"}]}]}}
        with patch.object(quote, "check_dependencies", return_value=True), \
                patch("nexvia_inspect_quote_upload.inspect_browser", return_value=report):
            ready = quote.preflight(60, 1421, "PO7413", "Bunnings", browser=object())
            self.assertTrue(ready["nativeUploadReady"])
            self.assertFalse(ready["fileSelectionInvoked"])
            self.assertFalse(ready["uploadOrSaveInvoked"])
            report["addPage"]["available"] = False
            with self.assertRaises(quote.QuoteAttachmentError):
                quote.preflight(60, 1421, "PO7413", "Bunnings", browser=object())


if __name__ == "__main__":
    unittest.main()
