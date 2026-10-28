
import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {buildUserInvitePage} from '../src/user-invite-page.js';
const origins='https://app.panelstockhq.com,https://web.panelstockhq.com,https://site.panelstockhq.com';
async function page(access,{allowedOrigins=origins,fail=false}={}){
 const html=buildUserInvitePage('test',allowedOrigins),links=Array.from(html.matchAll(/<a data-app="([^"]+)"[^>]* hidden>/g),match=>({dataset:{app:match[1]},hidden:true}));
 const fields=Object.fromEntries(['setup','status','intro','save','pin','confirm','success','app-help','done'].map(id=>[id,{hidden:['setup','done'].includes(id),textContent:'',disabled:false,value:['pin','confirm'].includes(id)?'654321':''}]));
 let submit;fields.setup.addEventListener=(name,callback)=>{assert.equal(name,'submit');submit=callback;};
 const requests=[],history=[];
 const document={getElementById:id=>fields[id],querySelector:()=>({textContent:''}),querySelectorAll:selector=>{assert.equal(selector,'[data-app]');return links;}};
 vm.runInNewContext(html.match(/<script nonce="test">([\s\S]*?)<\/script>/)[1],{document,location:{hash:'#test-token',pathname:'/invite/'},history:{replaceState:(...args)=>history.push(args)},fetch:async(_url,options)=>{
  const request=JSON.parse(options.body);requests.push(request);const inspect=request.action==='inspect';
  return {ok:inspect||!fail,json:async()=>inspect?{ok:true,displayName:'Sam',username:'sam'}:fail?{ok:false,error:'Unable to set PIN'}:{ok:true,username:'sam',appAccess:access}};
 }});
 await new Promise(resolve=>setImmediate(resolve));
 return {html,links,fields,requests,history,submit:()=>submit({preventDefault(){}})};
}
test('only permitted app links appear after PIN setup for every permission combination',async()=>{
 for(let mask=0;mask<8;mask++){
  const access={web:!!(mask&1),app:!!(mask&2),site:!!(mask&4)},view=await page(access);
  assert.equal(view.fields.done.hidden,true);assert.ok(view.links.every(link=>link.hidden));
  await view.submit();
  assert.equal(view.fields.done.hidden,false);
  assert.deepEqual(view.links.filter(link=>!link.hidden).map(link=>link.dataset.app).sort(),Object.keys(access).filter(app=>access[app]).sort());
  if(mask===0)assert.match(view.fields['app-help'].textContent,/no apps.*administrator/);
  assert.equal(view.fields.pin.value,'');assert.equal(view.history.length,1);
 }
});
test('missing permissions and failed setup never reveal app links',async()=>{
 for(const options of [{},{fail:true}]){
  const view=await page(undefined,options);await view.submit();assert.ok(view.links.every(link=>link.hidden));
  assert.equal(view.fields.done.hidden,!!options.fail);
 }
});
test('permitted app links still respect the configured app origins',async()=>{
 const view=await page({web:true,app:true,site:true},{allowedOrigins:'https://site.panelstockhq.com'});await view.submit();
 assert.deepEqual(view.links.filter(link=>!link.hidden).map(link=>link.dataset.app),['site']);
});
