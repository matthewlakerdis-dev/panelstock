import base64
from contextlib import contextmanager
import copy
from datetime import datetime, timezone
import hashlib
import io
import json
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import build_quote_policy_checker as builder
import nexvia_check_quote_policy as checker
import nexvia_requests as bridge
import nexvia_quote_attachment as deployed_quote
from test_nexvia_requests import work, WORKER_ID
from test_nexvia_quote_attachment import SEND_SOURCE as NORMALIZER, ENDPOINT, kendo_serialized_native_state, policy_fields


SOURCE = NORMALIZER.split("if(kind)")[0] + r"""if(kind==='admin'||kind==='client'){url='/upload/security';}else{url='/'+kind+'/upload/security';}
if(!file.response){$.ajax({url:url,type:'GET',dataType:'json',data:{file_name:file.normalized,file_size:file.size,file_type:file.type},async:false,success:function(response){file.response=response;}});}
let form=new FormData();form.append('Content-Type',file.type);form.append('acl','private');
form.append('key',file.response.key);form.append('policy',file.response.policy);
form.append('x-goog-algorithm',file.response.algorithm);form.append('x-goog-credential',file.response.credential);
form.append('x-goog-date',file.response.date);form.append('x-goog-signature',file.response.signature);
form.append('Content-Disposition','attachment');form.append('file',file);}"""
PRIVATE = "PRIVATE-HEADER-POLICY-VALUE"


class Session:
    def __init__(self):
        self.calls = []
        self.closed = False
        self.controller = "staff"

    def send(self, method, values):
        self.calls.append((method, values))
        if method == "Runtime.evaluate": return {"result": {"objectId": "metadata"}}
        if method == "Runtime.releaseObjectGroup": return {}
        name = values["objectId"]
        if name == "metadata": return {"result": [
            {"name": "send", "value": {"type": "function", "objectId": "function"}},
            {"name": "source", "value": {"type": "string", "value": SOURCE}}]}
        if name == "function": return {"result": [], "internalProperties": [{"name": "[[Scopes]]", "value": {"objectId": "scopes"}}]}
        if name == "scopes": return {"result": [{"name": "0", "value": {"objectId": "closure", "description": "Closure"}}]}
        if name == "closure": return {"result": [{"name": "kind", "value": {"type": "string", "value": self.controller}}]}
        raise AssertionError("Unexpected passive request")

    def detach(self): self.closed = True


class Page:
    def __init__(self, owner, state):
        self.context, self.state, self.url = owner, state, "about:blank"
        self.routes = []
        self.closed = False
        self.defaults = {"blocked": False, "data": {"kind": "undefined", "extraCount": 0, "fields": []},
                         "headers": [{"name": "X-CSRF-TOKEN", "value": PRIVATE}],
                         "headerShape": [{"alias": "h0", "type": "string"}], "beforeSend": False, "cache": False}

    def route(self, pattern, handler, **kwargs): self.routes.append(handler)
    def locator(self, *args, **kwargs): return SimpleNamespace(set_input_files=lambda *args: (_ for _ in ()).throw(AssertionError("file selection")))
    def close(self): self.closed = True
    def evaluate(self, source, argument=None):
        if source == checker.AJAX_DEFAULTS_JS: return copy.deepcopy(self.defaults)
        if source == "() => document.baseURI": return self.url
        if source == "() => navigator.userAgent": return "Synthetic-Native-Agent"
        if source.startswith("__nexvia_filename=>"):
            self.context.normalizer_calls += 1
            return argument.replace(" ", "_")
        return copy.deepcopy(self.state)


class Context:
    def __init__(self, state):
        self.page = Page(self, state)
        self.pages = [self.page]
        self.session = Session()
        self.request = SimpleNamespace(get=self.get)
        self.gets, self.normalizer_calls = [], 0
        self.status = 200
        self.raw = json.dumps(policy_fields()).encode()
        self.disposed = False
        self.closed = False
        self.fetch_error = False
        self.on_get = None

    def new_page(self): return self.page
    def new_cdp_session(self, page): return self.session
    def get(self, url, **kwargs):
        self.gets.append((url, kwargs))
        if self.on_get: self.on_get()
        if self.fetch_error: raise RuntimeError(PRIVATE)
        return SimpleNamespace(status=self.status, headers={"content-length": str(len(self.raw))}, body=lambda: self.raw,
                               dispose=lambda: setattr(self, "disposed", True))


class PolicyCheckerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.bundle = builder.bundle(Path(__file__).parent)

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.root.chmod(0o755)  # A normal NAS /config must not need mode0700.
        self.journals = self.root / "panelstock-request-journal"
        self.journals.mkdir(mode=0o700)
        self.lock = self.journals / ".bridge.lock"
        self.lock.write_bytes(b"")
        self.lock.chmod(0o600)
        self.source = work()
        self.identifier = self.source["id"]
        payload = self.source["payload"]
        payload.update(breakdownType="ew_734", quote={"filename": "Private quote.pdf", "bytes": 100, "sha256": "a" * 64})
        payload["lines"][0]["breakdownType"] = "ew_734"
        self.source.update(documentExpected=True, quoteAttachmentVersion=1)
        self.folder = bridge.stage_request(self.root / "nexvia-requests", payload)
        self.request = bridge.read_json(self.folder / "request.json", private=True)
        self.path = "/staff/project-purchase-order-add/60?type=Assembly&service=8&client=225&breakdown_type=ew_734"
        attempt = {**deployed_quote.binding(self.request, self.path), "attemptedAt": datetime.now(timezone.utc).isoformat()}
        bridge.atomic_json(self.folder / checker.MARKERS[0], attempt)
        outbound = {"workerId": WORKER_ID, "id": self.identifier, "kind": "request", "claimToken": self.source["claimToken"],
                    "state": "needs_review", "message": "The native quote upload policy step did not complete."}
        self.main = self.journals / ("request-" + self.identifier + ".json")
        bridge.atomic_json(self.main, {"version": 1, "workerId": WORKER_ID, "id": self.identifier, "kind": "request",
            "claimToken": self.source["claimToken"], "phase": "TERMINAL", "reported": True,
            "documentExpected": True, "quoteAttachmentVersion": 1, "workHash": bridge.claimed_work_hash(self.source), "outbound": outbound})
        self.original, state = kendo_serialized_native_state()
        state["widgets"][0]["sendSource"] = SOURCE
        self.context = Context(state)
        self.browser = SimpleNamespace(contexts=[SimpleNamespace(pages=[SimpleNamespace(url="https://lennox.nexvia.com.au/staff/projects")])])
        @contextmanager
        def owned(browser, source):
            try: yield self.context
            finally: self.context.closed = True
        @contextmanager
        def editor(context, request, quote_attachment):
            page = context.new_page()
            page.route("**/*", lambda route: route.continue_())
            page.url = "https://lennox.nexvia.com.au" + self.path
            try: yield {**copy.deepcopy(self.original), "page": page, "createPath": self.path}
            finally: page.close()
        self.creator = SimpleNamespace(quote_browser_context=owned, native_line_editor=editor,
            prepare=lambda *args: self.fail("prepare"), _prepare=lambda *args: self.fail("prepare"),
            submit=lambda *args: self.fail("submit"), save=lambda *args: self.fail("save"))
        self.make_prior()

    def make_prior(self, **changes):
        with checker.runtime_bundle(self.bundle) as (q, parser, hashes):
            before, records = checker.originals(self.root, self.identifier, parser)
            attempt = records[checker.MARKERS[0]]
            value = {"format": "nexvia-quote-policy-check", "version": 1, "requestId": self.identifier,
                "requestHash": q.digest(self.request), "attemptHash": checker.digest(attempt),
                "mainJournalHash": checker.digest(records["mainJournal"]), "sourceHashes": hashes,
                "evidenceBeforeHash": checker.digest(before), "evidenceAfterHash": checker.digest(before),
                "originalsUnchanged": True, "stage": "policy_validation", "status": "blocked",
                "code": "quote_policy_conditions", "httpStatus": 200, "policyRequestInvoked": True,
                "fileUploads": 0, "poSubmissions": 0, "emails": 0, "shape": None}
            value.update(changes)
            value["recordHash"] = checker.digest({key: item for key, item in value.items() if key != "recordHash"})
            directory = self.root / checker.PRIOR_REPORT_DIRECTORY
            directory.mkdir(mode=0o700, exist_ok=True)
            bridge.atomic_json(directory / (self.identifier + ".json"), value)
            return value

    def tearDown(self): self.temporary.cleanup()

    def check(self):
        runtime = checker.runtime_bundle
        @contextmanager
        def fixture_runtime(bundle=None, **kwargs):
            with runtime(bundle, **kwargs) as (q, parser, hashes):
                q.POLICY_SEND_SHA256 = hashlib.sha256(SOURCE.encode()).hexdigest()
                yield q, parser, hashes
        with patch.object(checker, "runtime_bundle", fixture_runtime):
            return checker.check_policy(self.identifier, self.root, browser=self.browser, bundle=self.bundle, creator=self.creator)

    def originals(self): return {path.name: path.read_bytes() for path in [self.folder / "request.json", self.folder / checker.MARKERS[0], self.main]}

    def test_single_metadata_get_preserves_originals_and_checkpoint_replays_without_any_second_get(self):
        before = self.originals()
        def before_get():
            record = bridge.read_json(self.root / checker.REPORT_DIRECTORY / (self.identifier + ".json"), private=True)
            self.assertTrue(record["policyRequestInvoked"])
            self.assertEqual(record["stage"], "policy_request_started")
        self.context.on_get = before_get
        report = self.check()
        self.assertEqual(report["status"], "passed")
        self.assertEqual(report["code"], "policy_verified")
        self.assertEqual(self.originals(), before)
        self.assertTrue(report["originalsUnchanged"])
        self.assertEqual(report["evidenceBeforeHash"], report["evidenceAfterHash"])
        self.assertEqual(len(self.context.gets), 1)
        url, options = self.context.gets[0]
        self.assertTrue(url.startswith("https://lennox.nexvia.com.au/staff/upload/security?"))
        self.assertEqual(options["max_redirects"], 0)
        self.assertEqual(options["timeout"], 15000)
        self.assertEqual(options["headers"]["X-CSRF-TOKEN"], PRIVATE)
        self.assertEqual(options["headers"]["User-Agent"], "Synthetic-Native-Agent")
        self.assertNotIn(PRIVATE, json.dumps(report))
        self.assertNotIn("Private quote.pdf", json.dumps(report))
        self.assertFalse((self.folder / "nexvia-supplier-quote.pdf").exists())
        self.assertTrue(self.context.disposed and self.context.closed and self.context.page.closed and self.context.session.closed)
        self.assertEqual(self.check(), report)
        self.assertEqual(len(self.context.gets), 1)
        self.assertEqual(self.root.stat().st_mode & 0o777, 0o755)
        self.assertEqual((self.root / checker.REPORT_DIRECTORY).stat().st_mode & 0o777, 0o700)

    def test_nonempty_content_disposition_prefix_reports_exact_validator_code_and_safe_shape(self):
        value = policy_fields()
        document = json.loads(base64.b64decode(value["policy"]))
        document["conditions"].append(["starts-with", "$Content-Disposition", PRIVATE])
        value["policy"] = base64.b64encode(json.dumps(document).encode()).decode()
        self.context.raw = json.dumps(value).encode()
        report = self.check()
        self.assertEqual(report["code"], "quote_policy_conditions")
        self.assertEqual(report["httpStatus"], 200)
        matches = [row for row in report["shape"]["candidates"][0]["conditions"] if row.get("field") == "Content-Disposition"]
        self.assertTrue(any(row.get("emptyPrefix") is False for row in matches))
        self.assertTrue(report["shape"]["candidates"][0]["checks"]["algorithmSupported"])
        self.assertNotIn(PRIVATE, json.dumps(report))
        self.assertTrue(self.context.disposed)

    def test_ajax_default_extras_stop_before_metadata_request_and_never_print_private_values(self):
        self.context.page.defaults.update(blocked=True, data={"kind": "object", "extraCount": 1,
            "fields": [{"alias": "d0", "type": "string", "extra": True}]})
        report = self.check()
        self.assertEqual(report["code"], "native_ajax_defaults")
        self.assertFalse(report["policyRequestInvoked"])
        self.assertEqual(self.context.gets, [])
        self.assertEqual(report["ajaxDefaults"]["data"]["extraCount"], 1)

    def test_http_failure_and_lost_response_are_frozen_never_retried(self):
        self.context.status = 302
        report = self.check()
        self.assertEqual(report["code"], "quote_policy_http")
        self.assertTrue(self.context.disposed)
        self.check()
        self.assertEqual(len(self.context.gets), 1)

    def test_lost_metadata_response_freezes_one_attempt_without_exporting_private_error_or_repeating_get(self):
        before = self.originals()
        self.context.fetch_error = True
        report = self.check()
        self.assertTrue(report["policyRequestInvoked"])
        self.assertEqual(report["code"], "quote_policy_fetch")
        self.assertIsNone(report["httpStatus"])
        self.assertNotIn(PRIVATE, json.dumps(report))
        self.assertEqual(self.originals(), before)
        self.assertEqual(self.check(), report)
        self.assertEqual(len(self.context.gets), 1)

    def test_changed_original_evidence_stops_finalization_without_touching_original_records(self):
        def changed():
            (self.folder / "nexvia-prepared.json").write_text("{}")
            (self.folder / "nexvia-prepared.json").chmod(0o600)
        self.context.on_get = changed
        with self.assertRaisesRegex(checker.PolicyCheckError, "original_evidence_changed"):
            self.check()
        self.assertTrue((self.folder / "nexvia-prepared.json").exists())
        checkpoint = bridge.read_json(self.root / checker.REPORT_DIRECTORY / (self.identifier + ".json"), private=True)
        self.assertTrue(checkpoint["policyRequestInvoked"])

    def test_replay_tampering_and_any_later_marker_block_before_network(self):
        report = self.check()
        path = self.root / checker.REPORT_DIRECTORY / (self.identifier + ".json")
        value = dict(report, requestHash="b" * 64)
        bridge.atomic_json(path, value)
        with self.assertRaisesRegex(checker.PolicyCheckError, "policy_check_replay_identity"):
            self.check()
        self.assertEqual(len(self.context.gets), 1)
        path.unlink()
        for marker in checker.MARKERS[1:]:
            target = self.folder / marker
            target.symlink_to(self.root / "missing")
            with self.subTest(marker=marker), self.assertRaises(ValueError): self.check()
            target.unlink()
        self.assertEqual(len(self.context.gets), 1)

    def test_source_pdf_is_never_opened_and_all_financial_entrypoints_are_tripwired(self):
        opened = os.open
        def no_pdf(path, *args, **kwargs):
            if str(path).endswith(".pdf"): self.fail("Policy checker must not read PDF bytes")
            return opened(path, *args, **kwargs)
        with patch("os.open", side_effect=no_pdf):
            self.assertEqual(self.check()["status"], "passed")
        with checker.runtime_bundle(self.bundle) as (q, parser, hashes), checker.financial_tripwires(self.creator, q, parser):
            for function in (self.creator.prepare, self.creator._prepare, self.creator.submit, self.creator.save, q.upload_quote,
                             q.begin_upload, q.complete_upload, q.source_upload_payload, q.verify_source, q.download_quote):
                with self.assertRaises(ValueError): function()


class BundleTests(unittest.TestCase):
    def test_standalone_build_is_deterministic_and_below_loader_limit(self):
        first, second = builder.build(), builder.build()
        self.assertEqual(first, second)
        self.assertLess(len(first), 1024 * 1024)
        namespace = {"__name__": "standalone_checker_test"}
        exec(compile(first, "<standalone-checker-test>", "exec"), namespace)
        with namespace["runtime_bundle"]() as (q, parser, hashes):
            self.assertEqual(hashes["nexvia_quote_attachment.py"], checker.Q_SHA256)
            self.assertEqual(hashes["nexvia_preparation_diagnostics.py"], checker.DIAGNOSTICS_SHA256)
            self.assertTrue(callable(q.validate_policy_response))


if __name__ == "__main__": unittest.main()
