import copy
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import nexvia_requests as bridge


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
        key = "lookup" if value["kind"] == "lookup" else "request"
        return {"ok": True, key: {"id": value["id"], "state": value["state"]}}

    def preparer(self, request_id):
        self.prepare_calls.append(request_id)
        folder = self.requests / request_id
        saved = bridge.read_json(folder / "request.json")
        fields = {
            "form[ServiceId]": "8", "form[CurrencyId]": "8",
            "form[Comment]": "Request reference: " + saved["reference"],
            "form[Print]": "false", "form[Email]": "false", "form[Outlook]": "false",
            "form[MarkSent]": "false", "form[Stock]": "false", "form[EditStock]": "false",
            "form[Approve]": "", "form[SubmitForApproval]": "", "form[ContinueEdit]": "true",
            "form[NewJobId]": "", "form[NewJobMoveLines]": "",
            "form[OrderedDate][day]": "13", "form[OrderedDate][month]": "11",
            "form[OrderedDate][year]": "2026",
            "form[Lines]": json.dumps([{
                "id": None, "is_new": True, "item_description": "Blanket PO",
                "chart_of_account_id": 401, "tax_rate_id": 1, "breakdown_type": "b_70",
                "job_id": 262, "qty": 1, "unit_price": 1000,
            }]),
        }
        value = {
            "requestHash": bridge.fingerprint(saved), "reference": saved["reference"],
            "projectPageId": 60, "jobId": 262, "totalCents": 110000,
            "createPath": "/staff/project-purchase-order-add/60?type=Assembly&service=8&client=225&breakdown_type=b_70",
            "fields": [list(pair) for pair in fields.items()],
            "preparedAt": datetime.now(timezone.utc).isoformat(),
        }
        value["preparedHash"] = bridge.fingerprint(value)
        bridge.atomic_json(folder / "nexvia-prepared.json", value)
        return 0

    def creator(self, request_id, prepared_hash):
        self.create_calls.append(request_id)
        self.assert_prepared_hash = prepared_hash
        bridge.atomic_json(self.requests / request_id / "nexvia-result.json", verified())
        return 0

    def run(self, **overrides):
        args = {"post": self.post, "lookup": lambda project: catalog(),
                "creator": self.creator, "preparer": self.preparer}
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

    def test_cloud_requests_have_only_fixed_https_routes_and_no_redirects(self):
        observed = []
        with patch.object(bridge, "request_json", side_effect=lambda req, timeout: observed.append(req) or {"ok": True}):
            bridge.post_api(bridge.WORK_PATH, {"workerId": WORKER_ID}, TOKEN)
            bridge.local_lookup(60)
        self.assertEqual(observed[0].full_url, bridge.ORIGIN + bridge.WORK_PATH)
        self.assertEqual(observed[0].get_method(), "POST")
        self.assertEqual(observed[0].get_header("Authorization"), "Bearer " + TOKEN)
        self.assertEqual(observed[1].full_url, "http://127.0.0.1:8765/lookup?project=60&q=")
        self.assertEqual(observed[1].get_method(), "GET")
        self.assertIsNone(observed[1].get_header("Authorization"))
        with self.assertRaises(bridge.BridgeError):
            bridge.post_api("https://elsewhere.example/requests", {}, TOKEN)
        with self.assertRaises(bridge.BridgeError):
            bridge.NoRedirect().redirect_request(None, None, 302, "Moved", {}, "https://elsewhere.example")

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


if __name__ == "__main__":
    unittest.main()
