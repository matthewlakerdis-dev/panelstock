import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../../site/app.js',import.meta.url),'utf8');
test('mobile compatibility bundle includes the styled upload controls',()=>{
 const legacy=fs.readFileSync(new URL('../../site/app.legacy.js',import.meta.url),'utf8');
 assert.match(legacy,/order-upload-button order-upload-primary/);
 assert.match(legacy,/aria-label=\\?"Choose order files\\?"/);
 assert.match(legacy,/aria-label=\\?"Take order photo\\?"/);
});
test('new and existing order uploads retain file and camera controls with accessible styled labels',()=>{
 const context={orderValidationId:'',orderDraft:null,busy:false,dateIso:()=> '2026-09-30',profile:null,message:'',draftNotice:'Draft saved',discardDraftArmed:false,projects:[{id:'p',name:'Project'}],orderTypes:['Panels'],esc:String,formatDate:String,session:{isAdmin:true},isPanelOrder:order=>String(order.orderType||'').toLowerCase()==='panels',can:()=>true};
 vm.createContext(context);
 vm.runInContext(source.split('\n').find(line=>line.includes('function selectableOrderTypes(')),context);
 vm.runInContext(source.split("\n").find(line=>line.includes("function siteOrderContactDefaults(")),context);
 for(const name of ['newOrder','orderAttachmentControls']){
  const line=source.split('\n').find(line=>line.includes(`function ${name}(`));
  const html=vm.runInContext(`${line};${name}(${name==='newOrder'?'':'{id:"order",attachments:[]}'})`,context);
  assert.match(html,/class="order-upload-actions"/);assert.match(html,/order-upload-button order-upload-primary/);
  assert.match(html,/aria-label="Choose order files" type="file" multiple/);
  assert.match(html,/aria-label="Take order photo" type="file" accept="image\/\*" capture="environment"/);
  assert.equal((html.match(/<svg aria-hidden="true"/g)||[]).length,2);
 }
});
test('file selection remains keyboard accessible and order totals are retained',()=>{
 const css=fs.readFileSync(new URL('../../site/order-controls.css',import.meta.url),'utf8');
 assert.match(css,/:focus-within/);assert.match(css,/input\[type=file\].*opacity:0/);assert.match(css,/min-height:48px/);
 assert.match(source,/all.length>10/);assert.match(source,/25\*1024\*1024/);assert.match(source,/file.size>10\*1024\*1024/);
});

test('any Panel order viewer gets the PDF action, while unrelated file permissions are retained',()=>{
 const context={session:{username:'viewer',isAdmin:false,taskAccess:{'site.orders.view':true,'site.orders.create':false}},busy:false,isPanelOrder:order=>String(order.orderType||'').toLowerCase()==='panels',can:task=>task==='site.orders.view',esc:String};vm.createContext(context);vm.runInContext(source.split('\n').find(line=>line.includes('function orderAttachmentControls(')),context);
 const panel=vm.runInContext('orderAttachmentControls({id:"order",orderType:"Panels",requestedBy:"other",attachments:[]})',context);assert.match(panel,/Add PDFs/);assert.match(panel,/aria-label="Add PDF documents" type="file" accept="application\/pdf,.pdf" multiple/);assert.doesNotMatch(panel,/aria-label="Choose order files"|aria-label="Take order photo"/);assert.match(panel,/appended to the order sheet/);
 const other=vm.runInContext('orderAttachmentControls({id:"order",orderType:"Fixings",requestedBy:"other",attachments:[]})',context);assert.doesNotMatch(other,/type="file"/);
 context.session.isAdmin=true;const managed=vm.runInContext('orderAttachmentControls({id:"order",orderType:"Panels",requestedBy:"other",attachments:[]})',context);assert.match(managed,/Choose order files/);assert.match(managed,/Take order photo/);assert.match(managed,/Add PDF documents/);
});

test('Site file validation accepts a 6 MB drawing and enforces 10 MB per file and 25 MB total',()=>{
 const context={};vm.createContext(context);vm.runInContext(source.split('\n').find(line=>line.includes('function validateOrderFiles(')),context);
 for(const size of [6*1024*1024,10*1024*1024])assert.doesNotThrow(()=>context.validateOrderFiles([{size}]));
 assert.throws(()=>context.validateOrderFiles([{size:10*1024*1024+1}]),/10 MB/);
 assert.throws(()=>context.validateOrderFiles([{size:6*1024*1024}],[{size:20*1024*1024}]),/25 MB/);
 assert.throws(()=>context.validateOrderFiles(Array.from({length:11},()=>({size:1}))),/10 files/);
});
