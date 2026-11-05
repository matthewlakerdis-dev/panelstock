import {requireCondition as check} from './security.js';
const typeOf=order=>String(order.orderType||'').trim().toLowerCase();
// Drafts may be incomplete; require these details only at an explicit order save.
export function orderTypeFields(input,type,previous={}){
 const read=(key,label,max)=>{check(input[key]==null||typeof input[key]==='string',`Invalid ${label}`);const value=String(input[key]||'').trim();check(value.length<=max,`${label} must be ${max} characters or fewer`);return value;};
 const gate=typeOf({orderType:type})==='gate',panels=typeOf({orderType:type})==='panels';
 const villa=gate?read('villa','Villa / location',100):previous.villa||'',location=panels?read('location','Location',300):previous.location||'',notes=panels?read('notes','Notes',300):previous.notes||'';
 check(!gate||villa,'Villa / location is required for Gate orders');
 check(!panels||location,'Location is required for Panel orders');
 return {villa,location,notes};
}
// Preserve unsplit historical text: never guess which part was a location.
export function orderDetailRows(order){
 const rows=[];
 if(order.villa)rows.push(['Villa / location',order.villa]);
 if(order.location)rows.push(['Location',order.location]);
 if(order.notes)rows.push(['Notes',order.notes]);
 if(order.locationNotes)rows.push(['Location / notes',order.locationNotes]);
 return rows;
}
export const orderDetailText=order=>!order.villa&&!order.location&&!order.notes?String(order.locationNotes||''):orderDetailRows(order).map(([label,value])=>`${label}: ${value}`).join('\n');
