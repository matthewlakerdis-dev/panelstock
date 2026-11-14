import copy
from contextlib import nullcontext
from datetime import datetime, timedelta, timezone
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import time
from types import SimpleNamespace, ModuleType
import unittest
from unittest.mock import Mock, patch


DIRECTORY = Path(__file__).parent
sys.path.insert(0, str(DIRECTORY))
spec = importlib.util.spec_from_file_location("nexvia_create", DIRECTORY / "nexvia_create.py")
creator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(creator)
from nexvia_allocations import allocation_from_native
import nexvia_quote_attachment as quote_attachment


def payload(eow="ew_734"):
    return {
        "requestId": "7d913213-5be7-4271-a0fa-9ed1462367f4", "reference": "PR-12345678",
        "projectPageId": 60, "supplierId": "225", "serviceId": "8", "breakdownType": eow,
        "date": "2026-11-13", "quote": None, "supplierReference": "Supplier quote",
        "requestor": {"name": "Test requester", "email": "test@example.invalid"},
        "lines": [{"description": "Purchase materials", "quantity": "1", "unitPriceExGst": "1000",
                   "chartOfAccountId": "401", "taxRateId": "17", "breakdownType": eow}],
        "subtotalCents": 100000, "taxCents": 10000, "totalCents": 110000,
    }


def choices():
    return {"projectPageId": 60, "accounts": [{"id": 401, "name": "Materials", "type": "Cost of Goods Sold"}],
            "taxes": [{"id": 17, "rate": "10"}, {"id": 27, "rate": "0"}]}


def captured(request, canonical=True):
    fields = [["form[ServiceId]", "8"], ["form[CurrencyId]", "8"],
              ["form[Lines]", "[]"], ["form[BreakdownType]", request["breakdownType"]],
              ["form[Token]", "private-session-value"], ["form[Email]", "true"],
              ["form[Files][]", ""], ["form[TaxInclusive]", "false"]]
    row = {"id": None, "is_new": True, "item_description": "", "job_id": 262,
           "default_job_id": 262, "budget_item_category_id": None,
           "budget_item_id": 583, "assembly_id": 919, "currency_id": 8,
           "curr_alpha3": "AUD", "curr_rate": 1}
    if canonical:
        row["breakdown_type"] = request["breakdownType"]
    options = {} if request.get("quote") is None else {"quote_attachment": request["quote"]}
    allocation = allocation_from_native(request, {"fields": fields, "rows": [row], "bindings": []}, **options)
    return {"fields": fields, "nativeTemplate": row, "allocation": allocation,
            "createPath": "/staff/project-purchase-order-add/60?type=Assembly&service=8&client=225&breakdown_type="
                          + request["breakdownType"]}


def prepared(request=None, canonical=True):
    request = request or payload()
    with tempfile.TemporaryDirectory() as folder, \
            patch.object(creator, "refresh_and_validate", return_value=choices()), \
            patch.object(creator, "native_line_editor", return_value=nullcontext(editor(request, canonical))), \
            patch.object(creator, "account_tax_for_editor", return_value=choices()):
        return creator.prepare(Mock(), request, Path(folder))


def editor(request, canonical=True):
    captured_form = captured(request, canonical)
    return {"fields": captured_form["fields"], "rows": [captured_form["nativeTemplate"]],
            "bindings": [], "createPath": captured_form["createPath"], "page": Mock()}


def rehash(document):
    document["preparedHash"] = creator.digest({key: value for key, value in document.items()
                                               if key != "preparedHash"})
    return document["preparedHash"]


class FakePage:
    def __init__(self, result):
        self.result = result
        self.closed = False
        self.guards = []

    def route(self, pattern, handler):
        self.guards.append(handler)

    def goto(self, url, **options):
        self.url = url

    def locator(self, selector):
        return SimpleNamespace(wait_for=lambda **options: None)

    def evaluate(self, script):
        return copy.deepcopy(self.result)

    def close(self):
        self.closed = True


def saved_result(request, document):
    rows = json.loads(creator.one(document["fields"], "form[Lines]"))
    for row in rows:
        row.update(id=987, is_new=False)
    return {"text": "Purchase Order # PO9999", "lines": rows,
            "service": request["serviceId"], "comment": "Request reference: " + request["reference"]}


