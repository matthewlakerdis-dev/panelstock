import '../../test/cnc-area.test.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {buildCncExcelRows,buildCncReportRows,buildCncExcelFeed} from '../src/cnc-excel.js';
import {normalizeChanges,validateRecord} from '../src/inventory.js';

test('CNC spreadsheet, feed and report totals count a PDF sheet once and preserve legacy/manual semantics',()=>{
  const base={orderNumber:'7',jobReference:'QA Job',sheetNumber:'1',stockItemId:'stock',stockItemType:'variant',sheetWidth:4000,sheetHeight:1500,totalPanelArea:4.2,panelAreaScope:'sheet',status:'completed',completedAt:'2026-09-06T01:00:00Z'};
  const panels=[{...base,id:'21',panelNumber:'21'},{...base,id:'22',panelNumber:'22'}],before=JSON.stringify(panels);
  const rows=buildCncExcelRows(panels,()=>({date:'06/09/2026',time:'11:00'}));
  assert.equal(rows.length,1);assert.equal(rows[0]['Panel area (m²)'],4.2);
  assert.ok(Math.abs(rows[0].Waste.value-0.3)<0.000001);
  assert.match(buildCncExcelFeed(rows),/>30%<\/td>/);
  const reports=buildCncReportRows(rows);
  for(const period of ['daily','weekly','monthly'])assert.deepEqual(reports[period].map(row=>[row.sheets,row.panels,row.area]),[[1,2,4.2]]);
  assert.equal(JSON.stringify(panels),before);
  const legacy=panels.map(({panelAreaScope,...row})=>row);
  assert.equal(buildCncExcelRows(legacy,()=>({}))[0]['Panel area (m²)'],8.4,'do not reinterpret unmarked historical records');
  const manual=legacy.map((row,index)=>({...row,totalPanelArea:index?3:1.2}));
  assert.equal(buildCncExcelRows(manual,()=>({}))[0]['Panel area (m²)'],4.2);
  const copies=panels.concat(panels.map(row=>({...row,id:row.id+'copy',sheetNumber:'1.2'})));
  assert.deepEqual(buildCncExcelRows(copies,()=>({})).map(row=>row['Panel area (m²)']),[4.2,4.2]);
});
test('server validates and retains explicit CNC area scope through completion',()=>{
  const panel={id:'a',orderNumber:'7',sheetNumber:'1',panelNumber:'21',status:'pending',totalPanelArea:4.2,panelAreaScope:'sheet'};
  validateRecord('cncPanels',panel,panel.id);
  assert.throws(()=>validateRecord('cncPanels',{...panel,panelAreaScope:'unknown'},panel.id),/scope/);
  const result=normalizeChanges([{field:'cncPanels',id:panel.id,before:panel,after:{...panel,status:'completed'}}],{username:'staff'},'2026-09-06T01:00:00Z')[0].after;
  assert.equal(result.panelAreaScope,'sheet');assert.equal(result.totalPanelArea,4.2);
});
