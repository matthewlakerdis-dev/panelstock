import {normalizeCncInput} from './cnc-input.js';
export function buildCncTrackerHtml(token) {
  return String.raw`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>CNC Tracker — PanelStock</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#f8fafc;color:#0f172a;font-family:system-ui,-apple-system,sans-serif}header{background:#0f172a;color:white;padding:22px max(16px,calc((100% - 1000px)/2));}h1{font-size:21px;margin:0 0 6px}.sub{font-size:13px;color:#cbd5e1}main{max-width:1032px;margin:auto;padding:20px 16px}button,input,select,a{font:inherit}button,select,.download{min-height:44px}button,summary{cursor:pointer}.toolbar{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:16px 0}.download,button,select,input{border:1px solid #cbd5e1;background:white;color:#155e75;border-radius:9px;padding:10px 12px}.download{text-decoration:none;font-size:14px;display:inline-flex;align-items:center}input{width:100%;min-height:46px;color:#0f172a}.counts{font-size:14px;color:#475569}.connection{font-size:12px;margin-top:10px;color:#cbd5e1}.connection.error{color:#fde68a}.order{background:white;border:1px solid #cbd5e1;border-radius:12px;margin:12px 0;overflow:hidden}summary{padding:16px;min-height:60px;overflow-wrap:anywhere}summary strong{margin-left:6px}summary .progress{display:block;margin:6px 0 0 22px;color:#64748b;font-size:13px}.panels{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr));gap:12px;padding:0 12px 12px}.panel{border:1px solid #e2e8f0;border-radius:10px;padding:14px;min-width:0;overflow-wrap:anywhere}.panel-head{display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between}.label{font-weight:600;font-size:14px}.badge{font-size:11px;font-weight:700;border-radius:20px;padding:5px 9px;background:#fef3c7;color:#92400e}.badge.done{background:#dcfce7;color:#166534}.job{font-size:14px;color:#475569;margin:10px 0}.meta{font-size:12px;color:#64748b;margin-top:8px}.empty{padding:30px 10px;text-align:center;color:#64748b}label{font-size:14px}button:focus-visible,summary:focus-visible,a:focus-visible{outline:3px solid #0891b2;outline-offset:2px}@media(max-width:480px){main{padding:16px 12px}.toolbar>*{flex:1}.download{justify-content:center;width:100%}header{padding:20px 16px}.panels{grid-template-columns:1fr}}
</style></head><body>
<header><h1>CNC Tracker</h1><div class="sub">PanelStock · Read-only live view</div><div id="connection" class="connection" role="status">Loading latest schedule…</div></header>
<main><div id="counts" class="counts"></div><div class="toolbar"><a id="download" class="download">Download live Excel</a><button id="expand" type="button">Expand all</button><button id="collapse" type="button">Collapse all</button></div>
<p class="counts">Excel desktop: download once, enable the PanelStock data connection, and keep the workbook open to refresh every minute. The workbook contains the read-only sharing link.</p><label for="search">Find an order, job, sheet or panel</label><input id="search" type="search" placeholder="Search CNC schedule…">
<div class="toolbar"><label for="status">Show</label><select id="status"><option value="all">All panels</option><option value="pending">Pending</option><option value="completed">Completed</option></select></div>
<div id="orders"></div><p id="empty" class="empty" hidden>No panels scheduled yet.</p></main>
<script>
const TOKEN=__CNC_TOKEN__;
__CNC_NORMALIZE__
const orders=document.getElementById('orders'), search=document.getElementById('search'), status=document.getElementById('status');
let panels=[], inFlight=false, fingerprint='', rendered=false;
const expanded=new Map();
document.getElementById('download').href='/cnc-tracker?token='+encodeURIComponent(TOKEN);
function el(tag,className,text){const node=document.createElement(tag);if(className)node.className=className;if(text!=null)node.textContent=text;return node;}
function date(iso){if(!iso)return '';const value=new Date(iso);return Number.isNaN(value.getTime())?'':value.toLocaleString([], {dateStyle:'short',timeStyle:'short'});}
function render(){
 const q=search.value.trim().toLowerCase(), filter=status.value, groups=new Map(), totals=new Map(), jobTotals=new Map();
 for(const panel of panels){
  const job=normalizeCncInput(panel).jobReference, key=JSON.stringify(['order',job,String(panel.orderNumber)]), done=panel.status==='completed';
  const jobTotal=jobTotals.get(job)||{pending:0,completed:0};jobTotal[done?'completed':'pending']++;jobTotals.set(job,jobTotal);
  const total=totals.get(key)||{pending:0,completed:0};total[done?'completed':'pending']++;totals.set(key,total);
  if(filter!=='all' && (done?'completed':'pending')!==filter)continue;
  if(q && ![panel.orderNumber,panel.jobReference,panel.sheetNumber,panel.panelNumber].join(' ').toLowerCase().includes(q))continue;
  if(!groups.has(key))groups.set(key,[]);groups.get(key).push(panel);
 }
 const fragment=document.createDocumentFragment(), jobGroups=new Map();
 for(const [key,rows] of groups){
  const [,job,order]=JSON.parse(key);
  if(!jobGroups.has(job)){
   const jobDetails=el('details','order'), jobId=JSON.stringify(['job',job]);jobDetails.dataset.order=jobId;jobDetails.open=expanded.has(jobId)?expanded.get(jobId):Boolean(q);
   jobDetails.addEventListener('toggle',()=>{if(jobDetails.isConnected)expanded.set(jobId,jobDetails.open);});
   const jobSummary=el('summary');jobSummary.append(el('strong','',job||'No job reference'));const jt=jobTotals.get(job);jobSummary.append(el('span','progress',jt.pending+' pending · '+jt.completed+'/'+(jt.pending+jt.completed)+' complete'));jobDetails.append(jobSummary);
   const content=el('div');content.style.padding='0 10px';jobDetails.append(content);jobGroups.set(job,content);fragment.append(jobDetails);
  }
  const details=el('details','order');details.dataset.order=key;details.open=expanded.has(key)?expanded.get(key):Boolean(q);
  details.addEventListener('toggle',()=>{if(!details.isConnected)return;expanded.set(key,details.open);});
  const summary=el('summary');summary.append(el('strong','', 'Order '+order));const total=totals.get(key);
  summary.append(el('span','progress',total.pending+' pending · '+total.completed+'/'+(total.pending+total.completed)+' complete'));
  details.append(summary);const grid=el('div','panels');
  for(const panel of rows){
   const card=el('article','panel'), head=el('div','panel-head'), done=panel.status==='completed';
   head.append(el('span','label','Sheet '+panel.sheetNumber+' · Panel '+panel.panelNumber),el('span','badge'+(done?' done':''),done?'Completed':'Pending'));card.append(head);
   if(done)card.append(el('div','meta','Completed '+date(panel.completedAt)+(panel.completedBy?' by '+panel.completedBy:'')));
   grid.append(card);
  }
  details.append(grid);jobGroups.get(job).append(details);
 }
 orders.replaceChildren(fragment);const empty=document.getElementById('empty');empty.hidden=groups.size>0;empty.textContent=panels.length?'No panels match your search or filter.':'No panels scheduled yet.';
 document.getElementById('counts').textContent=panels.filter(p=>p.status!=='completed').length+' pending · '+panels.filter(p=>p.status==='completed').length+' completed';
}
search.addEventListener('input',render);status.addEventListener('change',render);
document.getElementById('expand').onclick=()=>{for(const d of orders.querySelectorAll('details')){expanded.set(d.dataset.order,true);d.open=true;}};
document.getElementById('collapse').onclick=()=>{for(const d of orders.querySelectorAll('details')){expanded.set(d.dataset.order,false);d.open=false;}};
async function refresh(){
 if(inFlight)return;inFlight=true;const controller=new AbortController(), timeout=setTimeout(()=>controller.abort(),15000);
 try{const response=await fetch('/cnc-tracker/data?token='+encodeURIComponent(TOKEN),{cache:'no-store',signal:controller.signal});if(!response.ok)throw Error('Unavailable');
  const data=await response.json();if(!Array.isArray(data.panels))throw Error('Invalid schedule');
  const next=JSON.stringify(data.panels);if(next!==fingerprint||!rendered){panels=data.panels.slice().sort((a,b)=>new Date(b.uploadedAt)-new Date(a.uploadedAt));fingerprint=next;render();rendered=true;}
  const connection=document.getElementById('connection');connection.className='connection';connection.textContent='Updated '+new Date().toLocaleTimeString()+' · refreshes automatically';
 }catch{const connection=document.getElementById('connection');connection.className='connection error';connection.textContent=rendered?'Connection lost — showing last received schedule. Retrying…':'Unable to load schedule — retrying…';}
 finally{clearTimeout(timeout);inFlight=false;}
}
refresh();setInterval(refresh,8000);
</script></body></html>`.replace('__CNC_NORMALIZE__',()=>normalizeCncInput.toString()).replace('__CNC_TOKEN__',JSON.stringify(token).replace(/</g,'\\u003c'));
}