def stage_quote(folder, request):
    raw = b"%PDF-1.7\nSynthetic supplier quote\n%%EOF"
    request["quote"] = {"filename": "Supplier quote.pdf", "bytes": len(raw),
                        "sha256": creator.hashlib.sha256(raw).hexdigest()}
    creator.save(folder / "request.json", request)
    (folder / quote_attachment.SOURCE_FILE).write_bytes(raw)
    (folder / quote_attachment.SOURCE_FILE).chmod(0o600)
    now = time.time()
    creator.save(folder / quote_attachment.TRANSFER_FILE, {
        "version": 1, "id": request["requestId"], "workerId": "a4021607-322d-461f-8ca9-c60287708415",
        "claimToken": "synthetic-private-claim-token", "quote": request["quote"], "createdAt": now,
        "expiresAt": now + quote_attachment.SOURCE_TTL_SECONDS})


def uploaded_receipt(folder, request, create_path, file_id=801):
    receipt = {**quote_attachment.binding(request, create_path), "nativeFileIds": [file_id],
               "uploadedAt": datetime.now(timezone.utc).isoformat()}
    receipt["receiptHash"] = quote_attachment.digest(receipt)
    creator.save(folder / quote_attachment.RECEIPT_FILE, receipt)
    return receipt


def prepare_quote(folder, request, finance=None, upload=None):
    native = editor(request)
    fields = [row for row in native["fields"] if row[0] != "form[Files][]"] + [["form[Files][]", "801"]]
    native["page"] = SimpleNamespace(url=creator.BASE + native["createPath"],
                                    evaluate=Mock(return_value={"fields": fields}))
    with patch.object(creator, "refresh_and_validate", return_value=choices()), \
            patch.object(creator, "native_line_editor", return_value=nullcontext(native)), \
            patch.object(creator, "account_tax_for_editor", return_value=finance or choices()), \
            patch.object(quote_attachment, "upload_quote", create=True,
                         side_effect=upload or (lambda page, location, value, path:
                                                uploaded_receipt(location, value, path))):
        return creator.prepare(Mock(), request, folder)


