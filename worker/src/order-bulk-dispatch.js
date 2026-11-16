import {requireCondition as check,digest} from './security.js';
import {dispatchOrder,completeDispatchedPanelOrders} from './order-dispatch.js';
import {isPanelOrder,orderConflict} from './order-updates.js';
import {isGateOrder} from './gate-order-progress.js';
import {gateComponentViews} from './gate-components.js';
import {dispatchBalances} from './partial-dispatch.js';
import {panelLoadView,splitPanelDispatch,panelRequiresPowderCoating} from './panel-dispatch.js';
import {matchesSiteOrder} from './site-orders-excel.js';
import {migrateQaRecords} from './qa-status.js';

export const MAX_BULK_ORDERS=20;
const requestId=value=>typeof value==='string'&&/^[a-zA-Z0-9-]{16,100}$/.test(value);
function access(store,actor){for(const task of ['site.orders.view','site.orders.manage','factory.dispatch'])store.requireTask(actor,task);}
function selection(value){check(Array.isArray(value)&&value.length>0&&value.length<=MAX_BULK_ORDERS,'Select between 1 and '+MAX_BULK_ORDERS+' orders');const ids=value.map(row=>typeof row==='string'?row:row?.id);check(ids.every(requestId)&&new Set(ids).size===ids.length,'Select each order once');return ids;}
function text(value,label,max,required=false){check(value==null||typeof value==='string',label+' must be text');const result=String(value||'').trim();check(result.length<=max&&(!required||result),label+' is required and must be at most '+max+' characters');return result;}

