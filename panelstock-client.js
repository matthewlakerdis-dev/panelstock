(function(root) {
  'use strict';
  const FIELDS=['variants','offcuts','catalog','reasons','transactions','photos','cncPanels'];
  const copy=v=>JSON.parse(JSON.stringify(v));
  const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  const mapping=(field,value)=>field==='photos'?(value||{}):Object.fromEntries((value||[]).map(v=>[v.id,v]));
  const sortCncPanels=value=>[...(value||[])].sort((a,b)=>{
    const left=String(a?.sheetNumber??'').trim();
    const right=String(b?.sheetNumber??'').trim();
    if(!left||!right){if(left===right)return 0;return left?-1:1;}
    return left.localeCompare(right,'en',{numeric:true,sensitivity:'base'});
  });
  const prepareView=view=>{
    const next=copy(view);
    if(Array.isArray(next?.cncPanels))next.cncPanels=sortCncPanels(next.cncPanels);
    return next;
  };
  class Outbox {
    constructor(storage,send,notify=()=>{}) {
      this.storage=storage;this.send=send;this.notify=notify;this.running=null;this.timer=false;
      this.state=JSON.parse(storage.getItem('panelstock:outbox:v2')||'null')||{owner:null,view:null,queue:[],draft:null,blocked:null};
      if(this.state.blocked==='Dimensions must be positive numbers')this.state.blocked=null;
    }
    save(next) {
      try{this.storage.setItem('panelstock:outbox:v2',JSON.stringify(next));}
      catch{this.notify('storage','Device storage is full. No further edits can be saved. Export pending changes.');throw Error('Device storage is full; pending changes were not saved.');}
      this.state=next;this.notify(next.blocked?'conflict':next.queue.length||next.draft?'offline':'synced',next.blocked);
    }
    pending(){return this.state.queue.length>0||!!this.state.draft;}
    snapshot(remote,owner) {
      if(this.pending()) {
        if(this.state.owner!==owner)throw Error('Pending changes belong to another user. Log in as '+this.state.owner+'.');
        return prepareView(this.state.view);
      }
      if(this.state.owner===owner && this.state.view && remote.revision<this.state.view.revision)return prepareView(this.state.view);
      const view=prepareView(remote);
      this.save({owner,view,queue:[],draft:null,blocked:null});return copy(view);
    }
    stage(fields,owner,rendered) {
      if(!this.state.view || this.state.owner!==owner)throw Error('Load stock after logging in before editing.');
      if(this.state.blocked)throw Error(this.state.blocked);
      const next=copy(this.state);
      if(!next.draft)next.draft={before:copy(next.view),fields:{}};
      for(const field of FIELDS)if(fields[field]!==undefined && !(field in next.draft.fields) && rendered?.[field]!==undefined)next.draft.before[field]=copy(rendered[field]);
      for(const field of FIELDS)if(fields[field]!==undefined){const value=field==='cncPanels'?sortCncPanels(fields[field]):copy(fields[field]);next.draft.fields[field]=value;next.view[field]=copy(value);}
      this.save(next);
      if(!this.timer){this.timer=true;queueMicrotask(()=>{this.timer=false;this.finalize();void this.flush(owner);});}
    }
    finalize() {
      if(!this.state.draft)return;
      const next=copy(this.state),changes=[];
      for(const [field,value] of Object.entries(next.draft.fields)) {
        const before=mapping(field,next.draft.before[field]),after=mapping(field,value);
        for(const id of new Set([...Object.keys(before),...Object.keys(after)])) {
          if(field==='transactions' && !after[id])continue;
          if(!same(before[id]||null,after[id]||null))changes.push({field,id,before:before[id]||null,after:after[id]||null});
        }
      }
      if(changes.length)next.queue.push({mutationId:crypto.randomUUID(),restoreEpoch:next.draft.before.restoreEpoch||0,changes});
      next.draft=null;this.save(next);
    }
    flush(owner) {
      if(this.running)return this.running;
      this.running=this.drain(owner).finally(()=>{this.running=null;});return this.running;
    }
    async drain(owner) {
      this.finalize();
      if(this.state.owner!==owner||this.state.blocked)return false;
      while(this.state.queue.length) {
        const packet=this.state.queue[0];this.notify('syncing');
        let res;
        try{res=await this.send(packet,owner);}catch(error){this.notify('offline','Sync failed: '+(error&&error.message?error.message:'Network request failed.'));return false;}
        if(!res.ok) {
          if([400,403,409,413,422,426].includes(res.status)){
            const error=await res.json().catch(()=>({}));
            this.save({...this.state,blocked:error.error||'Pending changes require review.'});
          }else this.notify(res.status===401?'login':'offline','Sync failed (HTTP '+res.status+').');
          return false;
        }
        const result=await res.json();
        const next=copy(this.state);next.queue=next.queue.filter(p=>p.mutationId!==packet.mutationId);
        next.view.revision=Math.max(next.view.revision||0,result.revision||0);this.save(next);
      }
      return true;
    }
  }
  if(typeof module!=='undefined')module.exports={Outbox};
  if(!root.document)return;

  const nativeArraySort=Array.prototype.sort;
  Array.prototype.sort=function(compareFn){
    const isCncPanelArray=this.length>1&&this.every(row=>row&&typeof row==='object'&&'orderNumber' in row&&'sheetNumber' in row&&'panelNumber' in row);
    const isUploadedAtSort=typeof compareFn==='function'&&Function.prototype.toString.call(compareFn).includes('uploadedAt');
    if(isCncPanelArray&&isUploadedAtSort){
      return nativeArraySort.call(this,(a,b)=>{
        const sheet=String(a.sheetNumber??'').trim().localeCompare(String(b.sheetNumber??'').trim(),'en',{numeric:true,sensitivity:'base'});
        if(sheet)return sheet;
        return String(a.panelNumber??'').trim().localeCompare(String(b.panelNumber??'').trim(),'en',{numeric:true,sensitivity:'base'});
      });
    }
    return nativeArraySort.call(this,compareFn);
  };

  const collapsedCncSheets=new Set();
  const initializedCncSheets=new Set();
  let cncEnhanceQueued=false;
  const leafElements=rootNode=>[...rootNode.querySelectorAll('*')].filter(el=>el.children.length===0&&el.textContent.trim());
  const findPanelCard=meta=>{
    let node=meta.parentElement;
    while(node&&node!==document.body){
      const completeButtons=[...node.querySelectorAll('button')].filter(button=>button.textContent.trim()==='Complete panel');
      if(completeButtons.length===1)return node;
      node=node.parentElement;
    }
    return null;
  };
  const addMobileSheetGroups=()=>{
    document.querySelectorAll('[data-panelstock-sheet-heading="mobile"]').forEach(el=>el.remove());
    for(const meta of leafElements(document)){
      const match=meta.textContent.trim().match(/^Sheet\s+(.+?)\s*[·•]\s*Panel\s+(.+)$/i);
      if(!match)continue;
      const card=findPanelCard(meta);
      if(!card)continue;
      const sheet=match[1].trim(),panel=match[2].trim();
      const orderLeaf=leafElements(card).find(el=>/^Order\s+/i.test(el.textContent.trim()));
      const order=orderLeaf?.textContent.trim()||card.dataset.panelstockOrder||'Order';
      card.dataset.panelstockCncCard='1';card.dataset.panelstockSheet=sheet;card.dataset.panelstockOrder=order;
      if(orderLeaf){orderLeaf.textContent='Panel '+panel;orderLeaf.style.fontWeight='700';orderLeaf.style.paddingLeft='12px';}
      meta.style.display='none';
    }
    const parents=new Set([...document.querySelectorAll('[data-panelstock-cnc-card="1"]')].map(card=>card.parentElement).filter(Boolean));
    for(const parent of parents){
      const cards=[...parent.children].filter(el=>el.dataset?.panelstockCncCard==='1');
      const sheets=[];for(const card of cards)if(!sheets.includes(card.dataset.panelstockSheet))sheets.push(card.dataset.panelstockSheet);
      for(const sheet of sheets){
        const sheetCards=cards.filter(card=>card.dataset.panelstockSheet===sheet);if(!sheetCards.length)continue;
        const order=sheetCards[0].dataset.panelstockOrder||'Order',key=order+'|'+sheet;
        const heading=document.createElement('button');heading.type='button';heading.dataset.panelstockSheetHeading='mobile';heading.style.cssText='width:100%;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px;margin:8px 0;border:1px solid #e2e8f0;border-radius:10px;background:#f8fafc;color:#334155;font:700 14px system-ui;text-align:left';
        const label=document.createElement('span');label.textContent='Sheet '+sheet;
        const right=document.createElement('span');right.style.cssText='color:#64748b;font-weight:600';
        if(!initializedCncSheets.has(key)){collapsedCncSheets.add(key);initializedCncSheets.add(key);}
        const update=()=>{const closed=collapsedCncSheets.has(key);right.textContent=sheetCards.length+' panel'+(sheetCards.length===1?'':'s')+(closed?' ▸':' ▾');for(const card of sheetCards)card.style.display=closed?'none':'';};
        heading.onclick=()=>{collapsedCncSheets.has(key)?collapsedCncSheets.delete(key):collapsedCncSheets.add(key);update();};
        heading.append(label,right);parent.insertBefore(heading,sheetCards[0]);update();
      }
    }
  };
  const addDesktopSheetGroups=()=>{
    document.querySelectorAll('tr[data-panelstock-sheet-heading="desktop"]').forEach(el=>el.remove());
    for(const table of document.querySelectorAll('table')){
      const headers=[...table.querySelectorAll('thead th')].map(th=>th.textContent.trim().toLowerCase());
      const sheetIndex=headers.indexOf('sheet'),panelIndex=headers.indexOf('panel');if(sheetIndex<0||panelIndex<0)continue;
      const rows=[...table.querySelectorAll('tbody > tr')].filter(row=>!row.dataset.panelstockSheetHeading);let previousSheet=null;
      for(const row of rows){
        const cells=[...row.children],sheet=cells[sheetIndex]?.textContent.trim();if(!sheet||sheet===previousSheet)continue;previousSheet=sheet;
        const group=document.createElement('tr');group.dataset.panelstockSheetHeading='desktop';
        const cell=document.createElement('td');cell.colSpan=Math.max(cells.length,1);cell.style.cssText='padding:9px 16px;background:#f8fafc;border-top:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;color:#334155;font:700 13px system-ui';cell.textContent='Sheet '+sheet;
        group.appendChild(cell);row.parentElement.insertBefore(group,row);
      }
    }
  };
  const enhanceCncHierarchy=()=>{addMobileSheetGroups();addDesktopSheetGroups();};
  const queueCncEnhance=()=>{if(cncEnhanceQueued)return;cncEnhanceQueued=true;requestAnimationFrame(()=>{cncEnhanceQueued=false;enhanceCncHierarchy();});};
  new MutationObserver(records=>{
    const external=records.some(record=>[...record.addedNodes,...record.removedNodes].some(node=>node.nodeType===1&&!node.dataset?.panelstockSheetHeading));
    if(external)queueCncEnhance();
  }).observe(document.documentElement,{childList:true,subtree:true});
  queueMicrotask(queueCncEnhance);

  const SESSION='panelstock:session:v2';let session=null,workerUrl='',status='synced',message='',lockGranted=false,lockDenied=false;
  try{session=JSON.parse(sessionStorage.getItem(SESSION)||'null');}catch{}
  if(session?.expiresAt<=Date.now()){session=null;sessionStorage.removeItem(SESSION);}
  let outbox;
  const announce=(s,m='')=>{status=s;message=m;root.dispatchEvent(new CustomEvent('panelstock-sync',{detail:{status:s,message:m}}));renderNotice();};
  const apiFetch=async(url,options={})=>{
    const absolute=new URL(url,location.href);
    if(!workerUrl || absolute.origin!==new URL(workerUrl).origin)throw Error('Unapproved API destination');
    const headers=new Headers(options.headers||{});headers.delete('Authorization');
    if(session?.token)headers.set('Authorization','Bearer '+session.token);
    const res=await fetch(url,{...options,headers,cache:'no-store',signal:options.signal||AbortSignal.timeout(20000)});
    if(['/login','/set-pin'].includes(absolute.pathname) && res.ok){const result=await res.clone().json();if(result.token){session={token:result.token,username:result.username,isAdmin:result.isAdmin,expiresAt:result.expiresAt};sessionStorage.setItem(SESSION,JSON.stringify(session));}}
    if(res.status===401 && !['/login','/set-pin'].includes(absolute.pathname)){session=null;sessionStorage.removeItem(SESSION);root.dispatchEvent(new Event('panelstock-session-expired'));announce('login','Session expired. Log in again; pending changes are retained.');}
    return res;
  };
  outbox=new Outbox(localStorage,(packet,owner)=>{
    if(!session || session.username!==owner)return Promise.resolve(new Response('{}',{status:401}));
    return apiFetch(workerUrl+'/mutations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(packet)});
  },announce);
  function renderNotice() {
    let el=document.getElementById('panelstock-safety-notice');
    const legacy=localStorage.getItem('panelstock:pendingSync');
    const oldPending=legacy && Object.keys(JSON.parse(legacy)).length>0;
    const blocked=lockDenied || oldPending || ['conflict','storage'].includes(status) || (session && outbox.pending() && outbox.state.owner!==session.username);
    if(!el){el=document.createElement('div');el.id='panelstock-safety-notice';document.body.appendChild(el);}
    el.replaceChildren();
    if(!blocked){
      if(outbox.pending()){
        el.style.cssText='position:fixed;top:0;left:0;right:0;z-index:99999;background:#fff7ed;color:#7c2d12;padding:8px;text-align:center;font:14px system-ui;pointer-events:auto;display:flex;align-items:center;justify-content:center;gap:10px;flex-wrap:wrap';
        const text=document.createElement('span');
        text.textContent=status==='syncing'?'Saving pending stock changes…':(message||'Changes saved on this device — waiting to sync');
        el.appendChild(text);
        if(status!=='syncing'){
          const retry=document.createElement('button');retry.type='button';retry.textContent='Retry sync';retry.style.cssText='padding:6px 10px;border:1px solid #9a3412;border-radius:7px;background:#fff;color:#7c2d12;font:600 13px system-ui';
          retry.onclick=async()=>{
  retry.disabled=true;retry.textContent='Retrying…';message='';
  if(!session){
    announce('login','Your login has expired. Log in again to sync these saved changes; they will stay on this device.');
    root.dispatchEvent(new Event('panelstock-session-expired'));
    return;
  }
  if(outbox.state.owner&&outbox.state.owner!==session.username){
    announce('conflict','These pending changes belong to '+outbox.state.owner+'. Log in as that user to sync them.');
    return;
  }
  if(outbox.state.blocked){
    const next={...outbox.state,blocked:null};
    outbox.save(next);
  }
  const ok=await outbox.flush(session.username);
  if(ok&&!outbox.pending())announce('synced','Saved changes synced successfully.');
  else if(outbox.pending()&&!message)announce('offline','Sync did not complete. Check the connection or log in again, then retry.');
  else renderNotice();
};
          el.appendChild(retry);
        }
      }
      else el.style.display='none';return;
    }
    el.style.cssText='position:fixed;inset:0;z-index:999999;background:#fff7ed;padding:40px 24px;font:16px system-ui;overflow:auto;color:#7c2d12';
    const heading=document.createElement('h2');heading.textContent='Pending changes need review';el.appendChild(heading);
    const p=document.createElement('p');p.textContent=lockDenied?'Only one PanelStock tab may edit stock at a time. Close the other tab and reload this one.':oldPending?'This device has unsent changes from the previous app. Export them for reconciliation before continuing.':message||'Log in as '+outbox.state.owner+' to handle these pending changes.';el.appendChild(p);
    if(lockDenied)return;
    const exportButton=document.createElement('button');exportButton.textContent='Export pending changes';exportButton.style.cssText='padding:12px;margin:8px';
    exportButton.onclick=()=>{const blob=new Blob([JSON.stringify({savedAt:new Date().toISOString(),outbox:outbox.state,legacyPending:oldPending?JSON.parse(legacy):null},null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='PanelStock-pending-changes.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),5000);exportButton.textContent='Exported — keep this file for review';
      if(!el.querySelector('[data-discard]')){const discard=document.createElement('button');discard.dataset.discard='true';discard.textContent='Discard local pending changes and reload shared stock';discard.style.cssText='padding:12px;margin:8px';discard.onclick=()=>{if(!confirm('Only continue after saving the export. These local changes will NOT be applied to shared stock. Discard them?'))return;localStorage.removeItem('panelstock:pendingSync');localStorage.removeItem('panelstock:outbox:v2');location.reload();};el.appendChild(discard);}};
    el.appendChild(exportButton);
  }
  if(navigator.locks){void navigator.locks.request('panelstock-editor-v2',{ifAvailable:true},lock=>{if(!lock){lockDenied=true;announce('storage','PanelStock is already open in another tab. Use that tab or close it and reload.');return;}lockGranted=true;return new Promise(()=>{});});}
  else{lockGranted=false;queueMicrotask(()=>announce('storage','This browser cannot safely coordinate offline changes. Use an up-to-date browser.'));}
  root.PanelStock={
    apiFetch,outbox,
    async init(url){workerUrl=url.replace(/\/$/,'');if(!session)return null;try{const r=await apiFetch(workerUrl+'/session');if(!r.ok)return null;const user=await r.json();session={...session,...user};return user;}catch{announce('offline','Connection needed to verify login.');return null;}},
    async snapshot(){if(!session)return null;await outbox.flush(session.username);const r=await apiFetch(workerUrl+'/data');if(!r.ok)return null;return outbox.snapshot(await r.json(),session.username);},
    stage(fields,rendered){if(!lockGranted)throw Error('This tab cannot edit stock.');if(!session)throw Error('Please log in before editing.');outbox.stage(fields,session.username,rendered);},
    async flush(){return session?outbox.flush(session.username):false;},
    async logout(){try{if(session)await apiFetch(workerUrl+'/logout',{method:'POST'});}finally{session=null;sessionStorage.removeItem(SESSION);}},
    get username(){return session?.username||null;},
    get revision(){return outbox.state.view?.revision;},
    get status(){return status;},
    get pending(){return outbox.pending();}
  };
  root.addEventListener('online',()=>{void root.PanelStock.flush();});
  root.addEventListener('beforeunload',event=>{if(outbox.pending()){event.preventDefault();event.returnValue='';}});
  queueMicrotask(renderNotice);
})(typeof window==='undefined'?globalThis:window);
