import {dispatchOrders} from './order-dispatch.js';
import {isPanelOrder} from './order-updates.js';
import {matchesSiteOrder} from './site-orders-excel.js';

// A panel load is the dispatchable unit. Never add its parent order a second
// time, or let the order endpoint bypass routing, coating or QA.
export function dispatchQueue(store,actor){
  store.requireTask(actor,'factory.dispatch');
  const allOrders=store.read('orders',[]),loads=store.panelDispatchLoads(actor).filter(load=>{const related=allOrders.filter(order=>isPanelOrder(order)&&matchesSiteOrder(order,load));return !related.length||related.some(order=>order.status!=='cancelled');}),orders=dispatchOrders(store,actor,{includeWaiting:true});
  const entries=loads.map(load=>{
    const order=orders.find(order=>order.usesPanelLoads&&matchesSiteOrder(order,load));
    const status=load.status==='dispatched_to_site'?'dispatched':load.status==='at_powder_coaters'?'coating':load.status==='awaiting_final_qa'?'waiting':load.ready?'ready':'waiting';
    const reason=load.status==='awaiting_final_qa'?'Awaiting final QA':status==='coating'?'At powder coaters':status==='dispatched'?'Dispatched to site':load.ready?(load.requiresPowderCoating&&load.status==='waiting'?'Ready for powder coaters':'Ready for site'):
      'Waiting for '+[!load.routing&&'routing',!load.qaComplete&&'fabrication / QA'].filter(Boolean).join(' and ');
    return {key:'load:'+load.id,kind:'load',project:load.project,orderNumber:load.orderNumber,orderType:'Panels',status,reason,ready:status==='ready',destination:status==='ready'?(load.requiresPowderCoating&&load.status==='waiting'?'Powder coater to be selected':load.siteAddress||order?.siteAddress||''):load.legs?.at(-1)?.destination||load.siteAddress||order?.siteAddress||'',createdAt:load.createdAt||order?.createdAt||'',order:order||null,load};
  });
  for(const order of orders){
    if(order.usesPanelLoads&&loads.some(load=>matchesSiteOrder(order,load)))continue;
    for(const trip of order.dispatches||[])entries.push({key:'delivery:'+order.id+':'+trip.mutationId,kind:'order',project:order.project,orderNumber:order.orderNumber,orderType:order.orderType||'Other',status:'dispatched',reason:'Delivery dispatched',ready:false,destination:trip.destination||'',createdAt:trip.at||'',order:{...order,dispatchItems:undefined,dispatchComponents:undefined,items:trip.lines||[],dispatch:trip,dispatchedAt:trip.at,dispatchedBy:trip.by,dispatches:[trip]}});
    if(order.status==='dispatched'&&order.dispatches?.length)continue;
    const status=order.status==='dispatched'?'dispatched':!order.usesPanelLoads&&order.ready?'ready':'waiting';
    entries.push({key:'order:'+order.id,kind:'order',project:order.project,orderNumber:order.orderNumber,orderType:order.orderType==='Other'?(order.orderTypeOther||'Other'):(order.orderType||'Other'),status,reason:status==='dispatched'?'Dispatched to site':status==='ready'?(order.dispatches?.length?'Part dispatched · Balance ready':'Ready for site'):order.usesPanelLoads?'Waiting for panel scheduling':'Waiting for production / approval',ready:status==='ready',destination:order.dispatch?.destination||order.siteAddress||'',createdAt:order.createdAt||'',order});
  }
  const dispatchedTime=entry=>Math.max(0,...(entry.kind==='load'?(entry.load.legs||[]).filter(leg=>leg.destinationType==='site').map(leg=>leg.at):[entry.order.dispatch?.at,entry.order.dispatchedAt]).map(value=>Date.parse(value)).filter(Number.isFinite));
  const priority={ready:0,waiting:1,coating:2,dispatched:3};
  return entries.sort((a,b)=>priority[a.status]-priority[b.status]||(a.status==='dispatched'&&b.status==='dispatched'?dispatchedTime(b)-dispatchedTime(a):0)||String(b.createdAt).localeCompare(String(a.createdAt))||a.key.localeCompare(b.key));
}