// Existing dispatch workflows run against staged documents. No real writes,
// notifications or audit entries occur until the complete batch passes review.
function staging(store,batchId){
 const snapshots=new Map(),writes=new Map(),audits=[],notifications=[],pushes=[];let focused='';
 const staged=Object.create(store);
 const read=(key,fallback=null)=>{if(writes.has(key))return structuredClone(writes.get(key));if(!snapshots.has(key)){const value=structuredClone(store.read(key,fallback));snapshots.set(key,{fallback,value,serialized:JSON.stringify(value)});}return structuredClone(snapshots.get(key).value);};
 Object.defineProperties(staged,{
  read:{value:read},write:{value:(key,value)=>writes.set(key,structuredClone(value))},
  ctx:{value:{storage:{transactionSync:fn=>fn()},waitUntil:()=>{}}},
  sendPush:{value:async item=>{pushes.push(structuredClone(item));}},
  audit:{value:(username,action,detail)=>audits.push([username,action,{...detail,batchId}])},
  notify:{value:(...args)=>notifications.push(structuredClone(args))},
  ordersWithDrawingProgress:{value:()=>read('orders',[]).filter(order=>order.id===focused)}
 });
 return {store:staged,snapshots,writes,audits,notifications,pushes,focus:id=>{focused=id;}};
}
function source(store,order){
 const result={order};
 if(isPanelOrder(order)){
  result.panels=store.read('app:cncPanels',[]).filter(panel=>matchesSiteOrder(order,panel));
  result.loads=store.read('panel-dispatch-loads',[]).filter(load=>matchesSiteOrder(order,load));
  const ids=new Set(result.panels.map(panel=>panel.id));
  result.qa=store.read('qa-checks',[]).filter(record=>ids.has(record.id));
  const stock=store.panelCoatingStock();result.finishes=result.panels.map(panel=>[panel.id,panelRequiresPowderCoating(panel,stock)]);
 }else if(isGateOrder(order)){
  result.qa=store.read('qa-checks',[]).filter(record=>record.gateOrderId===order.id);
  result.settings=store.qaSettings();
 }
 return result;
}
function siteAddress(store,order){const projects=store.read('projects',[]);if(order.projectId)return projects.find(project=>project.id===order.projectId)?.address||'';const key=v=>String(v||'').trim().replace(/\s+/g,' ').toLowerCase(),matches=projects.filter(project=>key(project.name)===key(order.project));return matches.length===1?matches[0].address||'':'';}
function remainingItems(store,order){
 if(isPanelOrder(order)){
  const panels=store.read('app:cncPanels',[]),qa=migrateQaRecords(store.read('qa-checks',[])).records,stock=store.panelCoatingStock();
  return store.read('panel-dispatch-loads',[]).filter(load=>matchesSiteOrder(order,load)&&load.status!=='dispatched_to_site').flatMap(load=>panelLoadView(load,panels,qa,stock).items.filter(item=>!item.replaced).map(item=>({quantity:1,description:'Sheet '+(item.sheetNumber||'—')+' · Panel '+item.reference})));
 }
 if(order.gateComponents)return gateComponentViews(order,store.read('qa-checks',[])).filter(part=>!part.shipment).map(part=>({quantity:1,description:part.label}));
 return dispatchBalances(order).filter(item=>item.remaining>0).map(item=>({quantity:item.remaining,description:item.description}));
}
function dispatchPanelOrder(stage,order,details,actor){
 const store=stage.store,panels=store.read('app:cncPanels',[]),qa=migrateQaRecords(store.read('qa-checks',[])).records,stock=store.panelCoatingStock(),loads=store.read('panel-dispatch-loads',[]),matching=loads.filter(load=>matchesSiteOrder(order,load)),scheduled=panels.filter(panel=>matchesSiteOrder(order,panel));
 check(matching.length&&scheduled.length&&scheduled.every(panel=>matching.some(load=>load.panelIds.includes(panel.id))),'Schedule every panel before bulk dispatch',409);
 check(!store.read('orders',[]).some(other=>other.id!==order.id&&other.status!=='cancelled'&&isPanelOrder(other)&&matching.some(load=>matchesSiteOrder(other,load))),'Panel loads match more than one order; review them in Dispatch',409);
 const pending=matching.filter(load=>load.status!=='dispatched_to_site');check(pending.length,'No panel loads remain to dispatch',409);
 for(const raw of pending){
  const load=panelLoadView(raw,panels,qa,stock);check(['waiting','ready_for_site'].includes(load.status)&&load.ready&&load.readyForSite,'Complete panel routing, QA, powder coating and final QA before bulk dispatch',409);
  const body={...details,id:load.id,action:'dispatch',destinationType:'site',mutationId:crypto.randomUUID(),panelIds:load.items.filter(item=>!item.replaced).map(item=>item.id),expectedPanelIds:load.panelIds,expectedStatus:load.status,...(load.dispatchRevision?{dispatchRevision:load.dispatchRevision}:{})};
  const {sent,remainder}=splitPanelDispatch(load,body,actor,panels);check(!remainder,'Review the remaining panel load before bulk dispatch',409);
  store.write('panel-dispatch-loads',store.read('panel-dispatch-loads',[]).map(value=>value.id===sent.id?sent:value));completeDispatchedPanelOrders(store,actor,sent);
  store.audit(actor.username,'panel-load-dispatch',{loadId:sent.id,project:sent.project,orderNumber:sent.orderNumber,status:sent.status});
 }
}
function prepareOrder(stage,order,details,actor){
 const store=stage.store;stage.focus(order.id);
 check(!['cancelled','dispatched'].includes(order.status),'This order is already dispatched or cancelled',409);
 if(isPanelOrder(order))dispatchPanelOrder(stage,order,details,actor);
 else{
  if(order.status!=='completed'){
   const count=stage.notifications.length,result=store.updateOrderStatus(order.id,{status:'completed',expectedUpdatedAt:order.updatedAt||order.createdAt||''},actor);
   check(result.status===200,result.body?.error||'The order changed; review it again',409);
   // The requester receives the final dispatched update, not an intermediate alert.
   stage.notifications.length=count;
  }
  const current=store.read('orders',[]).find(value=>value.id===order.id),result=dispatchOrder(store,{...details,id:order.id,expectedUpdatedAt:current.updatedAt||current.createdAt||'',mutationId:crypto.randomUUID()},actor);
  check(result.ok,result.error||'The order changed; review it again',409);
 }
 const saved=store.read('orders',[]).find(value=>value.id===order.id);check(saved?.status==='dispatched','This order has production or QA work remaining',409);
}
export async function previewOrderDispatchBatch(store,body,actor){
 access(store,actor);const ids=selection(body.orderIds),orders=store.read('orders',[]),rows=[];
 for(const id of ids){
  const order=orders.find(value=>value.id===id);if(!order){rows.push({id,eligible:false,reason:'Order no longer exists',items:[]});continue;}
  const stage=staging(store,'preview'),original=source(stage.store,order),reviewToken=await digest(JSON.stringify(original));
  const row={id,orderNumber:order.orderNumber,project:order.project,orderType:order.orderType,status:order.status,expectedUpdatedAt:order.updatedAt||order.createdAt||'',reviewToken,destination:siteAddress(stage.store,order),items:remainingItems(stage.store,order),requiresPhoto:!!order.gateComponents&&store.qaSettings().requireDispatchPhoto===true};
  try{prepareOrder(stage,order,{destination:row.destination||'Preview destination',transport:'Preview vehicle',driver:'Preview driver',notes:'',photo:row.requiresPhoto?'data:image/png;base64,aA==':''},actor);rows.push({...row,eligible:true,reason:''});}
  catch(error){rows.push({...row,eligible:false,reason:error.message||'Review this order before dispatch'});}
 }
 return {ok:true,orders:rows,maxOrders:MAX_BULK_ORDERS,...store.dispatchDefaults()};
}
export async function dispatchOrderBatch(store,body,actor){
 access(store,actor);check(requestId(body.mutationId),'A batch request ID is required');const ids=selection(body.orders);
 const details={transport:text(body.transport,'Vehicle',300,true),driver:text(body.driver,'Driver',300,true),notes:text(body.notes,'Notes',5000),photo:String(body.photo||'')};
 check(!details.photo||details.photo.length<=300000&&/^data:image\/(jpeg|png|webp);base64,[a-zA-Z0-9+/=]+$/.test(details.photo),'Choose a smaller dispatch photo');
 const entries=body.orders.map(row=>{check(row&&typeof row==='object'&&typeof row.expectedUpdatedAt==='string'&&/^[a-f0-9]{64}$/.test(row.reviewToken||''),'Review each order before dispatch');return{id:row.id,expectedUpdatedAt:row.expectedUpdatedAt,reviewToken:row.reviewToken,destination:text(row.destination,'Site address',300,true)};});
 const signature=JSON.stringify({details,orders:entries.slice().sort((a,b)=>a.id.localeCompare(b.id))}),key='order-dispatch-batch:'+body.mutationId;
 const replay=existing=>{check(existing.by===actor.username&&existing.signature===signature,'This batch request was already used with different details',409);return{ok:true,idempotent:true,orderIds:ids,orders:store.read('orders',[]).filter(order=>ids.includes(order.id))};};
 const existing=store.read(key);if(existing)return replay(existing);
 const stage=staging(store,body.mutationId),orders=stage.store.read('orders',[]),originals=entries.map(row=>{const order=orders.find(value=>value.id===row.id);check(order,'Order no longer exists; review the batch again',409);check(!orderConflict(order,row),'An order changed; review the batch again',409);return{row,order,source:source(stage.store,order)};});
 const tokens=await Promise.all(originals.map(value=>digest(JSON.stringify(value.source))));
 originals.forEach((value,index)=>check(value.row.reviewToken===tokens[index],'Production, quantities or QA changed; review the batch again',409));
 for(const {row,order} of originals)prepareOrder(stage,order,{...details,destination:row.destination},actor);
 for(const args of stage.notifications)store.notify.apply(stage.store,args);
 let duplicate=false;
 store.ctx.storage.transactionSync(()=>{
  const concurrent=store.read(key);if(concurrent){replay(concurrent);duplicate=true;return;}
  for(const [name,snapshot] of stage.snapshots)check(JSON.stringify(store.read(name,snapshot.fallback))===snapshot.serialized,'Orders or production changed; review the batch again',409);
  for(const [name,value] of stage.writes)store.write(name,value);
  for(const args of stage.audits)store.audit(...args);
  store.write(key,{by:actor.username,at:new Date().toISOString(),signature,orderIds:ids});
  store.audit(actor.username,'order-batch-dispatched',{batchId:body.mutationId,orderIds:ids});
 });
 if(!duplicate&&stage.pushes.length)store.ctx.waitUntil(Promise.all(stage.pushes.map(item=>store.sendPush(item))));
 return {ok:true,idempotent:duplicate,orderIds:ids,orders:store.read('orders',[]).filter(order=>ids.includes(order.id))};
}
