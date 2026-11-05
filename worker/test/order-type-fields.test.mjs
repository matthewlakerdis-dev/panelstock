import {test} from 'node:test';
import assert from 'node:assert/strict';
import {orderTypeFields,orderDetailRows,orderDetailText} from '../src/order-type-fields.js';
import {buildOrderPdf} from '../src/order-pdf.js';
import {buildOrderEmail} from '../src/order-email.js';
import {buildSiteOrderRows,SITE_ORDER_COLUMNS} from '../src/site-orders-excel.js';

test('Gate Villa and Panel Location are required only for the selected type and bounded without silent truncation',()=>{
 for(const villa of [undefined,null,'',' \n '])assert.throws(()=>orderTypeFields({villa},'Gate'),/Villa.*required/);
 for(const location of [undefined,null,'',' \n '])assert.throws(()=>orderTypeFields({location},'Panels'),/Location is required/);
 assert.deepEqual(orderTypeFields({villa:' Villa 12 ',location:'unused',notes:'unused'},' GATE '),{villa:'Villa 12',location:'',notes:'unused'});
 assert.deepEqual(orderTypeFields({location:' North elevation ',notes:' Leave wrapped ',villa:'unused'},'Panels'),{villa:'',location:'North elevation',notes:'Leave wrapped'});
 assert.deepEqual(orderTypeFields({},'Fixings'),{villa:'',location:'',notes:''});
 for(const input of [{villa:'x'.repeat(101)},{villa:12},{villa:{}}])assert.throws(()=>orderTypeFields(input,'Gate'),/Villa/);
 assert.throws(()=>orderTypeFields({location:'x'.repeat(301)},'Panels'),/Location/);
 assert.throws(()=>orderTypeFields({location:'Dock',notes:'x'.repeat(301)},'Panels'),/Notes/);
});
test('new details reach PDF, creation and follow-up emails and the tracker while historical combined text stays readable',()=>{
 const common={id:'11111111-1111-4111-8111-111111111111',orderNumber:'42',project:'Example',status:'approved',items:[{quantity:2,description:'ITEM'}]};
 for(const order of [{...common,orderType:'Gate',villa:'Villa 12',locationNotes:'Loading dock'},{...common,orderType:'Panels',location:'North elevation',notes:'Leave wrapped',locationNotes:'Historical combined text'}]){
  const values=[order.villa,order.location,order.notes,order.locationNotes].filter(Boolean),pdf=new TextDecoder().decode(buildOrderPdf(order));
  for(const value of values){assert.ok(pdf.includes(value),value);for(const kind of [undefined,'files']){const email=buildOrderEmail({order,kind,orderedBy:'Creator',recipients:['office@example.test'],cc:['creator@example.test']},'sender@example.test');assert.ok(email.text.includes(value));assert.ok(email.html.includes(value));assert.deepEqual(email.cc,['creator@example.test']);}}
  const tracker=buildSiteOrderRows([order])[0];assert.equal(tracker.Location,order.location||order.villa||order.locationNotes||'');for(const value of values)assert.ok(tracker.Location.includes(value)||tracker['Order notes'].includes(value)||tracker.Notes.includes(value),value);
 }
 assert.equal(orderDetailText({orderType:'Panels',locationNotes:'Unsplit old notes'}),'Unsplit old notes');
 assert.equal(SITE_ORDER_COLUMNS.indexOf('Status')+1,SITE_ORDER_COLUMNS.indexOf('Drawn'));
});

test('a corrected order keeps its historical type details when its current details are edited',()=>{
 const previous={orderType:'Panels',location:'North elevation',notes:'Keep this delivery note'};
 const fields=orderTypeFields({siteContact:'New contact'},'Fixings',previous);
 assert.equal(fields.location,previous.location);assert.equal(fields.notes,previous.notes);
 assert.deepEqual(orderDetailRows({...previous,...fields,orderType:'Fixings'}),[['Location','North elevation'],['Notes','Keep this delivery note']]);
 const gate=orderTypeFields({villa:'Villa 12'},'Gate',previous);
 assert.equal(gate.location,previous.location);assert.equal(gate.villa,'Villa 12');
});

test('Gate Villa supplies the location detail once in exports and dispatch summaries',()=>{
 assert.deepEqual(orderDetailRows({orderType:'Gate',villa:'Villa 12'}),[['Villa','Villa 12']]);
 assert.equal(orderDetailText({orderType:'Gate',villa:'Villa 12'}),'Villa: Villa 12');
});

test('Notes are optional, bounded and editable for every order type',()=>{
 for(const type of ['Gate','Panels','Fixings','Other','Custom type']){
  const base={villa:'Villa 12',location:'North elevation'};
  assert.equal(orderTypeFields({...base,notes:' Keep wrapped '},type).notes,'Keep wrapped');
  assert.equal(orderTypeFields(base,type,{notes:'Saved note'}).notes,'Saved note');
  assert.equal(orderTypeFields({...base,notes:''},type,{notes:'Saved note'}).notes,'');
  assert.throws(()=>orderTypeFields({...base,notes:'x'.repeat(301)},type),/Notes/);
 }
 const order={orderType:'Gate',villa:'12',notes:'New note',locationNotes:'Older note'};
 assert.deepEqual(orderDetailRows(order),[['Villa','12'],['Notes','New note'],['Notes','Older note']]);
 assert.deepEqual(orderDetailRows({...order,locationNotes:'New note'}),[['Villa','12'],['Notes','New note']]);
});

test('an older order cover sheet labels its saved text as Notes',()=>{
 const pdf=new TextDecoder().decode(buildOrderPdf({orderType:'Fixings',locationNotes:'Older saved delivery instructions',items:[]}));
 assert.ok(pdf.includes('(Notes:)'));assert.ok(pdf.includes('Older saved delivery instructions'));assert.ok(!pdf.includes('Location/Notes:'));
});
