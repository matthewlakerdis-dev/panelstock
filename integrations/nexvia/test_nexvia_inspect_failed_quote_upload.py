import contextlib
import copy
import hashlib
import io
import json
import os
from pathlib import Path
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import nexvia_create as creator
import nexvia_inspect_failed_quote_upload as diagnostic
import nexvia_inspect_quote_upload as inspector
import nexvia_quote_attachment as quote
import nexvia_requests as bridge
from test_nexvia_quote_attachment import kendo_serialized_native_state
from test_nexvia_requests import work, WORKER_ID, TOKEN, REQUEST_ID


RAW = b"%PDF-1.7\nPrivate original quote bytes\n%%EOF"
PATH = "/staff/project-purchase-order-add/60?type=Assembly&service=8&client=225&breakdown_type=ew_734"
PRIVATE = "PRIVATE-SIGNATURE-NEVER-EXPORT"
SEND_POLICY = r"""function(e,data){let file=data.files[0];let target;
file.clean_name=decodeURIComponent(file.name.replace(/\+/g,'%20')).replace(new RegExp('\\r\\n','g'),'');
file.clean_name=file.clean_name.replace(/[%]/g,' ');
if(module==='staff'||module==='client'){target='/upload/url';}else{target='/'+module+'/upload/getSignedUrl';}
if(!file.response){$.ajax({url:target,type:'GET',dataType:'json',data:{file_name:file.clean_name,file_size:file.size,file_type:file.type},async:false,success:function(response){file.response=response;}});}
let formData=new FormData();formData.append('acl','private');formData.append('Content-Type',file.type);
formData.append('key',file.response.key);formData.append('policy',file.response.policy);
formData.append('x-goog-algorithm',file.response.fields['x-goog-algorithm']);
formData.append('x-goog-credential',file.response.fields['x-goog-credential']);
formData.append('x-goog-date',file.response.fields['x-goog-date']);
formData.append('x-goog-signature',file.response.fields['x-goog-signature']);formData.append('file',file);data.data=formData;}"""


class FakeLocator:
    def __init__(self, page):
        self.page = page

    def set_input_files(self, value):
        self.page.selections += 1
        raise AssertionError("A file must never be selected")


class FakePage:
    def __init__(self, state, raw):
        self.url = creator.BASE + "/staff/project-purchase-order-add/60"
        self.state, self.raw = state, raw
        self.selections = 0
        self.calls = []
        self.globals = {"module": "staff"}
        self.base_uri = self.url
        self.ownership = {"poForms": 1, "inputs": [{"formIsPO": False, "containedByPO": False,
            "visible": False, "selected": 0, "ancestors": [{"depth": 2, "tag": "DIV", "tab": True,
            "panel": False, "visible": False, "hidden": False}]}], "fields": [], "downloadLinks": [],
            "selectorCounts": {"progress": 1, "errors": 0, "success": 0}}

    def locator(self, selector, *args, **kwargs):
        return FakeLocator(self)

    def set_input_files(self, *args):
        self.selections += 1
        raise AssertionError("A page must never select a file")

    def evaluate(self, source, arg=None):
        self.calls.append(source)
        if source == quote.NATIVE_STATE_JS:
            return copy.deepcopy(self.state)
        if source == inspector.INSPECT_JS or source == inspector.INSPECT_JS.replace(
                "['upload','success','complete','select','error','add','done','change','submit']",
                "['upload','success','complete','select','error','add','done','change','submit','send','fail','always']"):
            return copy.deepcopy(self.raw)
        if source == diagnostic.OWNERSHIP_JS:
            return copy.deepcopy(self.ownership)
        if source == diagnostic.GLOBAL_SELECTOR_JS:
            return [{"available": ".".join(item["path"]) in self.globals, "kind": "string",
                     "matches": [self.globals.get(".".join(item["path"])) == value for value in item["literals"]]}
                    for item in arg]
        if source == "() => document.baseURI":
            return self.base_uri
        raise AssertionError("Only read-only snapshot scripts are allowed")


class FailedQuoteInspectionTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.requests = self.root / "nexvia-requests"
        self.journals = self.root / "panelstock-request-journal"
        self.journals.mkdir(mode=0o700)
        self.lock = self.journals / ".bridge.lock"
        self.lock.write_bytes(b"")
        self.lock.chmod(0o600)
        self.source = work()
        self.source["payload"]["breakdownType"] = "ew_734"
        self.source["payload"]["lines"][0]["breakdownType"] = "ew_734"
        self.source["payload"]["quote"] = {"filename": "Private filename.pdf", "bytes": len(RAW),
                                          "sha256": hashlib.sha256(RAW).hexdigest()}
        self.source.update(documentExpected=True, quoteAttachmentVersion=1)
        self.config = {"workerId": WORKER_ID, "token": TOKEN}
        self.folder = bridge.stage_request(self.requests, self.source["payload"])
        bridge.stage_quote(self.folder, self.source["payload"], self.config, self.source["claimToken"],
                           downloader=lambda identity, token, stream: stream.write(RAW))
        self.request = bridge.read_json(self.folder / "request.json", private=True)
        quote.begin_upload(self.folder, self.request, PATH)
        outbound = {"workerId": WORKER_ID, "id": REQUEST_ID, "kind": "request",
                    "claimToken": self.source["claimToken"], "state": "needs_review",
                    "message": "Fresh preparation failed; no submission authorized"}
        self.main = self.journals / ("request-" + REQUEST_ID + ".json")
        bridge.atomic_json(self.main, {"version": 1, "workerId": WORKER_ID, "id": REQUEST_ID,
            "kind": "request", "claimToken": self.source["claimToken"], "phase": "TERMINAL", "reported": True,
            "documentExpected": True, "quoteAttachmentVersion": 1,
            "workHash": bridge.claimed_work_hash(self.source), "outbound": outbound})
        self.original, state = kendo_serialized_native_state()
        self.raw = {"inputs": [], "fields": [], "downloads": [], "handlers": [
            {"kind": "add", "source": "function (e, data) { $.ajax({url:'/staff/upload/details/',type:'GET',data:{url:'https://secret.storage.googleapis.com/private?Signature=" + PRIVATE + "'}}); data.submit(); }"},
            {"kind": "submit", "source": "function (e, data) { data.process(); return true; }"},
            {"kind": "formData", "source": "function (form) { return form.serializeArray(); }"},
            {"kind": "done", "source": "function(e,data){ let secret='" + PRIVATE + "'; $.post('/staff/upload/details/',{file:secret}); }"},
            {"kind": "change", "source": "function (e) { return false; }"}], "completion": {}}
        self.page = FakePage(state, self.raw)
        self.closed = []

        @contextlib.contextmanager
        def owned(browser, signed_in):
            try:
                yield SimpleNamespace()
            finally:
                self.closed.append(True)

        @contextlib.contextmanager
        def editor(context, request, quote_attachment):
            self.assertEqual(request, self.request)
            self.assertEqual(quote_attachment, self.request["quote"])
            yield {**copy.deepcopy(self.original), "page": self.page, "createPath": PATH}

        self.native_creator = SimpleNamespace(BASE=creator.BASE, quote_browser_context=owned,
            native_line_editor=editor, account_tax_for_editor=lambda page: {},
            prepare=lambda *args: self.fail("prepare called"), submit=lambda *args: self.fail("submit called"),
            save=lambda *args: self.fail("save called"))
        self.browser = SimpleNamespace(contexts=[SimpleNamespace(pages=[SimpleNamespace(url=creator.BASE + "/staff/projects")])])
        self.modules = {"nexvia_create": self.native_creator, "nexvia_quote_attachment": quote,
                        "nexvia_requests": bridge, "nexvia_inspect_quote_upload": inspector}

    def tearDown(self):
        self.temporary.cleanup()

    def run_inspection(self):
        def imports(name):
            if name in self.modules:
                return self.modules[name]
            raise ImportError("Synthetic browser has no Playwright dependency")
        with patch.object(diagnostic.importlib, "import_module", side_effect=imports):
            return diagnostic.inspect_failed_request(REQUEST_ID, self.root, browser=self.browser)

    def protected(self):
        return diagnostic.evidence(self.root, REQUEST_ID)[0]

    def test_attempt_only_inspection_preserves_all_evidence_and_exports_every_sanitized_handler(self):
        before = self.protected()
        lock_before = self.lock.stat()
        report = self.run_inspection()
        self.assertEqual(self.protected(), before)
        self.assertEqual(self.lock.stat().st_mode, lock_before.st_mode)
        self.assertEqual(self.page.selections, 0)
        self.assertEqual(report["draftGuard"], "passed")
        self.assertEqual(len(report["handlers"]), 5)
        self.assertEqual(report["handlers"][0]["calls"], {"ajax": 1, "get": 0, "post": 0, "submit": 1, "process": 0})
        self.assertFalse(report["ownership"]["inputs"][0]["formIsPO"])
        self.assertFalse(report["ownership"]["inputs"][0]["ancestors"][0]["visible"])
        output = self.root / diagnostic.REPORT_NAME
        self.assertEqual(output.stat().st_mode & 0o777, 0o600)
        self.assertEqual(json.loads(output.read_bytes()), report)
        text = output.read_text()
        for secret in (PRIVATE, "Private filename.pdf", "Original quote bytes", "https://", "secret.storage.googleapis.com"):
            self.assertNotIn(secret, text)
        self.assertEqual(self.closed, [True])

    def test_callback_tokenization_preserves_full_middle_and_tail_without_private_values(self):
        source = "function(e,data){" + ";".join("let variable" + str(i) + "='private-value-" + str(i) + "'" for i in range(300))
        source += ";$.ajax({url:'/staff/upload/details/',type:'GET'});data.process();data.submit();}"
        symbolic = diagnostic.complete_symbolic_source(source, inspector)
        self.assertGreater(len(symbolic), 3600)
        self.assertIn("ajax", symbolic)
        self.assertTrue(symbolic.endswith("data . submit ( ) ; }"))
        self.assertNotIn("private-value", symbolic)
        self.assertNotIn("variable299", symbolic)
        self.assertNotIn("/staff/", symbolic)
        for invalid in ("function(){/*unclosed", "function(){return 'unclosed;}"):
            self.assertIsNone(diagnostic.complete_symbolic_source(invalid, inspector))

    def test_templates_mask_all_literals_and_expressions_but_keep_surrounding_ajax_flow(self):
        source = "function(e,data){let url=`/staff/upload/private-policy/${data.files[0].name}?token=" + PRIVATE + "`;return $.ajax({url:url,type:'GET'}).done(function(){data.submit();});}"
        result = diagnostic.symbolic_details(source, inspector)
        self.assertEqual(result["symbolicStatus"], "complete")
        self.assertIsNone(result["symbolicReason"])
        self.assertTrue(result["usesTemplate"])
        self.assertEqual(result["templateCount"], 1)
        self.assertIn("TEMPLATE_VALUE", result["symbolicComplete"])
        self.assertIn("ajax", result["symbolicComplete"])
        self.assertIn('"GET"', result["symbolicComplete"])
        self.assertIn("submit", result["symbolicComplete"])
        self.assertEqual(result["templateRoutes"], [{"dynamicPrefix": False,
            "destination": {"path": "/staff/upload/[redacted]/[redacted]", "queryKeys": ["[redacted]"]}}])
        for secret in (PRIVATE, "private-policy", "data.files[0].name", "token="):
            self.assertNotIn(secret, json.dumps(result))

    def test_escaped_and_nested_templates_are_opaque_including_interpolation_code(self):
        sources = [
            r"function(){return `private\`escaped\${" + PRIVATE + r"}`;}",
            "function(){return `outer ${`nested ${'" + PRIVATE + "'}`}`;}",
            "function(){return `outer ${{a:'}',b:/[}]/,c: /* } ` */ `inner ${1 / 2}`}}`;}" ,
            "function(){return `outer ${/[}`/]/.test('" + PRIVATE + "') ? 1 : 0}`;}",
            "function(){return `outer ${1 // " + PRIVATE + " } `\n + 2}`;}",
            "function(){return `https://private.storage.googleapis.com/secret?Signature=" + PRIVATE + "&name=${`deep ${'" + PRIVATE + "'}`}`;}"
        ]
        for source in sources:
            with self.subTest(source=source):
                result = diagnostic.symbolic_details(source, inspector)
                self.assertEqual(result["symbolicStatus"], "complete")
                self.assertNotIn(PRIVATE, json.dumps(result))
                self.assertNotIn("private.storage.googleapis.com", json.dumps(result))
                self.assertNotIn("outer", result["symbolicComplete"])
                self.assertNotIn("inner", result["symbolicComplete"])
                self.assertIn("TEMPLATE_VALUE", result["symbolicComplete"])

    def test_unsupported_syntax_reports_fixed_reason_without_raw_character_or_source(self):
        cases = [("function(){return `" + PRIVATE, "unterminated_template"),
                 ("function(){return `start ${'" + PRIVATE + "'", "unterminated_template_interpolation"),
                 ("function(){/* " + PRIVATE, "unterminated_comment"),
                 ("function(){return '" + PRIVATE, "unterminated_string"),
                 ("function(){return /" + PRIVATE, "unterminated_regex"),
                 ("function(){return @" + PRIVATE + ";}", "unsupported_token")]
        for source, reason in cases:
            with self.subTest(reason=reason):
                result = diagnostic.symbolic_details(source, inspector)
                self.assertEqual(result["symbolicStatus"], "unsupported")
                self.assertEqual(result["symbolicReason"], reason)
                self.assertIsNone(result["symbolicComplete"])
                self.assertNotIn(PRIVATE, json.dumps(result))
                self.assertNotIn("@", json.dumps(result))
                self.assertEqual(result["unsupportedToken"], reason == "unsupported_token")

    def test_template_depth_and_source_limits_have_fixed_actionable_status(self):
        nested = "`private`"
        for _ in range(40):
            nested = "`private ${" + nested + "}`"
        result = diagnostic.symbolic_details("function(){return " + nested + ";}", inspector)
        self.assertEqual(result["symbolicReason"], "template_nesting_limit")
        self.assertTrue(result["usesTemplate"])
        self.assertNotIn("private", json.dumps(result))
        result = diagnostic.symbolic_details("x" * 65537, inspector)
        self.assertEqual(result["symbolicReason"], "source_limit")
        self.assertEqual(result["sourceCharacters"], 65537)
        self.assertFalse(result["unsupportedToken"])

    def test_missing_send_source_is_reported_as_unavailable_instead_of_silently_skipped(self):
        report = diagnostic.callback_report({"handlers": [{"kind": "send", "source": None}]}, inspector)
        self.assertEqual(len(report), 1)
        self.assertEqual(report[0]["kind"], "send")
        self.assertEqual(report[0]["symbolicStatus"], "unsupported")
        self.assertEqual(report[0]["symbolicReason"], "source_type")
        self.assertFalse(report[0]["available"])

    def test_dynamic_template_prefix_only_exposes_redacted_native_route_structure(self):
        result = diagnostic.symbolic_details("function(){return `${window." + PRIVATE.replace("-", "_") + "}/staff/upload/details/${files[0].name}?file=${files[0].name}`;}", inspector)
        self.assertEqual(result["symbolicStatus"], "complete")
        self.assertEqual(result["templateRoutes"], [{"dynamicPrefix": True,
            "destination": {"path": "/staff/upload/details/[redacted]", "queryKeys": ["file"]}}])
        self.assertNotIn(PRIVATE.replace("-", "_"), json.dumps(result))

    def test_static_policy_contract_captures_root_relative_url_keys_provenance_and_complete_response_paths(self):
        self.raw["handlers"].append({"kind": "send", "source": SEND_POLICY})
        report = self.run_inspection()
        contract = report["policyContract"]
        self.assertEqual(contract["status"], "complete")
        ajax = contract["ajax"][0]
        self.assertEqual(ajax["method"], "GET")
        self.assertTrue(ajax["synchronous"])
        self.assertEqual(ajax["data"], [{"name": "file_name", "source": "normalized_filename"},
            {"name": "file_size", "source": "file.size"}, {"name": "file_type", "source": "file.type"}])
        self.assertEqual(ajax["urlCandidates"][0]["path"], "/upload/url")
        self.assertEqual(ajax["urlCandidates"][1]["path"], "/[dynamic]/upload/getSignedUrl")
        self.assertEqual(contract["globals"][0]["matchingLiteralIndexes"], [0])
        self.assertTrue(contract["filenameNormalizer"]["derivedFromName"])
        self.assertEqual(contract["filenameNormalizer"]["operations"], ["RegExp", "decodeURIComponent", "replace"])
        fields = {item["field"]: item for item in contract["formData"]}
        self.assertEqual(len(fields), 9)
        self.assertEqual(fields["x-goog-signature"]["responsePath"], ["response", "fields", "x-goog-signature"])
        self.assertEqual(fields["file"]["source"], "file_bytes")
        summary = diagnostic.console_summary(report)
        self.assertIn("Policy route:", summary)
        self.assertIn("Policy fields:", summary)
        self.assertIn("x-goog-signature", summary)
        self.assertIn('["file","file_bytes"]', summary)
        self.assertNotIn("SEND body:", summary)
        self.assertEqual(self.page.selections, 0)

    def test_private_route_field_key_response_property_and_selector_literals_never_leave_contract(self):
        private_identifier = PRIVATE.replace("-", "_")
        source = SEND_POLICY.replace("file_name:file.clean_name", "'" + PRIVATE + "':file.clean_name")
        source = source.replace("file.response.policy", "file.response['" + PRIVATE + "']")
        source = source.replace("'key',file.response.key", "'" + PRIVATE + "',file.response.key")
        source = source.replace("'staff'", "'" + PRIVATE + "'")
        source = source.replace("'/upload/url'", "'/upload/" + PRIVATE + "'")
        self.page.globals["module"] = PRIVATE
        contract = diagnostic.policy_contract({"handlers": [{"kind": "send", "source": source}]}, self.page)
        text = json.dumps(contract)
        self.assertNotIn(PRIVATE, text)
        self.assertNotIn(private_identifier, text)
        self.assertTrue(any(item["name"].startswith("[field-") for item in contract["ajax"][0]["data"]))
        self.assertTrue(any("[field-" in json.dumps(item) for item in contract["formData"]))
        for path in ("/upload/" + PRIVATE, "/upload/url?token=" + PRIVATE,
                     "https://private.invalid/upload/url", "/upload/abc01234567890abcdef"):
            self.assertIsNone(diagnostic._native_policy_path(path, creator.BASE + PATH))

    def test_unavailable_or_accessor_only_selector_does_not_evaluate_or_guess_global_values(self):
        self.page.globals = {}
        contract = diagnostic.policy_contract({"handlers": [{"kind": "send", "source": SEND_POLICY}]}, self.page)
        self.assertFalse(contract["globals"][0]["available"])
        self.assertEqual(contract["globals"][0]["matchingLiteralIndexes"], [])
        self.assertNotIn("matchedLiteralPath", json.dumps(contract))
        self.assertIn("Object.getOwnPropertyDescriptor", diagnostic.GLOBAL_SELECTOR_JS)
        self.assertNotIn("eval(", diagnostic.GLOBAL_SELECTOR_JS)
        self.assertNotIn("fetch(", diagnostic.GLOBAL_SELECTOR_JS)
        self.assertIn("hasOwnProperty.call(d,'value')", diagnostic.GLOBAL_SELECTOR_JS)

    def test_relative_policy_routes_use_only_validated_same_origin_document_base_uri(self):
        source = SEND_POLICY.replace("'/upload/url'", "'upload/url'")
        self.page.base_uri = creator.BASE + "/staff/"
        contract = diagnostic.policy_contract({"handlers": [{"kind": "send", "source": source}]}, self.page)
        self.assertEqual(contract["ajax"][0]["urlCandidates"][0]["path"], "/staff/upload/url")
        self.page.base_uri = "https://private.invalid/" + PRIVATE
        contract = diagnostic.policy_contract({"handlers": [{"kind": "send", "source": source}]}, self.page)
        self.assertEqual(contract["reason"], "unsafe_base_uri")
        self.assertEqual(contract["ajax"], [])
        self.assertNotIn(PRIVATE, json.dumps(contract))

    def test_arbitrary_regex_secrets_are_opaque_even_when_escaped_or_split(self):
        encoded = "".join("\\x" + format(ord(character), "02x") for character in PRIVATE)
        split = ".".join(PRIVATE)
        for pattern in ("/" + encoded + "/g", "/" + split + "/g"):
            source = SEND_POLICY.replace(r"/\+/g", pattern)
            contract = diagnostic.policy_contract({"handlers": [{"kind": "send", "source": source}]}, self.page)
            self.assertNotIn("patterns", contract["filenameNormalizer"])
            self.assertGreater(contract["filenameNormalizer"]["regexCount"], 0)
            self.assertNotIn(encoded, json.dumps(contract))
            self.assertNotIn(split, json.dumps(contract))

    def test_send_fail_and_always_callbacks_are_captured_without_invoking_them(self):
        for kind in ("send", "fail", "always"):
            self.raw["handlers"].append({"kind": kind, "source": "function(){throw '" + PRIVATE + "';}"})
        report = self.run_inspection()
        self.assertEqual([item["kind"] for item in report["handlers"][-3:]], ["send", "fail", "always"])
        self.assertTrue(any("'send','fail','always'" in source for source in self.page.calls))
        self.assertNotIn(PRIVATE, json.dumps(report))

    def test_console_prioritizes_send_template_flags_and_sanitized_body_within_total_budget(self):
        self.raw["handlers"].append({"kind": "send", "source": "function(e,data){let url=`/staff/upload/private-policy/${data.files[0].name}`;return $.ajax({url:url,type:'GET'}).done(function(){data.submit();});}"})
        report = self.run_inspection()
        summary = diagnostic.console_summary(report)
        self.assertIn("SEND body:", summary)
        self.assertIn("TEMPLATE_VALUE", summary)
        self.assertIn('"status":"complete"', summary)
        self.assertIn('"methods":["GET"]', summary)
        self.assertIn('"calls":{"ajax":1', summary)
        self.assertLess(summary.index("SEND body:"), summary.index("Handler:"))
        self.assertNotIn("private-policy", summary)
        stream = io.StringIO()
        with patch.object(diagnostic, "inspect_failed_request", return_value=report), contextlib.redirect_stdout(stream):
            diagnostic.main(["--request", REQUEST_ID, "--root", str(self.root)])
        self.assertLessEqual(len(stream.getvalue().rstrip("\n")), 2500)
        self.assertIn("No file was selected", stream.getvalue())

    def test_maximal_console_metadata_preserves_send_status_and_complete_evidence_footer(self):
        report = self.run_inspection()
        route = {"path": "/staff/" + "[redacted]/" * 40, "queryKeys": ["[redacted]"] * 20}
        send = {"kind": "send", "httpMethods": ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"],
                "routes": [route] * 12, "templateRoutes": [{"dynamicPrefix": True, "destination": route}] * 40,
                "symbolicStatus": "complete", "symbolicReason": None, "usesTemplate": True,
                "unsupportedToken": False, "templateCount": 40, "sourceCharacters": 65536,
                "calls": {key: 65536 for key in ("ajax", "get", "post", "submit", "process")},
                "symbolicComplete": "function data ajax TEMPLATE_VALUE " * 1000}
        report["handlers"] = [send] + [copy.deepcopy(send) for _ in range(39)]
        report["draftGuard"], report["draftError"] = "blocked", {"type": "QuoteAttachmentError", "message": "x" * 240}
        ancestor = {"tab": True, "visible": False, "panel": True, "hidden": True, "depth": 12, "tag": "DIV"}
        report["ownership"]["inputs"] = [{"containedByPO": True, "formIsPO": True, "visible": False,
                                            "ancestors": [ancestor] * 12}] * 12
        before = copy.deepcopy(report)
        stream = io.StringIO()
        with patch.object(diagnostic, "inspect_failed_request", return_value=report), contextlib.redirect_stdout(stream):
            diagnostic.main(["--request", REQUEST_ID, "--root", "/" + "long-root/" * 40])
        output = stream.getvalue()
        self.assertLessEqual(len(output), 2500)
        self.assertIn('"status":"complete"', output)
        self.assertIn("SEND body:", output)
        self.assertTrue(output.endswith("Original evidence is unchanged. No file was selected, uploaded or saved; no PO was created or changed.\n"))
        self.assertEqual(report, before, "console compacting must never alter the full private report")

    def test_source_comments_regexes_and_literal_secrets_are_never_exported(self):
        symbolic = diagnostic.complete_symbolic_source("function(){/* " + PRIVATE + " */ let secret=/" + PRIVATE + "/; //" + PRIVATE + "\nreturn \"" + PRIVATE + "\";}", inspector)
        self.assertIsNotNone(symbolic)
        self.assertNotIn(PRIVATE, symbolic)
        self.assertIn("REGEXP", symbolic)

    def test_missing_existing_lock_is_not_created_and_nonprivate_lock_is_not_repaired(self):
        self.lock.unlink()
        with self.assertRaises(diagnostic.InspectionError):
            self.run_inspection()
        self.assertFalse(self.lock.exists())
        self.lock.write_bytes(b"")
        self.lock.chmod(0o644)
        with self.assertRaises(diagnostic.InspectionError):
            self.run_inspection()
        self.assertEqual(self.lock.stat().st_mode & 0o777, 0o644)

    def test_lock_symlink_is_rejected_and_wait_is_bounded_without_evidence_changes(self):
        self.lock.unlink()
        target = self.root / "foreign-lock"
        target.write_bytes(b"")
        target.chmod(0o600)
        self.lock.symlink_to(target)
        with self.assertRaises(diagnostic.InspectionError):
            self.run_inspection()
        self.lock.unlink()
        self.lock.write_bytes(b"")
        self.lock.chmod(0o600)
        ticks = iter([0, 1, 31])
        with patch.object(diagnostic.fcntl, "flock", side_effect=BlockingIOError), \
                self.assertRaisesRegex(diagnostic.InspectionError, "bridge is busy"):
            with diagnostic.existing_bridge_lock(self.root, clock=lambda: next(ticks), sleep=lambda seconds: None):
                self.fail("Lock should not be acquired")

    def test_each_later_marker_blocks_before_opening_a_browser_even_when_symlinked(self):
        for marker in diagnostic.REQUEST_MARKERS[1:]:
            target = self.folder / marker
            target.symlink_to(self.root / "missing")
            with self.subTest(marker=marker), patch.object(diagnostic, "inspect_draft", side_effect=AssertionError("must not open a draft")), \
                    self.assertRaises(diagnostic.InspectionError):
                self.run_inspection()
            target.unlink()

    def test_attempt_identity_and_main_work_must_match_original_request(self):
        original_attempt = bridge.read_json(self.folder / quote.ATTEMPT_FILE, private=True)
        changed = dict(original_attempt, requestHash="a" * 64)
        bridge.atomic_json(self.folder / quote.ATTEMPT_FILE, changed)
        with self.assertRaisesRegex(diagnostic.InspectionError, "attempt does not match"):
            self.run_inspection()
        bridge.atomic_json(self.folder / quote.ATTEMPT_FILE, original_attempt)
        journal = bridge.read_json(self.main, private=True)
        journal["workHash"] = "b" * 64
        bridge.atomic_json(self.main, journal)
        with self.assertRaisesRegex(diagnostic.InspectionError, "work identity changed"):
            self.run_inspection()

    def test_source_permissions_and_hash_are_checked_without_opening_a_browser(self):
        source = self.folder / quote.SOURCE_FILE
        source.chmod(0o644)
        with patch.object(diagnostic, "inspect_draft", side_effect=AssertionError("must not open a draft")), \
                self.assertRaises(diagnostic.InspectionError):
            self.run_inspection()
        source.chmod(0o600)
        source.write_bytes(RAW[:-1] + b"x")
        with patch.object(diagnostic, "inspect_draft", side_effect=AssertionError("must not open a draft")), \
                self.assertRaises(quote.QuoteAttachmentError):
            self.run_inspection()

    def test_independent_tripwires_block_preparation_submission_save_and_file_selection(self):
        original_prepare = self.native_creator.prepare
        original_upload = quote.upload_quote
        with diagnostic.tripwires(self.native_creator, quote):
            for function in (self.native_creator.prepare, self.native_creator.submit, self.native_creator.save,
                             self.native_creator.upload_quote, quote.upload_quote, quote.begin_upload,
                             quote.complete_upload, quote.source_upload_payload):
                with self.assertRaises(diagnostic.InspectionError):
                    function()
        self.assertIs(self.native_creator.prepare, original_prepare)
        self.assertIs(quote.upload_quote, original_upload)
        self.assertFalse(hasattr(self.native_creator, "upload_quote"))
        self.native_creator.account_tax_for_editor = lambda page: page.locator('input[type="file"]').set_input_files(b"never")
        before = self.protected()
        with self.assertRaisesRegex(diagnostic.InspectionError, "prohibited"):
            self.run_inspection()
        self.assertEqual(self.page.selections, 0)
        self.assertEqual(self.protected(), before)

    def test_original_evidence_change_during_inspection_blocks_report_publication(self):
        def changed(page):
            record = bridge.read_json(self.main, private=True)
            record["reported"] = False
            bridge.atomic_json(self.main, record)
        self.native_creator.account_tax_for_editor = changed
        with self.assertRaisesRegex(diagnostic.InspectionError, "evidence changed"):
            self.run_inspection()
        self.assertFalse((self.root / diagnostic.REPORT_NAME).exists())

    def test_guard_failure_keeps_all_protocol_metadata_and_omits_unknown_private_error(self):
        self.page.state["inputCount"] = 2
        report = self.run_inspection()
        self.assertEqual(report["draftGuard"], "blocked")
        self.assertEqual(report["draftCounts"]["inputCount"], 2)
        self.assertEqual(report["draftError"]["message"], "Native quote draft context changed.")
        self.assertEqual(len(report["handlers"]), 5)
        with patch.object(quote, "validate_native_draft", side_effect=RuntimeError(PRIVATE)):
            report = self.run_inspection()
        self.assertEqual(report["draftError"], {"type": "UnexpectedError"})
        self.assertNotIn(PRIVATE, json.dumps(report))

    def test_output_symlink_does_not_overwrite_foreign_file_and_console_is_bounded(self):
        foreign = self.root / "foreign.json"
        foreign.write_text("preserved")
        output = self.root / diagnostic.REPORT_NAME
        output.symlink_to(foreign)
        with self.assertRaises(diagnostic.InspectionError):
            self.run_inspection()
        self.assertEqual(foreign.read_text(), "preserved")
        output.unlink()
        report = self.run_inspection()
        report["handlers"] *= 8
        stream = io.StringIO()
        with patch.object(diagnostic, "inspect_failed_request", return_value=report), contextlib.redirect_stdout(stream):
            diagnostic.main(["--request", REQUEST_ID, "--root", str(self.root)])
        self.assertLessEqual(len(stream.getvalue().rstrip("\n")), 2500)
        self.assertLess(stream.getvalue().index("Ownership:"), stream.getvalue().index("Handler:"))
        self.assertIn("No file was selected", stream.getvalue())

    def test_ownership_sanitizer_preserves_only_exact_boolean_counts_and_safe_structure(self):
        raw = copy.deepcopy(self.page.ownership)
        raw["inputs"][0]["url"] = "https://private.invalid/" + PRIVATE
        raw["inputs"][0]["ancestors"][0].update(id=PRIVATE, tag="PRIVATE-TAG")
        result = diagnostic.clean_ownership(raw)
        self.assertEqual(result["inputs"][0]["ancestors"][0]["tag"], "OTHER")
        self.assertFalse(result["inputs"][0]["containedByPO"])
        self.assertNotIn(PRIVATE, json.dumps(result))


if __name__ == "__main__":
    unittest.main()
