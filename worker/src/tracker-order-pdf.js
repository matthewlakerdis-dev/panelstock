import {equal} from './security.js';
const encoder=new TextEncoder();
const validId=id=>typeof id==='string'&&/^[a-zA-Z0-9-]{16,100}$/.test(id);
async function signingKey(secret){return crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);}
async function signature(key,siteId,orderId){
 const bytes=await crypto.subtle.sign('HMAC',key,encoder.encode('panelstock:tracker-order-pdf:v1\0'+(siteId||'panelstock')+'\0'+orderId));
 return Array.from(new Uint8Array(bytes),value=>value.toString(16).padStart(2,'0')).join('');
}
export async function validTrackerPdfLink(secret,siteId,orderId,token){
 if(!secret||!validId(orderId)||typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))return false;
 return equal(token,await signature(await signingKey(secret),siteId,orderId));
}
// Persistent links are restricted to one PDF and revoked with the tracker secret.
// Keep the tracker credential itself out of the PDF URL.
export async function trackerPdfRows(rows,origin,secret,siteId){
 const key=secret?await signingKey(secret):null;
 return Promise.all(rows.map(async row=>{
  let id;try{id=new URL(row.PDF).searchParams.get('orderPdf');}catch{}
  if(!key||!validId(id))return {...row,PDF:''};
  const url=new URL('/orders/'+encodeURIComponent(id)+'/pdf',origin);
  url.searchParams.set('tracker',await signature(key,siteId,id));
  return {...row,PDF:url.href};
 }));
}
