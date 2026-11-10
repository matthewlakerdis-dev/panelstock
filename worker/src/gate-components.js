import {gateProductionStages} from './gate-order-progress.js';
import {requireCondition as check} from './security.js';
import {orderConflict,nextOrderStamp,notifyOrderChange} from './order-updates.js';
import {orderCompletionStamp} from './order-history.js';
import {isGateType} from './order-types.js';
import {currentGateQaRecord} from './gate-order-qa.js';
const text=(value,max=300)=>{check(value==null||typeof value==='string','Enter text for the delivery details');const result=String(value||'').trim();check(result.length<=max,'Delivery details are too long');return result;};
const requestId=value=>typeof value==='string'&&/^[a-zA-Z0-9-]{16,100}$/.test(value);
export function gateComponentSpec(orderType,spec){
 check(isGateType(orderType),'Choose a Gate order');
 check(spec&&typeof spec==='object'&&!Array.isArray(spec),'Choose the gate components');
 const buggy=String(orderType).trim().toLowerCase()==='buggy gate';let sets;
 if(Object.hasOwn(spec,'sets')){
  check(!Object.hasOwn(spec,'highlights')&&!Object.hasOwn(spec,'gateCount'),'Use one component layout');
  check(Array.isArray(spec.sets)&&spec.sets.length>=1&&spec.sets.length<=(buggy?1:2),'Choose a valid number of sets');
  sets=spec.sets.map(set=>{
   check(set&&typeof set==='object'&&!Array.isArray(set)&&Object.keys(set).every(key=>['gates','highlights','posts'].includes(key)),'Choose gates, highlights and posts for each set');
   const counts={gates:set.gates,highlights:set.highlights,posts:set.posts};
   check(Object.values(counts).every(value=>Number.isInteger(value)&&value>=0&&value<=4),'Use between zero and four of each component');
   check(Object.values(counts).some(value=>value>0),'Each set needs at least one component');return counts;
  });
  if(buggy){
   check([1,2].includes(sets[0].gates),'Choose one or two buggy gates');
   check(sets[0].highlights===0&&sets[0].posts===0,'Buggy gates cannot include highlights or posts');
  }
 }else if(buggy){
  check([1,2].includes(spec.gateCount),'Choose one or two buggy gates');sets=[{gates:spec.gateCount,highlights:0,posts:0}];
 }else{
  check(Array.isArray(spec.highlights)&&[1,2].includes(spec.highlights.length)&&spec.highlights.every(n=>[1,2].includes(n)),'Choose one or two sets, with one or two highlights in each');
  sets=spec.highlights.map(highlights=>({gates:1,highlights,posts:1}));
 }
 return {sets};
}
export function gateComponentSlots(orderType,input){
 const {sets}=gateComponentSpec(orderType,input),buggy=String(orderType).trim().toLowerCase()==='buggy gate',slots=[];
 sets.forEach((counts,index)=>{
  const set=index+1;
  for(const [field,kind]of [['highlights','Highlight'],['gates','Gate'],['posts','Post']])for(let i=1;i<=counts[field];i++){
   // Retain the keys of existing parts so editing counts never copies an approval to a different part.
   const key=buggy&&kind==='Gate'?'gate-'+i:'set-'+set+'-'+kind.toLowerCase()+(kind==='Highlight'||i>1?'-'+i:'');
   slots.push({key,set,kind,label:kind+' '+String(i).padStart(2,'0')});
  }
 });return slots;
}
export function gateComponentViews(order,records){
 const model=order.gateComponents;if(!model)return [];
 const drawn=gateProductionStages(order).drawn==='complete';
 return model.components.map(component=>{
  const qa=records.find(record=>record.gateComponentId===component.id&&currentGateQaRecord(order,record));
  const shipment=(model.shipments||[]).find(load=>load.componentIds.includes(component.id));
  const delivery=(model.deliveries||[]).find(receipt=>receipt.componentIds.includes(component.id));
  return {...component,drawn,qaId:qa?.id||'',qaStatus:qa?.status||'awaiting',checkedBy:qa?.latest?.checkedBy||'',checkedAt:qa?.latest?.checkedAt||'',qaHistory:qa?.history||[],ready:qa?.status==='approved'&&!shipment,shipment:shipment?{id:shipment.id,at:shipment.at,by:shipment.by,destination:shipment.destination,transport:shipment.transport,driver:shipment.driver,notes:shipment.notes}:null,delivery:delivery?{id:delivery.id,at:delivery.at,by:delivery.by,receivedBy:delivery.receivedBy,notes:delivery.notes}:null};
 });
}
export function gateComponentOrders(orders,records,schedule=[]){
 const booked=new Set(schedule.filter(entry=>entry.orderId&&String(entry.assignedUsername||'').trim()&&['general','cnc'].includes(entry.scheduleType||'general')&&entry.status!=='cancelled').map(entry=>entry.orderId));
 return orders.filter(order=>isGateType(order.orderType)&&order.status!=='cancelled').map(order=>{
  const components=gateComponentViews(order,records),summary={total:components.length,qa:components.filter(c=>c.qaStatus==='approved').length,dispatched:components.filter(c=>c.shipment).length,delivered:components.filter(c=>c.delivery).length};
  return {id:order.id,project:order.project,villa:order.villa||order.location||'',orderNumber:order.orderNumber,orderType:order.orderType,colour:order.colour||'',status:order.status,drawn:gateProductionStages(order).drawn==='complete',scheduledForProduction:booked.has(order.id),requestedBy:order.requestedBy,updatedAt:order.updatedAt||order.createdAt||'',areaM2:order.manualProduction?.areaM2??null,spec:order.gateComponents?.spec||null,legacyQa:!order.gateComponents&&!!order.manualProduction?.qaWorkflowVersion,legacyStages:!order.gateComponents?Object.fromEntries(Object.entries(gateProductionStages(order)).map(([key,value])=>[key,value==='complete'])):null,hasRecordedQa:!order.gateComponents&&records.some(record=>record.gateOrderId===order.id&&(record.history?.length||record.latest)),previousQa:records.filter(record=>order.gateComponents?.previousQaItemIds?.includes(record.id)||record.gateOrderId===order.id&&(!order.gateComponents||!currentGateQaRecord(order,record))&&(record.history?.length||record.latest||record.status==='approved')),components,summary};
 });
}
function commit(store,orders,index,previous,current,actor,action,detail,records){
 store.ctx.storage.transactionSync(()=>{orders[index]=current;store.write('orders',orders);if(records)store.write('qa-checks',records);notifyOrderChange(store,previous,current,actor);store.audit(actor.username,action,{orderId:current.id,orderNumber:current.orderNumber,...detail});});
 return {ok:true,order:gateComponentOrders([current],records||store.read('qa-checks',[]),store.read('schedule',[]))[0]};
}
function savePlan(store,id,body,actor){
 store.requireTask(actor,'site.orders.manage');
 const orders=store.read('orders',[]),index=orders.findIndex(order=>order.id===id),previous=orders[index];check(previous&&isGateType(previous.orderType),'Gate order not found',404);check(!['cancelled','dispatched'].includes(previous.status),'This Gate order is closed',409);
 const conflict=orderConflict(previous,body);if(conflict)return conflict;
 check(body.drawn===undefined||typeof body.drawn==='boolean','Choose Drawn or Undrawn');
 const drawn=body.drawn!==false;
 check(drawn||!previous.gateComponents?.shipments?.length&&!previous.gateComponents?.deliveries?.length,'Dispatched components prevent resetting Drawn',409);
 const areaInput=body.areaM2===undefined?previous.manualProduction?.areaM2:body.areaM2;
 check(areaInput==null||['number','string'].includes(typeof areaInput),'Enter the total order area in m²');
 const spec=gateComponentSpec(previous.orderType,body.spec),slots=gateComponentSlots(previous.orderType,spec),areaM2=areaInput==null||String(areaInput).trim()===''?null:Number(areaInput);
 check(areaM2===null||Number.isFinite(areaM2)&&areaM2>0&&areaM2<=99999,'Enter the total order area in m²');
 check(!drawn||areaM2!==null,'Enter the total order area in m² when marking Drawn');
 const records=store.read('qa-checks',[]),old=previous.gateComponents;
 const previousQa=!old?records.filter(record=>record.gateOrderId===id&&(record.history?.length||record.latest||record.status==='approved')):[];
 if(!old){check(!previous.receipts?.length,'A Gate with recorded delivery must retain its current production history',409);check(!previousQa.length||body.confirmLegacyQa===true,'Review the earlier QA reports and confirm that the new components need their own QA',409);}
 const components=slots.map(slot=>({...slot,id:old?.components.find(c=>c.key===slot.key)?.id||crypto.randomUUID()}));
 for(const removed of old?.components.filter(c=>!components.some(next=>next.id===c.id))||[]){check(!records.some(r=>r.gateComponentId===removed.id&&(r.history?.length||r.latest||r.status==='approved'))&&!(old.shipments||[]).some(s=>s.componentIds.includes(removed.id)),'A component with QA or delivery history cannot be removed',409);}
 const wasDrawn=gateProductionStages(previous).drawn==='complete',continuing=!!old&&previous.manualProduction?.qaWorkflowVersion===1&&wasDrawn;
 const now=nextOrderStamp(previous),revision=drawn?(continuing&&previous.manualProduction?.qaRevision||crypto.randomUUID()):null,qaIds=[];
 if(drawn)for(const component of components){let record=continuing&&records.find(r=>r.gateComponentId===component.id&&currentGateQaRecord(previous,r));if(!record){record={id:crypto.randomUUID(),kind:'metalwork',gateOrderId:id,gateRevision:revision,gateComponentId:component.id,gateSet:component.set,project:previous.project,orderNumber:previous.orderNumber,reference:`${previous.villa||''} · Set ${component.set} · ${component.label}`,quantity:1,drawnBy:actor.username,createdBy:actor.username,createdAt:now,status:'awaiting',latest:null,history:[]};records.unshift(record);}qaIds.push(record.id);}
 const previousQaItemIds=[...new Set([...(old?.previousQaItemIds||[]),...previousQa.map(record=>record.id),...records.filter(record=>record.gateOrderId===id&&!qaIds.includes(record.id)&&(record.history?.length||record.latest||record.status==='approved')).map(record=>record.id)])];
 const approved=drawn&&qaIds.length>0&&qaIds.every(id=>records.find(r=>r.id===id)?.status==='approved'),status=approved?'completed':previous.status==='completed'?(previous.manualProduction?.statusBeforeReady||'approved'):previous.status;
 const current={...previous,gateComponents:{version:2,spec,components,previousQaItemIds,shipments:old?.shipments||[],deliveries:old?.deliveries||[],configuredAt:now,configuredBy:actor.username},manualProduction:{...previous.manualProduction,qaWorkflowVersion:1,qaRevision:revision,qaItemIds:qaIds,areaM2,drawnAt:drawn?(wasDrawn&&previous.manualProduction?.drawnAt||now):null,drawnBy:drawn?(wasDrawn&&previous.manualProduction?.drawnBy||actor.username):'',updatedAt:now,updatedBy:actor.username,statusBeforeReady:previous.manualProduction?.statusBeforeReady||(previous.status==='completed'?'approved':previous.status),stages:{drawn:drawn?'complete':'pending',fabricatedQa:approved?'complete':'pending',readyForDispatch:approved?'complete':'pending'}},status,completedAt:orderCompletionStamp(previous,status,now),updatedAt:now,updatedBy:actor.username};
 return commit(store,orders,index,previous,current,actor,'gate-components-confirmed',{componentCount:components.length,areaM2,drawn},records);
}
function moveComponents(store,id,action,body,actor){
 if(action==='dispatch')store.requireTask(actor,'factory.dispatch');else store.requireTask(actor,'site.orders.view');
 const orders=store.read('orders',[]),index=orders.findIndex(o=>o.id===id),previous=orders[index];check(previous?.gateComponents&&previous.status!=='cancelled','Configured Gate order not found',404);
 if(action==='delivery')check(actor.isAdmin||actor.tasks?.['site.orders.manage']||previous.requestedBy===actor.username,'Only the requester or an order manager can confirm delivery',403);
 check(requestId(body.mutationId),'A request identifier is required');check(Array.isArray(body.componentIds)&&body.componentIds.length>0&&body.componentIds.length<=24&&new Set(body.componentIds).size===body.componentIds.length,'Select individual components once');
 const ids=[...body.componentIds].sort(),details=action==='dispatch'?{destination:text(body.destination),transport:text(body.transport),driver:text(body.driver),notes:text(body.notes,5000)}:{receivedBy:text(body.receivedBy,100),notes:text(body.notes,5000)};
 if(action==='dispatch'){check(details.destination&&details.transport&&details.driver,'Enter destination, vehicle and driver');const photo=String(body.photo||'');check(!photo||(/^data:image\/(jpeg|png|webp);base64,[a-zA-Z0-9+/=]+$/.test(photo)&&photo.length<=1500000),'Dispatch photo must be an image under 1 MB');check(!store.qaSettings().requireDispatchPhoto||photo,'Add a dispatch photo');details.photo=photo;}else check(details.receivedBy,'Enter who received the delivery');
 const field=action==='dispatch'?'shipments':'deliveries',existing=previous.gateComponents[field].find(item=>item.id===body.mutationId),fingerprint=JSON.stringify({ids,details:{...details,photo:undefined}});
 if(existing){check(existing.by===actor.username&&existing.fingerprint===fingerprint&&(existing.photo||'')===(details.photo||''),'This request identifier was already used with different details',409);return {ok:true,duplicate:true,order:gateComponentOrders([previous],store.read('qa-checks',[]),store.read('schedule',[]))[0]};}
 const conflict=orderConflict(previous,body);if(conflict)return conflict;
 const views=gateComponentViews(previous,store.read('qa-checks',[]));
 for(const id of ids){const component=views.find(c=>c.id===id);check(component,'Component not found',404);if(action==='dispatch')check(component.ready,'Only QA-approved, undispatched components may be dispatched',409);else check(component.shipment&&!component.delivery,'Only dispatched, unreceived components may be marked delivered',409);}
 const now=nextOrderStamp(previous),entry={id:body.mutationId,componentIds:ids,...details,by:actor.username,at:now,fingerprint,...(action==='dispatch'?{qaApprovals:ids.map(id=>{const c=views.find(c=>c.id===id);return {componentId:id,qaId:c.qaId,checkedAt:c.checkedAt};})}:{})};
 const model={...previous.gateComponents,[field]:[...previous.gateComponents[field],entry]},allSent=model.components.every(c=>model.shipments.some(s=>s.componentIds.includes(c.id))),status=allSent?'dispatched':previous.status;
 const current={...previous,gateComponents:model,status,updatedAt:now,updatedBy:actor.username,...(action==='dispatch'&&allSent?{dispatchedAt:previous.dispatchedAt||now,dispatchedBy:previous.dispatchedBy||actor.username,dispatch:{...details,mutationId:body.mutationId,by:actor.username,at:now,source:'gate-components',componentIds:model.shipments.flatMap(load=>load.componentIds)}}:{})};
 return commit(store,orders,index,previous,current,actor,'gate-components-'+action,{componentIds:ids,status,...details,photo:undefined});
}
export function handleGateComponents(store,path,method,body,actor){
 check(store.env.GATE_COMPONENTS_ENABLED==='true','Not found',404);
 if(path==='/gate-components'&&method==='GET'){store.requireTask(actor,'site.orders.view');return {ok:true,staging:store.env.SITE_ID!=='panelstock',orders:gateComponentOrders(store.read('orders',[]),store.read('qa-checks',[]),store.read('schedule',[])),checklist:store.qaChecklists().gate,canManage:actor.isAdmin||actor.tasks?.['site.orders.manage']===true,canCreate:actor.isAdmin||actor.tasks?.['site.orders.create']===true,canQa:actor.isAdmin||actor.tasks?.['factory.qa']===true,canDispatch:actor.isAdmin||actor.tasks?.['factory.dispatch']===true,username:actor.username};}
 const match=path.match(/^\/gate-components\/orders\/([a-f0-9-]{36})\/(plan|dispatch|delivery)$/i);check(match&&method==='POST','Not found',404);
 return match[2]==='plan'?savePlan(store,match[1],body,actor):moveComponents(store,match[1],match[2],body,actor);
}
