import importlib.util
from contextlib import contextmanager
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("nexvia_lookups", Path(__file__).with_name("nexvia_lookups.py"))
lookups = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lookups)


def page(number, rows, total=3, size=2, server=True, native_filter=None):
    return {"page": number, "rows": rows, "total": total, "pageSize": size,
            "serverPaging": server, "filter": native_filter}


class PagingTests(unittest.TestCase):
    def test_all_server_pages_are_collected_with_native_ids(self):
        pages = {1: page(1, [{"id": 1}, {"id": 2}]), 2: page(2, [{"id": 3}])}
        requested = []
        rows, selected_filter = lookups.collect_pages(lambda number: requested.append(number) or pages[number], "Supplier")
        self.assertEqual(requested, [1, 2])
        self.assertEqual([row["id"] for row in rows], [1, 2, 3])
        self.assertIsNone(selected_filter)

    def test_client_paging_reads_complete_data_not_only_the_visible_view(self):
        rows = [{"id": 1}, {"id": 2}, {"id": 3}]
        collected, _ = lookups.collect_pages(lambda number: page(1, rows, size=2, server=False), "Account")
        self.assertEqual(collected, rows)

    def test_changed_total_filter_page_size_or_page_identity_rejects_whole_refresh(self):
        for changed in [{"total": 4}, {"filter": {"field": "name", "value": "A"}},
                        {"pageSize": 1}, {"page": 1}, {"serverPaging": False}]:
            second = page(2, [{"id": 3}]); second.update(changed)
            with self.subTest(changed=changed), self.assertRaises(lookups.LookupError):
                lookups.collect_pages(lambda number: page(1, [{"id": 1}, {"id": 2}]) if number == 1 else second, "Supplier")

    def test_incomplete_or_duplicate_pages_never_publish_a_partial_directory(self):
        for second_rows in [[], [{"id": 2}], [{"id": 3}, {"id": 4}]]:
            with self.subTest(second_rows=second_rows), self.assertRaises(lookups.LookupError):
                lookups.collect_pages(lambda number: page(1, [{"id": 1}, {"id": 2}]) if number == 1 else page(2, second_rows), "Supplier")
        with self.assertRaises(lookups.LookupError):
            lookups.collect_pages(lambda number: page(1, [{"id": 1}], total=3, server=False), "Account")

    def test_invalid_counts_and_identities_are_rejected(self):
        for sample in [page(1, [], total=0), page(1, [], total=10001),
                       page(1, [{"id": True}], total=1), page(1, [{"id": "unknown"}], total=1),
                       page(1, [{"id": 1}], total=1, size=0)]:
            with self.subTest(sample=sample), self.assertRaises(lookups.LookupError):
                lookups.collect_pages(lambda number: sample, "Supplier")

    def test_duplicate_paging_diagnostic_contains_only_numeric_paging_evidence(self):
        first = page(1, [{"id": 1, "name": "PRIVATE SUPPLIER"}, {"id": 2}],
                     native_filter={"value": "PRIVATE FILTER"})
        second = page(2, [{"id": 1, "name": "PRIVATE SUPPLIER"}],
                      native_filter={"value": "PRIVATE FILTER"})
        with self.assertRaises(lookups.LookupError) as caught:
            lookups.collect_pages(lambda number: first if number == 1 else second, "Supplier")
        message = str(caught.exception)
        self.assertNotIn("PRIVATE", message)
        self.assertEqual(message, "Supplier identities repeat across pages")
        evidence = caught.exception.paging_diagnostic
        self.assertEqual(evidence, {"requestedPage": 2, "observedPage": 2, "total": 3,
                                    "pageSize": 2, "firstIds": [1]})


