import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


spec = importlib.util.spec_from_file_location("nexvia_inspect_live", Path(__file__).with_name("nexvia_inspect_live.py"))
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)


class InspectionTests(unittest.TestCase):
    def test_paths_omit_query_credentials_and_reject_other_destinations(self):
        self.assertEqual(probe.safe_path("https://lennox.nexvia.com.au/staff/projects?token=synthetic-secret"), "/staff/projects")
        for value in ["https://elsewhere.example/staff/projects", "http://lennox.nexvia.com.au/staff/projects", "/staff/session-token/secret", "/login", "/staff/"+"x"*100]:
            self.assertIsNone(probe.safe_path(value))

    def test_native_modal_parser_uses_current_choice_ids(self):
        html = '''<select id="form_Service"><option value="">Select</option><option value="8">Fixing</option><option value="9" disabled>Old</option></select>
<select id="form_BreakdownType"></select></div><script>var options = {"choices":[{"id":"b_70","name":"Misc"},{"id":"ew_734","name":"New EOW"},{"id":"b_71","name":"Inactive","disabled":true}]};</script>'''
        self.assertEqual(probe.modal_identifiers(html), (["8"], ["b_70", "ew_734"]))
        self.assertEqual(probe.representative_choices(["b_1", "b_70", "b_2", "ew_1", "ew_2", "42"]), ["b_70", "b_1", "ew_1", "42"])
        with self.assertRaises(ValueError):
            probe.modal_identifiers("<html>Sign in</html>")

    def test_report_is_private_and_failed_bound_cannot_replace_it(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder)/"report.json"
            probe.atomic_report(path, {"pages":[]})
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            before = path.read_bytes()
            with self.assertRaises(ValueError):
                probe.atomic_report(path, {"oversized":"x"*(probe.MAX_REPORT_BYTES+1)})
            self.assertEqual(path.read_bytes(), before)

    @unittest.skipUnless(shutil.which("node"), "Node is needed for the JS metadata boundary test")
    def test_browser_metadata_does_not_export_records_or_query_secrets(self):
        harness = r'''
const vm=require('node:vm');
const source=JSON.parse(require('node:fs').readFileSync(0,'utf8'));
const element={id:'ProjectGrid',getAttribute:name=>name==='name'?'projects':null};
const ds={options:{serverPaging:true,transport:{read:{url:'/staff/projects/data?csrf=synthetic-secret',type:'POST',data:{csrf:'synthetic-secret',page:1}}},schema:{data:'records',total:'total',model:{id:'id',fields:{id:{type:'number'},name:{type:'string'},password:{type:'string'}}}}},total:()=>49,pageSize:()=>20,data:()=>[{id:60,name:'PRIVATE CUSTOMER PROJECT',password:'synthetic-secret'}]};
const jq=()=>({data:()=>({kendoGrid:{options:{},dataSource:ds}})});
const doc={querySelectorAll:selector=>selector==='[data-role],select,input,.k-grid'?[element]:[],scripts:[]};
const context={document:doc,window:{jQuery:jq},location:{origin:'https://lennox.nexvia.com.au',pathname:'/staff/projects'},URL,console};
process.stdout.write(JSON.stringify(vm.runInNewContext('('+source+')()',context)));
'''
        completed = subprocess.run(["node", "-e", harness], input=json.dumps(probe.METADATA_JS), text=True, capture_output=True, check=True)
        report = json.loads(completed.stdout)
        serialized = json.dumps(report)
        self.assertNotIn("synthetic-secret", serialized)
        self.assertNotIn("PRIVATE CUSTOMER PROJECT", serialized)
        self.assertNotIn("password", serialized)
        widget = report["widgets"][0]
        self.assertEqual(widget["read"]["path"], "/staff/projects/data")
        self.assertEqual(widget["read"]["parameterNames"], ["page"])
        self.assertEqual(widget["total"], 49)
        self.assertEqual(widget["loaded"], 1)

    @unittest.skipUnless(shutil.which("node"), "Node is needed for JS syntax verification")
    def test_embedded_browser_programs_parse_without_running_them(self):
        programs = [probe.METADATA_JS, probe.NATIVE_ADD_JS, probe.NATIVE_ROW_JS,
                    probe.EDIT_LOOKUP_JS, probe.PROJECT_PAGING_JS, probe.NATIVE_CONTROLS_JS]
        script = "const vm=require('node:vm');for(const p of JSON.parse(require('node:fs').readFileSync(0,'utf8')))new vm.Script('('+p+')');"
        subprocess.run(["node", "-e", script], input=json.dumps(programs), text=True, capture_output=True, check=True)

    @unittest.skipUnless(shutil.which("node"), "Node is needed for the diagnostic boundary test")
    def test_controls_report_shapes_and_flags_without_line_or_form_content(self):
        harness = r'''
const vm=require('node:vm'),source=JSON.parse(require('node:fs').readFileSync(0,'utf8'));
const field={value:'[{"description":"PRIVATE LINE","token":"synthetic-secret"}]',form:{}},el={};
const grid={element:{attr:()=> 'Lines_123'},columns:[{field:'item_description'},{field:'tax_rate_id',hidden:true}],dataSource:{options:{schema:{model:{fields:{item_description:{}}}}},data:()=>[{id:null,is_new:true,item_description:'PRIVATE LINE',token:'synthetic-secret'}]}};
const context={window:{jQuery:()=>({data:()=>grid})},document:{querySelectorAll:s=>s==='[name="form[Lines]"]'?[field]:s==='[data-role="grid"],.k-grid'?[el]:[]}};
process.stdout.write(JSON.stringify(vm.runInNewContext('('+source+')()',context)));
'''
        completed = subprocess.run(["node", "-e", harness], input=json.dumps(probe.NATIVE_CONTROLS_JS), text=True, capture_output=True, check=True)
        report = json.loads(completed.stdout)
        self.assertEqual(report["linesFields"][0]["shape"], "nonempty_array")
        self.assertTrue(report["grids"][0]["hasItemDescriptionModel"])
        self.assertFalse(report["grids"][0]["blankRowStates"][0]["descriptionBlank"])
        self.assertNotIn("PRIVATE LINE", completed.stdout)
        self.assertNotIn("synthetic-secret", completed.stdout)

    @unittest.skipUnless(shutil.which("node"), "Node is needed for native Add guard verification")
    def test_diagnostic_add_allows_empty_new_form_but_blocks_existing_lines(self):
        harness = r'''
const vm=require('node:vm'),source=JSON.parse(require('node:fs').readFileSync(0,'utf8'));
const result=[];
for(const raw of ['', 'null', '[]', '[{"id":12}]', '{}', 'invalid']){
 let clicks=0;
 const field={value:raw},el={},button={textContent:'Click To Add New Row',getClientRects:()=>[1],closest:()=>null,scrollIntoView:()=>{},click:()=>{clicks++;}};
 const grid={columns:[],dataSource:{options:{schema:{model:{fields:{item_description:{}}}}},data:()=>[]}};
 const context={window:{jQuery:()=>({data:()=>grid})},document:{querySelector:()=>field,querySelectorAll:s=>s==='[data-role="grid"],.k-grid'?[el]:[button]}};
 try{vm.runInNewContext('('+source+')()',context);}catch{}
 result.push(clicks);
}
process.stdout.write(JSON.stringify(result));
'''
        completed = subprocess.run(["node", "-e", harness], input=json.dumps(probe.NATIVE_ADD_JS), text=True, capture_output=True, check=True)
        self.assertEqual(json.loads(completed.stdout), [1, 1, 1, 0, 0, 0])


if __name__ == "__main__":
    unittest.main()
