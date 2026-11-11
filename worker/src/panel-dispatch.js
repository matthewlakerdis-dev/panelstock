import {requireCondition as check} from './security.js';
import {panelQaResolution} from './qa-resolution.js';
import {panelQaExemptionFields} from './qa-exemptions.js';
const signature=panels=>JSON.stringify(panels.slice().sort((a,b)=>a.id.localeCompare(b.id)));
export function panelRequiresPowderCoating(panel,stock=[]) {
 const stockId=panel.stockItemId||panel.stockVariantId;
 const item=stock.find(item=>stockId&&item.id===stockId)||stock.find(item=>panel.stockSku&&item.sku===panel.stockSku);
 const finish=String(item?.color??panel.stockColor??panel.color??'').trim().toLowerCase().replace(/[-_]+/g,' ').replace(/\s+/g,' ');
 return ['milled','mill','mill finish','milled finish'].includes(finish);
}
const key=(p,stock)=>JSON.stringify([String(p.jobReference||'').trim().toLowerCase(),String(p.orderNumber||'').trim().toLowerCase(),...(panelRequiresPowderCoating(p,stock)?['powder_coaters']:[])]);
// Called in the scheduling transaction. Sent manifests are immutable.
export function reconcilePanelLoads(loads,panels,legacy=[],now=new Date().toISOString(),stock=[]) {
 const next=structuredClone(loads),shipped=new Set(legacy.flatMap(d=>(d.lines||[]).filter(l=>l.kind==='panel').map(l=>l.id))),assigned=new Set(next.filter(l=>l.status!=='waiting').flatMap(l=>l.panelIds)),groups=new Map();
 for(const p of panels){if(assigned.has(p.id)||shipped.has(p.id))continue;const k=key(p,stock);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(p);}
 for(const load of next.filter(l=>l.status==='waiting')){const first=panels.find(p=>load.panelIds.includes(p.id)&&!assigned.has(p.id)&&!shipped.has(p.id));if(first)load.orderKey=key(first,stock);const group=groups.get(load.orderKey)||[];load.requiresPowderCoating=group.some(p=>panelRequiresPowderCoating(p,stock));const ids=group.map(p=>p.id),productionSignature=signature(group);if(productionSignature!==load.productionSignature)load.fabrication=null;load.productionSignature=productionSignature;load.panelIds=ids;groups.delete(load.orderKey);}
 for(const [orderKey,group] of groups)next.push({id:crypto.randomUUID(),orderKey,project:group[0].jobReference||'',orderNumber:group[0].orderNumber,panelIds:group.map(p=>p.id),requiresPowderCoating:group.some(p=>panelRequiresPowderCoating(p,stock)),productionSignature:signature(group),status:'waiting',createdAt:now,fabrication:null,legs:[]});
 return next.filter(l=>l.status!=='waiting'||l.panelIds.length);
}
export function panelLoadView(load,panels,records,stock=[]){
 const byId=new Map(panels.map(p=>[p.id,p])),qa=new Map(records.filter(r=>r.kind==='panel').map(r=>[r.id,r]));
 const loadPanelIds=new Set(load.panelIds),items=load.panelIds.map(id=>{const p=byId.get(id),r=qa.get(id),resolution=panelQaResolution(p,r,byId,qa,loadPanelIds),replaced=r?.status==='replaced'&&resolution.qaResolved;return {id,reference:p?.panelNumber||id,requiresPowderCoating:!!p&&panelRequiresPowderCoating(p,stock),sheetNumber:p?.sheetNumber||'',routing:p?.status==='completed',qa:resolution.qaResolved,replaced,...resolution,...panelQaExemptionFields(p,r,load.status==='dispatched_to_site'),resolvedSeparatelyAt:r?.resolvedSeparatelyAt||null,resolvedSeparatelyBy:r?.resolvedSeparatelyBy||null,resolvedSeparatelyReason:r?.resolvedSeparatelyReason||''};});
 const requiresPowderCoating=items.some(item=>item.requiresPowderCoating)||(load.status!=='waiting'&&load.requiresPowderCoating===true);
 const routing=items.length>0&&items.every(p=>p.routing),qaComplete=items.length>0&&items.every(p=>p.qa),fabricationComplete=routing&&qaComplete;
 const lastApproval=items.filter(item=>!item.replaced).map(item=>qa.get(item.id)?.latest).filter(Boolean).sort((a,b)=>String(b.checkedAt).localeCompare(String(a.checkedAt)))[0];
 const fabrication=fabricationComplete&&lastApproval?{by:lastApproval.checkedBy,at:lastApproval.checkedAt,source:'qa'}:null;
 // Older coated-but-unsent loads also need an explicit post-coating approval.
 const status=load.status==='ready_for_site'&&!load.finalQa?'awaiting_final_qa':load.status;
 const coatingReady=!['at_powder_coaters','awaiting_final_qa'].includes(status)&&(!load.coatingCompleted||!!load.finalQa);
 const finalQaRequired=requiresPowderCoating||(load.legs||[]).some(leg=>leg.destinationType==='powder_coaters');
 const ready=routing&&fabricationComplete&&qaComplete&&coatingReady;
 return {...load,status,fabrication,items,routing,fabricationComplete,qaComplete,requiresPowderCoating,finalQaRequired,ready,readyForSite:ready&&(!finalQaRequired||!!load.coatingCompleted&&!!load.finalQa)};
}
export function transitionPanelLoad(load,body,actor,now=new Date().toISOString()){
 const next=structuredClone(load),action=body.action;
 if(action==='coating-complete'){check(load.status==='at_powder_coaters','This load is not awaiting powder coating',409);next.status='awaiting_final_qa';next.coatingCompleted={by:actor.username,at:now};delete next.finalQa;}
 else if(action==='final-qa'){check(load.status==='awaiting_final_qa'&&load.coatingCompleted,'Complete powder coating before final QA',409);check(body.confirmed===true,'Confirm the whole load has passed final QA');check(load.routing&&load.qaComplete,'Routing and production QA must still be complete',409);next.finalQa={by:actor.username,at:now};next.status='ready_for_site';}
 else{check(action==='dispatch','Unknown load action');check(!load.dispatchRevision||body.dispatchRevision===load.dispatchRevision,'This load was returned from dispatch. Refresh and review it before dispatching again',409);check(['waiting','ready_for_site'].includes(load.status),'This load cannot be dispatched again',409);check(!load.requiresPowderCoating||load.status!=='waiting'||body.destinationType==='powder_coaters','Milled panels must go to powder coaters before site dispatch',409);check(load.ready,'Routing, fabrication and QA must all be complete before dispatch',409);check(body.destinationType!=='site'||load.readyForSite!==false,'Complete powder coating and final QA before site dispatch',409);check(['site','powder_coaters'].includes(body.destinationType),'Choose site or powder coaters');check(load.status!=='ready_for_site'||body.destinationType==='site','Coated loads must go to site',409);const fields={};for(const name of ['destination','transport','driver']){fields[name]=String(body[name]||'').trim().slice(0,300);check(fields[name],`${name} is required`);}next.legs.push({...fields,destinationType:body.destinationType,notes:String(body.notes||'').slice(0,5000),by:actor.username,at:now});next.status=body.destinationType==='site'?'dispatched_to_site':'at_powder_coaters';}
 for(const field of ['items','routing','fabricationComplete','qaComplete','ready','readyForSite','finalQaRequired'])delete next[field];return next;
}


