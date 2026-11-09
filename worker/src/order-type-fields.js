import {isGateType} from './order-types.js';
import {requireCondition as check} from './security.js';
const typeOf=order=>String(order.orderType||'').trim().toLowerCase();
// Drafts may be incomplete; require these details only at an explicit order save.
export function orderTypeFields(input,type,previous={}){
 const read=(key,label,max)=>{check(input[key]==null||typeof input[key]==='string',`Invalid ${label}`);const value=String(input[key]||'').trim();check(value.length<=max,`${label} must be ${max} characters or fewer`);return value;};
 const gate=isGateType(type),panels=typeOf({orderType:type})==='panels';
 const villa=gate?read('villa','Villa',100):previous.villa||'',location=panels?read('location','Location',300):previous.location||'',notes=input.notes===undefined?previous.notes||'':read('notes','Notes',300);
 check(!gate||villa,'Villa is required for Gate orders');
 const colour=gate?(input.colour===undefined?previous.colour||'':read('colour','Colour',40)):previous.colour||'';
 check(!gate||['Spruce','Norwegian Beech'].includes(colour)||isGateType(previous.orderType)&&typeOf(previous)===typeOf({orderType:type})&&!previous.colour&&!colour,'Choose a Colour for Gate orders: Spruce or Norwegian Beech');
 check(!panels||location,'Location is required for Panel orders');
 return {villa,location,notes,...(gate||colour?{colour}:{})};
}
export function gateColourItems(items,colour){
 check(['Spruce','Norwegian Beech'].includes(colour),'Choose a Colour for Gate orders: Spruce or Norwegian Beech');
 return items.map(item=>{const base=String(item.description||'').trim().replace(/(?:^|\s+)-\s+(SPRUCE|NORWEGIAN BEECH)$/i,'').trim();check(base,'Enter a Gate item description');const description=base.toUpperCase()+' - '+colour.toUpperCase();check(description.length<=180,'Gate item description including colour must be 180 characters or fewer');return {...item,description};});
}
// Preserve unsplit historical text: never guess which part was a location.
export function orderDetailRows(order){
 const rows=[];
 if(order.villa)rows.push(['Villa',order.villa]);
 if(order.location)rows.push(['Location',order.location]);
 for(const notes of new Set([order.notes,order.locationNotes].filter(Boolean)))rows.push(['Notes',notes]);
 return rows;
}
export const orderDetailText=order=>!order.villa&&!order.location&&!order.notes?String(order.locationNotes||''):orderDetailRows(order).map(([label,value])=>`${label}: ${value}`).join('\n');
