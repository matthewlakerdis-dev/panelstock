import test from 'node:test';
import assert from 'node:assert/strict';
import {validateRecord,normalizeChanges} from '../src/inventory.js';

const panel={id:'panel-axes',orderNumber:'22',sheetNumber:'1',panelNumber:'P1',status:'pending',sheetWidth:3000,sheetHeight:1200};
const proposal={length:480,width:1200,dimensionOrder:'sheet',status:'pending',source:'cnc-pdf',rectangle:{x:2520,y:0,width:480,height:1200}};
const stock={id:'offcut-axes',sku:'OC-AXES',color:'Milled',material:'Solid Aluminium',thickness:3,width:480,height:1200,qty:1,dimensionOrder:'sheet'};
const details={length:480,width:1200,dimensionOrder:'sheet',color:stock.color,material:stock.material,thickness:stock.thickness};

test('sheet-axis dimensions survive CNC proposals, completion and stock persistence',()=>{
  const before={...panel,pendingOffcuts:[proposal],pendingOffcut:proposal};
  const after={...before,status:'completed',offcutOutcome:'confirmed',savedOffcuts:[details],offcutDetails:details};
  for(const value of [before,after])assert.doesNotThrow(()=>validateRecord('cncPanels',value,value.id));
  assert.doesNotThrow(()=>validateRecord('offcuts',stock,stock.id));
  const changes=normalizeChanges([
    {field:'cncPanels',id:panel.id,before,after},
    {field:'offcuts',id:stock.id,before:null,after:stock}
  ],{username:'operator'},'2026-11-04T00:00:00Z');
  assert.deepEqual(changes[0].after.savedOffcuts,[details]);
  assert.deepEqual([changes[1].after.width,changes[1].after.height,changes[1].after.dimensionOrder],[480,1200,'sheet']);
});

test('sheet-axis proposals cannot silently swap length and width against the source rectangle',()=>{
  assert.throws(()=>validateRecord('cncPanels',{...panel,pendingOffcuts:[{...proposal,length:1200,width:480}]},panel.id),/axes do not match/);
  // Legacy proposals used longer-side-first dimensions; they remain readable.
  const {dimensionOrder,...legacy}=proposal;
  assert.doesNotThrow(()=>validateRecord('cncPanels',{...panel,pendingOffcuts:[{...legacy,length:1200,width:480}]},panel.id));
});

test('unknown offcut dimension-order values are rejected in records and aliases',()=>{
  assert.throws(()=>validateRecord('offcuts',{...stock,dimensionOrder:'other'},stock.id),/dimension order/);
  for(const field of ['pendingOffcut','offcutDetails']){
    const item=field==='pendingOffcut'?proposal:details;
    assert.throws(()=>validateRecord('cncPanels',{...panel,[field]:{...item,dimensionOrder:'other'}},panel.id),/dimension order/);
  }
  for(const field of ['pendingOffcuts','savedOffcuts']){
    const item=field==='pendingOffcuts'?proposal:details;
    assert.throws(()=>validateRecord('cncPanels',{...panel,[field]:[{...item,dimensionOrder:'other'}]},panel.id),/dimension order/);
  }
  const {dimensionOrder,...legacyStock}=stock;
  assert.doesNotThrow(()=>validateRecord('offcuts',legacyStock,legacyStock.id));
});
