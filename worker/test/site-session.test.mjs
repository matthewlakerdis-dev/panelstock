import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const app=fs.readFileSync(new URL('../../site/app.js',import.meta.url),'utf8');
const KEY='panelstock:site-orders:session:v1',OUTBOX='panelstock:site-orders:outbox:v1',PROJECTS='panelstock:site-orders:projects:v1';
function storage(){const entries=new Map();return {getItem:key=>entries.get(key)||null,setItem:(key,value)=>entries.set(key,value),removeItem:key=>entries.delete(key)};}
function harness(fetchImpl=async()=>Response.json({ok:true})){
 const localStorage=storage(),sessionStorage=storage(),calls=[];
 const queued={owner:'user-a',queue:[{localId:'saved-order',order:{project:'Private job'}}]};
 localStorage.setItem(OUTBOX,JSON.stringify(queued));
 const node={querySelector:()=>null,querySelectorAll:()=>[],addEventListener:()=>{},appendChild:()=>{},prepend:()=>{}};
 const document={getElementById:()=>node,createElement:()=>({...node}),head:node,body:node,querySelectorAll:()=>[]};
 const context={console,URL,Headers,Response,Request,AbortSignal,Map,Set,Date,document,localStorage,sessionStorage,
   navigator:{onLine:true},window:{addEventListener:()=>{}},MutationObserver:class{observe(){}},
   fetch:async(...args)=>{calls.push(args);return fetchImpl(...args);}};
 const start=app.indexOf("  window.addEventListener('online'");
 const source=app.slice(0,start).replace(/^import .*?;\s*/,'')+`
  globalThis.siteTest={
    api,logout,refresh,readProjects,
    seed:()=>{
      session={token:'synthetic-a',username:'user-a',isAdmin:true};
      sessionStorage.setItem(SESSION_KEY,JSON.stringify(session));
      orders=[{id:'private-order'}];cncPanels=[{id:'private-sheet'}];projects=[{name:'Private job'}];
      supportTickets=[{id:'private-ticket'}];supportSelected='private-ticket';supportPhoto='photo-a';supportReplyPhoto='photo-b';
      profile={displayName:'User A'};pendingSetup={pin:'000000'};selectedProfilePhoto='private-photo';
      cncExpanded.add('private-sheet');profileGesture.pointers.set(1,{});view='settings';
      localStorage.setItem(PROJECTS_KEY,JSON.stringify({owner:'user-a',projects}));
    },
    state:()=>({session,orders,cncPanels,projects,supportTickets,supportSelected,supportPhoto,supportReplyPhoto,profile,pendingSetup,selectedProfilePhoto,view,busy,message,expanded:cncExpanded.size,pointers:profileGesture.pointers.size,outbox})
  };
})();`;
 vm.runInNewContext(source,context);
 const api=context.siteTest;api.seed();return {...api,calls,localStorage,sessionStorage,queued};
}
test('site logout revokes the captured token, clears private state and preserves owner-scoped unsynced orders',async()=>{
 const h=harness();await h.logout();
 assert.equal(h.calls.length,1);assert.match(h.calls[0][0],/\/logout$/);
 assert.equal(h.calls[0][1].method,'POST');assert.equal(h.calls[0][1].headers.Authorization,'Bearer synthetic-a');
 const state=h.state();assert.equal(state.session,null);assert.equal(h.sessionStorage.getItem(KEY),null);assert.equal(h.localStorage.getItem(PROJECTS),null);
 for(const key of ['orders','cncPanels','projects','supportTickets'])assert.equal(state[key].length,0,key);
 for(const key of ['profile','pendingSetup','selectedProfilePhoto'])assert.equal(state[key],null,key);
 for(const key of ['supportSelected','supportPhoto','supportReplyPhoto'])assert.equal(state[key],'',key);
 assert.equal(state.expanded,0);assert.equal(state.pointers,0);assert.equal(state.view,'orders');assert.equal(state.busy,false);
 assert.equal(JSON.stringify(state.outbox),JSON.stringify(h.queued));assert.equal(h.localStorage.getItem(OUTBOX),JSON.stringify(h.queued));
});
test('offline logout still clears device identity and explicitly warns that server revocation was not confirmed',async()=>{
 const h=harness(async()=>{throw Error('Offline');});await h.logout();
 assert.equal(h.state().session,null);assert.match(h.state().message,/Server sign-out could not be confirmed/);
 assert.equal(h.localStorage.getItem(OUTBOX),JSON.stringify(h.queued));
});
test('late authenticated responses and delayed JSON cannot restore data after logout',async()=>{
 let finishFetch;
 const h=harness(url=>url.endsWith('/logout')?Promise.resolve(Response.json({ok:true})):new Promise(resolve=>finishFetch=resolve));
 const pending=h.api('/support');await h.logout();finishFetch(Response.json({tickets:[{id:'user-a-private'}]}));
 await assert.rejects(pending,/Session changed/);
 let finishJson;
 const j=harness(async url=>url.endsWith('/logout')?Response.json({ok:true}):{status:200,json:()=>new Promise(resolve=>finishJson=resolve)});
 const response=await j.api('/support'),json=response.json();await j.logout();finishJson({tickets:[{id:'user-a-private'}]});
 await assert.rejects(json,/Session changed/);assert.equal(j.state().supportTickets.length,0);
});
test('expired session clears private state and project cache cannot cross account ownership',async()=>{
 const h=harness(async()=>Response.json({error:'expired'},{status:401}));
 assert.equal(h.readProjects('user-a').length,1);assert.equal(h.readProjects('user-b').length,0);
 await assert.rejects(h.api('/session'),/session expired/);
 assert.equal(h.state().session,null);assert.equal(h.state().supportTickets.length,0);assert.equal(h.state().profile,null);
});

