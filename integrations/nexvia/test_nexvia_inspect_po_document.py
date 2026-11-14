import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
from types import SimpleNamespace
import unittest


spec = importlib.util.spec_from_file_location(
    "nexvia_inspect_po_document", Path(__file__).with_name("nexvia_inspect_po_document.py"))
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)
TARGET = "/staff/project-purchase-order-modify/60/1421"


class FakeContext:
    def __init__(self, raw=None):
        self.closed = False
        self.guard = None
        self.raw = raw or {"hasLines": True, "numbers": ["PO7413"], "controls": [], "embedded": [], "snippets": []}
        self.pages = [SimpleNamespace(url=probe.ORIGIN + "/staff/projects")]

    def storage_state(self):
        return {"cookies": [{"domain": ".nexvia.com.au", "name": "session", "value": "private-cookie"},
                            {"domain": "unrelated.example", "name": "unrelated", "value": "other-secret"}],
                "origins": [{"origin": probe.ORIGIN, "localStorage": [{"name": "private", "value": "local-secret"}]},
                            {"origin": "https://unrelated.example", "localStorage": []}]}

    def route(self, pattern, callback):
        self.guard = callback

    def route_web_socket(self, pattern, callback):
        self.websocket_guard = callback

    def add_init_script(self, script):
        self.init_script = script

    def new_page(self):
        context = self

        class Page:
            def goto(self, url, **kwargs):
                self.url = url
                return SimpleNamespace(status=200)

            def locator(self, selector):
                return SimpleNamespace(wait_for=lambda **kwargs: None)

            def evaluate(self, source):
                return context.raw

        self.page = Page()
        return self.page

    def close(self):
        self.closed = True


class FakeBrowser:
    def __init__(self, raw=None):
        self.original = FakeContext()
        self.contexts = [self.original]
        self.owned = FakeContext(raw)

    def new_context(self, **kwargs):
        self.options = kwargs
        return self.owned