class CreatorTests(unittest.TestCase):
    def test_quote_browser_context_clones_only_nexvia_auth_and_blocks_extra_channels(self):
        original_pages = [SimpleNamespace(url=creator.BASE + "/staff/projects")]
        source = Mock(pages=original_pages)
        source.storage_state.return_value = {
            "cookies": [{"domain": ".nexvia.com.au", "name": "session", "value": "private"},
                        {"domain": "other.invalid", "name": "unrelated", "value": "private"}],
            "origins": [{"origin": creator.BASE, "localStorage": []},
                        {"origin": "https://other.invalid", "localStorage": []}],
        }
        owned = Mock(pages=[])
        browser = SimpleNamespace(new_context=Mock(return_value=owned))
        with creator.quote_browser_context(browser, source) as context:
            self.assertIs(context, owned)
            browser.new_context.assert_called_once_with(storage_state={
                "cookies": [source.storage_state.return_value["cookies"][0]],
                "origins": [source.storage_state.return_value["origins"][0]],
            }, service_workers="block", accept_downloads=False)
            route = Mock()
            owned.route.call_args.args[1](route)
            route.abort.assert_called_once()
            route.continue_.assert_not_called()
            socket = Mock()
            owned.route_web_socket.call_args.args[1](socket)
            socket.close.assert_called_once()
            self.assertIn("window.open=()=>null", owned.add_init_script.call_args.args[0])
            self.assertIn("window.print=()=>undefined", owned.add_init_script.call_args.args[0])
            page, popup = Mock(), Mock()
            owned.pages = [page]
            owned.on.call_args.args[1](page)
            page.close.assert_not_called()
            owned.pages.append(popup)
            owned.on.call_args.args[1](popup)
            popup.close.assert_called_once()
        owned.close.assert_called_once()
        self.assertEqual(source.pages, original_pages)
        source.route.assert_not_called()
        source.route_web_socket.assert_not_called()
        source.add_init_script.assert_not_called()
        source.close.assert_not_called()

    def test_quote_browser_context_closes_on_operation_or_guard_setup_failure(self):
        source = Mock()
        source.storage_state.return_value = {"cookies": [], "origins": []}
        for fail_setup in (False, True):
            owned = Mock(pages=[])
            if fail_setup:
                owned.route_web_socket = None
            browser = SimpleNamespace(new_context=Mock(return_value=owned))
            with self.subTest(fail_setup=fail_setup), self.assertRaises(ValueError):
                with creator.quote_browser_context(browser, source):
                    raise ValueError("synthetic operation failure")
            owned.close.assert_called_once()
            source.close.assert_not_called()

    def test_cli_uses_owned_quote_context_and_preserves_legacy_context(self):
        for with_quote in (False, True):
            for submitting in (False, True):
                request = payload()
                with tempfile.TemporaryDirectory() as temporary:
                    root = Path(temporary)
                    folder = root / request["requestId"]
                    folder.mkdir(mode=0o700)
                    if with_quote:
                        stage_quote(folder, request)
                    else:
                        creator.save(folder / "request.json", request)
                    document = {"jobId": 262, "preparedHash": "a" * 64}
                    creator.save(folder / "nexvia-prepared.json", document)
                    source = Mock(pages=[SimpleNamespace(url=creator.BASE + "/staff/projects")])
                    source.storage_state.return_value = {"cookies": [], "origins": []}
                    owned = Mock(pages=[])
                    browser = SimpleNamespace(contexts=[source], new_context=Mock(return_value=owned))
                    playwright = SimpleNamespace(chromium=SimpleNamespace(connect_over_cdp=Mock(return_value=browser)))
                    fake_module = ModuleType("playwright.sync_api")
                    fake_module.sync_playwright = lambda: nullcontext(playwright)
                    arguments = ["--request", request["requestId"]]
                    if submitting:
                        arguments += ["--submit", document["preparedHash"]]
                    with patch.dict(sys.modules, {"playwright.sync_api": fake_module}), \
                            patch.object(creator, "ROOT", root), \
                            patch.object(creator, "prepare", return_value=document) as prepare, \
                            patch.object(creator, "submit", return_value={"state": "CREATED_VERIFIED"}) as submit, \
                            patch("builtins.print"):
                        creator.main(arguments)
                    expected = owned if with_quote else source
                    with self.subTest(with_quote=with_quote, submitting=submitting):
                        if submitting:
                            submit.assert_called_once_with(expected, request, document, folder, document["preparedHash"])
                            prepare.assert_not_called()
                        else:
                            prepare.assert_called_once_with(expected, request, folder)
                            submit.assert_not_called()
                        if with_quote:
                            owned.close.assert_called_once()
                        else:
                            browser.new_context.assert_not_called()
                            owned.close.assert_not_called()
                        source.route.assert_not_called()
                        source.close.assert_not_called()

    def test_managed_quote_native_receipt_is_frozen_before_the_one_create_post(self):
        request = payload()
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            stage_quote(folder, request)
            document = prepare_quote(folder, request)
            self.assertEqual(document["quoteReceipt"]["quote"], request["quote"])
            self.assertEqual(creator.one(document["fields"], "form[Files][]"), "801")
            self.assertEqual(creator.digest({key: value for key, value in document.items()
                                            if key != "preparedHash"}), document["preparedHash"])
            response = SimpleNamespace(status=302,
                headers={"location": "/staff/project-purchase-order-modify/60/12345"},
                body=lambda: b"private server response")
            page = FakePage(saved_result(request, document))
            context = SimpleNamespace(request=SimpleNamespace(post=Mock(return_value=response)),
                                      new_page=lambda: page)
            result = creator.submit(context, request, document, folder, document["preparedHash"])
            self.assertEqual(result["state"], "CREATED_VERIFIED")
            self.assertNotIn("quoteReceipt", result)
            self.assertEqual(creator.read_json(folder / "nexvia-result.json"), result)
            self.assertTrue((folder / quote_attachment.SOURCE_FILE).exists())
            posted = context.request.post.call_args.kwargs["data"]
            self.assertEqual(posted.count(b"form%5BFiles%5D%5B%5D=801"), 1)
            self.assertNotIn(b"%PDF-", posted)
            for action in ("Print", "Email", "Outlook", "MarkSent", "Stock", "EditStock"):
                self.assertIn(("form%5B" + action + "%5D=false").encode(), posted)
            with self.assertRaisesRegex(ValueError, "do not retry"):
                creator.submit(context, request, document, folder, document["preparedHash"])
            context.request.post.assert_called_once()

    def test_managed_quote_invalid_finance_never_starts_native_upload(self):
        request = payload()
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            stage_quote(folder, request)
            finance = choices()
            finance["taxes"][0]["rate"] = "9"
            upload = Mock()
            with self.assertRaisesRegex(ValueError, "totals"):
                prepare_quote(folder, request, finance=finance, upload=upload)
            upload.assert_not_called()
            self.assertFalse((folder / "nexvia-prepared.json").exists())
            self.assertFalse((folder / "nexvia-create-attempt.json").exists())

    def test_managed_quote_preparation_reentry_uses_receipt_without_source_or_upload(self):
        request = payload()
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            stage_quote(folder, request)
            document = prepare_quote(folder, request)
            (folder / quote_attachment.SOURCE_FILE).unlink()
            (folder / quote_attachment.TRANSFER_FILE).unlink()
            with patch.object(quote_attachment, "verify_source") as source, \
                    patch.object(quote_attachment, "upload_quote", create=True) as upload, \
                    patch.object(creator, "native_line_editor") as editor_call, \
                    patch.object(creator, "refresh_and_validate") as refresh:
                self.assertEqual(creator.prepare(Mock(), request, folder), document)
                source.assert_not_called()
                upload.assert_not_called()
                editor_call.assert_not_called()
                refresh.assert_not_called()
            creator.validate_prepared(document, request, document["preparedHash"])

    def test_managed_quote_receipt_or_attempt_without_preparation_never_reuploads(self):
        for filename in (quote_attachment.ATTEMPT_FILE, quote_attachment.RECEIPT_FILE):
            request = payload()
            with tempfile.TemporaryDirectory() as temporary:
                folder = Path(temporary)
                stage_quote(folder, request)
                creator.save(folder / filename, {"partial": True})
                with patch.object(quote_attachment, "upload_quote", create=True) as upload, \
                        patch.object(creator, "native_line_editor") as editor_call:
                    with self.subTest(filename=filename), self.assertRaisesRegex(ValueError, "already started"):
                        creator.prepare(Mock(), request, folder)
                    upload.assert_not_called()
                    editor_call.assert_not_called()

    def test_managed_quote_source_is_verified_before_opening_native_editor(self):
        request = payload()
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            stage_quote(folder, request)
            (folder / quote_attachment.SOURCE_FILE).write_bytes(b"changed source bytes")
            with patch.object(quote_attachment, "upload_quote", create=True) as upload, \
                    patch.object(creator, "refresh_and_validate") as refresh, \
                    patch.object(creator, "native_line_editor") as editor_call:
                with self.assertRaisesRegex(ValueError, "matching PDF"):
                    creator.prepare(Mock(), request, folder)
                upload.assert_not_called()
                refresh.assert_not_called()
                editor_call.assert_not_called()

    def test_managed_quote_uncertain_upload_never_repeats_or_creates(self):
        request = payload()
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            stage_quote(folder, request)

            def uncertain_upload(page, location, value, path):
                quote_attachment.begin_upload(location, value, path)
                raise TimeoutError("synthetic uncertain native upload")

            upload = Mock(side_effect=uncertain_upload)
            with self.assertRaises(TimeoutError):
                prepare_quote(folder, request, upload=upload)
            with self.assertRaisesRegex(ValueError, "already started"):
                prepare_quote(folder, request, upload=upload)
            upload.assert_called_once()
            self.assertFalse((folder / "nexvia-create-attempt.json").exists())
            self.assertFalse((folder / "nexvia-prepared.json").exists())

    def test_managed_quote_prepared_files_and_receipt_cannot_be_substituted(self):
        request = payload()
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            stage_quote(folder, request)
            document = prepare_quote(folder, request)
            for values in ([], ["802"], ["801", "801"], ["", "801"]):
                changed = copy.deepcopy(document)
                changed["fields"] = [row for row in changed["fields"] if row[0] != "form[Files][]"]
                changed["fields"] += [["form[Files][]", value] for value in values]
                with self.subTest(values=values), self.assertRaises(ValueError):
                    creator.validate_prepared(changed, request, rehash(changed))
            changed = copy.deepcopy(document)
            changed["quoteReceipt"]["quote"]["sha256"] = "0" * 64
            changed["quoteReceipt"]["receiptHash"] = quote_attachment.digest({
                key: value for key, value in changed["quoteReceipt"].items() if key != "receiptHash"})
            with self.assertRaisesRegex(ValueError, "different request"):
                creator.validate_prepared(changed, request, rehash(changed))
            uploaded_receipt(folder, request, document["createPath"], file_id=802)
            context = Mock()
            with self.assertRaisesRegex(ValueError, "receipt changed"):
                creator.submit(context, request, document, folder, document["preparedHash"])
            context.request.post.assert_not_called()
            self.assertFalse((folder / "nexvia-create-attempt.json").exists())

    def test_private_files_are_tightened_before_contents_with_inherited_permissions(self):
        request, document = payload(), prepared()
        original_open, original_fchmod = os.open, os.fchmod
        original_dump = json.dump
        writes = []

        def inherited_open(path, flags, *args, **kwargs):
            descriptor = original_open(path, flags, *args, **kwargs)
            if flags & os.O_CREAT:
                # Synology can inherit directory permissions instead of the
                # restrictive mode supplied to os.open.
                original_fchmod(descriptor, 0o666)
            return descriptor

        def private_dump(value, stream, *args, **kwargs):
            self.assertEqual(os.fstat(stream.fileno()).st_mode & 0o777, 0o600)
            writes.append(value)
            return original_dump(value, stream, *args, **kwargs)

        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)

            def response_body():
                self.assertEqual((folder / "nexvia-create-response.html").stat().st_mode & 0o777,
                                 0o600)
                return b"private server response"

            response = SimpleNamespace(status=200, headers={}, body=response_body)
            context = SimpleNamespace(request=SimpleNamespace(post=Mock(return_value=response)))
            with patch.object(creator.os, "open", side_effect=inherited_open), \
                    patch.object(creator.json, "dump", side_effect=private_dump):
                creator.save(folder / "nexvia-prepared.json", document)
                with self.assertRaisesRegex(ValueError, "Do not retry"):
                    creator.submit(context, request, document, folder, document["preparedHash"])
            self.assertEqual(len(writes), 3)
            for name in ("nexvia-prepared.json", "nexvia-create-attempt.json",
                         "nexvia-create-response.html"):
                self.assertEqual((folder / name).stat().st_mode & 0o777, 0o600)
            context.request.post.assert_called_once()

    def test_preparation_uses_native_links_and_current_tax_without_submitting(self):
        request = payload()
        context = Mock()
        with tempfile.TemporaryDirectory() as temporary, \
                patch.object(creator, "refresh_and_validate", return_value=choices()) as refresh, \
                patch.object(creator, "native_line_editor", return_value=nullcontext(editor(request))), \
                patch.object(creator, "account_tax_for_editor", return_value=choices()):
            folder = Path(temporary)
            document = creator.prepare(context, request, folder)
            refresh.assert_called_once_with(request, context, creator.CONFIG_ROOT)
            context.request.post.assert_not_called()
            self.assertEqual(document["allocation"]["version"], 2)
            lines = creator.validate_prepared(document, request, document["preparedHash"])
            self.assertEqual((lines[0]["budget_item_id"], lines[0]["assembly_id"]), (583, 919))
            self.assertIsNone(lines[0]["budget_item_category_id"])
            self.assertEqual((lines[0]["tax_rate_id"], lines[0]["tax_rate"]), (17, 10))
            self.assertEqual(creator.one(document["fields"], "form[Email]"), "false")
            self.assertEqual(creator.one(document["fields"], "form[Token]"), "private-session-value")
            self.assertEqual((folder / "nexvia-prepared.json").stat().st_mode & 0o777, 0o600)

    def test_noncanonical_eow_uses_native_form_proof(self):
        request = payload("custom_47")
        document = prepared(request, canonical=False)
        rows = creator.validate_prepared(document, request, document["preparedHash"])
        self.assertNotIn("breakdown_type", rows[0])
        self.assertEqual(document["allocation"]["eowProof"][0]["source"], "form")
        document["fields"] = creator.replace(document["fields"], "form[BreakdownType]", "custom_48")
        with self.assertRaisesRegex(ValueError, "EOW form identity"):
            creator.validate_prepared(document, request, rehash(document))

    def test_fresh_finance_for_exact_request_blocks_changed_tax_or_unavailable_cos(self):
        request = payload()
        for change in (lambda live: live["taxes"][0].update(rate="9"),
                       lambda live: live.update(accounts=[]),
                       lambda live: live["accounts"][0].update(disabled=True),
                       lambda live: live["accounts"][0].update(type="Expense")):
            finance = choices()
            change(finance)
            context, native = Mock(), editor(request)
            with tempfile.TemporaryDirectory() as temporary, \
                    patch.object(creator, "refresh_and_validate", return_value=choices()), \
                    patch.object(creator, "native_line_editor", return_value=nullcontext(native)) as open_editor, \
                    patch.object(creator, "account_tax_for_editor", return_value=finance) as fresh:
                with self.subTest(finance=finance), self.assertRaises(ValueError):
                    creator.prepare(context, request, Path(temporary))
                open_editor.assert_called_once_with(context, request)
                fresh.assert_called_once_with(native["page"])
                context.request.post.assert_not_called()
                self.assertEqual(list(Path(temporary).iterdir()), [])

    def test_allocation_and_fields_are_captured_before_finance_editors_activate(self):
        request, native = payload(), editor(payload())

        def activate_finance(page):
            self.assertIs(page, native["page"])
            native["rows"][0]["assembly_id"] = 999
            native["fields"].append(["form[Email]", "true"])
            return choices()

        with tempfile.TemporaryDirectory() as temporary, \
                patch.object(creator, "refresh_and_validate", return_value=choices()), \
                patch.object(creator, "native_line_editor", return_value=nullcontext(native)), \
                patch.object(creator, "account_tax_for_editor", side_effect=activate_finance):
            document = creator.prepare(Mock(), request, Path(temporary))
        self.assertEqual(document["allocation"]["allocationFields"]["assembly_id"], 919)
        self.assertEqual(creator.one(document["fields"], "form[Email]"), "false")

    def test_changed_hash_request_or_allocation_never_authorizes(self):
        request = payload()
        document = prepared(request)
        for change in (lambda doc: doc.update(totalCents=1),
                       lambda doc: doc["fields"].append(["form[Email]", "false"])):
            changed = copy.deepcopy(document)
            change(changed)
            with self.assertRaisesRegex(ValueError, "hash mismatch"):
                creator.validate_prepared(changed, request, document["preparedHash"])
        request["lines"][0]["description"] = "Changed"
        with self.assertRaisesRegex(ValueError, "Request changed"):
            creator.validate_prepared(document, request, document["preparedHash"])
        request = payload()
        rows = json.loads(creator.one(document["fields"], "form[Lines]"))
        rows[0]["assembly_id"] = 734
        document["fields"] = creator.replace(document["fields"], "form[Lines]", json.dumps(rows))
        with self.assertRaisesRegex(ValueError, "assembly_id"):
            creator.validate_prepared(document, request, rehash(document))

    def test_recomputed_unsafe_action_or_destination_is_rejected(self):
        request = payload()
        for action, value in (("Email", "true"), ("Approve", "1"), ("NewJobId", "999")):
            document = prepared(request)
            document["fields"] = creator.replace(document["fields"], "form[" + action + "]", value)
            with self.subTest(action=action), self.assertRaisesRegex(ValueError, "Unexpected prepared"):
                creator.validate_prepared(document, request, rehash(document))
        for destination in ("https://example.invalid/staff/project-purchase-order-add/60",
                            prepared(request)["createPath"] + "&service=9"):
            document = prepared(request)
            document["createPath"] = destination
            with self.assertRaisesRegex(ValueError, "destination"):
                creator.validate_prepared(document, request, rehash(document))

    def test_stale_future_or_naive_preparation_is_rejected(self):
        request = payload()
        for timestamp in ((datetime.now(timezone.utc) - timedelta(seconds=901)).isoformat(),
                          (datetime.now(timezone.utc) + timedelta(seconds=5)).isoformat(),
                          "2026-11-13T00:00:00"):
            document = prepared(request)
            document["preparedAt"] = timestamp
            with self.subTest(timestamp=timestamp), self.assertRaisesRegex(ValueError, "Preparation"):
                creator.validate_prepared(document, request, rehash(document))

    def test_pdf_cannot_be_prepared_or_submitted(self):
        request = payload()
        request["quote"] = {"filename": "quote.pdf"}
        with self.assertRaisesRegex(ValueError, "PDF submission"), patch.object(creator.subprocess, "run") as run:
            creator.refresh_and_validate(request, Mock())
        run.assert_not_called()

    def test_refresh_validates_with_import_safe_live_helper(self):
        request, context = payload(), Mock()
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "nexvia-form-data.json").write_text(json.dumps(choices()))
            with patch.object(creator.subprocess, "run", return_value=SimpleNamespace(returncode=0)) as run, \
                    patch("nexvia_form_data.validate_request") as validate:
                result = creator.refresh_and_validate(request, context, root)
                validate.assert_called_once_with(request, choices(), context)
                self.assertEqual(result, choices())
                self.assertEqual(run.call_args.args[0][1:],
                                 [str(root / "nexvia_form_data.py"), "--project", "60"])
                self.assertEqual(run.call_args.kwargs["timeout"], 90)
            with patch.object(creator.subprocess, "run", return_value=SimpleNamespace(returncode=1)), \
                    patch("nexvia_form_data.validate_request") as validate:
                with self.assertRaisesRegex(ValueError, "Could not refresh"):
                    creator.refresh_and_validate(request, context, root)
                validate.assert_not_called()

    def test_uncertain_post_is_durably_recorded_and_never_retried(self):
        request, context = payload(), Mock()
        document = prepared(request)
        context.request.post.side_effect = TimeoutError("synthetic uncertain timeout")
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            with self.assertRaises(TimeoutError):
                creator.submit(context, request, document, folder, document["preparedHash"])
            self.assertEqual(creator.read_json(folder / "nexvia-create-attempt.json")["state"], "SUBMISSION_STARTED")
            self.assertEqual((folder / "nexvia-create-attempt.json").stat().st_mode & 0o777, 0o600)
            with self.assertRaisesRegex(ValueError, "do not retry"):
                creator.submit(context, request, document, folder, document["preparedHash"])
            context.request.post.assert_called_once()

    def test_invalid_preparation_cannot_write_attempt(self):
        document, request = prepared(), payload()
        with tempfile.TemporaryDirectory() as temporary:
            with self.assertRaisesRegex(ValueError, "hash mismatch"):
                creator.submit(Mock(), request, document, Path(temporary), "0" * 64)
            self.assertEqual(list(Path(temporary).iterdir()), [])

    def test_verified_save_checks_native_links_and_current_tax_rate(self):
        request = payload()
        document = prepared(request)
        actual = saved_result(request, document)
        page = FakePage(actual)
        context = SimpleNamespace(new_page=lambda: page)
        with tempfile.TemporaryDirectory() as temporary:
            result = creator.verify(context, "/staff/project-purchase-order-modify/60/12345", request,
                                    document, Path(temporary))
            self.assertEqual((result["state"], result["purchaseOrderNumber"]), ("CREATED_VERIFIED", "PO9999"))
            self.assertFalse(result["requestorEmailSent"])
            self.assertTrue(page.closed)
            self.assertEqual(creator.read_json(Path(temporary) / "nexvia-result.json"), result)
        for field, value in (("assembly_id", 734), ("tax_rate", 0), ("amount", 1),
                             ("chart_of_account_id", 999), ("qty", 2)):
            changed = copy.deepcopy(actual)
            changed["lines"][0][field] = value
            page = FakePage(changed)
            with tempfile.TemporaryDirectory() as temporary, self.subTest(field=field):
                with self.assertRaises(ValueError):
                    creator.verify(SimpleNamespace(new_page=lambda: page),
                                   "/staff/project-purchase-order-modify/60/12345", request,
                                   document, Path(temporary))
                self.assertFalse((Path(temporary) / "nexvia-result.json").exists())
                self.assertTrue(page.closed)

    def test_saved_server_ownership_and_empty_extra_links_are_verified(self):
        request = payload()
        document = prepared(request)
        actual = saved_result(request, document)
        actual["lines"][0].update(job_purchase_order_id="12345", tender_id=None,
                                  project_cost_to_complete_link_id=None)
        page = FakePage(actual)
        with tempfile.TemporaryDirectory() as temporary:
            result = creator.verify(SimpleNamespace(new_page=lambda: page),
                                    "/staff/project-purchase-order-modify/60/12345", request,
                                    document, Path(temporary))
            self.assertEqual(result["purchaseOrderId"], 12345)
            self.assertTrue(page.closed)
        for field, value in [("job_purchase_order_id", 54321), ("job_purchase_order_id", None),
                             ("job_purchase_order_id", True), ("tender_id", 99),
                             ("project_cost_to_complete_link_id", "99")]:
            changed = copy.deepcopy(actual)
            changed["lines"][0][field] = value
            page = FakePage(changed)
            with tempfile.TemporaryDirectory() as temporary, self.subTest(field=field, value=value):
                with self.assertRaises(ValueError):
                    creator.verify(SimpleNamespace(new_page=lambda: page),
                                   "/staff/project-purchase-order-modify/60/12345", request,
                                   document, Path(temporary))
                self.assertFalse((Path(temporary) / "nexvia-result.json").exists())
                self.assertTrue(page.closed)

    def test_saved_normalization_keeps_owner_content_and_tax_verification_strict(self):
        request = payload()
        document = prepared(request)
        actual = saved_result(request, document)
        actual["lines"][0].update(default_job_id=None, project_cost_to_complete_link_id=918,
                                  tender_id=None, job_purchase_order_id=1422)
        context = SimpleNamespace(new_page=lambda: FakePage(actual), request=Mock())
        with tempfile.TemporaryDirectory() as temporary:
            result = creator.verify(context, "/staff/project-purchase-order-modify/60/1422", request,
                                    document, Path(temporary))
            self.assertEqual(result["purchaseOrderId"], 1422)
            context.request.post.assert_not_called()
        for field, value in [("job_purchase_order_id", 1423), ("job_id", 999),
                             ("default_job_id", 999), ("budget_item_id", 999),
                             ("item_description", "Different goods"), ("tax_rate", 0),
                             ("amount", 1), ("curr_amount", 1), ("unit_price", 1),
                             ("unobserved_project_id", 99)]:
            changed = copy.deepcopy(actual)
            changed["lines"][0][field] = value
            page = FakePage(changed)
            context = SimpleNamespace(new_page=lambda: page, request=Mock())
            with tempfile.TemporaryDirectory() as temporary, self.subTest(field=field):
                with self.assertRaises(ValueError):
                    creator.verify(context, "/staff/project-purchase-order-modify/60/1422", request,
                                   document, Path(temporary))
                self.assertFalse((Path(temporary) / "nexvia-result.json").exists())
                context.request.post.assert_not_called()

    def test_prepared_lines_cannot_inject_an_existing_parent_order(self):
        request = payload()
        document = prepared(request)
        lines = json.loads(creator.one(document["fields"], "form[Lines]"))
        lines[0]["job_purchase_order_id"] = 12345
        document["fields"] = creator.replace(document["fields"], "form[Lines]", json.dumps(lines))
        with self.assertRaisesRegex(ValueError, "purchase-order owner"):
            creator.validate_prepared(document, request, rehash(document))

    def test_saved_order_read_blocks_mutations_and_offsite_redirects(self):
        request, document = payload(), prepared()
        for location in ("https://example.invalid/staff/project-purchase-order-modify/60/1",
                         "/staff/project-purchase-order-modify/61/1", "/staff/project-purchase-order-modify/60/1?email=true"):
            context = Mock()
            with self.subTest(location=location), self.assertRaisesRegex(ValueError, "redirect"):
                creator.verify(context, location, request, document, Path("unused"))
            context.new_page.assert_not_called()
        page = FakePage(saved_result(request, document))
        with tempfile.TemporaryDirectory() as temporary:
            creator.verify(SimpleNamespace(new_page=lambda: page),
                           "/staff/project-purchase-order-modify/60/1", request, document, Path(temporary))
        route = Mock(request=SimpleNamespace(method="POST"))
        page.guards[0](route)
        route.abort.assert_called_once()
        route.continue_.assert_not_called()

    def test_response_needs_review_without_verified_result(self):
        request, document = payload(), prepared()
        response = SimpleNamespace(status=200, headers={}, body=lambda: b"private server response")
        context = SimpleNamespace(request=SimpleNamespace(post=Mock(return_value=response)))
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            with self.assertRaisesRegex(ValueError, "Do not retry"):
                creator.submit(context, request, document, folder, document["preparedHash"])
            self.assertEqual(creator.read_json(folder / "nexvia-create-attempt.json")["state"], "RESPONSE_RECEIVED")
            self.assertEqual((folder / "nexvia-create-response.html").stat().st_mode & 0o777, 0o600)
            self.assertFalse((folder / "nexvia-result.json").exists())

    def test_json_reloaded_form_is_encoded_once_without_following_redirect(self):
        request = payload()
        document = json.loads(json.dumps(prepared(request)))
        response = SimpleNamespace(status=302, headers={"location": "/staff/project-purchase-order-modify/60/12345"},
                                   body=lambda: b"private response")
        context = Mock()
        context.request.post.return_value = response
        with tempfile.TemporaryDirectory() as temporary, \
                patch.object(creator, "verify", return_value={"state": "CREATED_VERIFIED"}) as verify:
            result = creator.submit(context, request, document, Path(temporary), document["preparedHash"])
            self.assertEqual(result["state"], "CREATED_VERIFIED")
            call = context.request.post.call_args
            self.assertEqual(call.kwargs["max_redirects"], 0)
            self.assertIsInstance(call.kwargs["data"], bytes)
            self.assertIn(b"form%5BLines%5D=", call.kwargs["data"])
            self.assertIn(b"form%5BEmail%5D=false", call.kwargs["data"])
            context.request.post.assert_called_once()
            verify.assert_called_once()


if __name__ == "__main__":
    unittest.main()
