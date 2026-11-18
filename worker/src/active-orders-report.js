import {isGateType} from './order-types.js';
import dispatchProgress from '../../order-dispatch-progress.js';
import {orderStatusLabel} from './order-updates.js';
import {requireCondition as check} from './security.js';

export const ACTIVE_ORDER_STATUSES=['submitted','approved','ordered','in_stock','completed'];
const text=value=>String(value??'').trim();
const key=value=>text(value).replace(/\s+/g,' ').toLocaleLowerCase('en-AU');
const natural=new Intl.Collator('en-AU',{numeric:true,sensitivity:'base'});
const DATE_FIELDS={ordered:['Date ordered','dateOrdered'],requested:['Requested delivery','requestedDeliveryDate'],scheduled:['Scheduled delivery','scheduledDeliveryDate']};
const validDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T12:00:00Z'))&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;
function brisbaneDate(value){
  if(/^\d{4}-\d{2}-\d{2}$/.test(String(value||'')))return validDate(value)?value:'';
  if(!value||!Number.isFinite(Date.parse(value)))return '';
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Australia/Brisbane',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(value)),part=type=>parts.find(item=>item.type===type).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export function activeReportFilters(input=[]){
  check(Array.isArray(input),'Invalid report filters');
  const limits={scope:10,project:120,orderType:80,status:20,dateField:20,dateFrom:10,dateTo:10,schedule:20},result={},seen=new Set();
  for(const pair of input){
    check(Array.isArray(pair)&&pair.length===2&&typeof pair[0]==='string'&&typeof pair[1]==='string','Invalid report filters');
    const [name,value]=pair;
    check(Object.hasOwn(limits,name)&&!seen.has(name),'Unknown or repeated report filter');seen.add(name);
    check(value.length<=limits[name]&&!/[\x00-\x1f\x7f]/.test(value),'Invalid report filter value');result[name]=value.trim();
  }
  result.scope=result.scope||'all';result.status=result.status||'';result.schedule=result.schedule||'all';result.dateField=result.dateField||'requested';
  check(['all','mine'].includes(result.scope),'Choose All orders or My orders');
  check(!result.status||[...ACTIVE_ORDER_STATUSES,'part_dispatched'].includes(result.status),'Choose an active order status');
  check(['all','scheduled','unscheduled'].includes(result.schedule),'Choose a delivery schedule filter');
  check(Object.hasOwn(DATE_FIELDS,result.dateField),'Choose a report date field');
  for(const name of ['dateFrom','dateTo'])check(!result[name]||validDate(result[name]),'Choose valid report dates');
  check(!result.dateFrom||!result.dateTo||result.dateFrom<=result.dateTo,'The From date must be on or before the To date');
  return result;
}
function filterSummary(filters,actor){
  const summary=['Orders: '+(filters.scope==='mine'?'My orders ('+actor.username+')':'All active orders')];
  if(filters.project)summary.push('Project: '+filters.project);
  if(filters.orderType)summary.push('Order type: '+filters.orderType);
  if(filters.status)summary.push('Status: '+orderStatusLabel(filters.status));
  if(filters.schedule!=='all')summary.push(filters.schedule==='scheduled'?'Delivery: Scheduled':'Delivery: Not scheduled');
  if(filters.dateFrom||filters.dateTo)summary.push(DATE_FIELDS[filters.dateField][0]+': '+(filters.dateFrom||'Any date')+' to '+(filters.dateTo||'Any date')+' (inclusive, Brisbane)');
  return summary;
}

