import UPNGModule from '@pdf-lib/upng';
const UPNG=UPNGModule.default||UPNGModule;
import {createHash} from 'node:crypto';
import {requireCondition as check} from './security.js';
export const receiptSignatureKey=(orderId,receiptId)=>'order-receipt-signature:'+orderId+':'+receiptId;
export const canRecordReceipt=(actor,order)=>actor.isAdmin||actor.tasks?.['site.orders.manage']===true||(actor.tasks?.['site.orders.create']===true&&order.requestedBy===actor.username);
export function signedReceiptRecord(order,receipt,input){
 check(input&&typeof input==='object','Recipient name and signature are required. Refresh Site Orders if the signature field is missing.');
 const name=typeof input.name==='string'?input.name.trim().replace(/\s+/g,' '):'';
 check(name.length>0&&name.length<=120&&!/[\u0000-\u001f\u007f]/.test(name),'Enter the recipient name (up to 120 characters)');
 const image=input.image;check(typeof image==='string'&&image.length<=150000&&/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(image),'Draw the recipient signature (PNG under 110 KB)');
 let ink=0;
 try{
  const raw=Uint8Array.from(atob(image.split(',')[1]),c=>c.charCodeAt(0));
  check(raw.length>=33&&raw.slice(0,8).every((v,i)=>v===[137,80,78,71,13,10,26,10][i]),'Invalid signature image');
  const view=new DataView(raw.buffer),width=view.getUint32(16),height=view.getUint32(20);
  check(width>=100&&width<=1500&&height>=30&&height<=600,'Invalid signature dimensions');
  const decoded=UPNG.decode(raw.buffer),frames=UPNG.toRGBA8(decoded);check(frames.length===1,'Use a still signature image');
  const pixels=new Uint8Array(frames[0]);for(let i=0;i<pixels.length;i+=4)if(pixels[i+3]>32&&Math.min(pixels[i],pixels[i+1],pixels[i+2])<220)ink++;
 }catch{check(false,'Draw a valid recipient signature');}
 check(ink>=20,'Draw the recipient signature before saving');
 const content={orderId:order.id,orderNumber:order.orderNumber,project:order.project,receiptId:receipt.id,name,by:receipt.by,at:receipt.at,lines:receipt.lines,notes:receipt.notes,attachmentIds:receipt.attachmentIds};
 const contentHash=createHash('sha256').update(JSON.stringify(content)).digest('hex');
 return {...content,contentHash,image};
}
export function readReceiptAcknowledgement(store,orderId,receiptId,actor){
 store.requireTask(actor,'site.orders.view');const order=store.read('orders',[]).find(order=>order.id===orderId);check(order,'Order not found',404);check(canRecordReceipt(actor,order),'Only the requester or an order manager can view delivery signatures',403);
 check((order.receipts||[]).some(receipt=>receipt.id===receiptId),'Delivery receipt not found',404);
 const acknowledgement=store.read(receiptSignatureKey(orderId,receiptId),null);check(acknowledgement,'No signature was recorded for this delivery',404);
 return {ok:true,acknowledgement};
}
