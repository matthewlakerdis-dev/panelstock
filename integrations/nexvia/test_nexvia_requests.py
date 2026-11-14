import copy
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
        key = "lookup" if value["kind"] == "lookup" else "request"
        return {"ok": True, key: {"id": value["id"], "state": value["state"]}}

    def preparer(self, request_id):
        self.prepare_calls.append(request_id)
        folder = self.requests / request_id
        saved = bridge.read_json(folder / "request.json")
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
        })
        lines = build_lines(saved, allocation, catalog())
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


if __name__ == "__main__":
    unittest.main()
