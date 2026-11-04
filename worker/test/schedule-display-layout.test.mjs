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

test('TV fits every schedule row above the footer and refits after resize or a shorter refresh',()=>{
 const html=buildScheduleDisplayHtml('test'),styles={},wrap={style:{},getBoundingClientRect:()=>({top:120})};let height=1800;
 const timeline={style:styles,parentElement:wrap,getBoundingClientRect(){const scale=Number((styles.transform||'scale(1)').match(/scale\(([^)]+)\)/)[1]);return {height:height*scale};}};
 const elements={timeline,connection:{},date:{}},footer={getBoundingClientRect:()=>({height:14})},screen={},listeners={};
 const context={document:{getElementById:id=>elements[id],querySelector:selector=>selector==='.footer'?footer:screen},window:{innerHeight:720,addEventListener:(name,fn)=>listeners[name]=fn},getComputedStyle:element=>element===footer?{marginTop:'6px'}:{paddingBottom:'10px'},setInterval(){},location:{hostname:'tv.panelstockhq.com'},fetch:()=>new Promise(()=>{}),AbortSignal:{timeout:()=>null},Intl,Date};
 vm.createContext(context);vm.runInContext(html.match(/<script>([\s\S]*)<\/script>/)[1],context);vm.runInContext('fitTimeline()',context);
 const fits=()=>assert.ok(120+parseFloat(wrap.style.height)+14+6+10<=context.window.innerHeight+1);
 fits();assert.ok(parseFloat(styles.width)>100);assert.ok(Number(styles.transform.match(/scale\(([^)]+)\)/)[1])<1);
 context.window.innerHeight=1080;listeners.resize();fits();
 height=300;vm.runInContext('fitTimeline()',context);assert.equal(styles.transform,'scale(1)');assert.equal(styles.width,'100%');fits();
});

test('busy rows use actual card heights and keep overlapping tracks separate',()=>{
 const html=buildScheduleDisplayHtml('test'),cards=[{dataset:{track:'0'},style:{},getBoundingClientRect:()=>({height:76})},{dataset:{track:'0'},style:{},getBoundingClientRect:()=>({height:92})},{dataset:{track:'1'},style:{},getBoundingClientRect:()=>({height:76})}],lane={style:{},querySelectorAll:()=>cards},timeline={querySelectorAll:()=>[lane]},elements={timeline,connection:{},date:{}},context={document:{getElementById:id=>elements[id]},setInterval(){},location:{hostname:'tv.panelstockhq.com'},fetch:()=>new Promise(()=>{}),AbortSignal:{timeout:()=>null},Intl,Date};
 vm.createContext(context);vm.runInContext(html.match(/<script>([\s\S]*)<\/script>/)[1],context);vm.runInContext('compactRows()',context);
 assert.equal(cards[0].style.top,'6px');assert.equal(cards[1].style.top,'6px');assert.equal(cards[2].style.top,'106px');assert.equal(lane.style.minHeight,'188px');
});
