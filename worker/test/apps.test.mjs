import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
test('mobile bundle parses, uses individual sessions and excludes voided jobs',()=>{
 const html=fs.readFileSync(new URL('../../index.html',import.meta.url),'utf8');
 for(const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g))if(match[1].trim())new vm.Script(match[1]);
 assert.ok(html.includes('panelstock-client.js'));
 assert.ok(!html.includes('BAKED_SHARED_SECRET'));
 assert.ok(!html.includes('.slice(0, 800)'));
 const dispatch=html.slice(html.indexOf('function DispatchTab'),html.indexOf('function DamageTab'));
 assert.match(dispatch,/ItemPicker[^\n]+sortLikeSoh: true/);
 assert.match(html,/function ScheduleTab\(\)/);
 assert.match(html,/Read-only project schedule/);
 assert.match(html,/BAKED_WORKER_URL\+"\/schedule"/);
 const filter=html.match(/const dispatches = transactions.filter\(([^;]+)\);/)[1];
 const result=vm.runInNewContext(`transactions.filter(${filter})`,{transactions:[{type:'dispatch',qty:2},{type:'dispatch',qty:5,voided:true}]});
 assert.equal(result.length,1);assert.equal(result[0].qty,2);
});
