import {requireCondition as check,digest} from './security.js';
import {dispatchOrder,completeDispatchedPanelOrders} from './order-dispatch.js';
import {isPanelOrder,orderConflict,nextOrderStamp} from './order-updates.js';
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
function staging(store,batchId,sharedSnapshots=null){
 const snapshots=new Map(sharedSnapshots||[]),writes=new Map(),audits=[],notifications=[],pushes=[];let focused='';
 const staged=Object.create(store);
 const liveRead=(key,fallback)=>key==='qa-checks'?store.readQaForDispatch():store.read(key,fallback);
 // Existing dispatch handlers replace order records instead of mutating them.
 // Share their immutable nested data; copying every saved order/photo on each
 // staged read multiplies memory by the batch size. Other documents stay isolated.
 const copy=(key,value)=>key==='orders'?value.slice():structuredClone(value);
 const read=(key,fallback=null)=>{if(writes.has(key))return copy(key,writes.get(key));if(!snapshots.has(key)){const value=liveRead(key,fallback);const snapshot={fallback,value,serialized:JSON.stringify(value)};snapshots.set(key,snapshot);sharedSnapshots?.set(key,snapshot);}return copy(key,snapshots.get(key).value);};
 Object.defineProperties(staged,{
  read:{value:read},write:{value:(key,value)=>{check(key!=='qa-checks','Dispatch cannot replace QA evidence');writes.set(key,copy(key,value));}},
  ctx:{value:{storage:{transactionSync:fn=>fn()},waitUntil:()=>{}}},
  sendPush:{value:async item=>{pushes.push(structuredClone(item));}},
  audit:{value:(username,action,detail)=>audits.push([username,action,{...detail,batchId}])},
  notify:{value:(...args)=>notifications.push(structuredClone(args))},
  ordersWithDrawingProgress:{value:()=>read('orders',[]).filter(order=>order.id===focused)}
 });
 return {store:staged,snapshots,writes,audits,notifications,pushes,liveRead,focus:id=>{focused=id;}};
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
  return store.read('panel-dispatch-loads',[]).filter(load=>matchesSiteOrder(order,load)&&load.status!=='dispatched_to_site').flatMap(load=>panelLoadView(load,panels,qa,stock).items.filter(item=>!item.replaced).map(item=>({panelId:item.id,quantity:1,description:'Sheet '+(item.sheetNumber||'—')+' · Panel '+item.reference})));
 }
 if(order.gateComponents)return gateComponentViews(order,store.read('qa-checks',[])).filter(part=>!part.shipment).map(part=>({componentId:part.id,quantity:1,description:part.label}));
 return dispatchBalances(order).filter(item=>item.remaining>0).map(item=>({index:item.index,quantity:item.remaining,description:item.description}));
}
function dispatchPanelOrder(stage,order,details,actor,selection={}){
 const store=stage.store,panels=store.read('app:cncPanels',[]),qa=migrateQaRecords(store.read('qa-checks',[])).records,stock=store.panelCoatingStock(),loads=store.read('panel-dispatch-loads',[]),matching=loads.filter(load=>matchesSiteOrder(order,load)),scheduled=panels.filter(panel=>matchesSiteOrder(order,panel));
 check(matching.length&&scheduled.length&&scheduled.every(panel=>matching.some(load=>load.panelIds.includes(panel.id))),'Schedule every panel before bulk dispatch',409);
 check(!store.read('orders',[]).some(other=>other.id!==order.id&&other.status!=='cancelled'&&isPanelOrder(other)&&matching.some(load=>matchesSiteOrder(other,load))),'Panel loads match more than one order; review them in Dispatch',409);
 const pending=matching.filter(load=>load.status!=='dispatched_to_site');check(pending.length,'No panel loads remain to dispatch',409);
 const available=pending.flatMap(raw=>panelLoadView(raw,panels,qa,stock).items.filter(item=>!item.replaced).map(item=>item.id));
 if(selection.panelIds)check(selection.panelIds.every(id=>available.includes(id)),'Choose panels remaining on this order',409);
 for(const raw of pending){
  const load=panelLoadView(raw,panels,qa,stock);check(['waiting','ready_for_site'].includes(load.status)&&load.ready&&load.readyForSite,'Complete panel routing, QA, powder coating and final QA before bulk dispatch',409);
  const panelIds=load.items.filter(item=>!item.replaced&&(!selection.panelIds||selection.panelIds.includes(item.id))).map(item=>item.id);if(!panelIds.length)continue;
  const body={...details,id:load.id,action:'dispatch',destinationType:'site',mutationId:crypto.randomUUID(),panelIds,expectedPanelIds:load.panelIds,expectedStatus:load.status,...(load.dispatchRevision?{dispatchRevision:load.dispatchRevision}:{})};
  const {sent,remainder}=splitPanelDispatch(load,body,actor,panels);
  store.write('panel-dispatch-loads',store.read('panel-dispatch-loads',[]).map(value=>value.id===sent.id?sent:value).concat(remainder?[remainder]:[]));completeDispatchedPanelOrders(store,actor,sent);
  store.audit(actor.username,'panel-load-dispatch',{loadId:sent.id,project:sent.project,orderNumber:sent.orderNumber,status:sent.status});
 }
}
function prepareOrder(stage,order,details,actor,selection={}){
 const store=stage.store;stage.focus(order.id);
 check(!['cancelled','dispatched'].includes(order.status),'This order is already dispatched or cancelled',409);
 const expected=isPanelOrder(order)?'panelIds':order.gateComponents?'componentIds':'lines';
 check(!Object.keys(selection).length||Object.hasOwn(selection,expected),'Delivery selection does not match the order type');
 if(isPanelOrder(order)){
  dispatchPanelOrder(stage,order,details,actor,selection);
  const orders=store.read('orders',[]),index=orders.findIndex(value=>value.id===order.id),current=orders[index];
  if(current.status!=='dispatched'){
   const now=nextOrderStamp(current);orders[index]={...current,status:'completed',completedAt:current.completedAt||now,updatedAt:now,updatedBy:actor.username};store.write('orders',orders);
   if(current.requestedBy&&current.requestedBy!==actor.username)store.notify([current.requestedBy],{title:`Order #${current.orderNumber}: part dispatched`,message:current.project+' · More panels remain to be sent',kind:'orders',priority:'important',link:'orders',orderId:current.id});
  }
 }
 else{
  if(order.status!=='completed'){
   const count=stage.notifications.length,result=store.updateOrderStatus(order.id,{status:'completed',expectedUpdatedAt:order.updatedAt||order.createdAt||''},actor);
   check(result.status===200,result.body?.error||'The order changed; review it again',409);
   // The requester receives the final dispatched update, not an intermediate alert.
   stage.notifications.length=count;
  }
  const current=store.read('orders',[]).find(value=>value.id===order.id),result=dispatchOrder(store,{...details,...selection,id:order.id,expectedUpdatedAt:current.updatedAt||current.createdAt||'',mutationId:crypto.randomUUID()},actor);
  check(result.ok,result.error||'The order changed; review it again',409);
 }
 const saved=store.read('orders',[]).find(value=>value.id===order.id);check(['completed','dispatched'].includes(saved?.status),'This order has production or QA work remaining',409);
}
export async function previewOrderDispatchBatch(store,body,actor){
 access(store,actor);const ids=selection(body.orderIds),orders=store.read('orders',[]),rows=[],sharedSnapshots=new Map([['orders',{fallback:[],value:orders,serialized:JSON.stringify(orders)}]]);
 for(const id of ids){
  const order=orders.find(value=>value.id===id);if(!order){rows.push({id,eligible:false,reason:'Order no longer exists',items:[]});continue;}
  const stage=staging(store,'preview',sharedSnapshots),original=source(stage.store,order),reviewToken=await digest(JSON.stringify(original));
  const row={id,orderNumber:order.orderNumber,project:order.project,orderType:order.orderType,status:order.status,selectionType:isPanelOrder(order)?'panelIds':order.gateComponents?'componentIds':'lines',expectedUpdatedAt:order.updatedAt||order.createdAt||'',reviewToken,destination:siteAddress(stage.store,order),items:remainingItems(stage.store,order),requiresPhoto:!!order.gateComponents&&store.qaSettings().requireDispatchPhoto===true};
  try{prepareOrder(stage,order,{destination:row.destination||'Preview destination',transport:'Preview vehicle',driver:'Preview driver',notes:'',photo:row.requiresPhoto?'data:image/png;base64,aA==':''},actor);rows.push({...row,eligible:true,reason:''});}
  catch(error){rows.push({...row,eligible:false,reason:error.message||'Review this order before dispatch'});}
 }
 return {ok:true,orders:rows,maxOrders:MAX_BULK_ORDERS,...store.dispatchDefaults()};
}
function deliverySelection(row){
 const fields=['lines','componentIds','panelIds'].filter(key=>Object.hasOwn(row,key));check(fields.length<=1,'Choose one delivery selection per order');if(!fields.length)return {};
 const key=fields[0],values=row[key];check(Array.isArray(values)&&values.length>0&&values.length<=300,'Choose between 1 and 300 delivery items');
 if(key==='lines'){
  check(values.every(line=>line&&Number.isInteger(line.index)&&line.index>=0&&typeof line.quantity==='number'&&Number.isFinite(line.quantity)&&line.quantity>0),'Enter valid delivery quantities');
  check(new Set(values.map(line=>line.index)).size===values.length,'Choose each item once');return {lines:values.map(({index,quantity})=>({index,quantity})).sort((a,b)=>a.index-b.index)};
 }
 check(values.every(id=>typeof id==='string'&&id.length>0&&id.length<=200)&&new Set(values).size===values.length,'Choose each delivery item once');return {[key]:values.slice().sort()};
}
function dispatchBatchRequest(body){
 check(requestId(body.mutationId),'A batch request ID is required');const ids=selection(body.orders);
 const details={transport:text(body.transport,'Vehicle',300,true),driver:text(body.driver,'Driver',300,true),notes:text(body.notes,'Notes',5000),photo:String(body.photo||'')};
 check(!details.photo||details.photo.length<=300000&&/^data:image\/(jpeg|png|webp);base64,[a-zA-Z0-9+/=]+$/.test(details.photo),'Choose a smaller dispatch photo');
 const entries=body.orders.map(row=>{check(row&&typeof row==='object'&&typeof row.expectedUpdatedAt==='string'&&/^[a-f0-9]{64}$/.test(row.reviewToken||''),'Review each order before dispatch');return{id:row.id,expectedUpdatedAt:row.expectedUpdatedAt,reviewToken:row.reviewToken,destination:text(row.destination,'Site address',300,true),...deliverySelection(row)};});
 const signature=JSON.stringify({details,orders:entries.slice().sort((a,b)=>a.id.localeCompare(b.id))}),key='order-dispatch-batch:'+body.mutationId;
 return {ids,details,entries,signature,key};
}
function dispatchBatchReplay(store,actor,existing,{signature,ids}){check(existing.by===actor.username&&existing.signature===signature,'This batch request was already used with different details',409);return{ok:true,idempotent:true,orderIds:ids,partialOrderIds:existing.partialOrderIds||[],orders:store.read('orders',[]).filter(order=>ids.includes(order.id))};}
export function dispatchOrderBatchStatus(store,body,actor){access(store,actor);const request=dispatchBatchRequest(body),existing=store.read(request.key);return existing?{state:'committed',result:dispatchBatchReplay(store,actor,existing,request)}:{state:'unknown'};}
export async function dispatchOrderBatch(store,body,actor){
 access(store,actor);const request=dispatchBatchRequest(body),{ids,details,entries,signature,key}=request,replay=existing=>dispatchBatchReplay(store,actor,existing,request);
 const existing=store.read(key);if(existing)return replay(existing);
 const stage=staging(store,body.mutationId),orders=stage.store.read('orders',[]),originals=entries.map(row=>{const order=orders.find(value=>value.id===row.id);check(order,'Order no longer exists; review the batch again',409);check(!orderConflict(order,row),'An order changed; review the batch again',409);return{row,order,source:source(stage.store,order)};});
 const tokens=await Promise.all(originals.map(value=>digest(JSON.stringify(value.source))));
 originals.forEach((value,index)=>check(value.row.reviewToken===tokens[index],'Production, quantities or QA changed; review the batch again',409));
 for(const {row,order} of originals)prepareOrder(stage,order,{...details,destination:row.destination},actor,deliverySelection(row));
 const partialOrderIds=stage.store.read('orders',[]).filter(order=>ids.includes(order.id)&&order.status!=='dispatched').map(order=>order.id);
 for(const args of stage.notifications)store.notify.apply(stage.store,args);
 let duplicate=false;
 store.ctx.storage.transactionSync(()=>{
  const concurrent=store.read(key);if(concurrent){replay(concurrent);duplicate=true;return;}
  for(const [name,snapshot] of stage.snapshots)check(JSON.stringify(stage.liveRead(name,snapshot.fallback))===snapshot.serialized,'Orders or production changed; review the batch again',409);
  for(const [name,value] of stage.writes)store.write(name,value);
  for(const args of stage.audits)store.audit(...args);
  store.write(key,{by:actor.username,at:new Date().toISOString(),signature,orderIds:ids,partialOrderIds});
  store.audit(actor.username,'order-batch-dispatched',{batchId:body.mutationId,orderIds:ids});
 });
 if(!duplicate&&stage.pushes.length)store.ctx.waitUntil(Promise.all(stage.pushes.map(item=>store.sendPush(item))));
 return {ok:true,idempotent:duplicate,orderIds:ids,partialOrderIds,orders:store.read('orders',[]).filter(order=>ids.includes(order.id))};
}
