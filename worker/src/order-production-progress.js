import {buildSiteOrderRows} from './site-orders-excel.js';
import {migrateQaRecords} from './qa-status.js';
import {requireCondition as check} from './security.js';

const stages=['Drawn','Toolpathed','Routed / cut','QA','Sent to PC','Final QA','Ready for dispatch'];

// Use the workbook's production rules and expose only the summary, never CAD,
// stock, dispatch contacts or QA evidence to an order viewer.
export function buildOrderProductionProgress(order,panels=[],records=[],loads=[],stock=[]){
  const row=buildSiteOrderRows([order],panels,records,loads,stock)[0];
  return {
    orderId:order.id,
    cancelled:String(order.status||'').trim().toLowerCase()==='cancelled',
    stages:stages.map(label=>({label,state:row[label]==='✓'?'complete':row[label]==='N/A'?'not_applicable':'pending'})),
    notes:row.Notes
  };
}

export function orderProductionProgress(store,id,actor){
  store.requireTask(actor,'site.orders.view');
  const order=store.ordersWithDrawingProgress().find(value=>value.id===id);
  check(order,'Order request not found',404);
  return {ok:true,progress:buildOrderProductionProgress(order,store.read('app:cncPanels',[]),
    migrateQaRecords(store.read('qa-checks',[])).records,store.read('panel-dispatch-loads',[]),store.panelCoatingStock())};
}
