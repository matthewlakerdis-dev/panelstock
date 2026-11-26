import {requireCondition as check} from './security.js';
export function fullOrderFileAccess(order,actor){return actor.isAdmin===true||actor.tasks?.['site.orders.manage']===true||order.requestedBy===actor.username&&actor.tasks?.['site.orders.create']===true;}
export const panelPdfAccess=order=>String(order.orderType||'').trim().toLowerCase()==='panels';
// View access is checked by both callers. Non-owners gain PDF-only access to Panels.
export function requireOrderFileAccess(store,order,actor,action='add attachments'){
 if(fullOrderFileAccess(order,actor))return false;
 if(panelPdfAccess(order))return true;
 check(order.requestedBy===actor.username,'Only the requester or an order manager can '+action,403);
 store.requireTask(actor,'site.orders.create');return false;
}