class DocumentInspectionTests(unittest.TestCase):
    def test_only_exact_saved_page_and_static_resource_reads_are_allowed(self):
        allowed = probe.allow_request
        self.assertTrue(allowed(probe.ORIGIN + TARGET, "GET", TARGET, "document"))
        self.assertTrue(allowed(probe.ORIGIN + "/staff/js/app.js?v=123", "GET", TARGET, "script"))
        self.assertTrue(allowed(probe.ORIGIN + "/staff/css/app.css", "HEAD", TARGET, "stylesheet"))
        for url, method, kind in [
            (probe.ORIGIN + TARGET, "POST", "document"),
            (probe.ORIGIN + TARGET + "?Print=true", "GET", "document"),
            (probe.ORIGIN + TARGET + "#print", "GET", "document"),
            (probe.ORIGIN + "/staff/project-purchase-order-modify/60/1422", "GET", "document"),
            (probe.ORIGIN + "/staff/project-purchase-order-print/1421/sent/1", "GET", "document"),
            (probe.ORIGIN + "/staff/project-purchase-order-print/1421/sent/0", "GET", "fetch"),
            (probe.ORIGIN + "/staff/project-purchase-order-print/1421/sent/1.js", "GET", "script"),
            (probe.ORIGIN + "/staff/project-purchase-order-add/60", "GET", "document"),
            (probe.ORIGIN + "/staff/file/remove/1.png", "GET", "image"),
            (probe.ORIGIN + "/staff/js/app.js", "GET", "document"),
            (probe.ORIGIN + "/staff/js/app.js", "POST", "script"),
            (probe.ORIGIN + "/staff/email-action.png?send=1", "GET", "image"),
            (probe.ORIGIN + "/staff/js/app.js?send=1", "GET", "script"),
            (probe.ORIGIN + "/staff/random-route.png", "GET", "image"),
            (probe.ORIGIN + "/staff/%70rint/1.js", "GET", "script"),
            (probe.ORIGIN + "/staff/js/../print.js", "GET", "script"),
            ("https://foreign.example/staff/js/app.js", "GET", "script"),
            ("http://lennox.nexvia.com.au" + TARGET, "GET", "document"),
        ]:
            with self.subTest(url=url, method=method):
                self.assertFalse(allowed(url, method, TARGET, kind))

    def test_url_metadata_omits_query_values_and_private_path_parts(self):
        value = probe.url_metadata("/staff/project-purchase-order-print/1421/sent/1?format=PDF&token=very-private&returnUrl=private-user")
        self.assertEqual(value, {"path": "/staff/project-purchase-order-print/1421/sent/1", "queryKeys": ["format", "[redacted]", "returnUrl"]})
        self.assertEqual(probe.url_metadata("/staff/files/Customer-name.pdf?name=customer-name")["path"], "/staff/files/[file].pdf")
        self.assertEqual(probe.url_metadata("/staff/private%40example.invalid/secret-token")["path"], "/staff/[redacted]/[redacted]")
        self.assertEqual(probe.url_metadata("https://private.example/path?token=secret"), {"externalOrNonHttp": True})
        self.assertEqual(probe.url_metadata("/documents/AbcdefghijklmnopQRSTuvwxYZ012345")["path"], "/documents/[redacted]")
        self.assertEqual(probe.url_metadata("/staff/AcmeConstructionPtyLtd/1421")["path"], "/staff/[redacted]/1421")
        self.assertEqual(probe.url_metadata("/file?AcmeConstructionPtyLtd=1")["queryKeys"], ["[redacted]"])
        self.assertNotIn("very-private", json.dumps(value))

    def test_js_snippets_preserve_route_control_flow_without_literals_or_secrets(self):
        source = "function nativePrint(){const csrfToken='private'; var email='person@example.invalid'; /* private comment */ if(ready){window.open('/staff/project-purchase-order-print/1421/sent/1');fetch('/staff/private',{method:'POST',body:'PRIVATE CUSTOMER'});}}"
        clean = probe.sanitized_snippet(source)
        self.assertIn("function nativePrint()", clean)
        self.assertIn("/staff/project-purchase-order-print/1421/sent/1", clean)
        self.assertIn('method:"POST"', clean)
        self.assertIn("if(IDENT)", clean)
        for secret in ["csrfToken", "'private'", "private comment", "person@example.invalid", "PRIVATE CUSTOMER", "/staff/private"]:
            self.assertNotIn(secret, clean)
        self.assertNotIn("AcmeConstructionPtyLtd", probe.sanitized_snippet("const labels={AcmeConstructionPtyLtd:1234};"))
        for source in ["window.open(`/staff/project-purchase-order-print/${id}`)", "if(/secret/.test(value))print()", "print('unfinished", "value@private.invalid"]:
            self.assertIsNone(probe.sanitized_snippet(source))

    def test_only_benign_action_flag_selectors_and_zero_one_literals_survive(self):
        clean = probe.sanitized_snippet("var flags=[0,1,42]; var sent=$('#form_MarkSent').is(':checked')?1:0; var print=document.getElementsByName('form[Print]')[0];var email=$('[name=\"form[Email]\"]');var privateField=$('#form_Password').val('private');")
        for literal in ['[0,1,NUMBER]', '"#form_MarkSent"', '":checked"', '?1:0', '"form[Print]"', 'form[Email]']:
            self.assertIn(literal, clean)
        for private in ["42", "form_Password", "privateField", "'private'"]:
            self.assertNotIn(private, clean)

    def test_metadata_never_exports_control_values_or_arbitrary_labels(self):
        raw = {"controls": [{"tag": "BUTTON", "label": "Download PRIVATE CUSTOMER PDF", "type": "submit",
                             "value": "private-form-value", "href": "/staff/files/customer.pdf?token=private",
                             "onclick": "send('private-recipient@example.invalid')", "visible": True,
                             "formMethod": "POST", "formAction": TARGET + "?csrf=private"}],
               "embedded": [{"tag": "IFRAME", "type": "application/pdf", "src": "/staff/files/customer.pdf?token=private"}],
               "snippets": ["if(/private/.test(value))print()"],
               "actionFlags": [{"name": "form[Print]", "type": "checkbox", "checked": True, "enabled": False, "value": "private"},
                               {"name": "form[Password]", "type": "password", "checked": False}]}
        clean = probe.clean_metadata(raw)
        serialized = json.dumps(clean)
        self.assertEqual(clean["controls"][0]["label"], "Download PDF")
        self.assertEqual(clean["controls"][0]["formMethod"], "POST")
        self.assertEqual(clean["actionFlags"], [{"name": "form[Print]", "type": "checkbox", "checked": True, "enabled": False}])
        self.assertTrue(clean["nativePrintHandlers"][0]["metadataOnly"])
        for secret in ["private", "PRIVATE CUSTOMER", "customer.pdf", "form[Password]", "private-form-value"]:
            self.assertNotIn(secret, serialized)

    def test_report_is_private_bounded_and_does_not_replace_after_invalid_write(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "discovery.json"
            probe.atomic_report(path, {"controls": []})
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            before = path.read_bytes()
            with self.assertRaises(ValueError):
                probe.atomic_report(path, {"oversized": "x" * probe.MAX_REPORT_BYTES})
            self.assertEqual(path.read_bytes(), before)
            link = Path(folder) / "link.json"
            link.symlink_to(path)
            with self.assertRaises(ValueError):
                probe.atomic_report(link, {})
            self.assertEqual(path.read_bytes(), before)

    def test_identity_arguments_fail_before_browser_connection(self):
        for value in ["0", "-1", "1.5", "1e2", "true", "001", "1/2", "1234567890123456"]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                probe.positive_id(value)
        for value in ["7413", "po7413", "PO1/private", "PO7413?token=private"]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                probe.po_number(value)
        with self.assertRaises(ValueError):
            probe.main(["--project", "0", "--po", "1421", "--number", "PO7413"])

    def test_owned_context_blocks_service_workers_popups_and_does_not_close_user_context(self):
        browser = FakeBrowser()
        report = probe.inspect_browser(browser, 60, 1421, "PO7413")
        self.assertEqual(browser.options["service_workers"], "block")
        self.assertFalse(browser.options["accept_downloads"])
        self.assertEqual([cookie["domain"] for cookie in browser.options["storage_state"]["cookies"]], [".nexvia.com.au"])
        self.assertEqual([origin["origin"] for origin in browser.options["storage_state"]["origins"]], [probe.ORIGIN])
        self.assertIsNotNone(browser.owned.guard)
        self.assertTrue(browser.owned.closed)
        self.assertFalse(browser.original.closed)
        self.assertFalse(report["documentActionInvoked"])
        self.assertEqual(report["purchaseOrderNumber"], "PO7413")
        self.assertNotIn("private-cookie", json.dumps(report))
        self.assertNotIn("local-secret", json.dumps(report))
        actions = []
        browser.owned.guard(SimpleNamespace(request=SimpleNamespace(url=probe.ORIGIN + "/staff/project-purchase-order-print/1421/sent/1?token=private", method="GET", resource_type="document"),
                                            continue_=lambda: actions.append("allowed"), abort=lambda: actions.append("blocked")))
        self.assertEqual(actions, ["blocked"])

    def test_wrong_po_identity_or_unavailable_websocket_guard_fails_closed(self):
        browser = FakeBrowser({"hasLines": True, "numbers": ["PO9999"], "controls": [], "embedded": [], "snippets": []})
        with self.assertRaises(ValueError):
            probe.inspect_browser(browser, 60, 1421, "PO7413")
        self.assertTrue(browser.owned.closed)
        self.assertFalse(browser.original.closed)
        browser = FakeBrowser()
        browser.owned.route_web_socket = None
        with self.assertRaises(ValueError):
            probe.inspect_browser(browser, 60, 1421, "PO7413")
        self.assertFalse(hasattr(browser.owned, "page"))
        self.assertTrue(browser.owned.closed)

    @unittest.skipUnless(shutil.which("node"), "Node is needed for browser-program syntax verification")
    def test_browser_metadata_program_parses_without_running_it(self):
        subprocess.run(["node", "-e", "new (require('node:vm').Script)('('+JSON.parse(require('node:fs').readFileSync(0,'utf8'))+')')"],
                       input=json.dumps(probe.METADATA_JS), text=True, capture_output=True, check=True)

    @unittest.skipUnless(shutil.which("node"), "Node is needed for passive handler inspection verification")
    def test_targeted_handlers_are_read_without_invoking_them_or_global_getters(self):
        harness = r'''
const vm=require('node:vm'),source=JSON.parse(require('node:fs').readFileSync(0,'utf8'));
let calls=0,getterReads=0,toStringCalls=0,jqueryReads=0;
function printPO(){calls++;if($('#form_MarkSent').is(':checked'))window.open('/staff/project-purchase-order-print/1421/sent/1');else window.open('/staff/project-purchase-order-print/1421/sent/0');}
function clickHandler(){printPO();}
function jqueryHandler(){calls++;return 'PRIVATE CUSTOMER';}
clickHandler.toString=()=>{toStringCalls++;throw Error('custom toString must not run');};
const attrs={onclick:'printPO();viewPDF();',type:'button'};
const button={tagName:'BUTTON',textContent:'Print PO',onclick:clickHandler,getAttribute:name=>attrs[name]||null,getClientRects:()=>[1],closest:()=>null};
const jq=()=>{};jq._data=(el,name)=>{jqueryReads++;return {click:[{handler:jqueryHandler}]};};
const window={jQuery:jq,printPO};Object.defineProperty(window,'viewPDF',{get(){getterReads++;throw Error('global getter must not run');}});
const document={body:{innerText:'Purchase Order # PO7413'},querySelectorAll:selector=>selector.startsWith('a,button')?[button]:[],querySelector:()=>({}),getElementsByName:()=>[],scripts:[{src:'',textContent:"var unrelated=/PRIVATE CUSTOMER/;window.open('/staff/project-purchase-order-print/1421/sent/1');"}]};
const raw=vm.runInNewContext('('+source+')()',{window,document});
process.stdout.write(JSON.stringify({raw,calls,getterReads,toStringCalls,jqueryReads}));
'''
        completed = subprocess.run(["node", "-e", harness], input=json.dumps(probe.METADATA_JS), text=True, capture_output=True, check=True)
        observed = json.loads(completed.stdout)
        self.assertEqual({key: observed[key] for key in ["calls", "getterReads", "toStringCalls", "jqueryReads"]},
                         {"calls": 0, "getterReads": 0, "toStringCalls": 0, "jqueryReads": 1})
        clean = probe.clean_metadata(observed["raw"])
        self.assertTrue(clean["nativePrintHandlers"][0]["metadataOnly"])
        sources = clean["controls"][0]["handlerSources"]
        self.assertEqual([item["kind"] for item in sources], ["onclick-property", "named-global", "jquery-click"])
        proof = sources[1]["sanitized"]
        self.assertIn('"#form_MarkSent"', proof)
        self.assertIn('":checked"', proof)
        self.assertIn("/staff/project-purchase-order-print/1421/sent/1", proof)
        self.assertIn("/staff/project-purchase-order-print/1421/sent/0", proof)
        self.assertNotIn("PRIVATE CUSTOMER", json.dumps(clean))


if __name__ == "__main__":
    unittest.main()
