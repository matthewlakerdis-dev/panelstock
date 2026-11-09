import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../src/store.js',import.meta.url),'utf8');
function store(){
 const methods=['scheduleOrders','scheduleOrderTitle','scheduleEntries','scheduleValue'].map(name=>{const a=source.indexOf('  '+name+'('),b=a+3+source.slice(a+3).search(/\n  (?=[a-zA-Z])/);return source.slice(a,b);}).join('\n');
 const Store=vm.runInNewContext('(class {'+methods+'})',{normalizeUsername:v=>v,check:(ok,message)=>{if(!ok)throw Error(message);}});
 const value=new Store();value.read=()=>[{id:'o1',projectId:'p1',project:'One',orderNumber:'12',orderType:'Panels',items:[{description:'Private detail'}]},{id:'o2',project:'  TWO ',orderNumber:'3',orderType:'Other',orderTypeOther:'Brackets'}];value.scheduleProjects=()=>[{id:'p1',name:'One'},{id:'p2',name:'Two'},{id:'factory',name:'Factory/Production',scheduleOnly:true}];value.scheduleAllPeople=()=>[{username:'person',displayName:'Person'}];value.orderProjectKey=v=>String(v||'').trim().toLowerCase();return value;
}
const input={projectId:'p1',orderId:'o1',assignedUsername:'person',date:'2026-11-06'};
test('schedule order selection persists its identity and derives the activity',()=>{const result=store().scheduleValue({...input,title:'Forged title'});assert.equal(result.orderId,'o1');assert.equal(result.title,'Order 12 · Panels');});
test('schedule rejects missing orders and orders belonging to another project',()=>{for(const patch of [{orderId:'missing'},{projectId:'p2'},{projectId:'factory'}])assert.throws(()=>store().scheduleValue({...input,...patch}),/Select an order for this project/);});
test('legacy project names match and Other order detail is shown',()=>{assert.equal(store().scheduleValue({...input,projectId:'p2',orderId:'o2'}).title,'Order 3 · Other: Brackets');});
test('factory activities and legacy schedule text remain editable',()=>{assert.equal(store().scheduleValue({...input,projectId:'factory',orderId:'',title:'Cleaning'}).title,'Cleaning');});
test('schedule only exposes order selection metadata',()=>{assert.equal('items' in store().scheduleOrders()[0],false);});

test('panel and gate schedule labels include location or villa without blank separators',()=>{
 const value=store();
 for(const orderType of ['Panels','Gate',' gate '])assert.equal(value.scheduleOrderTitle({orderNumber:'5',orderType,locationNotes:'  Villa 12\n Level 1  '}),`Order 5 · ${orderType} · Villa 12 Level 1`);
 assert.equal(value.scheduleOrderTitle({orderNumber:'5',orderType:'Gate',locationNotes:' '}),'Order 5 · Gate');
 assert.equal(value.scheduleOrderTitle({orderNumber:'5',orderType:'Brackets',locationNotes:'Loading bay'}),'Order 5 · Brackets');
});
test('existing linked schedule entries and TV display receive the current villa',()=>{
 const value=store(),entry={id:'s1',orderId:'o1',title:'Order 12 · Panels',date:'2026-11-06'};
 value.read=key=>key==='orders'?[{id:'o1',orderNumber:'12',orderType:'Panels',locationNotes:'Villa 7'}]:[entry,{id:'legacy',title:'Cleaning',date:'2026-11-06'}];
 const result=value.scheduleEntries();assert.equal(result.find(row=>row.id==='s1').title,'Order 12 · Panels · Villa 7');assert.equal(entry.title,'Order 12 · Panels');assert.equal(result.find(row=>row.id==='legacy').title,'Cleaning');
});

test('panel Location and gate Villa are exported and take priority over old notes',()=>{
 const value=store(),orders=[{id:'panel',orderNumber:'1',orderType:'Panels',location:' North\n elevation ',locationNotes:'Old notes'},{id:'gate',orderNumber:'2',orderType:'Gate',villa:' V135 ',location:'Other location',locationNotes:'Old notes'}];value.read=()=>orders;
 const exported=value.scheduleOrders();assert.equal(exported[0].location,orders[0].location);assert.equal(exported[1].villa,orders[1].villa);
 assert.equal(value.scheduleOrderTitle(exported[0]),'Order 1 · Panels · North elevation');assert.equal(value.scheduleOrderTitle(exported[1]),'Order 2 · Gate · V135');
 assert.equal(value.scheduleOrderTitle({...orders[0],location:' ',locationNotes:'Legacy location'}),'Order 1 · Panels · Legacy location');
});

test('scheduled marker includes past and completed person bookings but excludes cancelled or unassigned entries',()=>{
 const value=store();let bookings=[];value.read=key=>key==='orders'?[{id:'o1'}]:bookings;
 assert.equal(value.scheduleOrders()[0].alreadyScheduled,false);
 for(const status of ['planned','completed']){bookings=[{orderId:'o1',assignedUsername:'person',status,date:'2020-01-01'}];assert.equal(value.scheduleOrders()[0].alreadyScheduled,true);}
 for(const entry of [{orderId:'o1',assignedUsername:'person',status:'cancelled'},{orderId:'o1'},{orderId:'other',assignedUsername:'person'}]){bookings=[entry];assert.equal(value.scheduleOrders()[0].alreadyScheduled,false);}
});
test('dispatched orders reject new bookings and reassignment while preserving existing booking edits',()=>{
 const value=store();value.read=key=>key==='orders'?[{id:'o1',projectId:'p1',orderNumber:'12',status:'dispatched'}]:[];
 assert.throws(()=>value.scheduleValue(input),/Dispatched orders cannot be scheduled/);
 assert.equal(value.scheduleValue(input,{orderId:'o1',assignedUsername:'person'}).orderId,'o1');
 assert.throws(()=>value.scheduleValue(input,{orderId:'o1',assignedUsername:'another'}),/Dispatched orders cannot be scheduled/);
});
