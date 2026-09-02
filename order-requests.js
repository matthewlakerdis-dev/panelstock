(function(root){
  'use strict';
  if(!root.document)return;
  const STORAGE='panelstock:order-outbox:v1';
  const copy=value=>JSON.parse(JSON.stringify(value));
  const load=()=>{try{return JSON.parse(localStorage.getItem(STORAGE)||'null')||{owner:null,queue:[]};}catch{return {owner:null,queue:[]};}};
  const save=value=>localStorage.setItem(STORAGE,JSON.stringify(value));
  let outbox=load(),orders=[],open=false,busy=false,error='';
  const style=document.createElement('style');style.textContent=`
    #ps-order-button{position:fixed;right:18px;bottom:18px;z-index:90000;border:0;border-radius:999px;background:#0f766e;color:white;padding:13px 18px;font:700 14px system-ui;box-shadow:0 8px 24px #0f172a33;display:none}
    #ps-orders{position:fixed;inset:0;z-index:90001;background:#0f172a88;padding:18px;overflow:auto;font:14px system-ui;color:#0f172a}
    #ps-orders .panel{max-width:940px;margin:auto;background:white;border-radius:16px;padding:20px;box-shadow:0 20px 60px #0004}
    #ps-orders header{display:flex;align-items:center;justify-content:space-between;gap:12px}#ps-orders h2,#ps-orders h3{margin:0 0 12px}
    #ps-orders .grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}#ps-orders label{display:grid;gap:5px;font-weight:700}
    #ps-orders input,#ps-orders select,#ps-orders textarea{box-sizing:border-box;width:100%;border:1px solid #cbd5e1;border-radius:8px;padding:10px;font:inherit;background:white}
    #ps-orders .wide{grid-column:1/-1}.ps-items{margin:14px 0}.ps-item{display:grid;grid-template-columns:100px 1fr 42px;gap:8px;margin:7px 0}
    #ps-orders button{border:1px solid #cbd5e1;border-radius:8px;padding:9px 12px;background:white;font:700 13px system-ui;cursor:pointer}#ps-orders .primary{background:#0f766e;color:white;border-color:#0f766e}
    #ps-orders .notice{padding:10px;border-radius:8px;background:#fff7ed;color:#9a3412;margin:10px 0}.ps-order{border:1px solid #e2e8f0;border-radius:10px;padding:12px;margin:9px 0;display:flex;gap:12px;justify-content:space-between;align-items:center}.ps-order small{color:#64748b}.ps-actions{display:flex;gap:7px;flex-wrap:wrap;justify-content:flex-end}
    @media(max-width:650px){#ps-orders{padding:0}#ps-orders .panel{min-height:100vh;border-radius:0;padding:15px}#ps-orders .grid{grid-template-columns:1fr}#ps-orders .wide{grid-column:auto}.ps-order{align-items:flex-start;flex-direction:column}.ps-actions{justify-content:flex-start}.ps-item{grid-template-columns:78px 1fr 40px}}
  `;document.head.appendChild(style);
  const button=document.createElement('button');button.id='ps-order-button';button.type='button';button.textContent='Order requests';document.body.appendChild(button);
  const modal=document.createElement('div');modal.id='ps-orders';modal.hidden=true;document.body.appendChild(modal);
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const sessionReady=()=>!!root.PanelStock?.username;
  const pendingFor=id=>outbox.queue.find(packet=>packet.localId===id);
  async function flush(){
    if(busy||!sessionReady()||!navigator.onLine||!outbox.queue.length||outbox.owner!==root.PanelStock.username)return;
    busy=true;error='';render();
    try{
      while(outbox.queue.length){
        const packet=outbox.queue[0],response=await root.PanelStock.request('/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({idempotencyKey:packet.idempotencyKey,order:packet.order})});
        if(!response.ok){const result=await response.json().catch(()=>({}));throw Error(result.error||`Order sync failed (HTTP ${response.status})`);}
        outbox.queue.shift();save(outbox);
      }
      await refresh();
    }catch(reason){error=reason.message||'Order sync failed. Your request remains saved on this device.';}
    finally{busy=false;render();}
  }
  async function refresh(){
    if(!sessionReady())return;
    try{const response=await root.PanelStock.request('/orders');if(response.ok)orders=(await response.json()).orders||[];}catch{}
  }
  function addItem(){const list=modal.querySelector('.ps-items');const row=document.createElement('div');row.className='ps-item';row.innerHTML='<input name="quantity" type="number" min="1" step="1" value="1" required aria-label="Quantity"><input name="description" maxlength="180" required placeholder="Item description" aria-label="Description"><button type="button" aria-label="Remove item">×</button>';row.querySelector('button').onclick=()=>row.remove();list.appendChild(row);}
  function render(){
    button.style.display=sessionReady()?'block':'none';if(!open)return;
    const pending=outbox.queue.map(packet=>({id:packet.localId,orderNumber:'Pending',project:packet.order.project,status:'saved offline',createdAt:packet.createdAt,items:packet.order.items,local:true}));
    modal.hidden=false;modal.innerHTML=`<div class="panel"><header><div><h2>Site order requests</h2><div>Requests are stored separately from stock changes.</div></div><button data-close type="button">Close</button></header>
      ${(error||outbox.queue.length)?`<div class="notice">${esc(error||`${outbox.queue.length} request${outbox.queue.length===1?'':'s'} saved on this device, waiting to sync.`)} <button data-retry type="button">${busy?'Syncing…':'Retry'}</button></div>`:''}
      <details open><summary><strong>New request</strong></summary><form><div class="grid">
        <label>Project<input name="project" required maxlength="120"></label><label>Order type<select name="orderType"><option>Panels</option><option>Fixings</option><option>Plant / Equipment</option><option>Other</option></select></label>
        <label>Site contact<input name="siteContact" required maxlength="100"></label><label>Phone<input name="phone" required maxlength="40" inputmode="tel"></label>
        <label>Requested delivery date<input name="requestedDeliveryDate" type="date" required></label><label>Requested delivery time<input name="requestedDeliveryTime" type="time"></label>
        <label class="wide">Location / notes<textarea name="locationNotes" maxlength="300" rows="2"></textarea></label></div>
        <div class="ps-items"><strong>Items</strong></div><button data-add type="button">Add item</button> <button class="primary" type="submit">Submit order request</button></form></details>
      <h3 style="margin-top:22px">Current requests</h3><div>${[...pending,...orders].map(order=>`<div class="ps-order"><div><strong>#${esc(order.orderNumber)} · ${esc(order.project)}</strong><br><small>${esc(order.status)} · ${order.items?.length||0} item${order.items?.length===1?'':'s'} · ${esc(new Date(order.createdAt).toLocaleString('en-AU'))}</small></div><div class="ps-actions">${order.local?'':`<button data-pdf="${esc(order.id)}">Download PDF</button>`}${root.PanelStock?.isAdmin&&!order.local?`<select data-status="${esc(order.id)}"><option value="submitted">Submitted</option><option value="approved">Approved</option><option value="ordered">Ordered</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></select>`:''}</div></div>`).join('')||'<p>No order requests yet.</p>'}</div></div>`;
    modal.querySelector('[data-close]').onclick=()=>{open=false;modal.hidden=true;};modal.querySelector('[data-add]').onclick=addItem;modal.querySelector('[data-retry]')?.addEventListener('click',flush);
    addItem();
    modal.querySelector('form').onsubmit=event=>{
      event.preventDefault();const form=new FormData(event.currentTarget),items=[...modal.querySelectorAll('.ps-item')].map(row=>({quantity:Number(row.querySelector('[name=quantity]').value),description:row.querySelector('[name=description]').value.trim()})).filter(item=>item.quantity>0&&item.description);
      if(!items.length){error='Add at least one item.';render();return;}
      const order={project:form.get('project'),orderType:form.get('orderType'),siteContact:form.get('siteContact'),phone:form.get('phone'),requestedDeliveryDate:form.get('requestedDeliveryDate'),requestedDeliveryTime:form.get('requestedDeliveryTime'),locationNotes:form.get('locationNotes'),items};
      if(outbox.queue.length&&outbox.owner!==root.PanelStock.username){error='Pending order requests belong to another user on this device.';render();return;}
      outbox.owner=root.PanelStock.username;outbox.queue.push({localId:crypto.randomUUID(),idempotencyKey:crypto.randomUUID(),order:copy(order),createdAt:new Date().toISOString()});save(outbox);render();void flush();
    };
    modal.querySelectorAll('[data-pdf]').forEach(el=>el.onclick=async()=>{el.disabled=true;el.textContent='Preparing…';try{const response=await root.PanelStock.request('/orders/'+el.dataset.pdf+'/pdf');if(!response.ok)throw Error('PDF could not be generated');const blob=await response.blob(),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=(response.headers.get('Content-Disposition')||'').match(/filename="([^"]+)"/)?.[1]||'Site-Order.pdf';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),5000);}catch(reason){error=reason.message;render();}});
    modal.querySelectorAll('[data-status]').forEach(el=>{el.value=orders.find(order=>order.id===el.dataset.status)?.status||'submitted';el.onchange=async()=>{const response=await root.PanelStock.request('/orders/'+el.dataset.status+'/status',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:el.value})});if(!response.ok){error=(await response.json().catch(()=>({}))).error||'Status update failed';}await refresh();render();};});
  }
  Object.defineProperty(root.PanelStock||{},'isAdmin',{get(){try{return JSON.parse(sessionStorage.getItem('panelstock:session:v2')||'null')?.isAdmin||false;}catch{return false;}},configurable:true});
  button.onclick=async()=>{open=true;error='';await refresh();render();void flush();};
  root.addEventListener('online',flush);root.addEventListener('panelstock-session-expired',render);setInterval(()=>{const visible=sessionReady();button.style.display=visible?'block':'none';if(visible&&outbox.queue.length)void flush();},2000);
})(window);

