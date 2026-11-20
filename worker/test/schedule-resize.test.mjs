import test from 'node:test';
import assert from 'node:assert/strict';
import {resizeScheduleEntry} from '../src/schedule-resize.js';
const actor={username:'admin',isAdmin:true},base={id:'booking',project:'Future Tower',projectId:'',title:'Upcoming work',date:'2026-11-23',assignedUsername:'alex',assignedTo:'Alex',scheduleType:'general',notes:'Keep these notes',isPlaceholder:true,startTime:'07:00',endTime:'10:00',updatedAt:'2026-11-20T01:00:00.000Z'};
function store(patch={}){let entries=[{...base,...patch}],writes=0,notifications=0;return {read:()=>entries,write:(key,value)=>{entries=value;writes++;},scheduleSettings:()=>({startHour:6,endHour:18}),scheduleEntriesFor:()=>entries,requireTask:(user,task)=>{if(!user.isAdmin&&!user.tasks?.[task])throw Object.assign(Error('Permission denied'),{status:403});},ctx:{storage:{transactionSync:fn=>fn()}},notify:()=>notifications++,audit(){},state:()=>({entries,writes,notifications})};}
const input={edge:'start',time:'07:30',expectedUpdatedAt:base.updatedAt};
test('resizing changes only time and attribution, preserving placeholder project person notes and date',()=>{const s=store(),r=resizeScheduleEntry(s,base.id,{...input,notes:'Forged',project:'Forged'},actor);assert.equal(r.entry.startTime,'07:30');assert.equal(r.entry.endTime,'10:00');for(const key of ['project','projectId','title','date','assignedUsername','notes','isPlaceholder'])assert.equal(r.entry[key],base[key]);assert.equal(s.state().writes,1);assert.equal(s.state().notifications,1);assert.notEqual(r.entry.updatedAt,base.updatedAt);});
test('stale versions, invalid increments, short durations and out-of-hours moves cannot write',()=>{for(const patch of [{expectedUpdatedAt:'stale'},{time:'07:15'},{time:'25:00'},{edge:'end',time:'07:00'},{edge:'end',time:'19:00'},{edge:'start',time:'05:30'}]){const s=store();assert.throws(()=>resizeScheduleEntry(s,base.id,{...input,...patch},actor));assert.equal(s.state().writes,0);}});
test('permissions follow the actual stored booking type and vehicles still require general management',()=>{for(const [booking,person,allowed] of [[{}, {username:'viewer'},false],[{scheduleType:'cnc'},{username:'cnc',tasks:{'schedule.cnc.manage':true}},true],[{}, {username:'cnc',tasks:{'schedule.cnc.manage':true}},false],[{scheduleType:'cnc',assignedResourceType:'vehicle',assignedUsername:'vehicle:ute'},{username:'cnc',tasks:{'schedule.cnc.manage':true}},false]]){const s=store(booking);if(allowed)assert.equal(resizeScheduleEntry(s,base.id,input,person).ok,true);else assert.throws(()=>resizeScheduleEntry(s,base.id,input,person));}});
test('unchanged times do not write or notify, and the unmodified edge need not already be on a half hour',()=>{const s=store();assert.equal(resizeScheduleEntry(s,base.id,{...input,time:'07:00'},actor).unchanged,true);assert.equal(s.state().writes,0);const other=store({endTime:'10:15'});assert.equal(resizeScheduleEntry(other,base.id,input,actor).entry.endTime,'10:15');});

test('a Schedule manager can resize an automatic CNC booking and retain control of its timing',()=>{
 const s=store({scheduleType:'cnc',productionPlanStage:'cnc'});
 const manager={username:'manager',tasks:{'schedule.manage':true}};
 const result=resizeScheduleEntry(s,base.id,input,manager);
 assert.equal(result.entry.productionPlanOverride,true);
 assert.equal(result.entry.productionPlanStage,'cnc');
 assert.equal(result.entry.startTime,'07:30');
});