class NativeGuardTests(unittest.TestCase):
    class Page:
        url = "https://lennox.nexvia.com.au/staff/third-party"
        def __init__(self, metadata): self.metadata, self.guards = metadata, []
        def evaluate(self, script, arguments): return self.metadata
        def route(self, pattern, guard): self.guards.append(guard)

    class Route:
        def __init__(self, method, url):
            self.request = type("Request", (), {"method": method, "url": url})()
            self.allowed = None
        def continue_(self): self.allowed = True
        def abort(self): self.allowed = False

    def test_only_the_actual_same_origin_read_post_is_permitted(self):
        page = self.Page({"url": "/staff/native-grid-read", "method": "POST", "serverPaging": True})
        lookups.native_reader(page, "suppliers")
        for method, url, expected in [
            ("POST", "https://lennox.nexvia.com.au/staff/native-grid-read", True),
            ("POST", "https://lennox.nexvia.com.au/staff/project-purchase-order-add/60", False),
            ("POST", "https://elsewhere.example/staff/native-grid-read", False),
            ("GET", "https://lennox.nexvia.com.au/assets/native.js", True),
        ]:
            route = self.Route(method, url); page.guards[0](route)
            self.assertEqual(route.allowed, expected)

    def test_cross_origin_or_unreadable_native_transports_stop(self):
        for metadata in [{"url": "https://elsewhere.example/staff/read", "method": "POST", "serverPaging": True},
                         {"url": "/staff/read", "method": "DELETE", "serverPaging": True},
                         {"url": None, "method": "POST", "serverPaging": True},
                         {"url": None, "method": "POST", "serverPaging": False, "serverFiltering": True}]:
            with self.subTest(metadata=metadata), self.assertRaises(lookups.LookupError):
                lookups.native_reader(self.Page(metadata), "suppliers")

    def test_opaque_native_read_function_keeps_get_only_guard_for_remote_paging(self):
        page = self.Page({"url": None, "readFunction": True,
                          "serverPaging": True, "serverFiltering": True})
        read_page = lookups.native_reader(page, "suppliers")
        self.assertTrue(callable(read_page))
        for method, expected in [("GET", True), ("HEAD", True), ("OPTIONS", True),
                                 ("POST", False), ("PUT", False), ("DELETE", False)]:
            route = self.Route(method, "https://lennox.nexvia.com.au/staff/native-function-read")
            page.guards[0](route)
            with self.subTest(method=method): self.assertEqual(route.allowed, expected)


