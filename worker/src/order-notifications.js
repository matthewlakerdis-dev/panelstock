import {buildSiteOrderRows} from './site-orders-excel.js';
import {migrateQaRecords} from './qa-status.js';

// Optional metadata keeps older clients' Orders fallback and avoids URL routing.
export function notificationOrderId(kind,id){
  return kind==='orders'&&typeof id==='string'&&/^[a-zA-Z0-9-]{16,100}$/.test(id)?id:'';
}

// Snapshot the same whole-order readiness used by progress and Excel. Reads and
// polling never send alerts; callers compare before/after an explicit QA action.
export function readyOrderIds(store){
  const orders=store.read('orders',[]);
  const panels=store.read('app:cncPanels',[]),records=migrateQaRecords(store.read('qa-checks',[])).records,
    loads=store.read('panel-dispatch-loads',[]),stock=store.panelCoatingStock();
  return new Set(orders.filter(order=>buildSiteOrderRows([order],panels,records,loads,stock)[0]['Ready for dispatch']==='✓').map(order=>order.id));
}

export function notifyReadyOrders(store,before,actor){
  const ready=readyOrderIds(store);
  for(const order of store.read('orders',[])){
    if(!ready.has(order.id)||before.has(order.id)||!order.requestedBy||order.requestedBy===actor.username)continue;
    store.notify([order.requestedBy],{title:`Order #${order.orderNumber}: ready for dispatch`,
      message:`${order.project} · Production QA and any required powder coating and final QA are complete.`,
      kind:'orders',priority:'important',link:'orders',orderId:order.id});
  }
}
