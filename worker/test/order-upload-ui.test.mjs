import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../../site/app.js',import.meta.url),'utf8');
test('new and existing order uploads retain file and camera controls with accessible styled labels',()=>{
 const context={dateIso:()=> '2026-09-30',profile:null,message:'',projects:[{id:'p',name:'Project'}],orderTypes:['Panels'],esc:String,formatDate:String,session:{isAdmin:true}};
 vm.createContext(context);
 for(const name of ['newOrder','orderAttachmentControls']){
  const line=source.split('\n').find(line=>line.includes(`function ${name}(`));
  const html=vm.runInContext(`${line};${name}(${name==='newOrder'?'':'{id:"order",attachments:[]}'})`,context);
  assert.match(html,/class="order-upload-actions"/);assert.match(html,/order-upload-button order-upload-primary/);
  assert.match(html,/aria-label="Choose order files" type="file" multiple/);
  assert.match(html,/aria-label="Take order photo" type="file" accept="image\/\*" capture="environment"/);
  assert.equal((html.match(/<svg aria-hidden="true"/g)||[]).length,2);
 }
});
test('file selection remains keyboard accessible and limits are unchanged',()=>{
 const css=fs.readFileSync(new URL('../../site/order-controls.css',import.meta.url),'utf8');
 assert.match(css,/:focus-within/);assert.match(css,/input\[type=file\].*opacity:0/);assert.match(css,/min-height:48px/);
 assert.match(source,/all.length>10/);assert.match(source,/25\*1024\*1024/);assert.match(source,/file.size>5\*1024\*1024/);
});