class NativeEditorJavascriptTests(unittest.TestCase):
    @unittest.skipUnless(shutil.which("node"), "Node is needed to exercise native editor JavaScript")
    def test_account_callback_failure_requires_the_exact_initialized_combobox(self):
        script = r"""
const source = SOURCE;
const results = {};
for(const mode of ['success','after_correct_widget','without_widget','wrong_widget','without_data_source']) {
 let initialized=false;
 const sourceData={options:{serverPaging:false,serverFiltering:false}};
 const element={},gridElement={};
 const grid={
  columns:['library_item_name','stock_name','job_name','item_description','chart_of_account_id'].map(field=>({field})),
  tbody:{find:()=>({first:()=>({length:1,children:()=>({not:()=>({eq:index=>({index})})})})})},
  editCell:cell=>{
   if(cell.index!==4)throw Error('Wrong native cell');
   initialized=mode!=='without_widget';
   if(mode!=='success')throw Error('Native callback failed after optional initialization');
  }
 };
 global.document={
  querySelector:selector=>selector==='[name="chart_of_account_id"]'&&initialized?element:null,
  querySelectorAll:selector=>selector==='.k-grid'?[gridElement]:[]
 };
 global.window={jQuery:el=>({data:kind=>{
  if(el===gridElement&&kind==='kendoGrid')return grid;
  if(el===element&&kind==='kendoComboBox'&&mode!=='wrong_widget')
   return mode==='without_data_source'?{}:{dataSource:sourceData};
  return null;
 }})};
 try{
  const metadata=source({kind:'accounts',activate:true});
  results[mode]={accepted:window.__panelstockLookupSource===sourceData,serverPaging:metadata.serverPaging};
 }catch(error){results[mode]={accepted:false,message:error.message};}
}
process.stdout.write(JSON.stringify(results));
""".replace("SOURCE", "(" + lookups.SOURCE_JS + ")", 1)
        completed = subprocess.run([shutil.which("node")], input=script, text=True,
                                   capture_output=True, check=True, timeout=10)
        results = json.loads(completed.stdout)
        for mode in ["success", "after_correct_widget"]:
            with self.subTest(mode=mode): self.assertTrue(results[mode]["accepted"])
        for mode in ["without_widget", "wrong_widget", "without_data_source"]:
            with self.subTest(mode=mode):
                self.assertFalse(results[mode]["accepted"])
                self.assertEqual(results[mode]["message"], "Native lookup editor unavailable")

    @unittest.skipUnless(shutil.which("node"), "Node is needed to exercise native query completion")
    def test_query_owns_async_completion_and_ignores_unrelated_changes(self):
        script = r"""
const assert=require('assert');
const read = SOURCE;
const sleep=milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds));
function nativeSource(rows,server=false){
 let data=rows,page=1;
 return {
  options:{serverPaging:server},
  data:()=>data,total:()=>server?4:data.length,page:()=>page,pageSize:()=>2,
  filter:()=>({field:'status',value:0}),sort:()=>[{field:'name',dir:'asc'}],
  group:()=>[],aggregate:()=>[],
  publish:(number,records)=>{page=number;data=records;},
  query:state=>{page=state.page;return Promise.resolve();}
 };
}
async function run(){
 const memory=nativeSource([{id:1},{id:2},{id:3}]);memory._pending=false;
 global.window={__panelstockLookupSource:memory};
 const local=await read({kind:'suppliers',number:1});
 assert.deepStrictEqual(local.rows.map(row=>row.id),[1,2,3]);
 assert.strictEqual(local.serverPaging,false);

 const source=nativeSource([{id:1},{id:2}],true);
 source._requestInProgress=true;source._pending={nativeAutoRead:true};
 let queryState,finishOwn,finished=false,changes=0;
 source.query=state=>{
  queryState=state;source._requestInProgress=true;
  source.publish(state.page,[{id:1},{id:2}]);
  return new Promise(resolve=>{finishOwn=()=>{
   source.publish(state.page,[{id:3},{id:4}]);source._requestInProgress=false;resolve();
  };});
 };
 global.window={__panelstockLookupSource:source};
 const pending=read({kind:'suppliers',number:2}).then(value=>{finished=true;return value;});
 await sleep(2);assert.strictEqual(queryState,undefined);
 // An old auto-read and its pending page-one read complete before our query.
 source.publish(1,[{id:1},{id:2}]);source._pending=undefined;source._requestInProgress=false;
 for(let count=0;!finishOwn&&count<50;count++)await sleep(2);
 assert.strictEqual(typeof finishOwn,'function');
 assert.deepStrictEqual(queryState,{page:2,pageSize:2,filter:{field:'status',value:0},
  sort:[{field:'name',dir:'asc'}],group:[],aggregate:[]});
 // Page getter and unrelated changes already say two, but data is still old.
 changes++;await sleep(2);changes++;await sleep(2);
 assert.strictEqual(finished,false);
 finishOwn();
 const second=await pending;
 assert.deepStrictEqual(second.rows.map(row=>row.id),[3,4]);
 assert.strictEqual(second.page,2);assert.strictEqual(changes,2);

 for(const mode of ['missing','noPromise','reject','throw','timeout','initialTimeout']){
  const failing=nativeSource([{id:1},{id:2}],true);
  global.window={__panelstockLookupSource:failing};
  if(mode==='missing')delete failing.query;
  if(mode==='noPromise')failing.query=()=>undefined;
  if(mode==='reject')failing.query=()=>Promise.reject(Error('PRIVATE RESPONSE'));
  if(mode==='throw')failing.query=()=>{throw Error('PRIVATE RESPONSE');};
  if(mode==='timeout')failing.query=()=>new Promise(()=>{});
  const realTimer=global.setTimeout,realNow=Date.now;
  if(mode==='timeout')global.setTimeout=(callback,delay)=>realTimer(callback,delay>1000?5:delay);
  if(mode==='initialTimeout'){
   failing._requestInProgress=true;let now=0;Date.now=()=>{now+=10000;return now;};
   failing.query=()=>{throw Error('Query ran before initial idle');};
  }
  let message;
  try{await read({kind:'suppliers',number:2});}catch(error){message=error.message;}
  finally{global.setTimeout=realTimer;Date.now=realNow;}
  const expected={missing:'Native lookup query unavailable',noPromise:'Native lookup query completion unavailable',
   reject:'Native lookup read failed',throw:'Native lookup read failed',
   timeout:'Native lookup timed out',initialTimeout:'Native lookup timed out'}[mode];
  assert.strictEqual(message,expected,mode);
 }
 process.stdout.write('query completion verified');
}
run().catch(error=>{process.stderr.write(String(error));process.exitCode=1;});
""".replace("SOURCE", "(" + lookups.READ_JS + ")", 1)
        completed = subprocess.run([shutil.which("node")], input=script, text=True,
                                   capture_output=True, check=True, timeout=10)
        self.assertEqual(completed.stdout, "query completion verified")


class SnapshotTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(); self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.suppliers = {"expectedTotal": 1, "filter": None, "records": [{"id": 1, "name": "Example"}]}
        self.accounts = {"accounts": [{"id": 1, "type": "Cost of Goods Sold"}], "taxes": [{"id": 4, "rate": 5}]}

    def test_both_complete_snapshots_share_a_refresh_timestamp_and_private_modes(self):
        lookups.commit_snapshots(self.root, self.suppliers, self.accounts, "2026-11-14T00:00:00+00:00")
        for name in ["nexvia-supplier-directory.json", "nexvia-account-tax-lookups.json"]:
            path = self.root / name; record = json.loads(path.read_text())
            self.assertEqual(record["refreshedAt"], "2026-11-14T00:00:00+00:00")
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)

    def test_commit_failure_restores_previous_complete_snapshot(self):
        lookups.commit_snapshots(self.root, self.suppliers, self.accounts, "previous")
        original = {path.name: json.loads(path.read_text()) for path in self.root.glob("*.json")}
        write, calls = lookups.atomic_json, []
        def fail_second(path, value):
            calls.append(path.name)
            if len(calls) == 2: raise OSError("synthetic write failure")
            return write(path, value)
        with patch.object(lookups, "atomic_json", side_effect=fail_second), self.assertRaises(lookups.LookupError):
            lookups.commit_snapshots(self.root, self.suppliers, self.accounts, "new")
        self.assertEqual({path.name: json.loads(path.read_text()) for path in self.root.glob("*.json")}, original)

    def test_supplier_failure_retains_completed_snapshots_and_writes_private_bounded_diagnostic(self):
        lookups.commit_snapshots(self.root, self.suppliers, self.accounts, "previous")
        paths = [self.root / name for name in ["nexvia-supplier-directory.json", "nexvia-account-tax-lookups.json"]]
        original = {path.name: path.read_bytes() for path in paths}
        (self.root / "nexvia-projects.json").write_text(json.dumps({"projects": [{"projectPageId": 60}]}))
        evidence = {"requestedPage": 2, "observedPage": 2, "total": 279,
                    "pageSize": 15, "firstIds": [1, 2, 3, 4, 5]}
        error = lookups.LookupError("Supplier identities repeat across pages", evidence)
        context = SimpleNamespace(pages=[SimpleNamespace(url=lookups.BASE + "/staff/third-party")])
        browser = SimpleNamespace(contexts=[context])
        @contextmanager
        def runtime():
            yield SimpleNamespace(chromium=SimpleNamespace(connect_over_cdp=lambda *args, **kwargs: browser))
        with patch.dict("sys.modules", {"playwright.sync_api": SimpleNamespace(sync_playwright=runtime)}), \
             patch.object(lookups, "supplier_records", side_effect=error), \
             patch.object(lookups, "account_tax_records") as finance, \
             self.assertRaises(lookups.LookupError) as caught:
            lookups.refresh_global_lookups(60, self.root)
        self.assertIs(caught.exception, error)
        finance.assert_not_called()
        self.assertEqual({path.name: path.read_bytes() for path in paths}, original)
        diagnostic = self.root / "nexvia-lookups-diagnostic.json"
        self.assertEqual(json.loads(diagnostic.read_text()), evidence)
        self.assertLess(diagnostic.stat().st_size, 512)
        self.assertEqual(diagnostic.stat().st_mode & 0o777, 0o600)