// Project directly from saved records: exporting must not migrate projects or
// modify orders, notification preferences, email jobs, stock or dispatch state.
export function activeOrdersReport(store,actor,now=new Date(),input=[]){
  store.requireTask(actor,'site.orders.view');
  const filters=activeReportFilters(input);
  const projects=store.read('projects',[]),users=store.read('users',{}),context={panels:store.read('app:cncPanels',[]),loads:store.read('panel-dispatch-loads',[])};
  const orders=store.read('orders',[]).filter(order=>{
    if(!ACTIVE_ORDER_STATUSES.includes(order.status)||filters.scope==='mine'&&order.requestedBy!==actor.username)return false;
    if(filters.project&&key(order.project)!==key(filters.project)||filters.orderType&&key(order.orderType)!==key(filters.orderType)||filters.status&&dispatchProgress.progress(order,context).status!==filters.status)return false;
    if(filters.schedule==='scheduled'&&!text(order.scheduledDeliveryDate)||filters.schedule==='unscheduled'&&text(order.scheduledDeliveryDate))return false;
    if(filters.dateFrom||filters.dateTo){
      const field=DATE_FIELDS[filters.dateField][1],date=brisbaneDate(order[field]||(field==='dateOrdered'?order.createdAt:''));
      if(!date||filters.dateFrom&&date<filters.dateFrom||filters.dateTo&&date>filters.dateTo)return false;
    }
    return true;
  }).map(order=>{
    const shipping=dispatchProgress.progress(order,context);
    const project=order.projectId?projects.find(value=>value.id===order.projectId):null;
    const matches=!order.projectId&&key(order.project)?projects.filter(value=>key(value.name)===key(order.project)):[];
    const explicitLocation=text(order.villa)||text(order.location),legacyLocation=!explicitLocation&&key(order.orderType)==='panels';
    const notes=[...new Set([order.notes,legacyLocation?'':order.locationNotes].map(text).filter(Boolean))].join('\n\n');
    const requester=text(order.requestedBy),name=text(users[requester]?.displayName);
    const adminNotes=actor.isAdmin||requester===actor.username?store.read('order-admin-notes:'+order.id,[]).map(note=>({text:text(note.text),author:text(note.author),createdAt:text(note.createdAt)})):[];
    return {
      id:order.id,orderNumber:text(order.orderNumber),project:text(order.project),projectId:text(order.projectId),
      orderType:text(order.orderType)+(key(order.orderType)==='other'&&order.orderTypeOther?' — '+text(order.orderTypeOther):''),
      status:shipping.status,statusLabel:shipping.statusLabel,dispatchProgress:{source:shipping.source,totalUnits:shipping.totalUnits,dispatchedUnits:shipping.dispatchedUnits,remainingUnits:shipping.remainingUnits},
      dateOrdered:text(order.dateOrdered||order.createdAt),requestedDeliveryDate:text(order.requestedDeliveryDate),requestedDeliveryTime:text(order.requestedDeliveryTime),
      scheduledDeliveryDate:text(order.scheduledDeliveryDate),scheduledDeliveryTime:text(order.scheduledDeliveryTime),
      locationLabel:isGateType(order.orderType)?'Villa':'Location',location:explicitLocation||(legacyLocation?text(order.locationNotes):''),
      colour:text(order.colour),areaM2:order.manualProduction?.areaM2>0?Number(order.manualProduction.areaM2):null,
      siteAddress:text((project||(matches.length===1?matches[0]:null))?.address),
      requestedBy:requester,requestedByName:name&&name!==requester?`${name} (${requester})`:requester,
      siteContact:text(order.siteContact),phone:text(order.phone),notes,adminNotes,
      items:(order.items||[]).map((item,index)=>({description:text(item.description),quantity:item.quantity,dispatched:shipping.items[index].dispatched,remaining:shipping.items[index].remaining,status:shipping.items[index].status,statusLabel:shipping.items[index].statusLabel}))
    };
  }).sort((a,b)=>natural.compare(a.project,b.project)||natural.compare(a.projectId,b.projectId)||natural.compare(a.orderNumber,b.orderNumber)||natural.compare(a.id,b.id));
  return {generatedAt:now.toISOString(),generatedBy:actor.username,filters,filterSummary:filterSummary(filters,actor),orders};
}
