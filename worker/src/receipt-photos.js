import {requireCondition as check} from './security.js';
import {canRecordReceipt} from './receipt-acknowledgement.js';
const MAX_PHOTO=1024*1024;
const encode=bytes=>{let text='';for(let i=0;i<bytes.length;i+=32768)text+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(text);};
export function prepareReceiptPhoto(orderId,receiptId,input,actor){
 check(input&&typeof input==='object','Choose a delivery photo');
 check(/^[a-f0-9-]{36}$/i.test(input.id||''),'Invalid delivery photo identifier');
 check(typeof input.name==='string'&&input.name.trim()&&input.name.length<=200&&!/[\u0000-\u001f\u007f]/.test(input.name),'Invalid delivery photo filename');
 check(typeof input.data==='string'&&input.data.length<=4*Math.ceil(MAX_PHOTO/3)&&input.data.length%4===0&&/^[A-Za-z0-9+/]*={0,2}$/.test(input.data),'Choose a delivery photo up to 1 MB');
 const bytes=Uint8Array.from(atob(input.data),c=>c.charCodeAt(0));check(bytes.length>0&&bytes.length<=MAX_PHOTO,'Choose a delivery photo up to 1 MB');
 const match=(offset,values)=>values.every((value,i)=>bytes[offset+i]===value);
 const contentType=match(0,[255,216,255])?'image/jpeg':match(0,[137,80,78,71,13,10,26,10])?'image/png':match(0,[82,73,70,70])&&match(8,[87,69,66,80])?'image/webp':'';
 check(contentType,'Choose a JPEG, PNG or WebP delivery photo');
 return {bytes,metadata:{id:input.id,name:input.name.trim().replace(/[\\/]/g,'_'),size:bytes.length,contentType,uploadedBy:actor.username,key:'order-receipt-photos/'+orderId+'/'+receiptId+'/'+crypto.randomUUID()}};
}
export async function readReceiptPhoto(store,orderId,receiptId,photoId,actor){
 store.requireTask(actor,'site.orders.view');const order=store.read('orders',[]).find(order=>order.id===orderId);check(order,'Order not found',404);check(canRecordReceipt(actor,order),'Only the requester or an order manager can view delivery photos',403);
 const photo=(order.receipts||[]).find(receipt=>receipt.id===receiptId)?.deliveryPhoto;check(photo&&photo.id===photoId,'Delivery photo not found',404);
 const bucket=store.env.CAD_PROJECT_FILES;check(bucket,'Delivery photo storage is unavailable',503);const object=await bucket.get(photo.key);check(object&&object.size<=MAX_PHOTO,'Delivery photo is unavailable',404);
 return {ok:true,photo:{...photo,data:encode(new Uint8Array(await object.arrayBuffer()))}};
}