class ModalTests(unittest.TestCase):
    def test_services_and_all_native_eow_prefixes_are_preserved(self):
        html = '''<select id="form_Service"><option value="8">Fixing</option></select>
        <select id="form_BreakdownType"></select></div><script>var options =
        {"choices":[{"id":"b_70","name":"Miscellaneous"},{"id":"ew_734","name":"Cladding"}]};</script>'''
        services, eows = lookups.modal_choices(html)
        self.assertEqual(services[0]["id"], "8")
        self.assertEqual([row["id"] for row in eows], ["b_70", "ew_734"])

    def test_incomplete_modal_is_rejected_without_guessing_choices(self):
        with self.assertRaises(lookups.LookupError): lookups.modal_choices("<html>Sign in</html>")


class NativeAccountTaxTests(unittest.TestCase):
    def setUp(self):
        self.accounts = [{"id": 9, "accountNo": "51062", "accountFullName": "COS - Estimating",
                          "accountType": "Cost of Goods Sold", "disabled": "0"},
                         {"id": 10, "accountNo": 60000, "accountFullName": "Expense",
                          "accountType": "Expense", "disabled": "1"}]
        self.taxes = [{"id": 7, "name": "New native rate", "rate": "7.5", "disabled": False},
                      {"id": 8, "name": "Retired rate", "rate": 10, "disabled": 1}]

    def test_new_native_tax_ids_rates_and_account_types_are_preserved(self):
        result = lookups.normalize_account_taxes(self.accounts, self.taxes)
        self.assertEqual(result["accounts"][0]["name"], "51062 - COS - Estimating")
        self.assertFalse(result["accounts"][0]["disabled"])
        self.assertEqual(result["accounts"][1]["type"], "Expense")
        self.assertTrue(result["accounts"][1]["disabled"])
        self.assertEqual(result["taxes"][0], {"id": 7, "name": "New native rate", "rate": "7.5", "disabled": False})
        self.assertTrue(result["taxes"][1]["disabled"])

    def test_exact_editor_helper_reads_both_live_sources_and_preserves_types(self):
        editor = object()
        requested = []
        def reader(page_object, kind):
            self.assertIs(page_object, editor)
            requested.append(kind)
            rows = self.accounts if kind == "accounts" else self.taxes
            return lambda number: page(number, rows, total=len(rows), size=len(rows), server=False)
        with patch.object(lookups, "native_reader", side_effect=reader):
            result = lookups.account_tax_for_editor(editor)
        self.assertEqual(requested, ["accounts", "taxes"])
        self.assertEqual([row["type"] for row in result["accounts"]], ["Cost of Goods Sold", "Expense"])
        self.assertEqual(result["taxes"][0]["rate"], "7.5")

    def test_global_lookup_uses_enabled_native_supplier_service_and_eow_context(self):
        html = '''<select id="form_Service"><option value="8" disabled>Old</option><option value="9">Current</option></select>
        <select id="form_BreakdownType"></select></div><script>var options =
        {"choices":[{"id":"b_70","name":"Old EOW","disabled":"1"},
                    {"id":"ew_734","name":"Current EOW","disabled":"false"}]};</script>'''
        contractors = [{"id": 1, "can_create_po": True, "disabled": "true"},
                       {"id": 2, "can_create_po": True, "disabled": "0"}]
        selected, editor_page = [], object()
        @contextmanager
        def editor(context, request):
            selected.append(request)
            yield {"page": editor_page}
        result = {"accounts": [], "taxes": []}
        with patch.object(lookups, "native_json", side_effect=[{"_html": html}, {"_resp": contractors}]), \
             patch.dict("sys.modules", {"nexvia_allocations": SimpleNamespace(native_line_editor=editor)}), \
             patch.object(lookups, "account_tax_for_editor", return_value=result) as finance:
            self.assertIs(lookups.account_tax_records(object(), 60), result)
        self.assertEqual(selected, [{"projectPageId": 60, "supplierId": "2", "serviceId": "9",
                                     "breakdownType": "ew_734", "quote": None}])
        finance.assert_called_once_with(editor_page)

    def test_last_completed_catalog_project_precedes_unrelated_open_tabs(self):
        tabs = [SimpleNamespace(url="https://lennox.nexvia.com.au/staff/project/60/modify")]
        self.assertEqual(lookups.preferred_context_project([60, 61], tabs, {"projectPageId": 61}), 61)
        self.assertEqual(lookups.preferred_context_project([60, 61], tabs, {"projectPageId": 61}, 60), 60)
        self.assertEqual(lookups.preferred_context_project([60, 61], tabs, {"projectPageId": 999}), 60)
        with self.assertRaisesRegex(lookups.LookupError, "Unknown refresh project"):
            lookups.preferred_context_project([60, 61], tabs, {"projectPageId": 61}, 999)

    def test_only_known_authenticated_nexvia_project_tabs_are_context_hints(self):
        tabs = [SimpleNamespace(url="https://elsewhere.example/staff/project/61/modify"),
                SimpleNamespace(url="https://lennox.nexvia.com.au/staff/project/999/modify"),
                SimpleNamespace(url="https://lennox.nexvia.com.au/staff/project-purchase-order-modify/61/1421")]
        self.assertEqual(lookups.preferred_context_project([60, 61], tabs), 61)
        self.assertEqual(lookups.preferred_context_project([60, 61], [], {"projectPageId": True}), 60)

    def test_invalid_or_missing_account_number_does_not_become_literal_none(self):
        for value in [None, True, {"id": 1}]:
            self.accounts[0]["accountNo"] = value
            with self.subTest(value=value), self.assertRaises(lookups.LookupError):
                lookups.normalize_account_taxes(self.accounts, self.taxes)

    def test_invalid_rates_or_native_eligibility_rejects_refresh(self):
        for value in [True, float("nan"), "-1", "101", "10%"]:
            self.taxes[0]["rate"] = value
            with self.subTest(value=value), self.assertRaises(lookups.LookupError):
                lookups.normalize_account_taxes(self.accounts, self.taxes)
        for value in [0.0, "unknown", [], {}]:
            with self.subTest(value=value), self.assertRaises(lookups.LookupError): lookups.disabled(value)

    def test_no_eligible_cos_or_tax_does_not_replace_usable_choices(self):
        self.accounts[0]["disabled"] = True
        with self.assertRaises(lookups.LookupError): lookups.normalize_account_taxes(self.accounts, self.taxes)
        self.accounts[0]["disabled"] = False
        self.taxes[0]["disabled"] = True
        with self.assertRaises(lookups.LookupError): lookups.normalize_account_taxes(self.accounts, self.taxes)


if __name__ == "__main__":
    unittest.main()
