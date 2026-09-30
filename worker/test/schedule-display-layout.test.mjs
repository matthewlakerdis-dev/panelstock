import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {buildScheduleDisplayHtml} from '../src/schedule-display.js';
test('TV cards separate time, wrap titles, gap adjacent entries and stack overlaps',()=>{
 const html=buildScheduleDisplayHtml('test'),elements={timeline:{},connection:{},date:{}},context={document:{getElementById:id=>elements[id]},setInterval(){},location:{hostname:'tv.panelstockhq.com'},fetch:()=>new Promise(()=>{}),AbortSignal:{timeout:()=>null},Intl,Date};
 vm.createContext(context);vm.runInContext(html.match(/<script>([\s\S]*)<\/script>/)[1],context);
 const date=vm.runInContext('brisbaneDate()',context),entry={date,assignedUsername:'p',title:'Deliver brackets <test>',project:'Airport',scheduleType:'delivery'};
 context.data={people:[{username:'p',displayName:'Person'}],settings:{startHour:4,endHour:14},entries:[{...entry,startTime:'05:00',endTime:'08:00'},{...entry,startTime:'06:00',endTime:'07:00'},{...entry,startTime:'08:00',endTime:'09:00'}]};vm.runInContext('render(data)',context);
 const out=elements.timeline.innerHTML;assert.match(out,/<time>05:00 – 08:00<\/time>/);assert.match(out,/Deliver brackets &lt;test&gt;/);assert.match(out,/top:130px/);assert.equal((out.match(/top:10px/g)||[]).length,2);assert.match(out,/width:calc\(30% - 6px\)/);assert.match(out,/min-height:248px/);assert.match(html,/-webkit-line-clamp:2/);
});
