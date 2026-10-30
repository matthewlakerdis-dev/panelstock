import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
test('Mobile Forgot PIN sends only after confirmation, including the legacy client',async()=>{
 for(const file of ['panelstock-app.modern.js','panelstock-app.legacy.js']){
  const source=fs.readFileSync(new URL('../../'+file,import.meta.url),'utf8'),start=source.indexOf('function requestPinReset()');let end=source.indexOf('async function handleLogin(',start);if(end<0)end=source.indexOf('function handleLogin(',start);
  let confirmed=false,calls=0;const context={PanelStock:{confirm:async options=>{assert.match(options.message,/sam/);return confirmed;}},username:'sam',busy:false,setBusy(){},setError(){},callWorker:async()=>{calls++;return{ok:true};}};
  const request=vm.runInNewContext(source.slice(start,end)+';requestPinReset',context);
  request();await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,0);
  confirmed=true;request();await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,1);
 }
});
test('Site Forgot PIN confirmation protects both current and legacy sign-in screens',async()=>{
 for(const file of ['site/app.js','site/app.legacy.js']){
  const source=fs.readFileSync(new URL('../../'+file,import.meta.url),'utf8'),start=source.indexOf('function loginScreen()'),end=source.indexOf('function orderList()',start);
  let confirmed=false,calls=0;const button={},input={value:'sam'};
  const context={confirmPinReset:async name=>{assert.equal(name,'sam');return confirmed;},localStorage:{getItem:()=>''},USERNAME_KEY:'test',pendingSetup:null,message:'',busy:false,esc:value=>value,login(){},register(){},render(){},api:async()=>{calls++;return{json:async()=>({ok:true})};},root:{innerHTML:'',querySelector:selector=>selector==='[data-pin-reset]'?button:selector==='input[name="username"]'?input:{addEventListener(){}}}};
  vm.runInNewContext(source.slice(start,end)+';loginScreen()',context);
  button.onclick();await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,0);assert.equal(input.value,'sam');
  confirmed=true;button.onclick();await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,1);
 }
});
