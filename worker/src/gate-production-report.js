import {isGateOrder,gateProductionStages} from './gate-order-progress.js';
// One total area per QA-complete order; dispatch retains its fabrication date.
export function gateProductionReportRows(orders){
 return orders.filter(order=>isGateOrder(order)&&['completed','dispatched'].includes(order.status)&&gateProductionStages(order).drawn==='complete'&&gateProductionStages(order).fabricatedQa==='complete'&&order.completedAt)
  .map(order=>({id:order.id,completedAt:order.completedAt,areaM2:order.manualProduction?.areaM2}));
}
