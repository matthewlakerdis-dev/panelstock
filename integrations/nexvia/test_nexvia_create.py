import copy
from contextlib import nullcontext
from datetime import datetime, timedelta, timezone
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch


DIRECTORY = Path(__file__).parent
sys.path.insert(0, str(DIRECTORY))
spec = importlib.util.spec_from_file_location("nexvia_create", DIRECTORY / "nexvia_create.py")
creator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(creator)
from nexvia_allocations import allocation_from_native


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
    allocation = allocation_from_native(request, {"fields": fields, "rows": [row], "bindings": []})
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


class CreatorTests(unittest.TestCase):
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
                             ("project_cost_to_complete_link_id", 99)]:
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
