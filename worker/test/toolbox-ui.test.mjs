import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {buildToolboxPage} from '../src/toolbox-page.js';
import {TOOLBOX_DEFAULTS} from '../src/toolbox.js';

function harness(search=''){
 const cache=new Map(),session=new Map(),elements=new Map();let username='supervisor';
 const element=()=>({style:{},classList:{add(){},remove(){}},addEventListener(){},innerHTML:'',textContent:''});
 const context=vm.createContext({crypto:webcrypto,Intl,Date,JSON,Array,String,Error,structuredClone,TextEncoder,Uint8Array,URLSearchParams,location:{search},setTimeout:()=>1,clearTimeout(){},confirm:()=>true,
  sessionStorage:{getItem:k=>session.get(k)||null,setItem:(k,v)=>session.set(k,v),removeItem:k=>session.delete(k)},localStorage:{getItem:k=>cache.get(k)||null,setItem:(k,v)=>cache.set(k,v)},
  document:{getElementById:id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id)},querySelectorAll:()=>[],querySelector:()=>element()},
  fetch:async path=>({ok:true,json:async()=>path==='/session'?{username,isAdmin:false,taskAccess:{'factory.toolbox':true}}:path==='/toolbox/templates'?{templates:structuredClone(TOOLBOX_DEFAULTS),revision:1}:path==='/toolbox/list'?{records:[{id:'summary-only',date:'2026-10-13',people:[],actions:[]}],total:1,offset:0,nextOffset:null,openActions:[],openActionTotal:0,actionNextOffset:null}:{ok:true}})
 });
 vm.runInContext(buildToolboxPage().split('<script>')[1].split('</script>')[0],context);
 return {context,cache,setUser:name=>username=name,run:code=>vm.runInContext(code,context)};
}
test('device caching excludes shared list summaries and retains unsaved drafts across login',async()=>{
 const h=harness();await h.run("token='synthetic';startSession()");h.run("field('site','Private unsaved workshop');field('tasks','Unfinished notes');persist()");
 const cached=JSON.parse(h.cache.get('panelstock-toolbox-v1:supervisor'));assert.deepEqual(cached.records,[]);assert.equal(cached.draft.site,'Private unsaved workshop');
 await h.run('logout()');await h.run("token='synthetic';startSession()");assert.equal(h.run('state.draft.tasks'),'Unfinished notes');assert.equal(h.run('state.draft.site'),'Private unsaved workshop');
});
test('switching accounts resets the draft before reading even an invalid account cache',async()=>{
 const h=harness();await h.run("token='synthetic';startSession()");h.run("field('site','First supervisor private draft')");await h.run('logout()');
 h.cache.set('panelstock-toolbox-v1:other',JSON.stringify({draft:{site:'broken'},templates:TOOLBOX_DEFAULTS,records:[]}));h.setUser('other');await h.run("token='synthetic';startSession()");
 assert.equal(h.run('state.draft.site'),'');assert.equal(h.run('key'),'panelstock-toolbox-v1:other');
});
test('old caches containing shared summaries recover the draft without treating summaries as full records',async()=>{
 const h=harness();await h.run("token='synthetic';startSession()");h.run("field('tasks','Recover these draft notes')");const old=JSON.parse(h.cache.get('panelstock-toolbox-v1:supervisor'));old.records=[{id:'summary-only',people:[],actions:[]}];h.cache.set('panelstock-toolbox-v1:supervisor',JSON.stringify(old));
 await h.run("token='synthetic';startSession()");assert.equal(h.run('state.draft.tasks'),'Recover these draft notes');assert.equal(h.run('actor.username'),'supervisor');
});
test('web toolbox uses Web access and a separate session cache; other hints preserve Mobile access',()=>{
 const web=harness('?app=web');assert.equal(web.run('toolboxApp'),'web');assert.equal(web.run('sessionKey'),'panelstock-toolbox-web-session');
 for(const search of ['', '?app=site', '?app=unknown']){const mobile=harness(search);assert.equal(mobile.run('toolboxApp'),'app');assert.equal(mobile.run('sessionKey'),'panelstock-toolbox-session');}
});

test('daily drafts show inspections and weekly drafts show employer without requiring daily inspection',async()=>{const h=harness();await h.run("token='synthetic';startSession()");assert.match(h.run('talkHTML()'),/inspection0/);h.run("state.draft=fresh('weekly');state.draft.people=[{name:'Worker',employer:'Contractor',ack:false,signature:null}]");assert.equal(h.run('state.draft.prestart'),undefined);assert.doesNotMatch(h.run('talkHTML()'),/inspection0|Time in/);assert.match(h.run('talkHTML()'),/Employer/);h.run("state.draft.people[0].signature={image:'synthetic',at:'2026-10-13'};state.draft.supervisorSignature={image:'synthetic'};person(0,'employer','Different employer')");assert.equal(h.run('state.draft.people[0].signature'),null);assert.equal(h.run('state.draft.supervisorSignature'),null);});
