import copy
import base64
import hashlib
import io
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from types import SimpleNamespace

import nexvia_requests as bridge
from nexvia_allocations import allocation_from_native, build_lines


REQUEST_ID = "35fc4244-267c-42c6-885c-6ab93a55b899"
WORKER_ID = "fcdb0b39-4f0b-444b-bb9c-cc558463f114"
LOOKUP_ID = "6855170d-b7bf-467d-8a26-0c8fa667f568"
TOKEN = "synthetic-request-bridge-token-1234567890"
CLAIM = "synthetic-private-claim-1234567890"


def payload():
    return {
        "requestId": REQUEST_ID, "reference": "REQ-" + REQUEST_ID,
        "projectPageId": 60, "requestor": {"name": "Taylor", "email": "taylor@example.test"},
        "date": "2026-11-13", "supplierId": "225", "supplierReference": "Quote 12",
        "serviceId": "8", "breakdownType": "b_70", "quote": None,
        "lines": [{"description": "Blanket PO", "quantity": "1",
                   "unitPriceExGst": "1000", "chartOfAccountId": "401",
                   "taxRateId": "1", "breakdownType": "b_70"}],
        "subtotalCents": 100000, "taxCents": 10000, "totalCents": 110000,
        "testOnly": True, "nexviaSubmissionEnabled": False,
    }


def work(kind="request"):
    result = {"id": REQUEST_ID if kind == "request" else LOOKUP_ID,
              "kind": kind, "claimToken": CLAIM, "projectPageId": 60}
    if kind == "request":
        result["payload"] = payload()
    return result


def catalog():
    return {"projectPageId": 60, "supplierSearch": "",
            "suppliers": [{"id": 225, "text": "Example supplier", "disabled": False}],
            "services": [{"id": 8, "name": "Supply"}],
            "breakdowns": [{"id": "b_70", "name": "Miscellaneous"}],
            "accounts": [{"id": 401, "name": "Materials"}],
            "taxes": [{"id": 1, "name": "GST", "rate": 10}]}


def verified():
    return {"state": "CREATED_VERIFIED", "requestReference": "REQ-" + REQUEST_ID,
            "projectPageId": 60, "jobId": 262, "purchaseOrderId": 1421,
            "purchaseOrderNumber": "PO7413", "totalCents": 110000,
            "url": "https://lennox.nexvia.com.au/staff/project-purchase-order-modify/60/1421",
            "verifiedAt": "2026-11-13T01:02:03.123456+00:00",
            "requestorEmailSent": False}


class Fixture:
    def __init__(self, root):
        self.root = Path(root)
        self.config = self.root / "config.json"
        self.projects = self.root / "projects.json"
        self.requests = self.root / "requests"
        self.journal = self.root / "journal"
        self.calls = []
        self.create_calls = []
        self.prepare_calls = []
        self.capture_calls = []
        self.quote_verify_calls = []
        self.quote_raw = b"%PDF-1.7\nSynthetic supplier quote\n%%EOF"
        self.native_row = None
        self.native_bindings = [{"field": "breakdown_type", "title": "Element of work"}]
        self.native_fields = []
        self.next_work = work()
        self.save_config()
        bridge.atomic_json(self.projects, {"projects": [{"projectPageId": 60, "name": "Jardin building"}]})

    def save_config(self, **changes):
        value = {"enabled": True, "token": TOKEN, "workerId": WORKER_ID,
                 "creationEnabled": False}
        value.update(changes)
        bridge.atomic_json(self.config, value)

    def post(self, path, value, token):
        self.calls.append((path, copy.deepcopy(value), token))
        if path == bridge.WORK_PATH:
            return {"ok": True, "work": copy.deepcopy(self.next_work)}
        if path == bridge.DOCUMENT_PATH:
            return {"ok": True, "confirmation": {"id": "live:" + str(value["purchaseOrderId"]),
                    "purchaseOrderId": value["purchaseOrderId"], "purchaseOrderNumber": value["purchaseOrderNumber"],
                    "test": False, "status": "queued", "providerId": None}}
        if path == bridge.QUOTE_RECEIPT_PATH:
            return {"ok": True, "duplicate": False,
                    "quoteTransfer": {"version": 1, "state": "attached", "expiresAt": "2026-11-15T00:00:00Z",
                                      "attachedAt": "2026-11-14T01:00:00Z"},
                    "receipt": {key: item for key, item in value.items()
                                if key not in {"workerId", "id", "claimToken"}}}
        key = "lookup" if value["kind"] == "lookup" else "request"
        return {"ok": True, key: {"id": value["id"], "state": value["state"]}}

    def preparer(self, request_id):
        self.prepare_calls.append(request_id)
        folder = self.requests / request_id
        saved = bridge.read_json(folder / "request.json")
        quote = saved.get("quote")
        options = {"quote_attachment": quote} if quote is not None else {}
        row = copy.deepcopy(self.native_row or {
            "id": None, "is_new": True, "item_description": "", "job_id": 262,
            "default_job_id": 262, "breakdown_type": "b_70", "budget_item_category_id": 70,
            "budget_item_id": None, "assembly_id": None, "currency_id": 8,
            "curr_alpha3": "AUD", "curr_rate": 1,
        })
        allocation = allocation_from_native(saved, {
            "fields": [["form[ServiceId]", saved["serviceId"]], ["form[CurrencyId]", "8"]]
                      + copy.deepcopy(self.native_fields),
            "rows": [row], "bindings": self.native_bindings,
        }, **options)
        lines = build_lines(saved, allocation, catalog(), **options)
        fields = {
            "form[ServiceId]": saved["serviceId"], "form[CurrencyId]": "8",
            "form[Comment]": "Request reference: " + saved["reference"],
            "form[Print]": "false", "form[Email]": "false", "form[Outlook]": "false",
            "form[MarkSent]": "false", "form[Stock]": "false", "form[EditStock]": "false",
            "form[Approve]": "", "form[SubmitForApproval]": "", "form[ContinueEdit]": "true",
            "form[NewJobId]": "", "form[NewJobMoveLines]": "",
            "form[OrderedDate][day]": "13", "form[OrderedDate][month]": "11",
            "form[OrderedDate][year]": "2026",
            "form[Lines]": json.dumps(lines),
        }
        fields.update(self.native_fields)
        value = {
            "requestHash": bridge.fingerprint(saved), "reference": saved["reference"],
            "projectPageId": saved["projectPageId"], "jobId": allocation["jobId"],
            "totalCents": saved["totalCents"], "allocation": allocation,
            "createPath": "/staff/project-purchase-order-add/" + str(saved["projectPageId"])
                          + "?type=Assembly&service=" + saved["serviceId"]
                          + "&client=" + saved["supplierId"] + "&breakdown_type=" + saved["breakdownType"],
            "fields": [list(pair) for pair in fields.items()],
            "preparedAt": datetime.now(timezone.utc).isoformat(),
        }
        if quote is not None:
            from nexvia_quote_attachment import binding
            receipt = dict(binding(saved, value["createPath"], quote), nativeFileIds=[885],
                           uploadedAt=datetime.now(timezone.utc).isoformat())
            receipt["receiptHash"] = bridge.fingerprint(receipt)
            bridge.atomic_json(folder / bridge.QUOTE_NATIVE_RECEIPT_FILE, receipt)
            value["quoteReceipt"] = receipt
            value["fields"].append(["form[Files][]", "885"])
        value["preparedHash"] = bridge.fingerprint(value)
        bridge.atomic_json(folder / "nexvia-prepared.json", value)
        return 0

    def creator(self, request_id, prepared_hash):
        self.create_calls.append(request_id)
        self.assert_prepared_hash = prepared_hash
        bridge.atomic_json(self.requests / request_id / "nexvia-result.json", verified())
        return 0

    def capturer(self, folder, request, result, **context):
        self.capture_calls.append((request["requestId"], copy.deepcopy(context)))
        raw = b"%PDF-1.4\nSynthetic original document bytes\n%%EOF"
        destination = Path(folder) / "nexvia-purchase-order.pdf"
        destination.write_bytes(raw)
        destination.chmod(0o600)
        descriptor = {"version": 1, "projectPageId": result["projectPageId"],
                      "purchaseOrderId": result["purchaseOrderId"], "purchaseOrderNumber": result["purchaseOrderNumber"],
                      "requestReference": result["requestReference"], "filename": destination.name,
                      "size": len(raw), "sha256": hashlib.sha256(raw).hexdigest(), "sourceKind": "data", "capturedAt": "2026-11-13T01:03:00Z"}
        bridge.atomic_json(Path(folder) / "nexvia-po-document.json", descriptor)
        return descriptor

    def document_journal(self):
        return bridge.read_json(self.journal / "documents" / (REQUEST_ID + ".json"), private=True)

    def quote_downloader(self, identity, token, stream):
        stream.write(self.quote_raw)

    def quote_verifier(self, folder, request, result, native_receipt):
        self.quote_verify_calls.append(request["requestId"])
        return {"version": 1, "requestId": request["requestId"], "requestHash": bridge.fingerprint(request),
                "projectPageId": result["projectPageId"], "purchaseOrderId": result["purchaseOrderId"],
                "purchaseOrderNumber": result["purchaseOrderNumber"], "sha256": request["quote"]["sha256"],
                "bytes": request["quote"]["bytes"], "nativeFileIds": native_receipt["nativeFileIds"],
                "createPath": native_receipt["createPath"], "uploadReceiptHash": native_receipt["receiptHash"]}

    def run(self, **overrides):
        args = {"post": self.post, "lookup": lambda project: catalog(),
                "creator": self.creator, "preparer": self.preparer,
                "refresher": lambda projects_path: None}
        args.update(overrides)
        return bridge.run_once(self.config, self.requests, self.projects, self.journal, **args)

    def stored_journal(self, kind="request"):
        identifier = REQUEST_ID if kind == "request" else LOOKUP_ID
        return bridge.read_json(self.journal / (kind + "-" + identifier + ".json"))


class RequestBridgeTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.fixture = Fixture(self.temporary.name)

    def test_missing_or_disabled_config_does_no_work_or_network(self):
        f = self.fixture
        f.config.unlink()
        self.assertEqual(f.run(), "disabled")
        f.save_config(enabled=False)
        self.assertEqual(f.run(), "disabled")
        self.assertFalse(f.journal.exists())
        self.assertEqual(f.calls, [])
        self.assertEqual(f.create_calls, [])

    def test_private_configuration_and_stable_worker_identity_are_required(self):
        f = self.fixture
        f.config.chmod(0o644)
        with self.assertRaises(bridge.BridgeError):
            f.run()
        for changes in ({"token": "too-short"}, {"workerId": "not-a-uuid"}):
            f.save_config(**changes)
            with self.assertRaises(bridge.BridgeError):
                f.run()
        self.assertEqual(f.calls, [])

    def test_document_feature_is_explicit_and_requires_an_available_extractor(self):
        f = self.fixture
        for value in ("true", 1, None, [], {}):
            f.save_config(documentEnabled=value)
            with self.assertRaises(bridge.BridgeError):
                f.run()
        f.save_config(documentEnabled=True)
        with patch.object(bridge, "load_document_capturer", side_effect=bridge.BridgeError("Unavailable")):
            with self.assertRaises(bridge.BridgeError):
                f.run()
        self.assertEqual(f.calls, [])
        self.assertEqual(f.create_calls, [])

    def test_document_capability_uses_the_returned_claim_and_keeps_pdf_work_after_result_ack(self):
        f = self.fixture
        f.save_config(creationEnabled=True, documentEnabled=True)
        f.next_work["documentExpected"] = True
        self.assertEqual(f.run(capturer=f.capturer), "created_verified")
        self.assertTrue(f.calls[0][1]["documentExpected"])
        terminal = f.stored_journal()
        self.assertTrue(terminal["documentExpected"])
        self.assertTrue(terminal["outbound"]["result"]["documentExpected"])
        self.assertTrue(terminal["reported"])
        self.assertNotIn("documentExpected", bridge.read_json(f.requests / REQUEST_ID / "nexvia-result.json"))
        result_bytes = (f.requests / REQUEST_ID / "nexvia-result.json").read_bytes()
        self.assertEqual(f.capture_calls, [])
        self.assertEqual(f.document_journal()["status"], "pending")
        f.next_work = None
        self.assertEqual(f.run(capturer=f.capturer), "document_uploaded")
        self.assertEqual(f.capture_calls, [(REQUEST_ID, {"expected_project": "Jardin building", "expected_supplier": "Example supplier"})])
        upload = [call[1] for call in f.calls if call[0] == bridge.DOCUMENT_PATH][0]
        self.assertEqual(set(upload), {"workerId", "id", "claimToken", "projectPageId", "purchaseOrderId", "purchaseOrderNumber", "sha256", "contentBase64"})
        self.assertEqual(base64.b64decode(upload["contentBase64"]), (f.requests / REQUEST_ID / "nexvia-purchase-order.pdf").read_bytes())
        self.assertEqual(f.document_journal()["status"], "uploaded")
        self.assertEqual((f.requests / REQUEST_ID / "nexvia-result.json").read_bytes(), result_bytes)
        self.assertEqual(f.stored_journal()["outbound"], terminal["outbound"])
        self.assertEqual(f.run(capturer=f.capturer), "idle")
        self.assertEqual(f.create_calls, [REQUEST_ID])
        self.assertEqual(len(f.capture_calls), 1)

    def test_document_upgrade_does_not_rewrite_old_outbound_or_retrofit_existing_claims(self):
        f = self.fixture
        f.save_config(creationEnabled=True)
        def lost_result(path, value, token):
            if path == bridge.RESULT_PATH:
                raise bridge.BridgeError("Lost result acknowledgement")
            return f.post(path, value, token)
        with self.assertRaises(bridge.BridgeError):
            f.run(post=lost_result)
        old = f.stored_journal()
        f.save_config(creationEnabled=True, documentEnabled=True)
        self.assertEqual(f.run(capturer=lambda *args, **kwargs: self.fail("No retro capture")), "created_verified")
        self.assertEqual(f.stored_journal()["outbound"], old["outbound"])
        self.assertEqual(f.stored_journal()["workHash"], old["workHash"])
        self.assertFalse((f.journal / "documents").exists())
        f.next_work = None
        self.assertEqual(f.run(capturer=f.capturer), "idle")
        self.assertEqual(f.capture_calls, [])
        self.assertEqual(f.create_calls, [REQUEST_ID])

    def test_returned_document_requirement_survives_disabling_new_capability_advertisement(self):
        f = self.fixture
        f.save_config(creationEnabled=True, documentEnabled=False)
        f.next_work["documentExpected"] = True
        self.assertEqual(f.run(), "created_verified")
        self.assertNotIn("documentExpected", f.calls[0][1])
        self.assertTrue(f.stored_journal()["outbound"]["result"]["documentExpected"])
        f.next_work = None
        self.assertEqual(f.run(), "idle")
        self.assertEqual(f.document_journal()["status"], "pending")
        f.save_config(creationEnabled=True, documentEnabled=True)
        self.assertEqual(f.run(capturer=f.capturer), "document_uploaded")
        self.assertEqual(f.create_calls, [REQUEST_ID])

    def test_document_lost_upload_ack_replays_frozen_bytes_after_backoff_without_creator(self):
        f = self.fixture
        f.save_config(creationEnabled=True, documentEnabled=True)
        f.next_work["documentExpected"] = True
        self.assertEqual(f.run(capturer=f.capturer, now=1000), "created_verified")
        f.next_work = None
        sent = []
        def lost_upload(path, value, token):
            if path == bridge.DOCUMENT_PATH:
                sent.append(copy.deepcopy(value))
                raise bridge.BridgeError("Lost upload acknowledgement")
            return f.post(path, value, token)
        self.assertEqual(f.run(capturer=f.capturer, post=lost_upload, now=1001), "document_pending")
        self.assertEqual(f.document_journal()["nextAttemptAt"], 1061)
        self.assertEqual(f.run(capturer=f.capturer, now=1002), "idle")
        self.assertEqual(f.run(capturer=lambda *args, **kwargs: self.fail("Frozen PDF cannot be recaptured"), now=1062), "document_uploaded")
        retry = [call[1] for call in f.calls if call[0] == bridge.DOCUMENT_PATH][-1]
        self.assertEqual(retry, sent[0])
        self.assertEqual(f.create_calls, [REQUEST_ID])
        self.assertEqual(len(f.capture_calls), 1)

    def test_corrupt_frozen_pdf_requires_review_without_recapture_or_mutating_verified_result(self):
        f = self.fixture
        f.save_config(creationEnabled=True, documentEnabled=True)
        f.next_work["documentExpected"] = True
        f.run(capturer=f.capturer, now=1000)
        f.next_work = None
        def lost_upload(path, value, token):
            if path == bridge.DOCUMENT_PATH:
                raise bridge.BridgeError("Connection unavailable")
            return f.post(path, value, token)
        f.run(capturer=f.capturer, post=lost_upload, now=1001)
        verified_bytes = (f.requests / REQUEST_ID / "nexvia-result.json").read_bytes()
        (f.requests / REQUEST_ID / "nexvia-purchase-order.pdf").write_bytes(b"%PDF-corrupt")
        before = len([call for call in f.calls if call[0] == bridge.DOCUMENT_PATH])
        self.assertEqual(f.run(capturer=lambda *args, **kwargs: self.fail("No recapture"), now=1062), "document_needs_review")
        self.assertEqual(f.run(capturer=f.capturer, now=2000), "idle")
        self.assertEqual(len([call for call in f.calls if call[0] == bridge.DOCUMENT_PATH]), before)
        self.assertEqual((f.requests / REQUEST_ID / "nexvia-result.json").read_bytes(), verified_bytes)
        self.assertEqual(f.create_calls, [REQUEST_ID])

    def test_busy_interactive_queue_cannot_starve_documents_past_persisted_deferral(self):
        f = self.fixture
        f.save_config(creationEnabled=True, documentEnabled=True)
        f.next_work["documentExpected"] = True
        self.assertEqual(f.run(capturer=f.capturer, now=1000), "created_verified")
        self.assertEqual(f.document_journal()["deferredAt"], 1000)
        f.next_work = work("lookup")
        for instant in (1001, 1020, 1059):
            self.assertEqual(f.run(capturer=f.capturer, now=instant), "ready")
            self.assertEqual(f.capture_calls, [])
        self.assertEqual(f.run(capturer=f.capturer, now=1060), "ready")
        self.assertEqual(f.document_journal()["status"], "uploaded")
        self.assertEqual([call[0] for call in f.calls[-2:]], [bridge.RESULT_PATH, bridge.DOCUMENT_PATH], "current terminal acknowledgement precedes the document turn")
        self.assertEqual(len(f.capture_calls), 1)
        self.assertEqual(f.create_calls, [REQUEST_ID])
        self.assertEqual(f.run(capturer=f.capturer, now=1200), "ready")
        self.assertEqual(len(f.capture_calls), 1)

    def test_malformed_document_journal_cannot_block_interactive_work(self):
        f = self.fixture
        f.save_config(creationEnabled=True, documentEnabled=True)
        f.next_work["documentExpected"] = True
        f.run(capturer=f.capturer, now=1000)
        document_path = f.journal / "documents" / (REQUEST_ID + ".json")
        document_path.write_bytes(b"{invalid json")
        warnings = []
        f.next_work = work("lookup")
        self.assertEqual(f.run(capturer=lambda *args, **kwargs: self.fail("Invalid document must not be captured"), now=2000, warning=warnings.append), "ready")
        self.assertTrue(warnings)
        self.assertEqual(f.create_calls, [REQUEST_ID])

    def test_capture_failures_and_bad_upload_ack_do_not_starve_other_interactive_work(self):
        f = self.fixture
        f.save_config(creationEnabled=True, documentEnabled=True)
        f.next_work["documentExpected"] = True
        f.run(capturer=f.capturer, now=1000)
        f.next_work = None
        warnings = []
        def unavailable(*args, **kwargs):
            raise RuntimeError("PRIVATE source content")
        self.assertEqual(f.run(capturer=unavailable, now=1001, warning=warnings.append), "document_pending")
        self.assertNotIn("PRIVATE", str(warnings) + str(f.document_journal()))
        f.next_work = work("lookup")
        self.assertEqual(f.run(capturer=unavailable, now=1002), "ready")
        self.assertEqual(f.create_calls, [REQUEST_ID])
        f.next_work = None
        def wrong_ack(path, value, token):
            if path == bridge.DOCUMENT_PATH:
                return {"ok": True, "confirmation": {"id": "live:9999", "purchaseOrderId": 9999, "purchaseOrderNumber": "PO9999", "test": False, "status": "queued"}}
            return f.post(path, value, token)
        self.assertEqual(f.run(capturer=f.capturer, post=wrong_ack, now=1062), "document_pending")
        self.assertNotIn("receipt", f.document_journal())
        self.assertEqual(f.run(capturer=f.capturer, now=1200), "document_uploaded")
        self.assertEqual(f.create_calls, [REQUEST_ID])

    def test_cloud_requests_have_only_fixed_https_routes_and_no_redirects(self):
        observed = []
        with patch.object(bridge, "request_json", side_effect=lambda req, timeout: observed.append(req) or {"ok": True}):
            bridge.post_api(bridge.WORK_PATH, {"workerId": WORKER_ID}, TOKEN)
            bridge.local_lookup(60)
        self.assertEqual(observed[0].full_url, bridge.ORIGIN + bridge.WORK_PATH)
        self.assertEqual(observed[0].get_method(), "POST")
        self.assertEqual(observed[0].get_header("Authorization"), "Bearer " + TOKEN)
        self.assertEqual(observed[0].get_header("User-agent"), "PanelStock-Nexvia-Bridge/1.0")
        self.assertEqual(observed[1].full_url, "http://127.0.0.1:8765/lookup?project=60&q=")
        self.assertEqual(observed[1].get_method(), "GET")
        self.assertIsNone(observed[1].get_header("Authorization"))
        with self.assertRaises(bridge.BridgeError):
            bridge.post_api("https://elsewhere.example/requests", {}, TOKEN)
        with self.assertRaises(bridge.BridgeError):
            bridge.NoRedirect().redirect_request(None, None, 302, "Moved", {}, "https://elsewhere.example")

    def test_project_directory_refresh_happens_before_publishing_new_choices(self):
        f = self.fixture
        f.next_work = None
        events = []
        def refresh(projects_path):
            events.append("refresh")
            bridge.atomic_json(projects_path, {"projects": [
                {"projectPageId": 60, "name": "Jardin building"},
                {"projectPageId": 90, "name": "New project"},
            ]})
        def post(path, value, token):
            events.append("post")
            return f.post(path, value, token)
        self.assertEqual(f.run(refresher=refresh, post=post, now=1000), "idle")
        self.assertEqual(events, ["refresh", "post"])
        self.assertEqual(f.calls[0][1]["projects"][-1],
                         {"projectPageId": 90, "name": "New project"})
        state = bridge.read_json(f.journal / bridge.SNAPSHOT_REFRESH_STATE, private=True)
        self.assertEqual(state["status"], "fresh")
        self.assertEqual(state["lastSuccessfulAt"], "1970-01-01T00:16:40.000Z")

    def test_directory_refresh_cadence_survives_new_passes_without_work_journal_conflicts(self):
        f = self.fixture
        f.next_work = None
        refreshed = []
        for instant in (1000, 1020, 1299, 1300):
            self.assertEqual(f.run(refresher=lambda path: refreshed.append(path),
                                   now=instant), "idle")
        self.assertEqual(refreshed, [f.projects, f.projects])
        self.assertEqual(list(f.journal.glob("*.json")), [])

    def test_failed_refresh_preserves_success_timestamp_and_throttles_retries(self):
        f = self.fixture
        f.next_work = None
        self.assertEqual(f.run(now=1000), "idle")
        refreshed, warnings = [], []
        def unavailable(path):
            refreshed.append(path)
            raise bridge.BridgeError("Private provider error must not be logged")
        self.assertEqual(f.run(refresher=unavailable, now=1300, warning=warnings.append), "idle")
        self.assertEqual(f.run(refresher=unavailable, now=1310, warning=warnings.append), "idle")
        state = bridge.read_json(f.journal / bridge.SNAPSHOT_REFRESH_STATE, private=True)
        self.assertEqual(state["status"], "stale")
        self.assertEqual(state["lastAttemptAt"], "1970-01-01T00:21:40.000Z")
        self.assertEqual(state["lastSuccessfulAt"], "1970-01-01T00:16:40.000Z")
        self.assertEqual(refreshed, [f.projects])
        self.assertEqual(warnings, ["Nexvia directory refresh failed; using the last saved choices."])
        self.assertEqual(f.calls[-1][1]["projects"],
                         [{"projectPageId": 60, "name": "Jardin building"}])

    def test_no_valid_project_cache_cannot_be_published_after_failed_refresh(self):
        f = self.fixture
        f.next_work = None
        f.projects.unlink()
        with self.assertRaises(bridge.BridgeError):
            f.run(refresher=lambda path: None, warning=lambda message: None)
        self.assertEqual(f.calls, [])
        state = bridge.read_json(f.journal / bridge.SNAPSHOT_REFRESH_STATE)
        self.assertIsNone(state["lastSuccessfulAt"])
        self.assertEqual(state["status"], "stale")

    def test_default_refresh_invokes_both_readonly_helpers_and_suppresses_output(self):
        f = self.fixture
        with patch.object(bridge.subprocess, "run", return_value=SimpleNamespace(returncode=0)) as run:
            bridge.refresh_directory_snapshots(f.projects)
        self.assertEqual([call.args[0] for call in run.call_args_list], [
            [str(bridge.PYTHON), "/config/nexvia_projects.py", "--refresh"],
            [str(bridge.PYTHON), "/config/nexvia_lookups.py", "--refresh"],
        ])
        for call in run.call_args_list:
            self.assertIs(call.kwargs["stdout"], bridge.subprocess.DEVNULL)
            self.assertIs(call.kwargs["stderr"], bridge.subprocess.DEVNULL)
        with patch.object(bridge.subprocess, "run", return_value=SimpleNamespace(returncode=1)) as run:
            with self.assertRaises(bridge.BridgeError):
                bridge.refresh_directory_snapshots(f.projects)
        self.assertEqual(run.call_count, 2)

    def test_watch_claims_cached_interactive_work_before_due_maintenance(self):
        f = self.fixture
        f.next_work = work("lookup")
        refreshed = []
        self.assertEqual(f.run(prefer_work=True, now=1000,
                               refresher=lambda path: refreshed.append(path)), "ready")
        self.assertEqual(refreshed, [])
        self.assertEqual([call[0] for call in f.calls],
                         [bridge.WORK_PATH, bridge.RESULT_PATH])
        state = bridge.read_json(f.journal / bridge.SNAPSHOT_REFRESH_STATE, private=True)
        self.assertEqual(state["deferredAt"], "1970-01-01T00:16:40.000Z")
        self.assertNotIn("lastSuccessfulAt", state)

    def test_watch_idle_pass_refreshes_after_claim_and_publishes_next_pass(self):
        f = self.fixture
        f.next_work = None
        events = []
        def refresh(path):
            events.append("refresh")
            bridge.atomic_json(path, {"projects": [
                {"projectPageId": 60, "name": "Jardin building"},
                {"projectPageId": 90, "name": "New project"},
            ]})
        def post(path, value, token):
            events.append("claim")
            return f.post(path, value, token)
        self.assertEqual(f.run(prefer_work=True, now=1000, refresher=refresh,
                               post=post), "idle")
        self.assertEqual(events, ["claim", "refresh"])
        self.assertEqual(len(f.calls[0][1]["projects"]), 1)
        self.assertEqual(f.run(prefer_work=True, now=1002, refresher=refresh,
                               post=post), "idle")
        self.assertEqual(events, ["claim", "refresh", "claim"])
        self.assertEqual(f.calls[-1][1]["projects"][-1]["projectPageId"], 90)

    def test_watch_cannot_starve_refresh_with_continuous_work_or_restarts(self):
        f = self.fixture
        f.next_work = work("lookup")
        events = []
        def post(path, value, token):
            events.append("claim" if path == bridge.WORK_PATH else "report")
            return f.post(path, value, token)
        def refresh(path):
            events.append("refresh")
        for instant in (1000, 1059, 1060):
            self.assertEqual(f.run(prefer_work=True, now=instant, refresher=refresh,
                                   post=post), "ready")
        self.assertEqual(events, ["claim", "report", "claim", "report",
                                  "refresh", "claim", "report"])
        state = bridge.read_json(f.journal / bridge.SNAPSHOT_REFRESH_STATE, private=True)
        self.assertEqual(state["status"], "fresh")
        self.assertNotIn("deferredAt", state)
        self.assertEqual(state["lastSuccessfulAt"], "1970-01-01T00:17:40.000Z")

    def test_watch_bootstrap_refreshes_missing_cache_before_claim(self):
        f = self.fixture
        f.next_work = None
        f.projects.unlink()
        events = []
        def refresh(path):
            events.append("refresh")
            bridge.atomic_json(path, {"projects": [{"projectPageId": 90,
                                                    "name": "New project"}]})
        def post(path, value, token):
            events.append("claim")
            return f.post(path, value, token)
        self.assertEqual(f.run(prefer_work=True, now=1000, refresher=refresh,
                               post=post), "idle")
        self.assertEqual(events, ["refresh", "claim"])
        self.assertEqual(f.calls[0][1]["projects"],
                         [{"projectPageId": 90, "name": "New project"}])

    def test_watch_failed_report_retries_saved_outcome_before_new_claim_or_refresh(self):
        f = self.fixture
        f.save_config(creationEnabled=True)
        events, results, delays = [], [], []
        failed = False
        def post(path, value, token):
            nonlocal failed
            if path == bridge.RESULT_PATH:
                results.append(copy.deepcopy(value))
                events.append("report")
                if not failed:
                    failed = True
                    raise bridge.BridgeError("Synthetic lost acknowledgement")
            else:
                events.append("claim")
                if failed:
                    f.next_work = None
            return f.post(path, value, token)
        passes = 0
        def runner(*paths, **options):
            nonlocal passes
            passes += 1
            if passes == 4:
                raise StopIteration
            return f.run(post=post, now=1000, prefer_work=options["prefer_work"],
                         refresher=lambda path: events.append("refresh"))
        with self.assertRaises(StopIteration):
            bridge.run_watch(runner=runner, sleep=delays.append,
                             clock=lambda: 0, emit=lambda message: None)
        self.assertEqual(events, ["claim", "report", "report", "claim", "refresh"])
        self.assertEqual(results[0], results[1])
        self.assertEqual(f.create_calls, [REQUEST_ID])
        self.assertEqual(f.prepare_calls, [REQUEST_ID])
        self.assertEqual(delays, [5, 2])

    def test_watch_drains_acknowledged_jobs_immediately_and_polls_idle_every_two_seconds(self):
        statuses = iter(["ready", "created_verified", "needs_review", "idle", "idle", "disabled"])
        delays, emitted, options = [], [], []
        def runner(*paths, **kwargs):
            options.append(kwargs)
            return next(statuses)
        with self.assertRaises(StopIteration):
            bridge.run_watch(runner=runner, sleep=delays.append,
                             clock=lambda: 0, emit=emitted.append)
        self.assertEqual(delays, [2, 2, 30])
        self.assertEqual(emitted, ["ready", "created_verified", "needs_review", "idle", "disabled"])
        self.assertTrue(all(value == {"prefer_work": True} for value in options))

    def test_watch_connection_error_backoff_is_bounded_and_resets_after_success(self):
        statuses = iter(["error"] * 5 + ["idle", "error", "ready", "error"])
        delays = []
        def runner(*paths, **kwargs):
            status = next(statuses)
            if status == "error":
                raise bridge.BridgeError("Synthetic connection failure")
            return status
        with self.assertRaises(StopIteration):
            bridge.run_watch(runner=runner, sleep=delays.append,
                             clock=lambda: 0, emit=lambda message: None)
        self.assertEqual(delays, [5, 10, 20, 30, 30, 2, 5, 5])

    def test_watch_unchanged_idle_log_is_limited_to_every_thirty_seconds(self):
        instants = iter([0, 2, 28, 30, 32, 60])
        emitted = []
        passes = 0
        def runner(*paths, **kwargs):
            nonlocal passes
            passes += 1
            if passes > 6:
                raise StopIteration
            return "idle"
        with self.assertRaises(StopIteration):
            bridge.run_watch(runner=runner, sleep=lambda seconds: None,
                             clock=lambda: next(instants), emit=emitted.append)
        self.assertEqual(emitted, ["idle", "idle", "idle"])

    def test_lookup_publishes_matching_catalog_and_never_calls_creator(self):
        f = self.fixture
        f.next_work = work("lookup")
        self.assertEqual(f.run(), "ready")
        self.assertEqual(f.calls[0][1], {"workerId": WORKER_ID, "projects": [{"projectPageId": 60, "name": "Jardin building"}]})
        body = f.calls[1][1]
        self.assertEqual(body["catalog"]["projectPageId"], 60)
        self.assertEqual(body["catalog"]["taxes"][0]["rate"], "10")
        self.assertEqual(body["claimToken"], CLAIM)
        self.assertTrue(f.stored_journal("lookup")["reported"])
        self.assertEqual(f.create_calls, [])

    def test_wrong_project_or_filtered_lookup_is_saved_for_review(self):
        f = self.fixture
        f.next_work = work("lookup")
        for changes in ({"projectPageId": 61}, {"supplierSearch": "example"}):
            with tempfile.TemporaryDirectory() as root:
                f = Fixture(root)
                f.next_work = work("lookup")
                self.assertEqual(f.run(lookup=lambda project: dict(catalog(), **changes)), "needs_review")
                self.assertNotIn("catalog", f.calls[1][1])
                self.assertEqual(f.create_calls, [])

    def test_disabled_creation_stages_legacy_record_and_does_not_submit(self):
        f = self.fixture
        self.assertEqual(f.run(), "needs_review")
        record = bridge.read_json(f.requests / REQUEST_ID / "request.json")
        self.assertEqual(record["status"], "LOCAL_TEST")
        self.assertEqual(record["reference"], "REQ-" + REQUEST_ID)
        self.assertEqual(record["totalCents"], 110000)
        self.assertIn("savedAt", record)
        original = payload()
        original.pop("reference")
        original["quoteBase64"] = ""
        self.assertEqual(record["submissionHash"], bridge.fingerprint(original))
        self.assertEqual(os.stat(f.requests / REQUEST_ID / "request.json").st_mode & 0o777, 0o600)
        self.assertEqual(f.create_calls, [])

    def test_enabled_creation_runs_once_and_reports_only_verified_matching_result(self):
        f = self.fixture
        f.save_config(creationEnabled=True)
        self.assertEqual(f.run(), "created_verified")
        self.assertEqual(f.create_calls, [REQUEST_ID])
        self.assertEqual(f.prepare_calls, [REQUEST_ID])
        self.assertEqual(f.assert_prepared_hash, f.stored_journal()["preparedHash"])
        result = f.calls[1][1]["result"]
        self.assertEqual(result["purchaseOrderNumber"], "PO7413")
        self.assertEqual(result["verifiedAt"], "2026-11-13T01:02:03.123Z")
        self.assertNotIn("requestorEmailSent", result)
        self.assertNotIn("recipient", f.calls[1][1])
        self.assertEqual(f.stored_journal()["phase"], "TERMINAL")

    def test_native_allocation_supports_each_eow_without_pdf_and_preserves_links(self):
        cases = [("b_615", "canonical", 19, 482, None),
                 ("ew_734", "bound", None, 583, 919),
                 ("custom_47", "form", 26, None, 909)]
        for eow, evidence, category, budget, assembly in cases:
            with self.subTest(eow=eow), tempfile.TemporaryDirectory() as root:
                f = Fixture(root)
                f.save_config(creationEnabled=True)
                f.next_work["payload"]["breakdownType"] = eow
                f.next_work["payload"]["lines"][0]["breakdownType"] = eow
                f.native_row = {
                    "id": None, "is_new": True, "item_description": "", "job_id": 262,
                    "default_job_id": 262, "breakdown_type": eow if evidence == "canonical" else None,
                    "budget_item_category_id": category, "budget_item_id": budget, "assembly_id": assembly,
                    "currency_id": 8, "curr_alpha3": "AUD", "curr_rate": 1,
                }
                if evidence == "bound":
                    del f.native_row["breakdown_type"]
                    f.native_row["allocation"] = {"id": eow, "text": "Current EOW"}
                    f.native_bindings = [{"field": "allocation", "title": "Element of work"}]
                elif evidence == "form":
                    f.native_fields = [["form[BreakdownType]", eow]]
                current = catalog()
                current["breakdowns"] = [{"id": eow, "name": "Selected EOW"}]
                self.assertEqual(f.run(lookup=lambda project: current), "created_verified")
                artifact = bridge.read_json(f.requests / REQUEST_ID / "nexvia-prepared.json")
                rows = json.loads(dict(artifact["fields"])["form[Lines]"])
                self.assertEqual(rows[0]["budget_item_category_id"], category)
                self.assertEqual(rows[0]["budget_item_id"], budget)
                self.assertEqual(rows[0]["assembly_id"], assembly)
                self.assertIsNone(bridge.read_json(f.requests / REQUEST_ID / "request.json")["quote"])
                self.assertEqual(artifact["allocation"]["version"], 2)
                self.assertEqual(f.run(lookup=lambda project: self.fail("Terminal replay must not prepare again")),
                                 "created_verified")
                self.assertEqual(f.prepare_calls, [REQUEST_ID])
                self.assertEqual(f.create_calls, [REQUEST_ID])

    def test_fresh_preflight_checks_current_choices_and_totals_before_creator(self):
        f = self.fixture
        f.save_config(creationEnabled=True)
        events = []
        def lookup(project):
            events.append("lookup")
            self.assertEqual(f.stored_journal()["phase"], "CLAIMED")
            return catalog()
        def creator(request_id, prepared_hash):
            events.append("creator")
            self.assertEqual(f.stored_journal()["phase"], "SUBMISSION_STARTED")
            self.assertEqual(f.stored_journal()["preparedHash"], prepared_hash)
            return f.creator(request_id, prepared_hash)
        self.assertEqual(f.run(lookup=lookup, creator=creator), "created_verified")
        self.assertEqual(events, ["lookup", "creator"])

    def test_changed_selection_or_tax_preflight_never_invokes_creator(self):
        def missing_supplier(value):
            value["suppliers"] = []
        def disabled_account(value):
            value["accounts"][0]["disabled"] = True
        def changed_tax(value):
            value["taxes"][0]["rate"] = 5
        def wrong_project(value):
            value["projectPageId"] = 61
        for change in (missing_supplier, disabled_account, changed_tax, wrong_project):
            with tempfile.TemporaryDirectory() as root:
                f = Fixture(root)
                f.save_config(creationEnabled=True)
                current = catalog()
                change(current)
                self.assertEqual(f.run(lookup=lambda project: current), "needs_review")
                self.assertEqual(f.create_calls, [])
                self.assertFalse((f.requests / REQUEST_ID / "nexvia-create-attempt.json").exists())

    def test_native_worker_cli_prepares_then_submits_the_exact_authorized_hash(self):
        calls = []
        class Completed:
            returncode = 0
        with patch.object(bridge.subprocess, "run", side_effect=lambda args, **kwargs: calls.append((args, kwargs)) or Completed()):
            bridge.invoke_preparer(REQUEST_ID)
            bridge.invoke_creator(REQUEST_ID, "a" * 64)
        self.assertEqual(calls[0][0], [str(bridge.PYTHON), str(bridge.CREATOR), "--request", REQUEST_ID])
        self.assertEqual(calls[1][0], [str(bridge.PYTHON), str(bridge.CREATOR), "--request", REQUEST_ID,
                                      "--submit", "a" * 64])
        self.assertEqual(calls[0][1]["stdin"], bridge.subprocess.DEVNULL)
        self.assertEqual(calls[1][1]["stdout"], bridge.subprocess.DEVNULL)
        with self.assertRaises(bridge.BridgeError):
            bridge.invoke_creator(REQUEST_ID, "wrong-hash")

    def test_success_exit_without_prepared_file_or_preparation_failure_cannot_submit(self):
        for prepare_code in (0, 7):
            with tempfile.TemporaryDirectory() as root:
                f = Fixture(root)
                f.save_config(creationEnabled=True)
                self.assertEqual(f.run(preparer=lambda request: prepare_code), "needs_review")
                self.assertEqual(f.create_calls, [])
                self.assertNotIn("preparedHash", f.stored_journal())

    def test_prepared_artifact_must_match_request_hash_age_destination_actions_and_lines(self):
        def change_hash(value):
            value["requestHash"] = "0" * 64
        def change_reference(value):
            value["reference"] = "REQ-other"
        def change_total(value):
            value["totalCents"] = 1
        def stale(value):
            value["preparedAt"] = (datetime.now(timezone.utc) - timedelta(minutes=16)).isoformat()
        def destination(value):
            value["createPath"] = "https://elsewhere.example/submit"
        def supplier(value):
            value["createPath"] = value["createPath"].replace("client=225", "client=999")
        def email_action(value):
            for pair in value["fields"]:
                if pair[0] == "form[Email]":
                    pair[1] = "true"
        def amount(value):
            for pair in value["fields"]:
                if pair[0] == "form[Lines]":
                    rows = json.loads(pair[1])
                    rows[0]["unit_price"] = 5000
                    pair[1] = json.dumps(rows)
        for change in (change_hash, change_reference, change_total, stale, destination,
                       supplier, email_action, amount):
            with tempfile.TemporaryDirectory() as root:
                f = Fixture(root)
                f.save_config(creationEnabled=True)
                def prepare(request):
                    f.preparer(request)
                    target = f.requests / request / "nexvia-prepared.json"
                    value = bridge.read_json(target)
                    change(value)
                    value.pop("preparedHash")
                    value["preparedHash"] = bridge.fingerprint(value)
                    bridge.atomic_json(target, value)
                    return 0
                self.assertEqual(f.run(preparer=prepare), "needs_review")
                self.assertEqual(f.create_calls, [])

    def test_changed_saved_request_after_preparation_is_not_submitted(self):
        f = self.fixture
        f.save_config(creationEnabled=True)
        def prepare(request):
            f.preparer(request)
            target = f.requests / request / "request.json"
            value = bridge.read_json(target)
            value["savedAt"] = "changed-after-preparation"
            bridge.atomic_json(target, value)
            return 0
        self.assertEqual(f.run(preparer=prepare), "needs_review")
        self.assertEqual(f.create_calls, [])

    def test_legacy_or_changed_native_proof_and_allocation_fields_cannot_submit(self):
        def missing_proof(value):
            value.pop("allocation")
        def legacy_proof(value):
            value["allocation"]["version"] = 1
        def proof_project(value):
            value["allocation"]["projectPageId"] = 61
        def proof_supplier(value):
            value["allocation"]["supplierId"] = "226"
        def proof_service(value):
            value["allocation"]["serviceId"] = "9"
        def proof_eow(value):
            value["allocation"]["breakdownType"] = "ew_70"
        def proof_job(value):
            value["allocation"]["jobId"] = 263
        def empty_eow_proof(value):
            value["allocation"]["eowProof"] = []
        def malformed_eow_proof(value):
            value["allocation"]["eowProof"] = [{"source": [], "field": "breakdown_type"}]
        def line_mutator(**changes):
            def change(value):
                fields = dict(value["fields"])
                rows = json.loads(fields["form[Lines]"])
                rows[0].update(changes)
                for pair in value["fields"]:
                    if pair[0] == "form[Lines]":
                        pair[1] = json.dumps(rows)
            return change
        mutations = [missing_proof, legacy_proof, proof_project, proof_supplier, proof_service,
                     proof_eow, proof_job, empty_eow_proof, malformed_eow_proof,
                     line_mutator(budget_item_category_id=999), line_mutator(budget_item_id=456),
                     line_mutator(assembly_id=999), line_mutator(default_job_id=263),
                     line_mutator(job_id=263), line_mutator(eow_extra_link_id=481),
                     line_mutator(curr_alpha3="NZD")]
        for change in mutations:
            with self.subTest(change=change.__name__), tempfile.TemporaryDirectory() as root:
                f = Fixture(root)
                f.save_config(creationEnabled=True)
                def prepare(request):
                    f.preparer(request)
                    target = f.requests / request / "nexvia-prepared.json"
                    value = bridge.read_json(target)
                    change(value)
                    value.pop("preparedHash")
                    value["preparedHash"] = bridge.fingerprint(value)
                    bridge.atomic_json(target, value)
                    return 0
                self.assertEqual(f.run(preparer=prepare), "needs_review")
                self.assertEqual(f.create_calls, [])
                self.assertNotIn("preparedHash", f.stored_journal())
                self.assertEqual(f.run(), "needs_review")
                self.assertEqual(f.prepare_calls, [REQUEST_ID])
                self.assertEqual(f.create_calls, [])

    def test_changed_form_bound_eow_cannot_submit_even_when_line_identity_is_null(self):
        f = self.fixture
        f.save_config(creationEnabled=True)
        f.native_row = {
            "id": None, "is_new": True, "item_description": "", "job_id": 262,
            "default_job_id": 262, "breakdown_type": None, "budget_item_category_id": 70,
            "currency_id": 8, "curr_alpha3": "AUD", "curr_rate": 1,
        }
        f.native_fields = [["form[BreakdownType]", "b_70"]]
        def prepare(request):
            f.preparer(request)
            target = f.requests / request / "nexvia-prepared.json"
            value = bridge.read_json(target)
            for pair in value["fields"]:
                if pair[0] == "form[BreakdownType]":
                    pair[1] = "b_71"
            value.pop("preparedHash")
            value["preparedHash"] = bridge.fingerprint(value)
            bridge.atomic_json(target, value)
            return 0
        self.assertEqual(f.run(preparer=prepare), "needs_review")
        self.assertEqual(f.create_calls, [])

    def test_crashed_readonly_preparation_can_be_reprepared_before_one_submission(self):
        f = self.fixture
        f.save_config(creationEnabled=True)
        def crash(request):
            raise KeyboardInterrupt()
        with self.assertRaises(KeyboardInterrupt):
            f.run(preparer=crash)
        self.assertEqual(f.stored_journal()["phase"], "PREPARING")
        self.assertEqual(f.run(), "created_verified")
        self.assertEqual(f.prepare_calls, [REQUEST_ID])
        self.assertEqual(f.create_calls, [REQUEST_ID])

    def test_lost_result_response_retries_exact_body_without_claiming_or_creating_again(self):
        f = self.fixture
        f.save_config(creationEnabled=True)
        sent = []
        def interrupted(path, value, token):
            if path == bridge.RESULT_PATH:
                sent.append(copy.deepcopy(value))
                raise bridge.BridgeError("Network unavailable")
            return f.post(path, value, token)
        with self.assertRaises(bridge.BridgeError):
            f.run(post=interrupted)
        self.assertFalse(f.stored_journal()["reported"])
        self.assertEqual(f.create_calls, [REQUEST_ID])
        self.assertEqual(f.run(), "created_verified")
        self.assertEqual(f.create_calls, [REQUEST_ID])
        self.assertEqual(len([call for call in f.calls if call[0] == bridge.WORK_PATH]), 1)
        self.assertEqual(f.calls[-1][1], sent[0])

    def test_uncertain_subprocess_result_is_never_invoked_again(self):
        f = self.fixture
        f.save_config(creationEnabled=True)
        attempts = []
        def uncertain(request_id, prepared_hash):
            attempts.append(request_id)
            return 7
        self.assertEqual(f.run(creator=uncertain), "needs_review")
        self.assertEqual(f.run(creator=uncertain), "needs_review")
        self.assertEqual(attempts, [REQUEST_ID])
        self.assertEqual(f.calls[1][1], f.calls[3][1])

    def test_crash_after_submission_journal_blocks_automatic_second_invocation(self):
        f = self.fixture
        f.save_config(creationEnabled=True)
        attempts = []
        def crash(request_id, prepared_hash):
            attempts.append(request_id)
            raise KeyboardInterrupt()
        with self.assertRaises(KeyboardInterrupt):
            f.run(creator=crash)
        self.assertEqual(f.stored_journal()["phase"], "SUBMISSION_STARTED")
        self.assertEqual(f.run(creator=crash, lookup=lambda project: self.fail("Never repeat a previous submission's lookup")), "needs_review")
        self.assertEqual(attempts, [REQUEST_ID])

    def test_existing_attempt_or_unverified_result_never_calls_creator(self):
        for filename, value in (("nexvia-create-attempt.json", {"state": "SUBMISSION_STARTED"}),
                                ("nexvia-result.json", {"state": "RESPONSE_RECEIVED"})):
            with tempfile.TemporaryDirectory() as root:
                f = Fixture(root)
                f.save_config(creationEnabled=True)
                folder = bridge.stage_request(f.requests, payload())
                bridge.atomic_json(folder / filename, value)
                self.assertEqual(f.run(), "needs_review")
                self.assertEqual(f.create_calls, [])

    def test_existing_verified_result_reconciles_even_while_creation_disabled(self):
        f = self.fixture
        folder = bridge.stage_request(f.requests, payload())
        bridge.atomic_json(folder / "nexvia-result.json", verified())
        bridge.atomic_json(folder / "nexvia-create-attempt.json", {"state": "RESPONSE_RECEIVED"})
        self.assertEqual(f.run(), "created_verified")
        self.assertEqual(f.create_calls, [])

    def test_mismatched_local_request_is_not_overwritten_or_submitted(self):
        f = self.fixture
        f.save_config(creationEnabled=True)
        other = payload()
        other["requestor"]["name"] = "Someone else"
        folder = bridge.stage_request(f.requests, other)
        original = (folder / "request.json").read_bytes()
        self.assertEqual(f.run(), "needs_review")
        self.assertEqual((folder / "request.json").read_bytes(), original)
        self.assertEqual(f.create_calls, [])

    def test_mismatched_verified_identity_or_amount_does_not_report_success(self):
        for changes in ({"purchaseOrderId": 1422}, {"totalCents": 1},
                        {"requestReference": "REQ-other"}, {"projectPageId": 61},
                        {"url": "https://elsewhere.example/PO7413"}):
            with tempfile.TemporaryDirectory() as root:
                f = Fixture(root)
                f.save_config(creationEnabled=True)
                folder = bridge.stage_request(f.requests, payload())
                bridge.atomic_json(folder / "nexvia-result.json", dict(verified(), **changes))
                self.assertEqual(f.run(), "needs_review")
                self.assertEqual(f.create_calls, [])
                self.assertNotIn("result", f.calls[-1][1])

    def test_changed_recovered_claim_is_rejected_without_another_submission(self):
        f = self.fixture
        f.save_config(creationEnabled=True)
        self.assertEqual(f.run(), "created_verified")
        f.next_work["payload"]["supplierReference"] = "Changed quote"
        with self.assertRaises(bridge.BridgeError):
            f.run()
        self.assertEqual(f.create_calls, [REQUEST_ID])

    def test_wrong_acknowledgement_does_not_mark_journal_reported(self):
        f = self.fixture
        def wrong_ack(path, value, token):
            if path == bridge.RESULT_PATH:
                return {"ok": True, "request": {"id": LOOKUP_ID}}
            return f.post(path, value, token)
        with self.assertRaises(bridge.BridgeError):
            f.run(post=wrong_ack)
        self.assertFalse(f.stored_journal()["reported"])
        self.assertEqual(f.create_calls, [])

    def test_wrong_acknowledgement_state_keeps_exact_terminal_result_pending(self):
        f = self.fixture
        def wrong_state(path, value, token):
            if path == bridge.RESULT_PATH:
                return {"ok": True, "request": {"id": value["id"], "state": "processing"}}
            return f.post(path, value, token)
        with self.assertRaises(bridge.BridgeError):
            f.run(post=wrong_state)
        self.assertFalse(f.stored_journal()["reported"])
        self.assertEqual(f.stored_journal()["outbound"]["state"], "needs_review")

    def test_invalid_payload_cannot_reach_creation(self):
        cases = [{"quote": {"filename": "quote.pdf"}}, {"testOnly": False},
                 {"nexviaSubmissionEnabled": True}, {"totalCents": 110001},
                 {"projectPageId": 61}, {"date": "2026-02-30"}]
        f = self.fixture
        f.save_config(creationEnabled=True)
        for changes in cases:
            f.next_work = work()
            f.next_work["payload"].update(changes)
            with self.assertRaises(bridge.BridgeError):
                f.run()
        self.assertEqual(f.create_calls, [])

    def test_overlapping_process_is_blocked_before_claim_or_creation(self):
        f = self.fixture
        with bridge.bridge_lock(f.journal):
            with self.assertRaises(bridge.BridgeError):
                f.run()
        self.assertEqual(f.calls, [])

    def test_numerically_equivalent_legacy_values_are_reused_without_overwrite(self):
        f = self.fixture
        legacy = payload()
        legacy["lines"][0].update(quantity=1, unitPriceExGst=1000.0)
        folder = bridge.stage_request(f.requests, legacy)
        original = (folder / "request.json").read_bytes()
        self.assertEqual(bridge.stage_request(f.requests, payload()), folder)
        self.assertEqual((folder / "request.json").read_bytes(), original)

    def test_inherited_modes_are_repaired_before_staging_and_after_uuid_rename(self):
        f = self.fixture
        mkdir, mkdtemp, rename = Path.mkdir, bridge.tempfile.mkdtemp, Path.rename
        pending_modes = []
        def inherited_mkdir(path, *args, **kwargs):
            value = mkdir(path, *args, **kwargs)
            if path == f.requests:
                path.chmod(0o755)
            return value
        def inherited_temporary(*args, **kwargs):
            value = mkdtemp(*args, **kwargs)
            Path(value).chmod(0o755)
            return value
        def inherited_rename(path, destination):
            pending_modes.append(path.stat().st_mode & 0o777)
            value = rename(path, destination)
            Path(destination).chmod(0o755)
            return value
        config_bytes, parent_mode = f.config.read_bytes(), f.root.stat().st_mode
        with patch.object(Path, "mkdir", inherited_mkdir), patch.object(bridge.tempfile, "mkdtemp", inherited_temporary), patch.object(Path, "rename", inherited_rename):
            folder = bridge.stage_request(f.requests, payload())
        self.assertEqual(pending_modes, [0o700])
        self.assertEqual(f.requests.stat().st_mode & 0o777, 0o700)
        self.assertEqual(folder.stat().st_mode & 0o777, 0o700)
        self.assertEqual((folder / "request.json").stat().st_mode & 0o777, 0o600)
        self.assertEqual(f.config.read_bytes(), config_bytes)
        self.assertEqual(f.root.stat().st_mode, parent_mode)

    def test_existing_request_permission_repair_requires_matching_payload_without_rewrite(self):
        f = self.fixture
        folder = bridge.stage_request(f.requests, payload())
        before = (folder / "request.json").read_bytes()
        f.requests.chmod(0o755)
        folder.chmod(0o755)
        wrong = payload()
        wrong["requestor"]["name"] = "Different request"
        with self.assertRaises(bridge.BridgeError):
            bridge.stage_request(f.requests, wrong)
        self.assertEqual(f.requests.stat().st_mode & 0o777, 0o755)
        self.assertEqual(folder.stat().st_mode & 0o777, 0o755)
        self.assertEqual(bridge.stage_request(f.requests, payload()), folder)
        self.assertEqual(f.requests.stat().st_mode & 0o777, 0o700)
        self.assertEqual(folder.stat().st_mode & 0o777, 0o700)
        self.assertEqual((folder / "request.json").read_bytes(), before)

    def test_unknown_custom_roots_and_symlink_directories_are_never_permission_repaired(self):
        f = self.fixture
        for root in (f.requests, f.journal):
            root.mkdir()
            root.chmod(0o755)
        with self.assertRaises(bridge.BridgeError):
            bridge.stage_request(f.requests, payload())
        with self.assertRaises(bridge.BridgeError):
            with bridge.bridge_lock(f.journal):
                self.fail("Unknown custom journal root cannot be locked")
        self.assertEqual(f.requests.stat().st_mode & 0o777, 0o755)
        self.assertEqual(f.journal.stat().st_mode & 0o777, 0o755)
        self.assertFalse((f.journal / ".bridge.lock").exists())
        target = f.root / "foreign"
        target.mkdir()
        target.chmod(0o755)
        alias = f.root / "alias"
        alias.symlink_to(target, target_is_directory=True)
        with self.assertRaises(bridge.BridgeError):
            bridge.stage_request(alias, payload())
        f.requests.chmod(0o700)
        bridge.atomic_json(target / "request.json", payload())
        (f.requests / REQUEST_ID).symlink_to(target, target_is_directory=True)
        with self.assertRaises(bridge.BridgeError):
            bridge.stage_request(f.requests, payload())
        self.assertEqual(target.stat().st_mode & 0o777, 0o755)

    def test_nonroot_foreign_owner_repairs_are_rejected_but_private_directories_are_unchanged(self):
        f = self.fixture
        folder = bridge.stage_request(f.requests, payload())
        folder.chmod(0o755)
        foreign_uid = os.geteuid() + 1001
        with patch.object(bridge.os, "geteuid", return_value=foreign_uid):
            with self.assertRaises(bridge.BridgeError):
                bridge.stage_request(f.requests, payload())
        self.assertEqual(folder.stat().st_mode & 0o777, 0o755)
        folder.chmod(0o700)
        with patch.object(bridge.os, "geteuid", return_value=foreign_uid), patch.object(bridge.os, "fchmod", side_effect=AssertionError("Already private folders must not be chmodded")):
            self.assertEqual(bridge.stage_request(f.requests, payload()), folder)

    def test_root_can_repair_verified_puid_owned_request_directories(self):
        f = self.fixture
        folder = bridge.stage_request(f.requests, payload())
        folder.chmod(0o755)
        original_fstat = os.fstat
        def puid_directory(descriptor):
            info = original_fstat(descriptor)
            if bridge.stat.S_ISDIR(info.st_mode):
                return SimpleNamespace(st_mode=info.st_mode, st_uid=12345, st_dev=info.st_dev, st_ino=info.st_ino)
            return info
        with patch.object(bridge.os, "geteuid", return_value=0), patch.object(bridge.os, "fstat", side_effect=puid_directory):
            self.assertEqual(bridge.stage_request(f.requests, payload()), folder)
        self.assertEqual(folder.stat().st_mode & 0o777, 0o700)

    def test_foreign_new_staging_directory_is_rejected_without_deleting_it(self):
        f = self.fixture
        foreign = f.root / "foreign-pending"
        foreign.mkdir()
        foreign.chmod(0o755)
        (foreign / "untouched").write_text("Keep")
        with patch.object(bridge.tempfile, "mkdtemp", return_value=str(foreign)), patch.object(bridge.os, "geteuid", return_value=os.geteuid() + 1001):
            with self.assertRaises(bridge.BridgeError):
                bridge.stage_request(f.requests, payload())
        self.assertEqual((foreign / "untouched").read_text(), "Keep")
        self.assertEqual(foreign.stat().st_mode & 0o777, 0o755)

    def test_journal_and_document_directories_repair_inherited_modes(self):
        f = self.fixture
        f.save_config(creationEnabled=True, documentEnabled=True)
        f.next_work["documentExpected"] = True
        mkdir = Path.mkdir
        def inherited_mkdir(path, *args, **kwargs):
            value = mkdir(path, *args, **kwargs)
            if path in (f.journal, f.journal / "documents"):
                path.chmod(0o755)
            return value
        with patch.object(Path, "mkdir", inherited_mkdir):
            self.assertEqual(f.run(capturer=f.capturer), "created_verified")
        for path in (f.journal, f.journal / "documents"):
            self.assertEqual(path.stat().st_mode & 0o777, 0o700)
            path.chmod(0o755)
        (f.journal / ".bridge.lock").chmod(0o644)
        f.next_work = None
        self.assertEqual(f.run(capturer=f.capturer), "document_uploaded")
        self.assertEqual(f.journal.stat().st_mode & 0o777, 0o700)
        self.assertEqual((f.journal / "documents").stat().st_mode & 0o777, 0o700)
        self.assertEqual((f.journal / ".bridge.lock").stat().st_mode & 0o777, 0o600)

    def test_pending_document_repairs_only_hash_matched_existing_request_folder(self):
        f = self.fixture
        f.save_config(creationEnabled=True, documentEnabled=True)
        f.next_work["documentExpected"] = True
        f.run(capturer=f.capturer)
        folder = f.requests / REQUEST_ID
        original_request, original_result = (folder / "request.json").read_bytes(), (folder / "nexvia-result.json").read_bytes()
        f.requests.chmod(0o755)
        folder.chmod(0o755)
        f.next_work = None
        def capture(*args, **kwargs):
            self.assertEqual(f.requests.stat().st_mode & 0o777, 0o700)
            self.assertEqual(folder.stat().st_mode & 0o777, 0o700)
            return f.capturer(*args, **kwargs)
        self.assertEqual(f.run(capturer=capture), "document_uploaded")
        self.assertEqual((folder / "request.json").read_bytes(), original_request)
        self.assertEqual((folder / "nexvia-result.json").read_bytes(), original_result)
        self.assertEqual(f.create_calls, [REQUEST_ID])

    def test_changed_pending_document_payload_does_not_authorize_directory_repair(self):
        f = self.fixture
        f.save_config(creationEnabled=True, documentEnabled=True)
        f.next_work["documentExpected"] = True
        f.run(capturer=f.capturer)
        folder = f.requests / REQUEST_ID
        request = bridge.read_json(folder / "request.json")
        request["supplierReference"] = "Changed after verification"
        bridge.atomic_json(folder / "request.json", request)
        f.requests.chmod(0o755)
        folder.chmod(0o755)
        f.next_work = None
        self.assertEqual(f.run(capturer=lambda *args, **kwargs: self.fail("Changed identity cannot capture")), "document_needs_review")
        self.assertEqual(f.requests.stat().st_mode & 0o777, 0o755)
        self.assertEqual(folder.stat().st_mode & 0o777, 0o755)
        self.assertEqual(f.create_calls, [REQUEST_ID])


class QuoteTransportTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.fixture = Fixture(self.temporary.name)
        self.raw = b"%PDF-1.7\nSynthetic supplier quote\n%%EOF"
        self.quote = {"filename": "Supplier quote.pdf", "bytes": len(self.raw),
                      "sha256": hashlib.sha256(self.raw).hexdigest()}
        self.payload = dict(payload(), quote=self.quote)
        self.config = bridge.load_config(self.fixture.config)
        self.identity = bridge.quote_transfer_identity(self.payload, self.config, CLAIM)

    def response(self, raw=None, **headers):
        response = io.BytesIO(self.raw if raw is None else raw)
        response.headers = {"Content-Type": "application/pdf", "Content-Length": str(self.quote["bytes"]),
                            "X-Quote-Sha256": self.quote["sha256"], "Cache-Control": "private, no-store"}
        response.headers.update(headers)
        return response

    def quote_work(self):
        return dict(work(), payload=copy.deepcopy(self.payload),
                    quoteAttachmentVersion=1, documentExpected=True)

    def test_quote_version_lives_only_in_work_envelope_and_requires_explicit_validator_opt_in(self):
        quoted = self.quote_work()
        self.assertEqual(bridge.claimed_quote(quoted), self.quote)
        self.assertEqual(set(quoted["payload"]), bridge.PAYLOAD_FIELDS)
        self.assertNotIn("quoteAttachmentVersion", quoted["payload"])
        with self.assertRaises(bridge.BridgeError):
            bridge.validate_payload(quoted["payload"], REQUEST_ID, 60)
        self.assertIs(bridge.validate_payload(quoted["payload"], REQUEST_ID, 60,
                                             quote_attachment=self.quote), quoted["payload"])
        with self.assertRaises(bridge.BridgeError):
            bridge.validate_payload(quoted["payload"], REQUEST_ID, 60,
                                    quote_attachment=dict(self.quote, sha256="0" * 64))
        self.assertEqual(bridge.payload_projection(quoted["payload"])["quote"], self.quote)

    def test_quote_envelope_rejects_missing_version_wrong_type_document_or_lookup(self):
        missing = self.quote_work()
        missing.pop("quoteAttachmentVersion")
        cases = [missing, dict(self.quote_work(), quoteAttachmentVersion=True),
                 dict(self.quote_work(), quoteAttachmentVersion=2),
                 dict(self.quote_work(), quoteAttachmentVersion="1"),
                 dict(self.quote_work(), documentExpected=False),
                 dict(self.quote_work(), documentExpected=1),
                 dict(self.quote_work(), kind="lookup"),
                 dict(work(), quoteAttachmentVersion=1, documentExpected=True)]
        for claimed in cases:
            with self.subTest(claimed=claimed), self.assertRaises(bridge.BridgeError):
                bridge.claimed_quote(claimed)

    def test_work_hash_preserves_legacy_bytes_and_freezes_quote_capability_separately(self):
        for kind in ("lookup", "request"):
            legacy = work(kind)
            unsigned = {"id": legacy["id"], "kind": kind, "projectPageId": 60,
                        "payload": legacy.get("payload")}
            expected = bridge.fingerprint(unsigned)
            self.assertEqual(bridge.claimed_work_hash(legacy), expected)
            self.assertEqual(bridge.claimed_work_hash(dict(legacy, documentExpected=False)), expected)
            if kind == "request":
                self.assertEqual(bridge.claimed_work_hash(dict(legacy, documentExpected=True)),
                                 bridge.fingerprint(dict(unsigned, documentExpected=True)))
        claimed = self.quote_work()
        immutable = {"id": REQUEST_ID, "kind": "request", "projectPageId": 60,
                     "payload": claimed["payload"], "documentExpected": True,
                     "quoteAttachmentVersion": 1}
        self.assertEqual(bridge.claimed_work_hash(claimed), bridge.fingerprint(immutable))
        self.assertNotEqual(bridge.claimed_work_hash(claimed),
                            bridge.fingerprint({key: value for key, value in immutable.items()
                                                if key != "quoteAttachmentVersion"}))
        # A rotated or mutated delivery claim is checked separately; it cannot
        # alter the immutable work fingerprint used by the existing journal.
        self.assertEqual(bridge.claimed_work_hash(dict(claimed, claimToken=CLAIM + "other")),
                         bridge.claimed_work_hash(claimed))

    def test_unadvertised_quote_creation_remains_blocked_without_explicit_config(self):
        f = self.fixture
        f.save_config(creationEnabled=True, documentEnabled=True)
        f.next_work = self.quote_work()
        self.assertEqual(f.run(capturer=f.capturer), "needs_review")
        self.assertNotIn("quoteAttachmentVersion", f.calls[0][1])
        self.assertEqual(f.prepare_calls, [])
        self.assertEqual(f.create_calls, [])

    def enable_quote_flow(self):
        f = self.fixture
        f.save_config(creationEnabled=True, documentEnabled=True, quoteEnabled=True)
        f.next_work = self.quote_work()
        return {"quote_downloader": f.quote_downloader, "quote_verifier": f.quote_verifier,
                "capturer": f.capturer}

    def test_quote_capability_requires_explicit_boolean_document_feature_and_native_preflight(self):
        f = self.fixture
        for value in (1, "true", None, [], {}):
            f.save_config(documentEnabled=True, quoteEnabled=value)
            with self.subTest(value=value), self.assertRaises(bridge.BridgeError):
                f.run(capturer=f.capturer)
        f.save_config(quoteEnabled=True, documentEnabled=False)
        with self.assertRaises(bridge.BridgeError):
            f.run()
        f.save_config(quoteEnabled=True, documentEnabled=True)
        with patch.object(bridge, "load_quote_verifier", side_effect=bridge.BridgeError("Unavailable")):
            with self.assertRaises(bridge.BridgeError):
                f.run(capturer=f.capturer)
        self.assertEqual(f.calls, [])
        self.assertEqual(f.create_calls, [])

    def test_active_quote_flow_creates_once_and_sends_official_pdf_only_after_native_quote_ack(self):
        f, args = self.fixture, self.enable_quote_flow()
        self.assertEqual(f.run(**args, now=1000), "created_verified")
        self.assertEqual(f.calls[0][1]["quoteAttachmentVersion"], 1)
        self.assertTrue(f.calls[0][1]["documentExpected"])
        source = f.stored_journal()
        quote_path = f.journal / "quotes" / (REQUEST_ID + ".json")
        self.assertTrue(quote_path.exists())
        self.assertEqual(bridge.read_json(quote_path)["status"], "pending")
        self.assertFalse((f.journal / "documents" / (REQUEST_ID + ".json")).exists())
        self.assertEqual(f.create_calls, [REQUEST_ID])
        self.assertEqual(f.capture_calls, [])
        f.next_work = None
        self.assertEqual(f.run(**args, now=1001), "quote_attached")
        self.assertEqual(f.quote_verify_calls, [REQUEST_ID])
        self.assertFalse((f.requests / REQUEST_ID / bridge.QUOTE_FILE).exists())
        self.assertEqual(f.capture_calls, [])
        self.assertEqual(f.run(**args, now=1002), "document_uploaded")
        self.assertEqual([call[0] for call in f.calls], [bridge.WORK_PATH, bridge.RESULT_PATH,
                         bridge.WORK_PATH, bridge.QUOTE_RECEIPT_PATH, bridge.WORK_PATH, bridge.DOCUMENT_PATH])
        self.assertEqual(f.stored_journal()["outbound"], source["outbound"])
        self.assertEqual(f.create_calls, [REQUEST_ID])
        self.assertEqual(f.prepare_calls, [REQUEST_ID])

    def test_quote_result_lost_ack_always_has_durable_recovery_before_cloud_post(self):
        f, args = self.fixture, self.enable_quote_flow()
        posts = []
        def lost(route, body, token):
            if route == bridge.RESULT_PATH:
                path = f.journal / "quotes" / (REQUEST_ID + ".json")
                self.assertTrue(path.exists(), "Cloud must never lose its creation work before local recovery is durable")
                self.assertEqual(bridge.read_json(path)["sourceHash"], bridge.fingerprint(body))
                posts.append(copy.deepcopy(body))
                raise bridge.BridgeError("Lost acknowledgement")
            return f.post(route, body, token)
        with self.assertRaises(bridge.BridgeError):
            f.run(**args, post=lost, now=1000)
        f.next_work = None
        self.assertEqual(f.run(**args, now=1001), "created_verified")
        self.assertEqual(posts[0], f.calls[-1][1])
        self.assertEqual(f.run(**args, now=1002), "quote_attached")
        self.assertEqual(f.create_calls, [REQUEST_ID])
        self.assertEqual(f.prepare_calls, [REQUEST_ID])

    def test_unverified_quote_blocks_official_email_document_and_recovers_without_creator(self):
        f, args = self.fixture, self.enable_quote_flow()
        self.assertEqual(f.run(**args, now=1000), "created_verified")
        f.next_work = None
        failed = dict(args, quote_verifier=lambda *unused: (_ for _ in ()).throw(RuntimeError("PRIVATE response")))
        self.assertEqual(f.run(**failed, now=1001, warning=lambda message: None), "quote_pending")
        self.assertFalse((f.journal / "documents" / (REQUEST_ID + ".json")).exists())
        self.assertEqual(f.capture_calls, [])
        self.assertEqual(f.run(**args, now=1062), "quote_attached")
        self.assertEqual(f.run(**args, now=1063), "document_uploaded")
        self.assertEqual(f.create_calls, [REQUEST_ID])

    def test_quote_preparation_failure_expires_on_enabled_resume_even_with_quote_feature_disabled(self):
        f, args = self.fixture, self.enable_quote_flow()
        self.assertEqual(f.run(**args, preparer=lambda identifier: 1, now=1000), "needs_review")
        folder = f.requests / REQUEST_ID
        self.assertTrue((folder / bridge.QUOTE_FILE).exists())
        self.assertFalse((f.journal / "quotes").exists())
        source_before = (f.journal / ("request-" + REQUEST_ID + ".json")).read_bytes()
        f.save_config(enabled=False)
        f.next_work = None
        self.assertEqual(f.run(now=1000 + bridge.QUOTE_SPOOL_SECONDS + 1), "disabled")
        self.assertTrue((folder / bridge.QUOTE_FILE).exists(), "A stopped bridge preserves its no-work guarantee")
        f.save_config(enabled=True, quoteEnabled=False)
        self.assertEqual(f.run(now=1000 + bridge.QUOTE_SPOOL_SECONDS + 2), "idle")
        self.assertFalse((folder / bridge.QUOTE_FILE).exists())
        self.assertEqual((f.journal / ("request-" + REQUEST_ID + ".json")).read_bytes(), source_before)
        self.assertEqual(f.create_calls, [])

    def test_expiry_during_preparation_cannot_authorize_new_po(self):
        f, args = self.fixture, self.enable_quote_flow()
        clock = [1000]
        def prepared(identifier):
            code = f.preparer(identifier)
            clock[0] += bridge.QUOTE_SPOOL_SECONDS + 1
            return code
        with patch.object(bridge.time, "time", side_effect=lambda: clock[0]):
            self.assertEqual(f.run(**args, preparer=prepared), "needs_review")
        self.assertEqual(f.create_calls, [])
        self.assertFalse((f.requests / REQUEST_ID / "nexvia-create-attempt.json").exists())

    def test_quote_prepared_file_id_must_match_frozen_upload_receipt(self):
        f, args = self.fixture, self.enable_quote_flow()
        def changed(identifier):
            f.preparer(identifier)
            path = f.requests / identifier / "nexvia-prepared.json"
            prepared = bridge.read_json(path)
            prepared["fields"] = [[name, "999" if name == "form[Files][]" else value]
                                  for name, value in prepared["fields"]]
            prepared["preparedHash"] = bridge.fingerprint({key: value for key, value in prepared.items()
                                                          if key != "preparedHash"})
            bridge.atomic_json(path, prepared)
            return 0
        self.assertEqual(f.run(**args, preparer=changed, now=1000), "needs_review")
        self.assertEqual(f.create_calls, [])

    def download(self, raw=None, **headers):
        output = io.BytesIO()
        response = self.response(raw, **headers)
        with patch.object(bridge.urllib.request, "build_opener") as build:
            build.return_value.open.return_value = response
            bridge.download_quote(self.identity, TOKEN, output)
            request = build.return_value.open.call_args.args[0]
        return output.getvalue(), request, build

    def test_binary_quote_uses_exact_fixed_claim_route_without_credentials_in_url(self):
        raw, request, build = self.download()
        self.assertEqual(raw, self.raw)
        self.assertEqual(request.full_url, bridge.ORIGIN + bridge.QUOTE_PATH)
        self.assertEqual(request.get_method(), "POST")
        self.assertEqual(request.get_header("Authorization"), "Bearer " + TOKEN)
        self.assertEqual(request.get_header("User-agent"), "PanelStock-Nexvia-Bridge/1.0")
        self.assertEqual(json.loads(request.data), {"workerId": WORKER_ID, "id": REQUEST_ID,
                                                  "claimToken": CLAIM, "sha256": self.quote["sha256"]})
        self.assertIsInstance(build.call_args.args[0], bridge.NoRedirect)
        self.assertEqual(build.return_value.open.call_args.kwargs, {"timeout": 60})
        for private in (TOKEN, CLAIM, self.quote["filename"]):
            self.assertNotIn(private, request.full_url)

    def test_full_ten_megabyte_quote_streams_independently_of_json_limit(self):
        self.raw = b"%PDF-" + b"x" * (bridge.MAX_QUOTE_BYTES - 5)
        self.quote.update(bytes=len(self.raw), sha256=hashlib.sha256(self.raw).hexdigest())
        self.identity = bridge.quote_transfer_identity(self.payload, self.config, CLAIM)
        sizes = []
        response = self.response()
        original = response.read
        response.read = lambda count: (sizes.append(count), original(count))[1]
        output = io.BytesIO()
        with patch.object(bridge.urllib.request, "build_opener") as build:
            build.return_value.open.return_value = response
            bridge.download_quote(self.identity, TOKEN, output)
        self.assertEqual(len(output.getvalue()), bridge.MAX_QUOTE_BYTES)
        self.assertGreater(len(output.getvalue()), bridge.MAX_JSON_BYTES)
        self.assertTrue(all(0 < size <= 65536 for size in sizes))

    def test_metadata_cannot_supply_paths_urls_extra_keys_or_invalid_size_checksum(self):
        cases = [dict(self.quote, filename="../quote.pdf"), dict(self.quote, filename="dir\\quote.pdf"),
                 dict(self.quote, filename="quote.exe"), dict(self.quote, filename="quote\n.pdf"),
                 dict(self.quote, bytes=True), dict(self.quote, bytes=4),
                 dict(self.quote, bytes=bridge.MAX_QUOTE_BYTES + 1),
                 dict(self.quote, sha256="a" * 63), dict(self.quote, sha256="A" * 64),
                 dict(self.quote, url="https://other.test/private.pdf"), dict(self.quote, path="/tmp/quote.pdf")]
        for quote in cases:
            with self.subTest(quote=quote), self.assertRaises(bridge.BridgeError):
                bridge.quote_metadata(quote)

    def test_wrong_headers_truncated_changed_non_pdf_and_extra_bytes_fail_closed(self):
        cases = [(None, {"Content-Type": "text/html"}), (None, {"Content-Length": "0"}),
                 (None, {"X-Quote-Sha256": "0" * 64}), (None, {"Content-Encoding": "gzip"}),
                 (None, {"Cache-Control": "public, max-age=300"}), (self.raw[:-1], {}),
                 (self.raw + b"x", {}), (self.raw.replace(b"PDF", b"BAD"), {})]
        for raw, headers in cases:
            with self.subTest(headers=headers, raw=raw), self.assertRaises(bridge.BridgeError):
                self.download(raw, **headers)

    def test_transport_errors_do_not_include_credentials_or_response_body(self):
        errors = [bridge.urllib.error.URLError("PRIVATE " + TOKEN),
                  bridge.urllib.error.HTTPError(bridge.ORIGIN + bridge.QUOTE_PATH, 409,
                                               "PRIVATE " + CLAIM, {}, io.BytesIO(b"SECRET"))]
        for error in errors:
            with self.subTest(error=type(error)), patch.object(bridge.urllib.request, "build_opener") as build:
                build.return_value.open.side_effect = error
                with self.assertRaises(bridge.BridgeError) as raised:
                    bridge.download_quote(self.identity, TOKEN, io.BytesIO())
                self.assertNotIn("PRIVATE", str(raised.exception))
                self.assertNotIn(TOKEN, str(raised.exception))
                self.assertNotIn(CLAIM, str(raised.exception))
                self.assertNotIn("SECRET", str(raised.exception))

    def stage(self, downloader=None):
        folder = bridge.stage_request(self.fixture.requests, self.payload)
        calls = []
        def fetch(identity, token, stream):
            calls.append((copy.deepcopy(identity), token))
            stream.write(self.raw)
        destination = bridge.stage_quote(folder, self.payload, self.config, CLAIM, downloader or fetch)
        return folder, destination, calls

    def test_staging_keeps_private_binary_separate_from_immutable_request_and_reuses_it(self):
        folder = bridge.stage_request(self.fixture.requests, self.payload)
        original = (folder / "request.json").read_bytes()
        folder, destination, calls = self.stage()
        self.assertEqual(destination, folder / bridge.QUOTE_FILE)
        self.assertEqual(destination.read_bytes(), self.raw)
        self.assertEqual(destination.stat().st_mode & 0o777, 0o600)
        self.assertEqual((folder / bridge.QUOTE_TRANSFER_FILE).stat().st_mode & 0o777, 0o600)
        transfer = bridge.read_json(folder / bridge.QUOTE_TRANSFER_FILE)
        self.assertEqual({key: transfer[key] for key in self.identity}, self.identity)
        self.assertEqual(transfer["expiresAt"] - transfer["createdAt"], bridge.QUOTE_SPOOL_SECONDS)
        self.assertEqual((folder / "request.json").read_bytes(), original)
        self.assertNotIn(base64.b64encode(self.raw), original)
        bridge.stage_quote(folder, self.payload, self.config, CLAIM,
                           lambda *args: self.fail("Exact verified spool must not download again"))
        self.assertEqual(len(calls), 1)
        self.assertEqual(list(folder.glob(".pending-quote-*")), [])

    def test_changed_claim_cannot_reuse_the_same_quote_spool(self):
        folder, destination, calls = self.stage()
        receipt = (folder / bridge.QUOTE_TRANSFER_FILE).read_bytes()
        with self.assertRaises(bridge.BridgeError):
            bridge.stage_quote(folder, self.payload, self.config, CLAIM + "changed",
                               lambda *args: self.fail("Changed claim cannot download"))
        self.assertEqual(destination.read_bytes(), self.raw)
        self.assertEqual((folder / bridge.QUOTE_TRANSFER_FILE).read_bytes(), receipt)

    def test_nas_retention_deadline_is_frozen_before_first_download_and_never_renewed(self):
        folder = bridge.stage_request(self.fixture.requests, self.payload)
        seen = []
        def fetch(identity, token, stream):
            transfer = bridge.read_quote_transfer(folder, identity)
            seen.append(transfer)
            self.assertEqual(transfer["createdAt"], 1000)
            self.assertEqual(transfer["expiresAt"], 1000 + bridge.QUOTE_SPOOL_SECONDS)
            stream.write(self.raw)
        bridge.stage_quote(folder, self.payload, self.config, CLAIM, fetch, now=1000)
        receipt = (folder / bridge.QUOTE_TRANSFER_FILE).read_bytes()
        bridge.stage_quote(folder, self.payload, self.config, CLAIM,
                           lambda *args: self.fail("Existing bytes cannot refresh the retention clock"), now=2000)
        self.assertEqual((folder / bridge.QUOTE_TRANSFER_FILE).read_bytes(), receipt)
        self.assertEqual(len(seen), 1)
        with self.assertRaises(bridge.BridgeError):
            bridge.stage_quote(folder, self.payload, self.config, CLAIM,
                               lambda *args: self.fail("Expired bytes cannot authorize another download"),
                               now=1000 + bridge.QUOTE_SPOOL_SECONDS)

    def test_expiry_removes_only_input_bytes_and_preserves_every_recovery_artifact(self):
        folder = bridge.stage_request(self.fixture.requests, self.payload)
        bridge.stage_quote(folder, self.payload, self.config, CLAIM,
                           lambda identity, token, stream: stream.write(self.raw), now=1000)
        names = ("nexvia-create-attempt.json", "nexvia-prepared.json", "nexvia-result.json",
                 bridge.QUOTE_NATIVE_RECEIPT_FILE, "nexvia-purchase-order.pdf")
        for name in names:
            (folder / name).write_bytes(b"Preserved immutable evidence")
        before = {item.name: item.read_bytes() for item in folder.iterdir() if item.name != bridge.QUOTE_FILE}
        self.assertFalse(bridge.expire_quote_spool(folder, self.payload, self.config, CLAIM, now=2000))
        self.assertTrue((folder / bridge.QUOTE_FILE).exists())
        self.assertTrue(bridge.expire_quote_spool(folder, self.payload, self.config, CLAIM,
                                                now=1000 + bridge.QUOTE_SPOOL_SECONDS))
        self.assertFalse((folder / bridge.QUOTE_FILE).exists())
        self.assertEqual({item.name: item.read_bytes() for item in folder.iterdir()}, before)
        self.assertTrue(bridge.expire_quote_spool(folder, self.payload, self.config, CLAIM,
                                                now=1001 + bridge.QUOTE_SPOOL_SECONDS))

    def test_crashed_partial_download_expires_without_a_published_quote_or_po(self):
        f, args = self.fixture, self.enable_quote_flow()
        self.assertEqual(f.run(**args, preparer=lambda identifier: 1, now=1000), "needs_review")
        folder = f.requests / REQUEST_ID
        (folder / bridge.QUOTE_FILE).unlink()
        partial = folder / ".pending-quote-abc12345"
        partial.write_bytes(self.raw[:12])
        partial.chmod(0o600)
        unrelated = folder / ".pending-quote-user-document.pdf"
        unrelated.write_bytes(b"Preserve unrelated filename")
        f.save_config(quoteEnabled=False)
        f.next_work = None
        self.assertEqual(f.run(now=1000 + bridge.QUOTE_SPOOL_SECONDS + 1), "idle")
        self.assertFalse(partial.exists())
        self.assertEqual(unrelated.read_bytes(), b"Preserve unrelated filename")
        self.assertTrue((folder / bridge.QUOTE_TRANSFER_FILE).exists())
        self.assertEqual(f.create_calls, [])

    def test_crash_between_atomic_publication_and_temporary_unlink_recovers_same_bytes(self):
        folder, destination, calls = self.stage()
        pending = folder / ".pending-quote-abc12345"
        os.link(destination, pending)
        self.assertEqual(destination.stat().st_nlink, 2)
        transfer_before = (folder / bridge.QUOTE_TRANSFER_FILE).read_bytes()
        bridge.stage_quote(folder, self.payload, self.config, CLAIM,
                           lambda *args: self.fail("Published bytes must not download again"))
        self.assertFalse(pending.exists())
        self.assertEqual(destination.stat().st_nlink, 1)
        self.assertEqual(destination.read_bytes(), self.raw)
        self.assertEqual((folder / bridge.QUOTE_TRANSFER_FILE).read_bytes(), transfer_before)

    def test_pending_quote_expiry_rejects_symlinks_or_links_to_unrelated_files(self):
        folder = bridge.stage_request(self.fixture.requests, self.payload)
        bridge.stage_quote(folder, self.payload, self.config, CLAIM,
                           lambda identity, token, stream: stream.write(self.raw), now=1000)
        foreign = folder / "unrelated.pdf"
        foreign.write_bytes(b"%PDF-Unrelated private document")
        foreign.chmod(0o600)
        pending = folder / ".pending-quote-abc12345"
        for kind in ("symlink", "hardlink"):
            with self.subTest(kind=kind):
                if kind == "symlink":
                    pending.symlink_to(foreign)
                else:
                    os.link(foreign, pending)
                with self.assertRaises((bridge.BridgeError, OSError)):
                    bridge.expire_quote_spool(folder, self.payload, self.config, CLAIM,
                                             now=1000 + bridge.QUOTE_SPOOL_SECONDS)
                self.assertTrue(pending.exists())
                self.assertEqual(foreign.read_bytes(), b"%PDF-Unrelated private document")
                pending.unlink()

    def test_expired_pending_quote_cleanup_is_bounded_and_resumes_after_fixed_spool_removed(self):
        folder = bridge.stage_request(self.fixture.requests, self.payload)
        bridge.stage_quote(folder, self.payload, self.config, CLAIM,
                           lambda identity, token, stream: stream.write(self.raw), now=1000)
        for index in range(26):
            item = folder / (".pending-quote-" + str(index).zfill(8))
            item.write_bytes(b"%PDF-")
            item.chmod(0o600)
        deadline = 1000 + bridge.QUOTE_SPOOL_SECONDS
        bridge.expire_quote_spool(folder, self.payload, self.config, CLAIM, now=deadline)
        self.assertEqual(len(bridge.pending_quote_files(folder)), 1)
        self.assertFalse((folder / bridge.QUOTE_FILE).exists())
        bridge.expire_quote_spool(folder, self.payload, self.config, CLAIM, now=deadline + 1)
        self.assertEqual(bridge.pending_quote_files(folder), [])

    def test_changed_deadline_cannot_extend_spool_retention_or_download_again(self):
        folder = bridge.stage_request(self.fixture.requests, self.payload)
        bridge.stage_quote(folder, self.payload, self.config, CLAIM,
                           lambda identity, token, stream: stream.write(self.raw), now=1000)
        transfer = bridge.read_json(folder / bridge.QUOTE_TRANSFER_FILE)
        transfer["expiresAt"] += 1
        bridge.atomic_json(folder / bridge.QUOTE_TRANSFER_FILE, transfer)
        with self.assertRaises(bridge.BridgeError):
            bridge.stage_quote(folder, self.payload, self.config, CLAIM,
                               lambda *args: self.fail("Changed deadline cannot authorize download"), now=2000)

    def test_failed_or_unverified_download_keeps_only_frozen_transfer_deadline(self):
        folder = bridge.stage_request(self.fixture.requests, self.payload)
        def unavailable(identity, token, stream):
            stream.write(self.raw[:9])
            raise bridge.BridgeError("Transfer unavailable")
        for fetch in (unavailable, lambda identity, token, stream: stream.write(b"%PDF-wrong")):
            with self.assertRaises(bridge.BridgeError):
                bridge.stage_quote(folder, self.payload, self.config, CLAIM, fetch)
            transfer = bridge.read_quote_transfer(folder, self.identity)
            self.assertEqual(transfer["expiresAt"] - transfer["createdAt"], bridge.QUOTE_SPOOL_SECONDS)
            self.assertEqual(list(folder.glob(".pending-quote-*")), [])
            # An invalid callback cannot leave a trusted destination for creator.
            candidate = folder / bridge.QUOTE_FILE
            self.assertFalse(candidate.exists())

    def test_existing_corrupt_public_linked_or_symlink_spool_is_never_replaced(self):
        folder, destination, calls = self.stage()
        for kind in ("corrupt", "public", "hardlink", "symlink"):
            with self.subTest(kind=kind):
                destination.unlink()
                destination.write_bytes(self.raw if kind != "corrupt" else b"%PDF-changed")
                destination.chmod(0o644 if kind == "public" else 0o600)
                other = folder / "untouched.pdf"
                if kind == "hardlink":
                    os.link(destination, other)
                elif kind == "symlink":
                    destination.rename(other)
                    destination.symlink_to(other)
                before = destination.lstat()
                with self.assertRaises(bridge.BridgeError):
                    bridge.stage_quote(folder, self.payload, self.config, CLAIM,
                                       lambda *args: self.fail("Unsafe spool cannot be downloaded over"))
                self.assertEqual(destination.lstat(), before)
                if other.exists():
                    other.unlink()

    def test_staging_refuses_public_or_changed_request_folder(self):
        folder = bridge.stage_request(self.fixture.requests, self.payload)
        folder.chmod(0o755)
        with self.assertRaises(bridge.BridgeError):
            bridge.stage_quote(folder, self.payload, self.config, CLAIM,
                               lambda *args: self.fail("Public folder cannot receive private quote"))
        self.assertEqual(folder.stat().st_mode & 0o777, 0o755)
        folder.chmod(0o700)
        saved = bridge.read_json(folder / "request.json")
        saved["supplierId"] = "999"
        bridge.atomic_json(folder / "request.json", saved)
        with self.assertRaises(bridge.BridgeError):
            bridge.stage_quote(folder, self.payload, self.config, CLAIM,
                               lambda *args: self.fail("Changed request cannot download quote"))

    def recovery_fixture(self, reported=False):
        f = self.fixture
        folder, _, _ = self.stage()
        request = bridge.read_json(folder / "request.json", private=True)
        bridge.atomic_json(folder / "nexvia-result.json", verified())
        result = dict(bridge.verified_result(folder, self.payload), documentExpected=True)
        source = {"version": 1, "id": REQUEST_ID, "workerId": WORKER_ID, "claimToken": CLAIM,
                  "kind": "request", "workHash": bridge.claimed_work_hash(self.quote_work()),
                  "documentExpected": True, "quoteAttachmentVersion": 1,
                  "phase": "TERMINAL", "reported": reported,
                  "outbound": {"workerId": WORKER_ID, "id": REQUEST_ID, "claimToken": CLAIM,
                               "kind": "request", "state": "created_verified", "result": result}}
        bridge.make_tool_root(f.journal, bridge.JOURNAL, proof=True)
        source_path = f.journal / ("request-" + REQUEST_ID + ".json")
        bridge.atomic_json(source_path, source)
        path = bridge.ensure_quote_journal(source_path, source, f.requests)
        native_receipt = {"version": 1, "requestId": REQUEST_ID,
                          "requestHash": bridge.fingerprint(request), "projectPageId": 60,
                          "createPath": "/staff/project-purchase-order-add/60?type=Assembly&service=8&client=225&breakdown_type=b_70",
                          "quote": copy.deepcopy(self.quote), "nativeFileIds": [885],
                          "uploadedAt": "2026-11-14T01:00:00Z"}
        native_receipt["receiptHash"] = bridge.fingerprint(native_receipt)
        bridge.atomic_json(folder / bridge.QUOTE_NATIVE_RECEIPT_FILE, native_receipt)
        proof = {"version": 1, "requestId": REQUEST_ID, "requestHash": bridge.fingerprint(request),
                 "projectPageId": 60, "purchaseOrderId": 1421, "purchaseOrderNumber": "PO7413",
                 "sha256": self.quote["sha256"], "bytes": self.quote["bytes"], "nativeFileIds": [885],
                 "createPath": native_receipt["createPath"], "uploadReceiptHash": native_receipt["receiptHash"]}
        return folder, path, source_path, source, proof

    def receipt_ack(self, body):
        return {"ok": True, "duplicate": False,
                "quoteTransfer": {"version": 1, "state": "attached", "expiresAt": "2026-11-15T00:00:00Z",
                                  "attachedAt": "2026-11-14T01:00:00Z"},
                "receipt": {key: value for key, value in body.items()
                            if key not in {"workerId", "id", "claimToken"}}}

    def test_pending_quote_recovery_is_durable_before_verified_po_result_is_reported(self):
        folder, path, source_path, source, proof = self.recovery_fixture()
        frozen_result = source["outbound"]
        pending = bridge.read_json(path, private=True)
        self.assertEqual(pending["status"], "pending")
        self.assertEqual(pending["sourceHash"], bridge.fingerprint(frozen_result))
        self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        self.assertEqual(path.parent.stat().st_mode & 0o777, 0o700)
        self.assertFalse(source["reported"])
        self.assertEqual(bridge.process_quote_receipt(path, self.config, self.fixture.requests,
                         post=lambda *args: self.fail("Base result must be acknowledged first"),
                         verifier=lambda *args: self.fail("No native readback before result acknowledgement"),
                         now=1000, warning=lambda message: None), "quote_pending")
        self.assertEqual(bridge.read_json(path)["status"], "pending")
        self.assertEqual(bridge.read_json(source_path)["outbound"], frozen_result)
        self.assertTrue((folder / bridge.QUOTE_FILE).exists())

    def test_verified_quote_receipt_ack_is_fsynced_before_only_input_spool_is_removed(self):
        folder, path, source_path, source, proof = self.recovery_fixture(reported=True)
        request_before = (folder / "request.json").read_bytes()
        result_before = (folder / "nexvia-result.json").read_bytes()
        source_before = source_path.read_bytes()
        official = folder / "nexvia-purchase-order.pdf"
        official.write_bytes(b"%PDF-Official confirmation document")
        calls, readbacks = [], []
        def post(route, body, token):
            self.assertEqual(route, bridge.QUOTE_RECEIPT_PATH)
            self.assertEqual(token, TOKEN)
            frozen = bridge.read_json(path, private=True)
            self.assertEqual(frozen["outbound"], body)
            self.assertEqual(frozen["outboundHash"], bridge.fingerprint(body))
            self.assertTrue((folder / bridge.QUOTE_FILE).exists())
            calls.append(copy.deepcopy(body))
            return self.receipt_ack(body)
        def verifier(*args):
            readbacks.append(args)
            return copy.deepcopy(proof)
        original_purge = bridge.purge_quote_spool
        def purge(*args):
            persisted = bridge.read_json(path, private=True)
            self.assertEqual(persisted["status"], "attached")
            self.assertEqual(persisted["receipt"]["receipt"]["nativeFileIds"], [885])
            original_purge(*args)
        with patch.object(bridge, "purge_quote_spool", side_effect=purge):
            self.assertEqual(bridge.process_quote_receipt(path, self.config, self.fixture.requests,
                             post=post, verifier=verifier), "quote_attached")
        self.assertEqual(len(calls), 1)
        self.assertEqual(len(readbacks), 1)
        self.assertFalse((folder / bridge.QUOTE_FILE).exists())
        self.assertTrue(bridge.read_json(path)["sourcePurged"])
        self.assertEqual(official.read_bytes(), b"%PDF-Official confirmation document")
        self.assertEqual((folder / "request.json").read_bytes(), request_before)
        self.assertEqual((folder / "nexvia-result.json").read_bytes(), result_before)
        self.assertEqual(source_path.read_bytes(), source_before)
        self.assertEqual(self.fixture.create_calls, [])
        self.assertEqual(self.fixture.prepare_calls, [])

    def test_lost_receipt_ack_replays_frozen_proof_and_bytes_without_native_or_creator_retry(self):
        folder, path, source_path, source, proof = self.recovery_fixture(reported=True)
        calls, readbacks = [], []
        def lost(route, body, token):
            calls.append(copy.deepcopy(body))
            raise bridge.BridgeError("Lost acknowledgement")
        def verifier(*args):
            readbacks.append(args)
            return copy.deepcopy(proof)
        self.assertEqual(bridge.process_quote_receipt(path, self.config, self.fixture.requests,
                         post=lost, verifier=verifier, now=1000, warning=lambda message: None), "quote_pending")
        pending = bridge.read_json(path)
        self.assertEqual(pending["nextAttemptAt"], 1060)
        self.assertTrue((folder / bridge.QUOTE_FILE).exists())
        def accepted(route, body, token):
            calls.append(copy.deepcopy(body))
            return self.receipt_ack(body)
        self.assertEqual(bridge.process_quote_receipt(path, self.config, self.fixture.requests,
                         post=accepted, verifier=lambda *args: self.fail("Frozen native proof must not be re-read"),
                         now=1061), "quote_attached")
        self.assertEqual(calls[0], calls[1])
        self.assertEqual(len(readbacks), 1)
        self.assertFalse((folder / bridge.QUOTE_FILE).exists())
        self.assertEqual(self.fixture.create_calls, [])

    def test_incomplete_or_mismatched_receipt_ack_keeps_source_for_safe_retry(self):
        folder, path, source_path, source, proof = self.recovery_fixture(reported=True)
        def wrong(route, body, token):
            ack = self.receipt_ack(body)
            ack["receipt"]["nativeFileIds"] = [886]
            return ack
        self.assertEqual(bridge.process_quote_receipt(path, self.config, self.fixture.requests,
                         post=wrong, verifier=lambda *args: proof, now=1000,
                         warning=lambda message: None), "quote_pending")
        self.assertEqual(bridge.read_json(path)["status"], "pending")
        self.assertNotIn("receipt", bridge.read_json(path))
        self.assertTrue((folder / bridge.QUOTE_FILE).exists())

    def test_crash_after_ack_before_cleanup_retries_only_verified_spool_removal(self):
        folder, path, source_path, source, proof = self.recovery_fixture(reported=True)
        with patch.object(bridge, "purge_quote_spool", side_effect=OSError("Temporary filesystem error")):
            self.assertEqual(bridge.process_quote_receipt(path, self.config, self.fixture.requests,
                             post=lambda route, body, token: self.receipt_ack(body),
                             verifier=lambda *args: proof, now=1000,
                             warning=lambda message: None), "quote_pending")
        self.assertEqual(bridge.read_json(path)["status"], "attached")
        self.assertTrue((folder / bridge.QUOTE_FILE).exists())
        self.assertEqual(bridge.process_quote_receipt(path, self.config, self.fixture.requests,
                         post=lambda *args: self.fail("Accepted receipt cannot be posted again"),
                         verifier=lambda *args: self.fail("Accepted proof cannot be re-read"),
                         now=1061), "quote_attached")
        self.assertFalse((folder / bridge.QUOTE_FILE).exists())

    def test_expired_source_can_finish_saved_po_readback_and_receipt_without_recreating(self):
        folder, path, source_path, source, proof = self.recovery_fixture(reported=True)
        deadline = bridge.read_json(path)["sourceExpiresAt"]
        def verifier(*args):
            self.assertFalse((folder / bridge.QUOTE_FILE).exists(), "Expired bytes must be purged before native readback")
            return proof
        self.assertEqual(bridge.process_quote_receipt(path, self.config, self.fixture.requests,
                         post=lambda route, body, token: self.receipt_ack(body), verifier=verifier,
                         now=deadline + 1), "quote_attached")
        self.assertTrue(bridge.read_json(path)["sourcePurged"])
        self.assertEqual(bridge.read_json(source_path)["outbound"], source["outbound"])
        self.assertEqual(self.fixture.create_calls, [])
        self.assertEqual(self.fixture.prepare_calls, [])

    def test_early_missing_source_requires_review_without_readback_upload_or_new_po(self):
        folder, path, source_path, source, proof = self.recovery_fixture(reported=True)
        (folder / bridge.QUOTE_FILE).unlink()
        self.assertEqual(bridge.process_quote_receipt(path, self.config, self.fixture.requests,
                         post=lambda *args: self.fail("Missing source cannot post receipt without proof"),
                         verifier=lambda *args: self.fail("Unexpired missing source must be reviewed"),
                         now=1000, warning=lambda message: None), "quote_needs_review")
        self.assertEqual(self.fixture.create_calls, [])

    def test_mutated_frozen_receipt_or_native_identity_cannot_be_delivered_or_purged(self):
        folder, path, source_path, source, proof = self.recovery_fixture(reported=True)
        self.assertEqual(bridge.process_quote_receipt(path, self.config, self.fixture.requests,
                         post=lambda *args: (_ for _ in ()).throw(bridge.BridgeError("Lost reply")),
                         verifier=lambda *args: proof, now=1000,
                         warning=lambda message: None), "quote_pending")
        saved = bridge.read_json(path)
        saved["outbound"]["nativeFileIds"] = [999]
        bridge.atomic_json(path, saved)
        self.assertEqual(bridge.process_quote_receipt(path, self.config, self.fixture.requests,
                         post=lambda *args: self.fail("Changed frozen receipt cannot be posted"),
                         verifier=lambda *args: self.fail("Changed frozen receipt cannot re-verify"),
                         now=1061, warning=lambda message: None), "quote_needs_review")
        self.assertTrue((folder / bridge.QUOTE_FILE).exists())

    def test_readback_proof_must_match_durable_upload_receipt_and_saved_po(self):
        folder, path, source_path, source, proof = self.recovery_fixture(reported=True)
        pending = bridge.read_json(path)
        native = bridge.read_json(folder / bridge.QUOTE_NATIVE_RECEIPT_FILE)
        for changes in ({"purchaseOrderId": 999}, {"projectPageId": 59},
                        {"sha256": "0" * 64}, {"bytes": self.quote["bytes"] + 1},
                        {"requestId": LOOKUP_ID}, {"requestHash": "0" * 64},
                        {"uploadReceiptHash": "0" * 64}, {"nativeFileIds": [886]},
                        {"nativeFileIds": [True]}, {"nativeFileIds": [885, 886]}):
            with self.subTest(changes=changes), self.assertRaises(bridge.BridgeError):
                bridge.quote_receipt_body(pending, dict(proof, **changes), native)

    def test_unquoted_legacy_success_never_creates_quote_journal(self):
        f = self.fixture
        f.save_config(creationEnabled=True)
        self.assertEqual(f.run(), "created_verified")
        source = f.stored_journal()
        self.assertIsNone(bridge.ensure_quote_journal(f.journal / ("request-" + REQUEST_ID + ".json"),
                                                    source, f.requests))
        self.assertFalse((f.journal / "quotes").exists())


if __name__ == "__main__":
    unittest.main()