export function panelDispatchFingerprint(body){
 return JSON.stringify({id:body.id,destinationType:body.destinationType,destination:String(body.destination||'').trim(),transport:String(body.transport||'').trim(),driver:String(body.driver||'').trim(),notes:String(body.notes||'').slice(0,5000),panelIds:Array.isArray(body.panelIds)?body.panelIds.slice().sort():null,expectedPanelIds:Array.isArray(body.expectedPanelIds)?body.expectedPanelIds.slice().sort():null,expectedStatus:body.expectedStatus||'',dispatchRevision:body.dispatchRevision||0});
}
export function splitPanelDispatch(load,body,actor,panels,now=new Date().toISOString()){
 const full=transitionPanelLoad(load,body,actor,now);
 if(body.panelIds===undefined)return {sent:full,remainder:null};
 check(typeof body.mutationId==='string'&&/^[a-zA-Z0-9-]{16,100}$/.test(body.mutationId),'A delivery request ID is required');
 check(Array.isArray(body.panelIds)&&body.panelIds.length>0&&new Set(body.panelIds).size===body.panelIds.length,'Select panels once for this delivery');
 check(Array.isArray(body.expectedPanelIds)&&JSON.stringify(body.expectedPanelIds.slice().sort())===JSON.stringify(load.panelIds.slice().sort())&&body.expectedStatus===load.status,'This panel load changed. Refresh and select the delivery again',409);
 const actual=(load.items||[]).filter(item=>!item.replaced),selected=new Set(body.panelIds);
 check(body.panelIds.every(id=>typeof id==='string'&&actual.some(item=>item.id===id)),'Select panels from this load only');
 // Failed originals travel as audit dependencies of their approved recuts.
 for(const item of load.items||[])if(item.replaced&&selected.has(item.replacementId))selected.add(item.id);
 const sentIds=load.panelIds.filter(id=>selected.has(id)),remainingIds=load.panelIds.filter(id=>!selected.has(id));
 const clean=value=>{for(const field of ['items','routing','fabricationComplete','qaComplete','ready','readyForSite','finalQaRequired'])delete value[field];return value;};
 const sent=clean({...full,panelIds:sentIds,productionSignature:signature(panels.filter(panel=>selected.has(panel.id)))});
 sent.legs[sent.legs.length-1]={...sent.legs.at(-1),mutationId:body.mutationId,fingerprint:panelDispatchFingerprint(body),panelIds:body.panelIds.slice(),auditPanelIds:sentIds};
 const remainder=remainingIds.length?clean({...structuredClone(load),id:crypto.randomUUID(),panelIds:remainingIds,productionSignature:signature(panels.filter(panel=>remainingIds.includes(panel.id))),splitFrom:load.id}):null;
 return {sent,remainder};
}
