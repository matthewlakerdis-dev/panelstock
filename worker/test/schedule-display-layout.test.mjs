import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {buildScheduleDisplayHtml} from '../src/schedule-display.js';
test('TV cards show order project and escaped notes without time, and keep overlaps separate',()=>{
 const html=buildScheduleDisplayHtml('test'),elements={timeline:{},connection:{},date:{}},context={document:{getElementById:id=>elements[id]},setInterval(){},location:{hostname:'tv.panelstockhq.com'},fetch:()=>new Promise(()=>{}),AbortSignal:{timeout:()=>null},Intl,Date};
 vm.createContext(context);vm.runInContext(html.match(/<script>([\s\S]*)<\/script>/)[1],context);
 const date=vm.runInContext('brisbaneDate()',context),entry={date,assignedUsername:'p',title:'Deliver brackets <test>',project:'Airport',notes:'Use rear gate <check> & keep wrapped',scheduleType:'delivery'};
 context.data={people:[{username:'p',displayName:'Person'}],settings:{startHour:4,endHour:14},entries:[{...entry,startTime:'05:00',endTime:'08:00'},{...entry,startTime:'06:00',endTime:'07:00'},{...entry,startTime:'08:00',endTime:'09:00'}]};vm.runInContext('render(data)',context);
 const out=elements.timeline.innerHTML;assert.doesNotMatch(out,/<time>|05:00|08:00/);assert.match(out,/<strong>Deliver brackets &lt;test&gt;<\/strong><span>Airport<\/span><span class="notes">Use rear gate &lt;check&gt; &amp; keep wrapped<\/span>/);assert.match(out,/Deliver brackets &lt;test&gt;/);assert.match(out,/top:130px/);assert.equal((out.match(/top:10px/g)||[]).length,2);assert.match(out,/width:calc\(30% - 6px\)/);assert.match(out,/min-height:248px/);assert.match(html,/-webkit-line-clamp:2/);
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
 const html=buildScheduleDisplayHtml('test'),cards=[{dataset:{track:'0'},style:{},getBoundingClientRect:()=>({height:76})},{dataset:{track:'0'},style:{},getBoundingClientRect:()=>({height:92})},{dataset:{track:'1'},style:{},getBoundingClientRect:()=>({height:76})}],lane={style:{},querySelectorAll:()=>cards},emptyLane={style:{},querySelectorAll:()=>[]},timeline={querySelectorAll:()=>[lane,emptyLane]},elements={timeline,connection:{},date:{}},context={document:{getElementById:id=>elements[id]},setInterval(){},location:{hostname:'tv.panelstockhq.com'},fetch:()=>new Promise(()=>{}),AbortSignal:{timeout:()=>null},Intl,Date};
 vm.createContext(context);vm.runInContext(html.match(/<script>([\s\S]*)<\/script>/)[1],context);vm.runInContext('compactRows()',context);
 assert.equal(cards[0].style.top,'6px');assert.equal(cards[1].style.top,'6px');assert.equal(cards[2].style.top,'106px');assert.equal(lane.style.minHeight,'188px');assert.ok(parseFloat(emptyLane.style.minHeight)>0,'Empty users retain a visible timeline lane');
});

test('TV reservations use the selected task colour and name without an official order',()=>{const html=buildScheduleDisplayHtml('test'),elements={timeline:{},connection:{},date:{}},context={document:{getElementById:id=>elements[id]},setInterval(){},location:{hostname:'tv.panelstockhq.com'},fetch:()=>new Promise(()=>{}),AbortSignal:{timeout:()=>null},Intl,Date};vm.createContext(context);vm.runInContext(html.match(/<script>([\s\S]*)<\/script>/)[1],context);context.data={people:[{username:'alex',displayName:'Alex'}],entries:[{id:'p',isPlaceholder:true,scheduleType:'cnc',date:vm.runInContext('brisbaneDate()',context),assignedUsername:'alex',startTime:'06:00',endTime:'18:00',title:'Upcoming balustrades',project:'Future Tower',notes:'Order not placed'}]};vm.runInContext('render(data)',context);assert.match(elements.timeline.innerHTML,/class="entry cnc"/);assert.match(elements.timeline.innerHTML,/CNC work · Upcoming balustrades/);assert.match(elements.timeline.innerHTML,/Future Tower/);});

