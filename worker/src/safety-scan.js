import {PDFDocument} from 'pdf-lib';
import {requireCondition as check} from './security.js';
const normalName=value=>String(value||'').normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('en-AU');
const overlap=(a,b)=>a[0]<b[0]+b[2]&&b[0]<a[0]+a[2]&&a[1]<b[1]+b[3]&&b[1]<a[1]+a[3];
export async function scanSafetyPdf(store,version){
 check(store.env?.PDF_CONVERTER_URL&&store.env?.PDF_CONVERTER_TOKEN,'PDF scanning is unavailable. Use manual sign-off setup.',503);
 const file=store.read('safety:file:'+version.id),bytes=Uint8Array.from(atob(file.data),c=>c.charCodeAt(0));
 const response=await fetch(store.env.PDF_CONVERTER_URL.replace(/\/$/,'')+'/analyse-safety',{method:'POST',headers:{Authorization:'Bearer '+store.env.PDF_CONVERTER_TOKEN,'Content-Type':'application/pdf'},body:bytes,signal:AbortSignal.timeout(25000)});
 check(response.ok,'The document scanner could not read this PDF. Use manual setup or retry.',503);const raw=await response.text();check(raw.length<=150000,'Scan result is too large. Use manual setup.');let result;try{result=JSON.parse(raw)}catch{check(false,'Invalid scan result')};const pdf=await PDFDocument.load(bytes);
 check(result&&['detected','manual'].includes(result.status)&&Array.isArray(result.pages)&&result.pages.length<=20,'Invalid scan result');
 const used=new Set(),fields=['name','role','type','class','number','date','signature'];
 function dimensions(p){
  check(p&&Number.isInteger(p.page)&&p.page>=1&&p.page<=pdf.getPageCount(),'Invalid detected page');const actual=pdf.getPage(p.page-1),width=actual.getWidth(),height=actual.getHeight();
  check(actual.getRotation().angle%360===0&&Number.isFinite(p.width)&&Number.isFinite(p.height)&&Math.abs(p.width-width)<1&&Math.abs(p.height-height)<1,'Rotated or unsupported pages need manual setup.');return {width,height};
 }
 const pages=result.pages.map(p=>{
  const {width,height}=dimensions(p);check(!used.has(p.page),'Invalid detected page');used.add(p.page);
  const columns={};for(const field of fields){const rect=p.columns?.[field];check(Array.isArray(rect)&&rect.length===2&&rect.every(Number.isFinite)&&rect[0]>=0&&rect[1]>=15&&rect[0]+rect[1]<=width+1,'Invalid detected field');columns[field]=[...rect];}
  check(Array.isArray(p.rows)&&p.rows.length>0&&p.rows.length<=50,'Invalid detected rows');let bottom=0;
  const rows=p.rows.map(r=>{check(r&&Number.isFinite(r.top)&&Number.isFinite(r.height)&&r.top+.05>=bottom&&r.height>=24&&r.top+r.height<=height,'Invalid detected row');bottom=r.top+r.height;if(r.licenceRows!==undefined){check(Array.isArray(r.licenceRows)&&r.licenceRows.length===3,'Invalid detected licence rows');let edge=r.top;for(const sub of r.licenceRows){check(sub&&Number.isFinite(sub.top)&&Number.isFinite(sub.height)&&Math.abs(sub.top-edge)<=.05&&sub.height>=5&&sub.top+sub.height<=bottom+.05,'Invalid detected licence row');edge=sub.top+sub.height;}check(Math.abs(edge-bottom)<=.05,'Incomplete detected licence rows');}if(r.needsConstructionCardLabel!==undefined)check(typeof r.needsConstructionCardLabel==='boolean'&&Array.isArray(r.licenceRows),'Invalid detected licence label');return {top:r.top,height:r.height,...(r.needsConstructionCardLabel?{needsConstructionCardLabel:true}:{}),...(r.licenceRows?{licenceRows:r.licenceRows.map(sub=>({top:sub.top,height:sub.height}))}:{})}});
  return {page:p.page,width,height,columns,rows};
 });
 const rawSupervisors=result.supervisors??[];check(Array.isArray(rawSupervisors)&&rawSupervisors.length<=20,'Invalid supervisor sign-off fields');
 const directory=rawSupervisors.length?Object.entries(store.read('users',{})).filter(([,u])=>u.active!==false).map(([username,u])=>{const row=store.sql?.exec('SELECT display_name AS displayName FROM access_users WHERE username=? AND active=1',username).toArray()[0];return {username,name:normalName(row?.displayName||u.displayName||username)};}):[];
 const supervisors=[];
 for(const p of rawSupervisors){
  const {width,height}=dimensions(p);check(typeof p.name==='string'&&p.name.trim()&&p.name.length<=120&&!/[\u0000-\u001f\u007f]/.test(p.name),'Invalid supervisor name');
  const label=typeof p.label==='string'?p.label.trim().replace(/:$/,'').trim().toLowerCase():'';check(['signature','approval signature'].includes(label),'Invalid supervisor signature label');
  const rect=p.rect;check(Array.isArray(rect)&&rect.length===4&&rect.every(Number.isFinite)&&rect[0]>=0&&rect[1]>=0&&rect[2]>=24&&rect[3]>=8&&rect[0]+rect[2]<=width&&rect[1]+rect[3]<=height,'Invalid supervisor signature field');
  check(!supervisors.some(s=>s.page===p.page&&overlap(s.rect,rect)),'Supervisor signature fields overlap');
  check(!pages.some(table=>table.page===p.page&&table.rows.some(row=>Object.values(table.columns).some(([x,w])=>overlap(rect,[x,row.top,w,row.height])))),'Supervisor signature field overlaps a worker sign-off table');
  const matches=directory.filter(u=>u.name===normalName(p.name));supervisors.push({page:p.page,width,height,name:p.name.trim(),label:label==='signature'?'Signature':'Approval signature',rect:[...rect],username:matches.length===1?matches[0].username:''});
 }
 const detected=pages.length>0||supervisors.length>0;check(result.status!=='detected'||detected,'No detected sign-off fields');
 return {status:detected?'detected':'manual',pages,...(supervisors.length?{supervisors}:{}),candidatePages:Array.isArray(result.candidatePages)?result.candidatePages.filter(n=>Number.isInteger(n)&&n>0&&n<=pdf.getPageCount()).slice(0,200):[],message:detected?'Review the detected sign-off pages and fields before enabling.':'No supported text-based sign-off fields were found. Use manual setup; image-only PDFs need manual setup.',fileHash:version.fileHash};
}
