import {gateProgressStageDefinitions,gateProgressStages,isGateProgressComplete} from './gate-progress-stages.js';
export function gateProgressApp(options){
 const root=options.root,base=String(options.workerUrl||'').replace(/\/$/,''),controller=new AbortController(),expanded=new Set();
 root.querySelectorAll('a[href^="/gate-progress/"]').forEach(a=>a.href=base+a.getAttribute('href'));
 const $=selector=>root.querySelector(selector),esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
 let data=null,epoch=0,busy=false,context=null,destroyed=false,focused=false,loadVersion=0;
 const message=text=>{$('#notice').textContent=text||'';const dialogNotice=$('#dialogNotice');if(dialogNotice){dialogNotice.textContent=text||'';dialogNotice.hidden=!text;}};
 const date=value=>value?new Date(value).toLocaleString('en-AU',{timeZone:'Australia/Brisbane'}):'';
 const groupKey=order=>'villa:'+JSON.stringify([order.project,order.villa]),orderKey=order=>'order:'+order.id,setKey=(order,set)=>'set:'+order.id+':'+set;
 const chevron='<svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true"><path d="m7 4 6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
 const toggle=(key,name,label)=>`<button type="button" class="tree-toggle" data-action="toggle" data-collapse-key="${esc(key)}" aria-expanded="${expanded.has(key)}" aria-label="${esc((expanded.has(key)?'Collapse ':'Expand ')+name)}">${chevron}<span>${label}</span></button>`;
 const orderFor=id=>data.orders.find(order=>order.id===id);
 async function api(path,body,auth=true){
  const request=auth?options.apiFetch:fetch,response=await request(base+path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),cache:'no-store'}),result=await response.json();
  if(!response.ok)throw Error(result.error||'The request could not be completed');return result;
 }
 async function load(){
  const version=epoch,requestVersion=++loadVersion;
  try{
   const result=await api('/gate-components');if(version!==epoch||destroyed||requestVersion!==loadVersion)return;
   data=result;
   if(!focused&&options.orderId){const order=orderFor(options.orderId);if(order){expanded.add(groupKey(order));expanded.add(orderKey(order));for(const set of new Set(order.components.map(component=>component.set)))expanded.add(setKey(order,set));}}
   render();
   if(!focused&&options.orderId){focused=true;const order=orderFor(options.orderId);if(order){root.querySelector('[data-gate-order="'+CSS.escape(order.id)+'"]')?.scrollIntoView({block:'start'});if(!order.spec&&data.canManage)plan(order);}}
   return true;
  }catch(error){if(version===epoch&&!destroyed&&requestVersion===loadVersion)message(error.message);return false;}
 }
 function stageCells(components,settings={}){
  return gateProgressStages(components,settings).map(stage=>{
   const component=components.length===1?components[0]:null,evidence=stage.key==='fabricatedQa'?[component?.checkedBy,date(component?.checkedAt)].filter(Boolean).join(' · '):stage.key==='dispatched'?date(component?.shipment?.at):stage.key==='delivered'?date(component?.delivery?.at):'';
   const description=stage.label+': '+stage.detail+(evidence?' · '+evidence:'');
   return `<td class="stage-cell is-${stage.state}" data-stage="${stage.key}" aria-label="${esc(description)}" title="${esc(description)}"><span class="stage-marker" aria-hidden="true">${stage.symbol}</span></td>`;
  }).join('');
 }
 function componentRow(order,component){
  return `<tr class="component-row" data-component="${esc(component.id)}"><th scope="row"><div class="row-identity component-identity"><span><strong>${esc(component.label)}</strong><small>Set ${component.set}</small></span></div></th>${stageCells([component],{scheduled:order.scheduledForProduction?1:0,legacyStages:order.legacyStages})}</tr>`;
 }
 function orderRows(order){
  const identity=`<strong>Order ${esc(order.orderNumber)} — ${esc(order.orderType)} — <span class="order-villa">Villa ${esc(order.villa||'not recorded')}</span></strong>`,missing=!order.components.length;
  const edit=data.canManage&&order.status!=='dispatched'?`<button type="button" class="edit-order" data-action="plan" data-order="${esc(order.id)}" aria-label="Edit Order ${esc(order.orderNumber)}"><svg width="13" height="13" viewBox="0 0 20 20" aria-hidden="true"><path d="m12 4 4 4M3 17l4-1L17 6a2.8 2.8 0 0 0-4-4L3 12v5Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>Edit</button>`:'';
  const row=`<tr class="order-row" data-gate-order="${esc(order.id)}"><th scope="row"><div class="row-identity order-identity"><span>${order.components.length?toggle(orderKey(order),'Order '+order.orderNumber,identity):identity}<small>${order.areaM2==null?'Area not recorded':esc(order.areaM2)+' m² total'}${missing?' · Confirm components from the drawing':''}</small></span>${edit}</div></th>${stageCells(order.components,{missing,scheduled:order.scheduledForProduction?1:0,legacyStages:order.legacyStages})}</tr>`;
  if(!expanded.has(orderKey(order)))return row;
  return row+[...new Set(order.components.map(component=>component.set))].map(set=>{
   const components=order.components.filter(component=>component.set===set),heading=`<tr class="set-row"><th scope="row"><div class="row-identity set-identity"><span>${toggle(setKey(order,set),'Set '+set+' for Order '+order.orderNumber,'Set '+set)}<small>${components.length} components</small></span></div></th>${stageCells(components,{scheduled:order.scheduledForProduction?1:0})}</tr>`;
   return heading+(expanded.has(setKey(order,set))?components.map(component=>componentRow(order,component)).join(''):'');
  }).join('');
 }
 function render(){
  const active=(data?.orders||[]).filter(order=>!isGateProgressComplete(order));$('#mode').textContent='Gate progress · '+active.length+' active gate orders';
  if(!data){$('#content').innerHTML='<p>Loading gate progress…</p>';return;}
  const groups=new Map();for(const order of active){const key=groupKey(order);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(order);}
  $('#content').innerHTML=([...groups.values()].map(orders=>{
   const first=orders[0],components=orders.flatMap(order=>order.components);
   return `<section class="card"><div class="villa-head"><h2>${esc(first.project)}</h2><span>${orders.length} order${orders.length===1?'':'s'} · ${components.length} components</span></div><div class="scroll" role="region" aria-label="${esc('Gate progress for Villa '+(first.villa||'not recorded'))}" tabindex="0"><table><thead><tr><th scope="col">Order / component</th>${gateProgressStageDefinitions.map(([,label])=>`<th scope="col" class="stage-heading"><span>${label}</span></th>`).join('')}</tr></thead><tbody><tr class="villa-row"><th scope="row" colspan="${gateProgressStageDefinitions.length+1}"><div class="group-identity"><span class="group-label">GATE GROUP</span>${toggle(groupKey(first),'Villa '+(first.villa||'not recorded'),'<strong>Villa '+esc(first.villa||'not recorded')+'</strong>')}</div></th></tr>${expanded.has(groupKey(first))?orders.map(orderRows).join(''):''}</tbody></table></div></section>`;
  }).join('')||'<div class="empty">No gate orders to show. Create an order in Site Orders to get started.</div>');
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
 function previousQa(order){
  const records=order.previousQa||[];if(!records.length)return '';
  return '<details class="previous-qa"><summary>Earlier order QA reports ('+records.length+')</summary>'+records.map(record=>'<article><strong>'+esc(record.reference)+'</strong>'+(record.history?.length?record.history:record.latest?[record.latest]:[]).map(attempt=>'<p>'+esc([attempt.status,attempt.checkedBy,date(attempt.checkedAt)].filter(Boolean).join(' · '))+'</p><ul>'+Object.entries(attempt.results||{}).map(([key,value])=>'<li>'+esc((attempt.checklist||data.checklist||[]).find(([id])=>id===key)?.[1]||key)+': '+esc(value==='na'?'n/a':value)+'</li>').join('')+'</ul>'+(attempt.notes?'<p>'+esc(attempt.notes)+'</p>':'')+[...(attempt.photos||[]),...(attempt.photo?[attempt.photo]:[])].filter((value,index,all)=>all.indexOf(value)===index&&/^data:image\/(png|jpeg|webp);base64,/.test(value)).map(value=>'<img class="previous-qa-photo" src="'+esc(value)+'" alt="Earlier QA evidence">').join('')).join('')+'</article>').join('')+'</details>';
 }
 function plan(order){
  const buggy=String(order.orderType).trim().toLowerCase()==='buggy gate',sets=initialSets(order);
  open(`<h2>${order.spec||order.legacyQa?'Edit gate components':'Confirm Drawn & components'}</h2><p>${esc(order.project)} · Villa ${esc(order.villa)} · Order ${esc(order.orderNumber)}</p>${previousQa(order)}<form data-form="plan"><label>Sets<select name="setCount" aria-label="Sets"><option value="1">1 set</option>${buggy?'':`<option value="2" ${sets.length===2?'selected':''}>2 sets</option>`}</select></label><div id="setComponents"></div><p class="muted">Choose the parts on the drawing. Use 0 for any part that is not included.${buggy?' Buggy orders contain one or two gates.':''}</p><label>Total order area (m²)<input name="areaM2" type="number" min="0.000001" max="99999" step="any" value="${esc(order.areaM2??'')}" required></label><p class="muted">${order.hasRecordedQa?'Earlier order QA will be retained below. The new component checks will determine readiness and production totals.':'Existing approvals stay with the same parts. Inspected or dispatched parts cannot be removed.'}</p>${order.hasRecordedQa?`<label class="legacy-qa-review"><input type="checkbox" name="confirmLegacyQa" required> I have reviewed the earlier QA. Keep those reports and create separate QA checks for these components. Readiness will update from the new component checks.</label>`:''}<div class="actions"><button class="primary">${order.spec||order.legacyQa?'Save changes':'Confirm Drawn & components'}</button>${cancel}</div></form>`,{type:'plan',order,buggy});setFields();
 }
 root.addEventListener('focusin',event=>{if(event.target.matches('input[data-part]'))event.target.select();},{signal:controller.signal});
 root.addEventListener('change',event=>{if(event.target.name==='setCount')setFields();},{signal:controller.signal});
 root.addEventListener('click',async event=>{
  if(event.target.matches('input[data-part]'))event.target.select();
  const button=event.target.closest('[data-action]');if(!button||busy)return;
  try{
   const action=button.dataset.action;
   if(action==='toggle'){const key=button.dataset.collapseKey;expanded.has(key)?expanded.delete(key):expanded.add(key);render();root.querySelector('[data-collapse-key="'+CSS.escape(key)+'"]')?.focus({preventScroll:true});}
   else if(action==='close'){$('#editor').close();context=null;message('');}
   else if(action==='refresh'){epoch++;message('');await load();}
   else if(action==='plan')plan(orderFor(button.dataset.order));

  }catch(error){if(!destroyed)message(error.message);}
 },{signal:controller.signal});
 root.addEventListener('submit',async event=>{
  const form=event.target;if(!form.dataset.form)return;event.preventDefault();if(busy)return;
  const version=epoch,ctx=context,values=Object.fromEntries(new FormData(form));busy=true;form.querySelectorAll('button').forEach(button=>button.disabled=true);message('');
  try{
   const sets=Array.from({length:Number(values.setCount)},(_,index)=>Object.fromEntries(['gates','highlights','posts'].map(key=>[key,Number(values[key+index])])));
   await api('/gate-components/orders/'+ctx.order.id+'/plan',{expectedUpdatedAt:ctx.order.updatedAt,spec:{sets},areaM2:Number(values.areaM2),confirmLegacyQa:values.confirmLegacyQa==='on'});
   if(version!==epoch||destroyed)return;const refreshed=await load();if(version!==epoch||destroyed)return;$('#editor').close();context=null;
   message(!refreshed?'Saved. Use Refresh to load the latest gate progress.':'Saved. Gate progress has been refreshed.');
  }catch(error){if(version===epoch&&!destroyed)message(error.message);}
  finally{busy=false;if(version===epoch&&!destroyed)form.querySelectorAll('button').forEach(button=>button.disabled=false);}
 },{signal:controller.signal});
 const refresh=()=>{if(!busy&&!destroyed&&!$('#editor').open&&!document.hidden)void load();};
 window.addEventListener('panelstock-remote-change',refresh,{signal:controller.signal});window.addEventListener('online',refresh,{signal:controller.signal});document.addEventListener('visibilitychange',refresh,{signal:controller.signal});const timer=setInterval(refresh,30000);
 load();return {destroy(){destroyed=true;epoch++;clearInterval(timer);controller.abort();$('#editor')?.close();root.innerHTML='';}};
}
