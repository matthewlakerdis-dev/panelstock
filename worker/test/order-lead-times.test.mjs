import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import lead from '../../order-lead-times.js';
import {orderLeadTimes,setOrderLeadTimes,checkOrderLeadTime} from '../src/order-lead-settings.js';

test('working-day lead times exclude submission day and weekends across month/year/leap boundaries',()=>{
 for(const [start,days,end] of [['2026-11-19',2,'2026-11-23'],['2026-11-20',1,'2026-11-23'],['2026-11-21',1,'2026-11-23'],['2026-11-22',1,'2026-11-23'],['2026-12-31',2,'2027-01-04'],['2028-02-28',2,'2028-03-01']]){
  const settings={days:{Fabrication:days}};assert.equal(lead.minimumDate(settings,' fabrication ',start),end);assert.equal(lead.error(settings,'Fabrication',end,start),'');assert.match(lead.error(settings,'Fabrication',start,start),/Earliest requested delivery/);
 }
 assert.equal(lead.error({days:{Fixings:0}},'Fixings','2020-01-01','2026-11-20'),'');
 assert.equal(lead.minimumDate({days:{Panels:3}},'Other','2026-11-20'),'');
 assert.equal(lead.error({days:{Panels:1}},'Panels','2026-02-30','2026-02-01').includes('Earliest'),true);
});
test('Brisbane date is authoritative on either side of local midnight and independent of browser timezone',()=>{
 assert.equal(lead.today('2026-11-19T13:59:59Z'),'2026-11-19');assert.equal(lead.today('2026-11-19T14:00:00Z'),'2026-11-20');
 assert.equal(lead.minimumDate({days:{Panels:1}},'Panels',lead.today('2026-11-19T14:00:00Z')),'2026-11-23');
});
function store(){const data=new Map(),audits=[];return {data,audits,read:(key,fallback)=>data.get(key)??fallback,write:(key,value)=>data.set(key,structuredClone(value)),audit:(...args)=>audits.push(args),ctx:{storage:{transactionSync:fn=>fn()}}};}
test('admins configure independent canonical type minimums; invalid and stale settings cannot write',()=>{
 const s=store(),admin={username:'admin',isAdmin:true};s.data.set('order-types',['Fabrication','Fibre Cement']);const defaults=orderLeadTimes(s);assert.equal(defaults.days.Fabrication,0);
 assert.throws(()=>setOrderLeadTimes(s,{days:{Panels:1},expectedUpdatedAt:''},{username:'user',isAdmin:false}),/Admin access/);
 for(const days of [{Panels:-1},{Panels:1.5},{Panels:366},{Panels:'2'},{Unknown:2}])assert.throws(()=>setOrderLeadTimes(s,{days,expectedUpdatedAt:''},admin));
 assert.equal(s.audits.length,0);const saved=setOrderLeadTimes(s,{days:{Panels:10,Fabrication:3,'Fibre Cement':5},expectedUpdatedAt:''},admin).leadTimes;assert.equal(saved.days.Panels,10);assert.equal(saved.days.Fabrication,3);assert.equal(saved.days.Fixings,0);assert.equal(s.audits.length,1);
 assert.throws(()=>setOrderLeadTimes(s,{days:{Panels:1},expectedUpdatedAt:''},admin),/changed/);assert.equal(orderLeadTimes(s).days.Panels,10);
 s.data.set('order-types',['Fabrication','Fibre Cement','New type']);assert.equal(orderLeadTimes(s).days['New type'],0);
});
test('unchanged historical requests remain editable; new/changed dates and types use the current minimum',()=>{
 const s=store();s.data.set('order-lead-times',{days:{Fixings:2,Panels:5}});const previous={orderType:'Fixings',requestedDeliveryDate:'2026-11-01'},now='2026-11-19T00:00:00Z';
 assert.doesNotThrow(()=>checkOrderLeadTime(s,'Fixings','2026-11-01',previous,now));assert.throws(()=>checkOrderLeadTime(s,'Fixings','2026-11-20',previous,now),e=>e.code==='ORDER_LEAD_TIME');assert.throws(()=>checkOrderLeadTime(s,'Panels','2026-11-01',previous,now));assert.doesNotThrow(()=>checkOrderLeadTime(s,'Fixings','2026-11-23',previous,now));
});
test('Site modern and generated legacy clients use the same ES5 date calculations as the API',()=>{
 const shared=fs.readFileSync(new URL('../../order-lead-times.js',import.meta.url),'utf8'),site=fs.readFileSync(new URL('../../site/app.js',import.meta.url),'utf8');assert.equal(site.split('// BEGIN shared order lead times\n')[1].split('// END shared order lead times')[0],shared);
 const legacy=fs.readFileSync(new URL('../../site/app.legacy.js',import.meta.url),'utf8'),start=legacy.indexOf('(function (root, factory)'),end=legacy.indexOf('// END shared order lead times',start),context={window:{},Date};assert.ok(start>=0&&end>start);const typeHelper=legacy.split('\n').find(line=>line.startsWith('function _typeof('))||'';vm.runInNewContext(typeHelper+'\n'+legacy.slice(start,end),context);assert.equal(context.window.PanelStockOrderLeadTimes.minimumDate({days:{Panels:2}},'Panels','2026-11-20'),'2026-11-24');
});
