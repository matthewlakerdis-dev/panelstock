import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit


spec = importlib.util.spec_from_file_location("nexvia_inspect_quote_upload", Path(__file__).with_name("nexvia_inspect_quote_upload.py"))
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)
TARGET = probe.ORIGIN + "/staff/project-purchase-order-modify/60/1421"
ASSET = probe.ORIGIN + "/plugins/jquery-fileupload.js?v=1"


class ProbeTests(unittest.TestCase):
    def test_only_exact_existing_page_and_predeclared_static_reads_are_allowed(self):
        self.assertTrue(probe.allow_request(TARGET, "GET", {TARGET}, {ASSET}, "document"))
        self.assertTrue(probe.allow_request(ASSET, "GET", {TARGET}, {ASSET}, "script"))
        for url, method, kind in [(TARGET, "POST", "document"), (TARGET, "PUT", "document"),
                                  (TARGET + "?save=1", "GET", "document"),
                                  (probe.ORIGIN + "/staff/project-purchase-order-print/1421/sent/1", "GET", "document"),
                                  (probe.ORIGIN + "/staff/upload/details/123", "GET", "fetch"),
                                  (probe.ORIGIN + "/staff/file/getFiles/123", "GET", "fetch"),
                                  (ASSET, "POST", "script"), (ASSET, "GET", "document"),
                                  (probe.ORIGIN + "/plugins/undeclared.js", "GET", "script"),
                                  ("https://foreign.invalid/fileupload.js", "GET", "script")]:
            self.assertFalse(probe.allow_request(url, method, {TARGET}, {ASSET}, kind))
        for url in [probe.ORIGIN + "/staff/upload/details/action.js", ASSET + "&send=1", probe.ORIGIN + "/plugins/%2e%2e/action.js",
                    probe.ORIGIN + "/staff/project-purchase-order-email/1421.png", probe.ORIGIN + "/staff/markSent/1421.svg",
                    probe.ORIGIN + "/staff/approve/1421.js"]:
            self.assertIsNone(probe.static_url(url))
            self.assertFalse(probe.allow_request(url, "GET", {TARGET}, {url}, "script"))

    def test_route_and_handler_summaries_keep_contract_without_private_values(self):
        value = probe.route_info("/staff/upload/details/123/PRIVATE-QUOTE.pdf?token=PRIVATE&file=PRIVATE-ID")
        self.assertEqual(value["path"], "/staff/upload/details/[id]/[redacted]")
        self.assertEqual(value["queryKeys"], ["[redacted]", "file"])
        external = probe.route_info("https://private.invalid/secret?token=PRIVATE")
        self.assertTrue(external["externalOrNonHttp"])
        self.assertEqual(external["host"], "[other]")
        self.assertEqual(external["provider"], "other")
        google = probe.route_info("https://storage.googleapis.com/PRIVATE-BUCKET/PRIVATE-FILE.pdf?Signature=PRIVATE")
        self.assertEqual(google["host"], "storage.googleapis.com")
        self.assertEqual(google["provider"], "gcs")
        self.assertEqual(google["pathClass"], "bucket/object")
        self.assertNotIn("PRIVATE", json.dumps(google))
        self.assertEqual(probe.route_info("/staff/acmeconstruction/PRIVATE")["path"], "/staff/[redacted]/[redacted]")
        source = "function done(e){var fd=new FormData();fd.append('form[Files][]',e.response._resp.general_file_id);$.ajax({url:'/staff/upload/details/123?token=PRIVATE',type:'POST'});var email='PRIVATE@example.invalid';}"
        summary = probe.handler_info(source)
        self.assertTrue(summary["usesFormData"])
        self.assertTrue(summary["mentionsFilesField"])
        self.assertIn("form[Files][]", summary["formDataFields"])
        self.assertIn("general_file_id", summary["responseFields"])
        self.assertEqual(summary["httpMethods"], ["POST"])
        self.assertNotIn("PRIVATE", json.dumps(summary))
        self.assertNotIn("@example.invalid", json.dumps(summary))
        self.assertEqual(probe.field_name("AcmeConstructionPtyLtd"), "[redacted]")

    def test_symbolic_callback_keeps_relationships_but_redacts_values(self):
        source = "function AcmeConstruction(e){var secret='PRIVATE';var fd=new FormData();fd.append('GoogleAccessId',e.data.key);fd.append('policy','PRIVATE-POLICY');if(/PRIVATE[^x]+/.test(e.name)){$.ajax({url:'https://storage.googleapis.com/PRIVATE?Signature=PRIVATE',type:'POST'}).done(function(resp){e.inputs.val(resp.id);});}}"
        summary = probe.handler_info(source)
        symbolic = summary["symbolic"]
        self.assertIn('"GoogleAccessId"', symbolic)
        self.assertIn('"policy"', symbolic)
        self.assertIn("REGEXP", symbolic)
        self.assertIn("REMOTE_ROUTE", symbolic)
        self.assertIn(". id", symbolic)
        self.assertNotIn("PRIVATE", json.dumps(summary))
        self.assertNotIn("AcmeConstruction", json.dumps(summary))
        self.assertIsNone(probe.symbolic_source("function fn(){return `PRIVATE`;}"))

    def test_add_context_uses_explicit_saved_choices_and_unique_named_supplier(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            catalog = {"projectPageId": 60, "services": [{"id": 1}, {"id": 8}],
                       "breakdowns": [{"id": "b_1"}, {"id": "b_70"}], "suppliers": [{"id": 1}, {"id": 225}]}
            directory = {"expectedTotal": 2, "records": [{"id": 1, "name": "First Supplier"}, {"id": 225, "text": "Bunnings Warehouse"}]}
            def save():
                (root / "nexvia-form-data.json").write_text(json.dumps(catalog))
                (root / "nexvia-supplier-directory.json").write_text(json.dumps(directory))
            raw = {"nativeContext": {"service": "8", "eows": ["b_70"]}}
            save()
            result = probe.resolve_add_context(raw, 60, "Bunnings", root)
            self.assertEqual(urlsplit(result).path, "/staff/project-purchase-order-add/60")
            self.assertEqual(parse_qs(urlsplit(result).query), {"type": ["Assembly"], "service": ["8"], "client": ["225"], "breakdown_type": ["b_70"]})
            for changed, expected in [({"service": "8", "eows": []}, "saved_eow_missing"),
                                      ({"service": "8", "eows": ["b_70", "b_1"]}, "saved_eow_ambiguous"),
                                      ({"service": "99", "eows": ["b_70"]}, "saved_service_not_current")]:
                with self.assertRaisesRegex(probe.ContextUnavailable, expected):
                    probe.resolve_add_context({"nativeContext": changed}, 60, "Bunnings", root)
            directory["records"].append({"id": 226, "name": "Bunnings Trade"})
            directory["expectedTotal"] = 3
            save()
            with self.assertRaisesRegex(probe.ContextUnavailable, "supplier_ambiguous"):
                probe.resolve_add_context(raw, 60, "Bunnings", root)
            directory["expectedTotal"] = 4
            save()
            with self.assertRaisesRegex(probe.ContextUnavailable, "supplier_cache_incomplete"):
                probe.resolve_add_context(raw, 60, "Bunnings", root)

    def test_clean_report_omits_names_values_and_unknown_identifiers(self):
        raw = {"inputs": [{"name": "form[Files][]", "id": "PRIVATE_CUSTOMER", "accept": ".pdf,PRIVATE", "selectedCount": 1,
                           "widgets": [{"params": {"autoUpload": True, "saveField": "files"},
                                        "routes": [{"purpose": "saveUrl", "url": "/staff/upload/details/?token=PRIVATE"}],
                                        "fields": {"formData": {"kind": "object", "fields": [{"name": "csrf_token", "shape": {"kind": "string"}, "value": "PRIVATE"}]}},
                                        "allowedExtensions": [".pdf", ".PRIVATE"]}]}],
               "fields": [{"name": "form[Files][]", "kind": "opaque", "value": "PRIVATE"}],
               "handlers": [], "completion": {"fileCardLabels": {"name": True, "size": True, "download": True, "remove": True}}}
        clean = probe.clean_report(raw)
        self.assertEqual(clean["fileInputs"][0]["widgets"][0]["params"], {"autoUpload": True, "saveField": "files"})
        self.assertEqual(clean["fileInputs"][0]["accept"], [".pdf"])
        self.assertEqual(clean["fileInputs"][0]["widgets"][0]["allowedExtensions"], [".pdf"])
        self.assertNotIn("PRIVATE", json.dumps(clean))
        self.assertNotIn("csrf_token", json.dumps(clean))
        summary = probe.console_summary({**clean, "addPage": {"available": False}})
        self.assertLess(len(json.dumps(summary).encode()), 8000)
        self.assertEqual(summary["existing"]["formDataFields"], [{"name": "[redacted]", "kind": "string"}])
        self.assertFalse(summary["unsavedAdd"]["available"])

    def test_report_is_private_bounded_and_cannot_replace_a_symlink(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "discovery.json"
            probe.save_report(path, {"fileInputs": []})
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            before = path.read_bytes()
            with self.assertRaises(ValueError):
                probe.save_report(path, {"tooLarge": "x" * probe.MAX_REPORT})
            self.assertEqual(path.read_bytes(), before)
            link = Path(folder) / "link.json"
            link.symlink_to(path)
            with self.assertRaises(ValueError):
                probe.save_report(link, {})

    def test_owned_context_is_guarded_and_original_context_is_unchanged(self):
        original = SimpleNamespace(pages=[SimpleNamespace(url=TARGET, evaluate=lambda source: [ASSET])],
                                   storage_state=lambda: {"cookies": [{"domain": ".nexvia.com.au", "value": "PRIVATE"}, {"domain": "foreign.invalid", "value": "PRIVATE"}], "origins": []})
        state = {"closed": False}

        class Page:
            url = TARGET

            def goto(self, url, **kwargs):
                self.url = url
                return SimpleNamespace(status=200)

            def locator(self, selector):
                return SimpleNamespace(wait_for=lambda **kwargs: None)

            def wait_for_timeout(self, timeout):
                pass

            def evaluate(self, source):
                if self.url.startswith(probe.ORIGIN + "/staff/project-purchase-order-add/60"):
                    raw = {"hasLines": True, "numbers": [], "inputs": [], "fields": [{"name": "form[Files][]", "kind": "empty"}], "handlers": [], "completion": {},
                           "nativeForm": {"method": "POST", "action": self.url, "linesKind": "array", "lineCount": 0}}
                    raw.update(state.get("addOverrides", {}))
                    raw["nativeForm"].update(state.get("addFormOverrides", {}))
                    return raw
                return {"hasLines": True, "numbers": ["PO7413"], "inputs": [], "fields": [], "handlers": [], "completion": {}}

        context = SimpleNamespace(route=lambda pattern, callback: state.update(guard=callback),
                                  route_web_socket=lambda *args: None, add_init_script=lambda source: None,
                                  new_page=lambda: Page(), close=lambda: state.update(closed=True))

        def new_context(**kwargs):
            state["options"] = kwargs
            return context

        browser = SimpleNamespace(contexts=[original], new_context=new_context)
        add_target = probe.ORIGIN + "/staff/project-purchase-order-add/60?type=Assembly&service=8&client=225&breakdown_type=b_70"
        with patch.object(probe, "resolve_add_context", return_value=add_target):
            report = probe.inspect_browser(browser, 60, 1421, "PO7413")
        self.assertTrue(state["closed"])
        self.assertEqual(state["options"]["service_workers"], "block")
        self.assertFalse(state["options"]["accept_downloads"])
        self.assertEqual(len(state["options"]["storage_state"]["cookies"]), 1)
        self.assertFalse(report["uploadOrSaveInvoked"])
        self.assertTrue(report["addPage"]["available"])
        self.assertTrue(report["addPage"]["emptyUnsavedPostForm"])
        self.assertEqual(report["addPage"]["nativeForm"]["lineCount"], 0)
        self.assertEqual(report["addPage"]["filesFields"], [{"name": "form[Files][]", "kind": "empty"}])
        self.assertNotIn("PRIVATE", json.dumps(report))
        actions = []
        state["guard"](SimpleNamespace(request=SimpleNamespace(url=TARGET, method="POST", resource_type="document"),
                                       continue_=lambda: actions.append("allowed"), abort=lambda: actions.append("blocked")))
        self.assertEqual(actions, ["blocked"])
        for overrides, expected in [({"method": "GET"}, "add_form_not_post"), ({"lineCount": 1}, "add_lines_not_empty"), ({"action": TARGET}, "add_form_action_mismatch")]:
            state["addFormOverrides"] = overrides
            with patch.object(probe, "resolve_add_context", return_value=add_target):
                invalid = probe.inspect_browser(browser, 60, 1421, "PO7413")
            self.assertFalse(invalid["addPage"]["available"])
            self.assertEqual(invalid["addPage"]["status"], expected)
        state["addFormOverrides"] = {}
        state["addOverrides"] = {"numbers": ["PO7413"]}
        with patch.object(probe, "resolve_add_context", return_value=add_target):
            self.assertFalse(probe.inspect_browser(browser, 60, 1421, "PO7413")["addPage"]["available"])
        self.assertEqual(probe.inspect_browser(browser, 60, 1421, "PO7413")["addPage"]["status"], "supplier_hint_required")

    def test_invalid_identity_arguments_fail_before_browser_connection(self):
        with self.assertRaises(ValueError):
            probe.main(["--project", "0", "--po", "1421", "--number", "PO7413"])
        with self.assertRaises(ValueError):
            probe.main(["--project", "60", "--po", "1421", "--number", "PO7413/private"])

    @unittest.skipUnless(shutil.which("node"), "Node is needed for passive native uploader verification")
    def test_real_js_reads_widget_protocol_without_invoking_upload_or_selecting_file(self):
        harness = r'''
const vm=require('node:vm'),inputData=JSON.parse(require('node:fs').readFileSync(0,'utf8')),source=inputData.source;
let actions=0,getters=0,overrides=0;
function success(e){actions++;var file=e.response._resp.general_file_id;var fd=new FormData();fd.append('form[Files][]',file);}
success.toString=()=>{overrides++;throw Error();};
function changed(e){NativeFiles.onChange(e);LazyFiles.onChange(e);}
function nativeUpload(e){actions++;$.ajax({url:'/staff/upload/details/',type:'POST',data:e.files});}
const path=inputData.draft?'/staff/project-purchase-order-add/60':'/staff/project-purchase-order-modify/60/1421';
const form={getAttribute:name=>({method:'POST',action:path})[name]||null,enctype:'application/x-www-form-urlencoded',parentElement:null};
const attrs={onchange:'NativeFiles.onChange(event)',name:'form[Files][]'};
const input={name:'form[Files][]',id:'nativeFileInput',accept:'.pdf',multiple:true,disabled:false,type:'file',files:[],attributes:[],form,parentElement:form,
 getAttribute:name=>attrs[name]||null,getClientRects:()=>[1],matches:selector=>selector==='input[type=file]',onchange:changed};
const widget={options:{name:'Upload',async:{saveUrl:'/staff/upload/details/?token=PRIVATE',removeUrl:'/staff/file/remove/123',saveField:'files',autoUpload:true},
 validation:{allowedExtensions:['.pdf'],maxFileSize:10485760},success,formData:{csrf_token:'PRIVATE'},files:inputData.draft?[]:[{id:123,name:'PRIVATE.pdf',size:100}]},_events:{success:[success]}};
const jq=()=>({data:()=>({kendoUpload:widget})});jq._data=node=>({change:node===document?[{selector:'input[type=file]',handler:nativeUpload}]:[]});
const window={jQuery:jq,NativeFiles:{onChange:nativeUpload}};Object.defineProperty(window,'LazyFiles',{get(){getters++;throw Error();}});
const document={body:{innerText:inputData.draft?'New Purchase Order':'Purchase Order # PO7413\nName: PRIVATE.pdf Size: 20 KB Download Remove'},querySelector:()=>({value:'[]',form}),getElementsByName:name=>[{value:name==='form[ServiceId]'?'8':'b_70'}],
 querySelectorAll:selector=>selector==='input[type="file"]'?[input]:selector.startsWith('[name=')?[{name:'form[Files][]',tagName:'INPUT',type:'hidden',value:inputData.draft?'':'PRIVATE_ID'}]:[],scripts:[]};
const raw=vm.runInNewContext('('+source+')()',{window,document,location:{href:'https://lennox.nexvia.com.au'+path}});
process.stdout.write(JSON.stringify({raw,actions,getters,overrides}));
'''
        completed = subprocess.run(["node", "-e", harness], input=json.dumps({"source": probe.INSPECT_JS, "draft": False}), text=True, capture_output=True, check=True)
        value = json.loads(completed.stdout)
        self.assertEqual({key: value[key] for key in ["actions", "getters", "overrides"]}, {"actions": 0, "getters": 0, "overrides": 0})
        clean = probe.clean_report(value["raw"])
        widget = clean["fileInputs"][0]["widgets"][0]
        self.assertEqual(widget["params"]["saveField"], "files")
        self.assertTrue(widget["params"]["autoUpload"])
        self.assertEqual(widget["routes"][0]["destination"]["path"], "/staff/upload/details/")
        self.assertTrue(any(row.get("mentionsFilesField") for row in clean["handlers"]))
        self.assertTrue(any("POST" in row.get("httpMethods", []) for row in clean["handlers"]))
        self.assertTrue(any("general_file_id" in row.get("responseFields", []) for row in clean["handlers"]))
        self.assertEqual(widget["filesShape"]["count"], 1)
        self.assertIn({"name": "id", "kind": "number"}, widget["filesShape"]["itemFields"])
        self.assertNotIn("PRIVATE", json.dumps(clean))
        completed = subprocess.run(["node", "-e", harness], input=json.dumps({"source": probe.INSPECT_JS, "draft": True}), text=True, capture_output=True, check=True)
        draft = json.loads(completed.stdout)
        self.assertEqual(draft["raw"]["numbers"], [])
        clean = probe.clean_report(draft["raw"])
        self.assertEqual(clean["nativeForm"]["method"], "POST")
        self.assertEqual(clean["nativeForm"]["lineCount"], 0)
        self.assertEqual(clean["fileInputs"][0]["widgets"][0]["filesShape"]["count"], 0)
        self.assertEqual(clean["filesFields"][0]["kind"], "empty")
        self.assertEqual(draft["actions"], 0)


if __name__ == "__main__":
    unittest.main()
