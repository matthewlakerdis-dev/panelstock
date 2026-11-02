import {requireCondition as check} from './security.js';
import {isPanelOrder,orderConflict,nextOrderStamp} from './order-updates.js';
import {selectOrderType,otherOrderType} from './order-types.js';
import {matchesSiteOrder} from './site-orders-excel.js';

// Correct a mistaken Panels classification without opening the general panel editor.
export function correctOrderType(store,id,body,actor){
  check(actor.isAdmin===true,'Admin access required',403);
  const orders=store.read('orders',[]),index=orders.findIndex(order=>order.id===id);
  check(index>=0,'Order request not found',404);
  const previous=orders[index],conflict=orderConflict(previous,body);if(conflict)return conflict;
  check(isPanelOrder(previous),'Only incorrectly classified Panel orders can be corrected here',409);
  check(!['completed','dispatched','cancelled'].includes(previous.status),'Ready, dispatched or cancelled orders cannot have their type corrected',409);
  check(typeof body.orderType==='string'&&body.orderType.trim(),'Choose the correct order type');
  const type=selectOrderType(store,body.orderType),detail=otherOrderType(body.orderTypeOther,type);
  check(!isPanelOrder({orderType:type}),'Choose a non-panel order type');
  const matches=item=>matchesSiteOrder(previous,item);
  const linkedCad=store.orderDrawingProjects().some(project=>{
    const d=project.drawingProgress;
    return d&&matches({projectId:d.projectId,project:d.projectName,orderNumber:d.orderNumber});
  });
  const linkedProduction=['app:cncPanels','panel-dispatch-loads','qa-checks'].some(key=>store.read(key,[]).some(item=>item.gateOrderId===id||matches(item)));
  check(!linkedCad&&!linkedProduction&&previous.manualDrawing?.drawn!==true&&!previous.manualProduction,
    'This order has linked drawings or factory production. Resolve those links before correcting its type.',409);
  const current={...previous,orderType:type,orderTypeOther:detail,updatedAt:nextOrderStamp(previous),updatedBy:actor.username};
  orders[index]=current;
  store.ctx.storage.transactionSync(()=>{
    store.write('orders',orders);
    store.audit(actor.username,'order-type-changed',{orderId:id,orderNumber:current.orderNumber,
      previousOrderType:previous.orderType,previousOrderTypeOther:previous.orderTypeOther||'',orderType:type,orderTypeOther:detail});
  });
  return {ok:true,order:current};
}
