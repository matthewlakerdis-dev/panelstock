import {isGateType} from './order-types.js';
import {orderStatusLabel} from './order-updates.js';

export const ACTIVE_ORDER_STATUSES=['submitted','approved','ordered','in_stock','completed'];
const text=value=>String(value??'').trim();
const key=value=>text(value).replace(/\s+/g,' ').toLocaleLowerCase('en-AU');
const natural=new Intl.Collator('en-AU',{numeric:true,sensitivity:'base'});

// Project directly from saved records: exporting must not migrate projects or
// modify orders, notification preferences, email jobs, stock or dispatch state.
export function activeOrdersReport(store,actor,now=new Date()){
  store.requireTask(actor,'site.orders.view');
  const projects=store.read('projects',[]),users=store.read('users',{});
  const orders=store.read('orders',[]).filter(order=>ACTIVE_ORDER_STATUSES.includes(order.status)).map(order=>{
    const project=order.projectId?projects.find(value=>value.id===order.projectId):null;
    const matches=!order.projectId&&key(order.project)?projects.filter(value=>key(value.name)===key(order.project)):[];
    const explicitLocation=text(order.villa)||text(order.location),legacyLocation=!explicitLocation&&key(order.orderType)==='panels';
    const notes=[...new Set([order.notes,legacyLocation?'':order.locationNotes].map(text).filter(Boolean))].join('\n\n');
    const requester=text(order.requestedBy),name=text(users[requester]?.displayName);
    const adminNotes=actor.isAdmin||requester===actor.username?store.read('order-admin-notes:'+order.id,[]).map(note=>({text:text(note.text),author:text(note.author),createdAt:text(note.createdAt)})):[];
    return {
      id:order.id,orderNumber:text(order.orderNumber),project:text(order.project),projectId:text(order.projectId),
      orderType:text(order.orderType)+(key(order.orderType)==='other'&&order.orderTypeOther?' — '+text(order.orderTypeOther):''),
      status:order.status,statusLabel:orderStatusLabel(order.status),
      dateOrdered:text(order.dateOrdered||order.createdAt),requestedDeliveryDate:text(order.requestedDeliveryDate),requestedDeliveryTime:text(order.requestedDeliveryTime),
      scheduledDeliveryDate:text(order.scheduledDeliveryDate),scheduledDeliveryTime:text(order.scheduledDeliveryTime),
      locationLabel:isGateType(order.orderType)?'Villa':'Location',location:explicitLocation||(legacyLocation?text(order.locationNotes):''),
      colour:text(order.colour),areaM2:order.manualProduction?.areaM2>0?Number(order.manualProduction.areaM2):null,
      siteAddress:text((project||(matches.length===1?matches[0]:null))?.address),
      requestedBy:requester,requestedByName:name&&name!==requester?`${name} (${requester})`:requester,
      siteContact:text(order.siteContact),phone:text(order.phone),notes,adminNotes,
      items:(order.items||[]).map(item=>({description:text(item.description),quantity:item.quantity}))
    };
  }).sort((a,b)=>natural.compare(a.project,b.project)||natural.compare(a.projectId,b.projectId)||natural.compare(a.orderNumber,b.orderNumber)||natural.compare(a.id,b.id));
  return {generatedAt:now.toISOString(),generatedBy:actor.username,orders};
}
