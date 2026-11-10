import {gateProgressStageDefinitions,gateProgressStages} from './gate-progress-stages.js';
export function gateProgressApp(options){
 const root=options.root,base=String(options.workerUrl||'').replace(/\/$/,''),controller=new AbortController();
 root.querySelectorAll('a[href^="/gate-progress/"]').forEach(a=>a.href=base+a.getAttribute('href'));
 const $=selector=>root.querySelector(selector),esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
 let data=null,epoch=0,busy=false,context=null,destroyed=false,focused=false;
 const message=text=>{$('#notice').textContent=text||'';const dialogNotice=$('#dialogNotice');if(dialogNotice){dialogNotice.textContent=text||'';dialogNotice.hidden=!text;}};
 const date=value=>value?new Date(value).toLocaleString('en-AU',{timeZone:'Australia/Brisbane'}):'';
 const groupKey=order=>'villa:'+JSON.stringify([order.project,order.villa]);
 const orderFor=id=>data.orders.find(order=>order.id===id);
 async function api(path,body,auth=true){
  const request=auth?options.apiFetch:fetch,response=await request(base+path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),cache:'no-store'}),result=await response.json();
  if(!response.ok)throw Error(result.error||'The request could not be completed');return result;
 }
 async function load(sample=false){
  const version=epoch;
  try{
   const result=await api(sample?'/gate-progress/sample':'/gate-components',undefined,!sample);if(version!==epoch||destroyed)return;
   data=result;
   render();
   if(!sample&&!focused&&options.orderId){focused=true;const order=orderFor(options.orderId);if(order){root.querySelector('[data-gate-order="'+CSS.escape(order.id)+'"]')?.scrollIntoView({block:'start'});if(!order.spec&&data.canManage)plan(order);}}
   return true;
  }catch(error){if(version===epoch&&!destroyed)message(error.message);return false;}
 }
 function stageCells(components,settings={}){
  return gateProgressStages(components,settings).map(stage=>{
   const component=components.length===1?components[0]:null,evidence=stage.key==='fabricatedQa'?[component?.checkedBy,date(component?.checkedAt)].filter(Boolean).join(' · '):stage.key==='dispatched'?date(component?.shipment?.at):stage.key==='delivered'?date(component?.delivery?.at):'';
   const description=stage.label+': '+stage.detail+(evidence?' · '+evidence:'');
   return `<td class="stage-cell is-${stage.state}" data-stage="${stage.key}" aria-label="${esc(description)}" title="${esc(description)}"><span class="stage-marker" aria-hidden="true">${stage.symbol}</span></td>`;
  }).join('');
 }
 function componentRow(order,component){
  return `<tr class="component-row" data-component="${esc(component.id)}"><th scope="row"><div class="row-identity component-identity"><span><strong>${esc(component.label)}</strong><small>Set ${component.set}</small></span></div></th>${stageCells([component],{scheduled:order.scheduledForProduction?1:0})}</tr>`;
 }
 function orderRows(order){
  const identity=`<strong>Order ${esc(order.orderNumber)} — ${esc(order.orderType)} — <span class="order-villa">Villa ${esc(order.villa||'not recorded')}</span></strong>`,missing=!order.components.length;
  const edit=data.canManage&&order.status!=='dispatched'?`<button type="button" class="edit-order" data-action="plan" data-order="${esc(order.id)}" aria-label="Edit Order ${esc(order.orderNumber)}"><svg width="13" height="13" viewBox="0 0 20 20" aria-hidden="true"><path d="m12 4 4 4M3 17l4-1L17 6a2.8 2.8 0 0 0-4-4L3 12v5Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>Edit</button>`:'';
  const row=`<tr class="order-row" data-gate-order="${esc(order.id)}"><th scope="row"><div class="row-identity order-identity"><span>${identity}<small>${order.areaM2==null?'Area not recorded':esc(order.areaM2)+' m² total'}${missing?' · Components not configured':''}</small></span>${edit}</div></th>${stageCells(order.components,{missing,scheduled:order.scheduledForProduction?1:0})}</tr>`;
  return row+[...new Set(order.components.map(component=>component.set))].map(set=>{
   const components=order.components.filter(component=>component.set===set),heading=`<tr class="set-row"><th scope="row"><div class="row-identity set-identity"><span><strong>Set ${set}</strong><small>${components.length} components</small></span></div></th>${stageCells(components,{scheduled:order.scheduledForProduction?1:0})}</tr>`;
   return heading+components.map(component=>componentRow(order,component)).join('');
  }).join('');
 }
 function render(){
  $('#newOrder').hidden=!data?.canCreate||data?.sample;$('#export').hidden=!!data?.sample;$('#mode').textContent=data?.sample?'Sample data · Switch back with Refresh to see staging orders.':'Staging data · '+(data?.orders.length||0)+' gate orders';
  if(!data){$('#content').innerHTML='<p>Loading gate progress…</p>';return;}
  const groups=new Map();for(const order of data.orders){const key=groupKey(order);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(order);}
  $('#content').innerHTML=(data.sample?'<div class="banner">Sample view. Download the sample Excel to review the component layout.</div>':'')+([...groups.values()].map(orders=>{
   const first=orders[0],components=orders.flatMap(order=>order.components);
   return `<section class="card"><div class="villa-head"><h2>${esc(first.project)}</h2><span>${orders.length} order${orders.length===1?'':'s'} · ${components.length} components</span></div><div class="scroll" role="region" aria-label="${esc('Gate progress for Villa '+(first.villa||'not recorded'))}" tabindex="0"><table><thead><tr><th scope="col">Order / component</th>${gateProgressStageDefinitions.map(([,label])=>`<th scope="col" class="stage-heading"><span>${label}</span></th>`).join('')}</tr></thead><tbody><tr class="villa-row"><th scope="row" colspan="${gateProgressStageDefinitions.length+1}"><div class="group-identity"><span class="group-label">GATE GROUP</span><strong>Villa ${esc(first.villa||'not recorded')}</strong></div></th></tr>${orders.map(orderRows).join('')}</tbody></table></div></section>`;
  }).join('')||'<div class="empty">No gate orders in this staging workspace. Create a staging order to try the workflow.</div>');
 }
 const cancel='<button type="button" data-action="close">Cancel</button>';
 function open(html,ctx){context=ctx;$('#dialogBody').innerHTML='<p id="dialogNotice" role="status" hidden></p>'+html;$('#editor').showModal();}
 function initialSets(order){
  if(order.spec?.sets)return order.spec.sets;
  if(String(order.orderType).trim().toLowerCase()==='buggy gate'&&order.spec?.gateCount!=null)return [{gates:order.spec.gateCount,highlights:0,posts:0}];
  if(Array.isArray(order.spec?.highlights)&&order.spec.highlights.length)return order.spec.highlights.map(highlights=>({gates:1,highlights,posts:1}));
  return [{gates:0,highlights:0,posts:0}];
 }
 function setFields(){
  const count=Number($('#editor [name=setCount]').value),host=$('#setComponents'),previous=[...host.querySelectorAll('fieldset')].map(fieldset=>Object.fromEntries([...fieldset.querySelectorAll('input')].map(input=>[input.dataset.part,input.value]))),defaults=initialSets(context.order);
  host.innerHTML=Array.from({length:count},(_,index)=>{
   const values=previous[index]||defaults[index]||{gates:0,highlights:0,posts:0};
   return `<fieldset class="component-editor-set"><legend>Set ${index+1}</legend><div class="three">${[['gates','Gates'],['highlights','Highlights'],['posts','Posts']].map(([key,label])=>`<label>${label}<input type="number" name="${key}${index}" data-part="${key}" aria-label="Set ${index+1} ${label.toLowerCase()}" min="${context.buggy&&key==='gates'?1:0}" max="${context.buggy&&key==='gates'?2:4}" step="1" value="${esc(values[key])}" required></label>`).join('')}</div></fieldset>`;
  }).join('');
 }
 function plan(order){
  const buggy=String(order.orderType).trim().toLowerCase()==='buggy gate',sets=initialSets(order);
  open(`<h2>${order.spec?'Edit gate components':'Confirm Drawn & components'}</h2><p>${esc(order.project)} · Villa ${esc(order.villa)} · Order ${esc(order.orderNumber)}</p><form data-form="plan"><label>Sets<select name="setCount" aria-label="Sets"><option value="1">1 set</option>${buggy?'':`<option value="2" ${sets.length===2?'selected':''}>2 sets</option>`}</select></label><div id="setComponents"></div><p class="muted">Choose the parts on the drawing. Use 0 for any part that is not included.${buggy?' Buggy orders contain one or two gates.':''}</p><label>Total order area (m²)<input name="areaM2" type="number" min="0.000001" max="99999" step="any" value="${esc(order.areaM2??'')}" required></label><p class="muted">Existing approvals stay with the same parts. Inspected or dispatched parts cannot be removed.</p><div class="actions"><button class="primary">${order.spec?'Save changes':'Confirm Drawn & components'}</button>${cancel}</div></form>`,{type:'plan',order,buggy});setFields();
 }
 root.addEventListener('focusin',event=>{if(event.target.matches('input[data-part]'))event.target.select();},{signal:controller.signal});
 root.addEventListener('change',event=>{if(event.target.name==='setCount')setFields();},{signal:controller.signal});
 root.addEventListener('click',async event=>{
  if(event.target.matches('input[data-part]'))event.target.select();
  const button=event.target.closest('[data-action]');if(!button||busy)return;
  try{
   const action=button.dataset.action;
   if(action==='close'){$('#editor').close();context=null;message('');}
   else if(action==='sample'){epoch++;await load(true);}
   else if(action==='refresh'){epoch++;message('');await load();}
   else if(action==='plan')plan(orderFor(button.dataset.order));
   else if(action==='new')open('<h2>New staging gate order</h2><form data-form="new"><label>Project<input name="project" required></label><div class="two"><label>Villa<input name="villa" required></label><label>Gate type<select name="orderType"><option>Bin Gate</option><option>Buggy Gate</option><option>Side Access Gate</option></select></label></div><div class="two"><label>Colour<select name="colour"><option>Spruce</option><option>Norwegian Beech</option></select></label><label>Requested date<input type="date" name="requestedDeliveryDate" required></label></div><div class="actions"><button class="primary">Create staging order</button>'+cancel+'</div></form>',{type:'new',mutationId:crypto.randomUUID()});
   else if(action==='export'){
    const version=epoch,response=await options.apiFetch(base+'/gate-progress/export',{cache:'no-store'});if(!response.ok)throw Error('Sign in again to download the staging snapshot.');const blob=await response.blob();if(version!==epoch||destroyed)return;
    const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='GATE_PROGRESS_STAGING.xlsx';link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
   }
  }catch(error){if(!destroyed)message(error.message);}
 },{signal:controller.signal});
 root.addEventListener('submit',async event=>{
  const form=event.target;if(!form.dataset.form)return;event.preventDefault();if(busy)return;
  const version=epoch,ctx=context,values=Object.fromEntries(new FormData(form));busy=true;form.querySelectorAll('button').forEach(button=>button.disabled=true);message('');
  try{
   let result;
   if(ctx.type==='new')result=await api('/orders',{idempotencyKey:ctx.mutationId,order:{...values,siteContact:'Staging review',phone:'Staging',items:[{quantity:1,description:values.orderType+' · '+values.villa}]}});
   else{
    const sets=Array.from({length:Number(values.setCount)},(_,index)=>Object.fromEntries(['gates','highlights','posts'].map(key=>[key,Number(values[key+index])])));
    result=await api('/gate-components/orders/'+ctx.order.id+'/plan',{expectedUpdatedAt:ctx.order.updatedAt,spec:{sets},areaM2:Number(values.areaM2)});
   }
   if(version!==epoch||destroyed)return;const refreshed=await load();if(version!==epoch||destroyed)return;$('#editor').close();context=null;
   if(refreshed&&ctx.type==='new')plan(orderFor(result.order.id));message(!refreshed?'Saved. Use Refresh to load the latest gate progress.':ctx.type==='new'?'Staging order created. Confirm its components next.':'Saved. Gate progress has been refreshed.');
  }catch(error){if(version===epoch&&!destroyed)message(error.message);}
  finally{busy=false;if(version===epoch&&!destroyed)form.querySelectorAll('button').forEach(button=>button.disabled=false);}
 },{signal:controller.signal});
 load();return {destroy(){destroyed=true;epoch++;controller.abort();$('#editor')?.close();root.innerHTML='';}};
}
