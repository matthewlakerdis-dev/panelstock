import test from 'node:test';
import assert from 'node:assert/strict';
import {validateRecord,validateChanges,normalizeChanges} from '../src/inventory.js';
import {buildCncExcelRows,buildCncExcelFeed} from '../src/cnc-excel.js';

const panel={id:'panel-1',orderNumber:'22',jobReference:'Notre Dame',sheetNumber:'1',panelNumber:'P1',status:'pending',sheetWidth:4000,sheetHeight:1500};
const proposal=(length=900,width=450,rectangle)=>({length,width,status:'pending',source:'cnc-pdf',...(rectangle?{rectangle}:{})});
const details=(length=900,width=450,rectangle)=>({length,width,color:'Milled',material:'Solid Aluminium',thickness:3,...(rectangle?{rectangle}:{})});
const valid=value=>validateRecord('cncPanels',value,value.id);

test('CNC records retain multiple proposals and saved leftovers alongside legacy aliases',()=>{
 const pendingOffcuts=[proposal(900,450,{x:0,y:0,width:900,height:450}),proposal(650,300,{x:1000,y:0,width:650,height:300})];
 const before={...panel,pendingOffcuts,pendingOffcut:pendingOffcuts[0]},savedOffcuts=[details(900,450),details(650,300)];
 const after={...before,status:'completed',savedOffcuts,offcutDetails:savedOffcuts[0],offcutOutcome:'confirmed'};
 assert.doesNotThrow(()=>valid(before));assert.doesNotThrow(()=>valid(after));
 assert.doesNotThrow(()=>valid({...panel,pendingOffcut:proposal()}));
 assert.doesNotThrow(()=>valid({...panel,status:'completed',offcutOutcome:'confirmed',offcutDetails:details()}));
 assert.doesNotThrow(()=>valid({...panel,pendingOffcuts:[],savedOffcuts:[]}));
 const result=normalizeChanges([{field:'cncPanels',id:panel.id,before,after}],{username:'worker'},'2026-10-30T00:00:00Z')[0].after;
 assert.deepEqual(result.pendingOffcuts,pendingOffcuts);assert.deepEqual(result.savedOffcuts,savedOffcuts);assert.equal(result.completedBy,'worker');
});

test('CNC lists reject malformed, oversized and overlapping offcuts without forbidding separate equal-sized pieces',()=>{
 const invalid=[
  {pendingOffcuts:{}},
  {pendingOffcuts:Array.from({length:21},()=>proposal(100,100))},
  {pendingOffcuts:[proposal(0,100)]},
  {pendingOffcuts:[{...proposal(),source:'other'}]},
  {pendingOffcuts:[proposal(4002,100)]},
  {pendingOffcuts:[proposal(3000,1500),proposal(3000,1500)]},
  {pendingOffcuts:[proposal(900,450,{x:-1,y:0,width:900,height:450})]},
  {pendingOffcuts:[proposal(900,450,{x:3500,y:0,width:900,height:450})]},
  {pendingOffcuts:[proposal(900,450,{x:0,y:0,width:700,height:450})]},
  {pendingOffcuts:[proposal(900,450,{x:0,y:0,width:900,height:450}),proposal(900,450,{x:800,y:0,width:900,height:450})]},
  {savedOffcuts:[{...details(),thickness:0}]},
  {savedOffcuts:[details(900,450,{x:0,y:0,width:900,height:450}),details(900,450,{x:0,y:0,width:900,height:450})]}
 ];
 for(const patch of invalid)assert.throws(()=>valid({...panel,...patch}),/off-cut/,JSON.stringify(patch));
 assert.doesNotThrow(()=>valid({...panel,pendingOffcuts:[proposal(900,450,{x:0,y:0,width:900,height:450}),proposal(900,450,{x:900,y:0,width:900,height:450})]}));
 assert.doesNotThrow(()=>valid({...panel,pendingOffcuts:[proposal(),proposal()]}),'manual/legacy lists can contain separate pieces with the same dimensions');
});

test('CNC completion permits saved lists while pending edits and historical saved data keep existing permissions',()=>{
 const pendingOffcuts=[proposal(900,450),proposal(650,300)],before={...panel,pendingOffcuts,pendingOffcut:pendingOffcuts[0]},savedOffcuts=[details(900,450),details(650,300)];
 const after={...before,status:'completed',savedOffcuts,offcutDetails:savedOffcuts[0],offcutOutcome:'confirmed'},change={field:'cncPanels',id:before.id,before,after};
 assert.doesNotThrow(()=>validateChanges([change],{username:'worker',isAdmin:false}));
 const {savedOffcuts:removed,...legacyCompletion}=after;
 assert.throws(()=>validateChanges([{...change,after:legacyCompletion}],{username:'worker',isAdmin:false}),/review all off-cuts/);
 assert.doesNotThrow(()=>validateChanges([{...change,after:{...after,savedOffcuts:[],offcutDetails:null,offcutOutcome:'none'}}],{username:'worker',isAdmin:false}));
 assert.throws(()=>validateChanges([{...change,after:{...after,pendingOffcuts:[]}}],{username:'worker',isAdmin:false}),/Only CNC completion/);
 const edited={...before,pendingOffcuts:[]},activity={field:'transactions',id:'audit',before:null,after:{id:'audit',type:'cnc',source:'cnc-edit',panelRecordIds:[before.id],desc:'Edited proposals',qty:'',timestamp:'2026-10-30T00:00:00Z'}};
 assert.doesNotThrow(()=>validateChanges([{...change,after:edited},activity],{username:'admin',isAdmin:true}));
 assert.throws(()=>validateChanges([{...change,before:after,after:{...after,savedOffcuts:[details(500,300)]}},activity],{username:'admin',isAdmin:true}),/Completed CNC panels cannot be edited/);
});

test('CNC tracker exports every saved offcut once per sheet and preserves single-offcut history',()=>{
 const savedOffcuts=[details(900,450),details(650,300)],base={...panel,status:'completed',offcutOutcome:'confirmed',savedOffcuts,offcutDetails:savedOffcuts[0]},panels=[base,{...base,id:'panel-2',panelNumber:'P2'}],snapshot=JSON.stringify(panels);
 const [row]=buildCncExcelRows(panels,()=>({}));
 assert.equal(row['Off-cut'],'✓');
 assert.equal(row.Details,'900 × 450 mm · Milled · Solid Aluminium · 3mm; 650 × 300 mm · Milled · Solid Aluminium · 3mm');
 assert.equal(buildCncExcelFeed([row]).split('650 × 300 mm').length-1,1);
 assert.equal(JSON.stringify(panels),snapshot);
 const {savedOffcuts:removed,...legacy}=base;
 assert.equal(buildCncExcelRows([legacy],()=>({}))[0].Details,'900 × 450 mm · Milled · Solid Aluminium · 3mm');
 const empty=buildCncExcelRows([{...base,savedOffcuts:[]}],()=>({}))[0];assert.equal(empty['Off-cut'],'✕');assert.equal(empty.Details,'');
 const pending=buildCncExcelRows([{...base,status:'pending'}],()=>({}))[0];assert.equal(pending['Off-cut'],'-');assert.equal(pending.Details,'');
});
