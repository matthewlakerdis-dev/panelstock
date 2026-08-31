import {brandLogo} from './brand-logo.js';
import {normalizeCncInput,compareCncOrders} from './cnc-input.js';
export function buildCncTrackerHtml(token) {
  return String.raw`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>CNC Tracker — PanelStock</title>
<link rel="manifest" href="/cnc-tracker/manifest.webmanifest?v=adaptive-v4&amp;token=__CNC_INSTALL_TOKEN__">
<meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="CNC Tracker"><meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="theme-color" content="#f5f5f4"><link rel="apple-touch-icon" href="/cnc-tracker/icon-mobile-v3-192.png"><link rel="icon" type="image/png" sizes="192x192" href="/cnc-tracker/icon-mobile-v3-192.png">
<style>

*{box-sizing:border-box}body{margin:0;background:#e8eaed;color:#0f172a;font:13px Arial,sans-serif}.preview-bar{max-width:420px;margin:18px auto 10px;display:flex;justify-content:space-between;align-items:center;gap:12px;padding:0 12px;color:#64748b;font-size:11px}.preview-bar button{font-size:11px;color:#155e75;border:1px solid #cbd5e1;padding:6px 9px;background:white;border-radius:6px}.app{max-width:420px;min-height:850px;margin:0 auto 24px;background:#f5f5f4;border:1px solid #ddd;border-radius:12px;overflow:hidden}header{padding:24px 16px;display:flex;align-items:center;justify-content:space-between;gap:14px;border-bottom:1px solid #e7e5e4}header img{width:158px;height:76px;object-fit:contain}.header-right{text-align:right}.header-right strong{font-size:13px;display:block;margin-bottom:6px}.readonly{display:inline-flex;gap:4px;align-items:center;background:#e6eef0;color:#155e75;border-radius:20px;padding:5px 8px;font-size:10px}.readonly svg{width:11px;height:11px}main{padding:14px}button,input,a{font:inherit}button{cursor:pointer}button:focus-visible,a:focus-visible,summary:focus-visible{outline:2px solid #155e75;outline-offset:2px}.search{position:relative}.search svg{position:absolute;left:11px;top:11px;width:14px;height:14px;color:#a3a3a3}input{width:100%;height:38px;border:1px solid #e5e5e5;background:white;border-radius:10px;padding:9px 12px 9px 34px;font-size:12px;outline:none}input:focus{border-color:#155e75}input::placeholder{color:#94a3b8}.pills{display:flex;gap:7px;margin:11px 0}.pill{border:1px solid #e5e5e5;background:white;border-radius:20px;padding:7px 11px;font-size:11px;color:#475569}.pill.active{background:#0f172a;border-color:#0f172a;color:white;font-weight:600}.tools{display:flex;gap:7px}.tools button{display:inline-flex;justify-content:center;align-items:center;gap:6px;background:#fafafa;border:1px solid #d4d4d4;border-radius:8px;min-height:32px;padding:6px 10px;font-size:11px;color:#0f172a;flex:1}.tools svg{width:13px;height:13px}.sync{display:flex;align-items:center;gap:5px;color:#64748b;font-size:10px;margin:12px 0 6px}.dot{width:5px;height:5px;border-radius:50%;background:#0d9488}.excel-help{font-size:10px;color:#64748b;margin-bottom:17px}.excel-help summary{cursor:pointer;color:#155e75;padding:5px 0}.excel-help p{line-height:1.6;margin:4px 0 10px}details>summary{list-style:none}details>summary::-webkit-details-marker{display:none}.job{margin:18px 0}.job>summary{display:flex;align-items:center;justify-content:space-between;gap:8px;color:#64748b;text-transform:uppercase;font-size:11px;font-weight:600;margin-bottom:8px;cursor:pointer}.job-count{font-size:10px;font-weight:400;text-transform:none;color:#94a3b8}.chevron{display:inline-block;transition:transform .12s}.job[open]>summary .chevron,.order[open]>summary .chevron{transform:rotate(90deg)}.order{border:1px solid #e5e5e5;border-radius:12px;background:white;margin-bottom:8px;overflow:hidden}.order>summary{display:flex;align-items:center;padding:13px 12px;gap:10px;cursor:pointer}.order-icon{width:32px;height:36px;border-radius:7px;background:#f0f4f5;display:grid;place-items:center;color:#155e75}.order-icon svg{width:17px;height:17px}.order-text{flex:1}.order-text strong{font-size:13px;font-weight:600}.order-text small{display:block;color:#94a3b8;font-size:10px;margin-top:5px}.order-status{text-align:right;font-size:10px;color:#94a3b8}.order-status b{display:block;color:#0f172a;font-size:13px;margin-bottom:4px}.order>summary .chevron{color:#a3a3a3}.panel-list{padding:0 12px 8px}.panel{border-top:1px solid #f1f1f1;padding:11px 0}.panel-top{display:flex;justify-content:space-between;align-items:center;gap:7px}.panel-name{font-size:12px;color:#334155}.panel-name span{font-size:10px;color:#94a3b8}.badge{padding:4px 7px;border-radius:12px;font-size:9px;font-weight:600;background:#fef3c7;color:#92400e}.badge.done{background:#dcfce7;color:#166534}.completed{font-size:10px;color:#94a3b8;margin-top:5px}.empty{text-align:center;color:#64748b;padding:48px 20px}.empty-icon{display:grid;place-items:center;width:46px;height:46px;background:white;border:1px solid #e5e5e5;border-radius:12px;margin:0 auto 14px;color:#94a3b8}.empty strong{font-size:13px;color:#475569}.empty p{font-size:12px;line-height:1.6}footer{text-align:center;color:#a3a3a3;font-size:10px;padding:24px 8px}#notice{font-size:11px;color:#155e75;line-height:1.5;margin:10px 0}@media(max-width:440px){body{background:#f5f5f4}.app{border:0;border-radius:0;margin:0;min-height:100vh}.preview-bar{margin-top:10px}}

body{background:#f5f5f4;font-family:system-ui,-apple-system,sans-serif}.app{max-width:1032px;border:0;border-radius:0;margin:0 auto;min-height:100vh}header{padding:24px 16px}header h1{font-size:15px;margin:0 0 6px}main{padding:14px 16px}.download{display:inline-flex;align-items:center;justify-content:center;gap:6px;text-decoration:none;border:1px solid #d4d4d4;border-radius:8px;min-height:34px;flex:1;color:#0f172a;background:#fafafa;font-size:11px}.download svg{width:13px;height:13px}.tools button{min-height:34px}.connection{font-size:11px;color:#64748b;margin:12px 0 6px}.connection:before{content:'';display:inline-block;width:5px;height:5px;border-radius:50%;background:#0d9488;margin-right:6px}.connection.error{color:#92400e}.connection.error:before{background:#d97706}.job>summary{min-height:32px}.job>summary strong{font-size:11px}.order>summary{min-height:66px}.order-icon{flex-shrink:0}.order-icon svg{width:17px;height:17px}.panels{padding:0 12px 8px}.panel{border-top:1px solid #f1f1f1;padding:11px 0}.panel-head{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:7px}.label{font-size:12px;color:#334155}.meta{font-size:10px;color:#94a3b8;margin-top:5px}.job-summary-count{font-size:10px;font-weight:400;text-transform:none;white-space:nowrap}.empty[hidden]{display:none}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}.order-text,.job>summary strong{min-width:0;overflow-wrap:anywhere}input{min-height:38px}.pills{flex-wrap:wrap}.pill{min-height:32px}.excel-help summary{min-height:30px;display:flex;align-items:center}.empty p{margin:8px 0}
@media(max-width:480px){main{padding:14px}header img{width:158px;height:76px}.order>summary{padding:13px 12px}}@media(min-width:760px){.panels{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));column-gap:18px}}

</style></head><body>
<div class="app"><header><img src="__CNC_LOGO__" alt="Lennox Facades"><div class="header-right"><h1>CNC Tracker</h1><span class="readonly">Read-only live view</span></div></header>
<main><div class="search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/></svg><label class="sr-only" for="search">Search CNC schedule</label><input id="search" type="search" placeholder="Search order, job, sheet or panel…"></div>
<div id="counts" class="pills" role="group" aria-label="Filter panel status"></div>
<div class="tools"><a id="download" class="download" title="Download the automatically refreshing Excel workbook"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16h16V8zM14 2v6h6M8 12h8M8 16h8"/></svg>Excel</a><button id="expand" type="button">Expand all</button><button id="collapse" type="button">Collapse all</button></div>
<div id="connection" class="connection" role="status">Loading latest schedule…</div>
<details class="excel-help"><summary>About the live Excel workbook</summary><p>Excel desktop: download once, enable the PanelStock data connection, and keep the workbook open to refresh every minute. The workbook contains the read-only sharing link.</p></details>
<div id="orders"></div><div id="empty" class="empty" hidden></div><footer>PanelStock · Shared CNC schedule</footer></main></div>
<script>
const TOKEN=__CNC_TOKEN__;
__CNC_NORMALIZE__
const orders=document.getElementById('orders'), search=document.getElementById('search'), status={value:'all'};
let panels=[], inFlight=false, fingerprint='', rendered=false;
const expanded=new Map();
document.getElementById('download').href='/cnc-tracker?token='+encodeURIComponent(TOKEN);
function el(tag,className,text){const node=document.createElement(tag);if(className)node.className=className;if(text!=null)node.textContent=text;return node;}
function gridIcon(){const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.5');const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d','M3 3h18v18H3zM3 9h18M9 3v18');svg.append(path);return svg;}
function date(iso){if(!iso)return '';const value=new Date(iso);return Number.isNaN(value.getTime())?'':value.toLocaleString([], {dateStyle:'short',timeStyle:'short'});}
function render(){
 const q=search.value.trim().toLowerCase(), filter=status.value, groups=new Map(), totals=new Map(), jobTotals=new Map();
 for(const panel of panels){
  const job=normalizeCncInput(panel).jobReference, key=JSON.stringify(['order',job,String(panel.orderNumber)]), done=panel.status==='completed';
  const jobTotal=jobTotals.get(job)||{pending:0,completed:0};jobTotal[done?'completed':'pending']++;jobTotals.set(job,jobTotal);
  const total=totals.get(key)||{pending:0,completed:0,sheets:new Set()};total[done?'completed':'pending']++;total.sheets.add(String(panel.sheetNumber));totals.set(key,total);
  if(filter!=='all' && (done?'completed':'pending')!==filter)continue;
  if(q && ![panel.orderNumber,panel.jobReference,panel.sheetNumber,panel.panelNumber].join(' ').toLowerCase().includes(q))continue;
  if(!groups.has(key))groups.set(key,[]);groups.get(key).push(panel);
 }
 const fragment=document.createDocumentFragment(), jobGroups=new Map();
 const jobOrder=Array.from(jobTotals.keys());
 for(const [key,rows] of Array.from(groups).sort(([a],[b])=>{const x=JSON.parse(a),y=JSON.parse(b);return jobOrder.indexOf(x[1])-jobOrder.indexOf(y[1])||compareCncOrders(x[2],y[2]);})){
  const [,job,order]=JSON.parse(key);
  if(!jobGroups.has(job)){
   const jobDetails=el('details','job'), jobId=JSON.stringify(['job',job]);jobDetails.dataset.order=jobId;jobDetails.open=expanded.has(jobId)?expanded.get(jobId):true;
   jobDetails.addEventListener('toggle',()=>{if(jobDetails.isConnected)expanded.set(jobId,jobDetails.open);});
   const jobSummary=el('summary');jobSummary.append(el('strong','',job||'No job reference'));const jt=jobTotals.get(job);jobSummary.append(el('span','job-summary-count',(jt.pending+jt.completed)+((jt.pending+jt.completed)===1?' panel':' panels')),el('span','chevron','›'));jobDetails.append(jobSummary);
   const content=el('div');jobDetails.append(content);jobGroups.set(job,content);fragment.append(jobDetails);
  }
  const details=el('details','order');details.dataset.order=key;details.open=expanded.has(key)?expanded.get(key):Boolean(q);
  details.addEventListener('toggle',()=>{if(!details.isConnected)return;expanded.set(key,details.open);});
  const summary=el('summary'), total=totals.get(key), totalCount=total.pending+total.completed;
  const icon=el('span','order-icon');icon.setAttribute('aria-hidden','true');icon.append(gridIcon());
  const title=el('span','order-text');title.append(el('strong','','Order '+order),el('small','',total.sheets.size+' sheet'+(total.sheets.size===1?'':'s')+' · '+totalCount+' panel'+(totalCount===1?'':'s')));
  const progress=el('span','order-status');progress.append(el('b','',total.completed+'/'+totalCount),el('span','','complete'));
  summary.append(icon,title,progress,el('span','chevron','›'));
  details.append(summary);const grid=el('div','panels');
  for(const panel of rows){
   const card=el('article','panel'), head=el('div','panel-head'), done=panel.status==='completed';
   head.append(el('span','label','Sheet '+panel.sheetNumber+' · Panel '+normalizeCncInput(panel).panelNumber),el('span','badge'+(done?' done':''),done?'Completed':'Pending'));card.append(head);
   if(done)card.append(el('div','meta','Completed '+date(panel.completedAt)+(panel.completedBy?' by '+panel.completedBy:'')));
   grid.append(card);
  }
  details.append(grid);jobGroups.get(job).append(details);
 }
 orders.replaceChildren(fragment);const empty=document.getElementById('empty');empty.hidden=groups.size>0;
 empty.replaceChildren(el('strong','',panels.length?'No matching panels':'No panels scheduled yet.'),el('p','',panels.length?'Try a different search or status.':'Scheduled panels will appear here automatically.'));
 const counts=document.getElementById('counts');counts.replaceChildren();
 for(const [value,label] of [['all','All'],['pending','Pending'],['completed','Completed']]){
  const count=panels.filter(p=>value==='all'||(p.status==='completed')===(value==='completed')).length;
  const button=el('button','pill'+(filter===value?' active':''),label+' ('+count+')');button.type='button';button.dataset.status=value;button.setAttribute('aria-pressed',String(filter===value));
  button.onclick=()=>{status.value=value;render();counts.querySelector('[data-status="'+value+'"]').focus();};counts.append(button);
 }

}
search.addEventListener('input',render);
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
</script></body></html>`.replace('__CNC_INSTALL_TOKEN__',()=>encodeURIComponent(token)).replace('__CNC_LOGO__',()=>brandLogo).replace('__CNC_NORMALIZE__',()=>normalizeCncInput.toString()+"\n"+compareCncOrders.toString()).replace('__CNC_TOKEN__',JSON.stringify(token).replace(/</g,'\\u003c'));
}