test('TV uses distinct colours for every production plan task',()=>{
 const html=buildScheduleDisplayHtml('test'),elements={timeline:{},connection:{},date:{}},context={document:{getElementById:id=>elements[id]},setInterval(){},location:{hostname:'tv.panelstockhq.com'},fetch:()=>new Promise(()=>{}),AbortSignal:{timeout:()=>null},Intl,Date};vm.createContext(context);vm.runInContext(html.match(/<script>([\s\S]*)<\/script>/)[1],context);
 const date=vm.runInContext('brisbaneDate()',context);context.data={people:[{username:'p',displayName:'Person'}],settings:{startHour:6,endHour:18},entries:['stock-order','drawing','cnc','fabrication','powder-coating','powder-pickup','delivery'].map(scheduleType=>({date,assignedUsername:'p',title:scheduleType,project:'Tower',startTime:'06:00',endTime:'07:00',scheduleType}))};vm.runInContext('render(data)',context);
 const colours=[...elements.timeline.innerHTML.matchAll(/background:(#[a-f0-9]+);left:/g)].map(match=>match[1]);assert.equal(colours.length,7);assert.equal(new Set(colours).size,7);
});

test('TV applies configured task colours with contrasting text',()=>{
 const html=buildScheduleDisplayHtml('test'),elements={timeline:{},connection:{},date:{}},context={document:{getElementById:id=>elements[id]},setInterval(){},location:{hostname:'tv.panelstockhq.com'},fetch:()=>new Promise(()=>{}),AbortSignal:{timeout:()=>null},Intl,Date};vm.createContext(context);vm.runInContext(html.match(/<script>([\s\S]*)<\/script>/)[1],context);
 const date=vm.runInContext('brisbaneDate()',context);context.data={people:[{username:'p',displayName:'Person'}],settings:{startHour:6,endHour:18,taskColours:{fabrication:'#00ff00',cnc:'#000000'}},entries:['fabrication','cnc'].map(scheduleType=>({date,assignedUsername:'p',title:scheduleType,project:'Tower',startTime:'06:00',endTime:'07:00',scheduleType}))};vm.runInContext('render(data)',context);
 assert.match(elements.timeline.innerHTML,/color:#000000;background:#00ff00/);assert.match(elements.timeline.innerHTML,/color:#ffffff;background:#000000/);
});

test('TV checks every two seconds, coalesces slow fetches and skips unchanged redraws',async()=>{
 const html=buildScheduleDisplayHtml('test'),elements={timeline:{},connection:{},date:{}},intervals=[],requests=[];let finish,renders=0;
 const context={document:{getElementById:id=>elements[id]},setInterval:(fn,ms)=>intervals.push(ms),location:{hostname:'tv.panelstockhq.com'},fetch:url=>{requests.push(url);return new Promise(resolve=>finish=resolve);},AbortSignal:{timeout:()=>null},Intl,Date};vm.createContext(context);vm.runInContext(html.match(/<script>([\s\S]*)<\/script>/)[1],context);context.render=()=>renders++;
 await vm.runInContext('refresh()',context);assert.equal(requests.length,1);assert.ok(intervals.includes(2000));
 finish({ok:true,json:async()=>({revision:'one',entries:[],people:[]})});await new Promise(resolve=>setImmediate(resolve));assert.equal(renders,1);
 context.fetch=async url=>{requests.push(url);return {ok:true,json:async()=>({revision:'one',unchanged:true})};};await vm.runInContext('refresh()',context);assert.equal(renders,1);assert.match(requests.at(-1),/revision=one/);
 context.brisbaneDate=()=> '2099-01-02';await vm.runInContext('refresh()',context);assert.equal(renders,2,'midnight redraws cached data even when the server data is unchanged');
});
