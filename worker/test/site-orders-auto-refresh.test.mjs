import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../../site/app.js',import.meta.url),'utf8'),code=source.slice(source.indexOf('  let siteOrdersRequest='),source.indexOf('  function submissionKey(packet)'));
function fixture(fetcher){let calls=0,renders=0,scroll;const root={scrollTop:120,scrollLeft:0,parentElement:null,querySelector:()=>null},window={scrollX:0,scrollY:240,setTimeout:()=>1,clearTimeout:()=>{},scrollTo:(...args)=>scroll=args};const context={root,window,AbortController,editorReady:true,session:{username:'viewer'},sessionVersion:1,can:()=>true,document:{hidden:false,activeElement:{matches:()=>false}},busy:false,statusSaving:false,mobileHost:null,view:'orders',selectedOrderId:'',orders:[{id:'order',status:'submitted'}],orderTypes:[],orderLeadSettings:{},projects:[],DEFAULT_ORDER_TYPES:['Panels'],PROJECTS_KEY:'projects',deviceStorage:{setItem:()=>{}},render:()=>{renders++;root.scrollTop=0;},api:async()=>{calls++;return fetcher();}};vm.createContext(context);vm.runInContext(code,context);return {context,calls:()=>calls,renders:()=>renders,scroll:()=>scroll};}
const response=()=>Response.json({orders:[{id:'order',status:'ordered'}],orderTypes:['Fabrication'],projectRecords:[]});
test('changed orders update in place; unchanged responses do not render and scroll stays put',async()=>{
 const f=fixture(response);assert.equal(await f.context.loadSiteOrders(true),true);assert.equal(f.context.orders[0].status,'ordered');assert.equal(f.renders(),1);assert.equal(f.context.root.scrollTop,120);assert.deepEqual(f.scroll(),[0,240]);await f.context.loadSiteOrders(true);assert.equal(f.renders(),1);
});
test('hidden pages, typing, order forms, inactive embedded screens and saves never poll',async()=>{
 for(const change of [c=>c.document.hidden=true,c=>c.document.activeElement.matches=()=>true,c=>c.view='new',c=>{c.view='deliveries';c.selectedOrderId='order';},c=>c.busy=true,c=>c.statusSaving=true,c=>c.mobileHost={isCurrent:()=>false}]){const f=fixture(response);change(f.context);await f.context.loadSiteOrders(true);assert.equal(f.calls(),0);}
});
test('slow polls cannot overlap, overwrite edits started during the request or leak across accounts',async()=>{
 for(const change of [c=>c.session.username='other',c=>c.sessionVersion++,c=>c.view='new',c=>c.document.activeElement.matches=()=>true]){let finish;const f=fixture(()=>new Promise(resolve=>finish=resolve)),pending=f.context.loadSiteOrders(true);await f.context.loadSiteOrders(true);assert.equal(f.calls(),1);change(f.context);finish(response());assert.equal(await pending,false);assert.equal(f.context.orders[0].status,'submitted');assert.equal(f.renders(),0);}
});
test('background errors keep the saved list and can be retried without a manual refresh',async()=>{
 let failure=true;const f=fixture(()=>{if(failure)throw Error('Offline');return response();});assert.equal(await f.context.loadSiteOrders(true),false);assert.equal(f.context.orders[0].status,'submitted');failure=false;assert.equal(await f.context.loadSiteOrders(true),true);assert.equal(f.renders(),1);
});

test('unavailable device cache cannot prevent live orders from appearing',async()=>{
 const f=fixture(response);f.context.deviceStorage.setItem=()=>{throw Error('Storage full');};assert.equal(await f.context.loadSiteOrders(true),true);assert.equal(f.renders(),1);assert.equal(f.context.orders[0].status,'ordered');
});
