import {gateProgressStageDefinitions,gateProgressStages,gateProgressSummary,isGateProgressComplete} from './gate-progress-stages.js';
export function gateProgressApp(options){
 const root=options.root,base=String(options.workerUrl||'').replace(/\/$/,''),controller=new AbortController(),expanded=new Set();
 root.querySelectorAll('a[href^="/gate-progress/"]').forEach(a=>a.href=base+a.getAttribute('href'));
 const $=selector=>root.querySelector(selector),esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
 let data=null,epoch=0,busy=false,context=null,destroyed=false,focused=false,initialized=false,loadVersion=0;
 const message=text=>{$('#notice').textContent=text||'';const dialogNotice=$('#dialogNotice');if(dialogNotice){dialogNotice.textContent=text||'';dialogNotice.hidden=!text;}};
 const date=value=>value?new Date(value).toLocaleString('en-AU',{timeZone:'Australia/Brisbane'}):'';
 const groupKey=order=>'villa:'+JSON.stringify([order.project,order.villa]),orderKey=order=>'order:'+order.id,setKey=(order,set)=>'set:'+order.id+':'+set;
 const chevron='<svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true"><path d="m7 4 6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
 const toggle=(key,name,label)=>`<button type="button" class="tree-toggle" data-action="toggle" data-collapse-key="${esc(key)}" aria-expanded="${expanded.has(key)}" aria-label="${esc((expanded.has(key)?'Collapse ':'Expand ')+name)}">${chevron}<span>${label}</span></button>`;
 const toggleSection=key=>{expanded.has(key)?expanded.delete(key):expanded.add(key);render();root.querySelector('[data-action="toggle"][data-collapse-key="'+CSS.escape(key)+'"]')?.focus({preventScroll:true});};
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
   if(!initialized){initialized=true;if(!options.orderId){const first=data.orders.find(order=>!isGateProgressComplete(order));if(first){expanded.add(groupKey(first));if(first.components.length){expanded.add(orderKey(first));for(const set of new Set(first.components.map(component=>component.set)))expanded.add(setKey(first,set));}}}}
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
   return `<td class="stage-cell is-${stage.state}" data-stage="${stage.key}" aria-label="${esc(description)}" title="${esc(description)}"><span class="stage-marker" aria-hidden="true">${stage.state==='rework'?'!':stage.symbol}</span></td>`;
  }).join('');
 }
 function detailsButton(order,component,extra=''){
  return `<button type="button" class="component-details ${extra}" data-action="details" data-order="${esc(order.id)}" data-component="${esc(component.id)}" aria-label="Details for ${esc(component.label)}, Set ${component.set}, Order ${esc(order.orderNumber)}">Details <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 8 8 2M2 2h6v6" fill="none" stroke="currentColor" stroke-width="1.2"/></svg></button>`;
 }
 function componentRow(order,component){
  return `<tr class="component-row" data-component="${esc(component.id)}"><th scope="row"><div class="row-identity component-identity"><span><strong>${esc(component.label)}</strong>${detailsButton(order,component,'mobile-details')}</span></div></th>${stageCells([component],{scheduled:order.scheduledForProduction?1:0,legacyStages:order.legacyStages})}<td class="detail-cell">${detailsButton(order,component)}</td></tr>`;
 }
 function orderRows(order){
  const identity=`<strong>Order ${esc(order.orderNumber)}</strong>`,missing=!order.components.length;
  const edit=data.canManage&&order.status!=='dispatched'?`<button type="button" class="edit-order" data-action="plan" data-order="${esc(order.id)}" aria-label="Edit Order ${esc(order.orderNumber)}"><svg width="13" height="13" viewBox="0 0 20 20" aria-hidden="true"><path d="m12 4 4 4M3 17l4-1L17 6a2.8 2.8 0 0 0-4-4L3 12v5Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>Edit</button>`:'';
  const row=`<tr class="order-row" data-gate-order="${esc(order.id)}"${missing?'':` data-row-toggle="${esc(orderKey(order))}"`}><th scope="row"><div class="row-identity order-identity"><span><span class="order-title">${order.components.length?toggle(orderKey(order),'Order '+order.orderNumber,identity):identity}<span class="order-type">${esc(order.orderType)}</span></span><small class="order-meta">${esc(order.colour||'Colour not recorded')} · ${order.areaM2==null?'Area not recorded':esc(order.areaM2)+' m² total'}${missing?' · Confirm components from the drawing':''}</small></span>${edit}</div></th>${stageCells(order.components,{missing,scheduled:order.scheduledForProduction?1:0,legacyStages:order.legacyStages})}<td class="detail-cell"></td></tr>`;
  if(!expanded.has(orderKey(order)))return row;
  return row+[...new Set(order.components.map(component=>component.set))].map(set=>{
   const components=order.components.filter(component=>component.set===set),heading=`<tr class="set-row" data-row-toggle="${esc(setKey(order,set))}"><th scope="row"><div class="row-identity set-identity"><span>${toggle(setKey(order,set),'Set '+set+' for Order '+order.orderNumber,'Set '+set)}<small>${components.length} component${components.length===1?'':'s'}</small></span></div></th>${stageCells(components,{scheduled:order.scheduledForProduction?1:0})}<td class="detail-cell"></td></tr>`;
   return heading+(expanded.has(setKey(order,set))?components.map(component=>componentRow(order,component)).join(''):'');
  }).join('');
 }
 const expansionKeys=orders=>orders.flatMap(order=>[groupKey(order),...(order.components.length?[orderKey(order),...[...new Set(order.components.map(c=>c.set))].map(set=>setKey(order,set))]:[])]);
 function render(){
  const active=(data?.orders||[]).filter(order=>!isGateProgressComplete(order));
  if(!data){$('#content').innerHTML='<p>Loading gate progress…</p>';return;}
  const groups=new Map();for(const order of active){const key=groupKey(order);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(order);}
  const components=active.reduce((sum,order)=>sum+order.components.length,0);
  $('#mode').textContent=groups.size+' villa'+(groups.size===1?'':'s')+' · '+active.length+' order'+(active.length===1?'':'s')+' · '+components+' component'+(components===1?'':'s');
  const expandAll=$('#expandAll');expandAll.disabled=!active.length;expandAll.textContent=active.length&&expansionKeys(active).every(key=>expanded.has(key))?'Collapse all':'Expand all';
  $('#content').innerHTML=([...groups.values()].map(orders=>{
   const first=orders[0],components=orders.flatMap(order=>order.components),key=groupKey(first),isOpen=expanded.has(key),villa='Villa '+(first.villa||'not recorded'),needsSetup=orders.filter(order=>!order.components.length).length;
   const metrics=gateProgressSummary(orders).map(stage=>`<div class="metric is-${stage.state}" title="${esc(stage.label+': '+stage.detail)}"><div class="metric-label">${stage.label}</div><div class="metric-value">${stage.count}<small> / ${stage.total}</small>${stage.state==='rework'?'<span aria-label="Rework required">!</span>':''}<span class="metric-unit">${stage.total===1?stage.unit.slice(0,-1):stage.unit}</span></div><div class="progress-track" role="progressbar" aria-label="${esc(stage.label+': '+stage.detail)}" aria-valuemin="0" aria-valuemax="${Math.max(1,stage.total)}" aria-valuenow="${stage.count}"><span style="width:${stage.total?Math.min(100,stage.count/stage.total*100):0}%"></span></div></div>`).join('');
   return `<section class="card"><div class="villa-summary" data-row-toggle="${esc(key)}"><div class="villa-name"><span class="house" aria-hidden="true"><svg width="17" height="17" viewBox="0 0 20 20"><path d="m3 9 7-6 7 6v8H3Z M8 17v-5h4v5" fill="none" stroke="currentColor" stroke-width="1.4"/></svg></span><div><h2>${esc(villa)}</h2><p>${orders.length} order${orders.length===1?'':'s'} · ${components.length} component${components.length===1?'':'s'}</p>${needsSetup?`<p class="setup-note">${needsSetup} order${needsSetup===1?'':'s'} without component details</p>`:''}</div></div><div class="summary-metrics">${metrics}</div><button type="button" class="tree-toggle villa-toggle" data-action="toggle" data-collapse-key="${esc(key)}" aria-expanded="${isOpen}" aria-label="${esc((isOpen?'Collapse ':'Expand ')+villa)}">${chevron}</button></div>${isOpen?`<div class="scroll" role="region" aria-label="${esc('Gate progress for '+villa)}" tabindex="0"><table><thead><tr><th scope="col">Order / component</th>${gateProgressStageDefinitions.map(([,label])=>`<th scope="col" class="stage-heading"><span>${label}</span></th>`).join('')}<th scope="col" class="detail-heading"><span class="sr-only">Component details</span></th></tr></thead><tbody>${orders.map(orderRows).join('')}</tbody></table></div><div class="card-footer">Select Details for inspection evidence and dispatch/delivery dates.</div>`:''}</section>`;
  }).join('')||'<div class="empty">No gate orders to show. Create an order in Site Orders to get started.</div>');
 }
 const cancel='<button type="button" data-action="close">Cancel</button>';
 function open(html,ctx){context=ctx;$('#dialogBody').innerHTML='<p id="dialogNotice" role="status" hidden></p>'+html;$('#editor').showModal();}
 function initialSets(order){
  if(String(order.orderType).trim().toLowerCase()==='buggy gate')return [{gates:order.spec?.sets?.[0]?.gates??order.spec?.gateCount??1,highlights:0,posts:0}];
  if(order.spec?.sets)return order.spec.sets;
  if(Array.isArray(order.spec?.highlights)&&order.spec.highlights.length)return order.spec.highlights.map(highlights=>({gates:1,highlights,posts:1}));
  return [{gates:0,highlights:0,posts:0}];
 }
 function setFields(){
  const count=Number($('#editor [name=setCount]').value),host=$('#setComponents'),previous=[...host.querySelectorAll('fieldset')].map(fieldset=>Object.fromEntries([...fieldset.querySelectorAll('input')].map(input=>[input.dataset.part,input.value]))),defaults=initialSets(context.order);
  host.innerHTML=Array.from({length:count},(_,index)=>{
   const values=previous[index]||defaults[index]||{gates:0,highlights:0,posts:0};
   const fields=context.buggy?[['gates','Gates']]:[['gates','Gates'],['highlights','Highlights'],['posts','Posts']];
   return `<fieldset class="component-editor-set"><legend>Set ${index+1}</legend><div class="${context.buggy?'':'three'}">${fields.map(([key,label])=>`<label>${label}<input type="number" name="${key}${index}" data-part="${key}" aria-label="Set ${index+1} ${label.toLowerCase()}" min="${context.buggy?1:0}" max="${context.buggy?2:4}" step="1" value="${esc(values[key])}" required></label>`).join('')}</div></fieldset>`;
  }).join('');
 }
 function previousQa(order){
  const records=order.previousQa||[];if(!records.length)return '';
  return `<details class="previous-qa"><summary>Earlier QA reports (${records.length})</summary>${records.map(record=>`<div><strong>${esc(record.reference)}</strong>${inspectionArticles(record.history?.length?record.history:record.latest?[record.latest]:[],record.photoAdditions||[])}</div>`).join('')}</details>`;
 }
 function inspectionArticles(attempts,photoAdditions=[]){
  const safePhotos=photos=>(photos||[]).filter((photo,index,all)=>all.indexOf(photo)===index&&/^data:image\/(png|jpeg|webp);base64,/.test(photo));
  return attempts.map(attempt=>{
   const checklist=attempt.checklist||data.checklist||[],photos=safePhotos([...(attempt.photos||[]),...(attempt.photo?[attempt.photo]:[])]),additions=attempt.id?photoAdditions.filter(addition=>addition.attemptId===attempt.id):[];
   return `<article><strong>${esc(attempt.status==='approved'?'Approved':attempt.status==='recut'?'Rework required':attempt.status||'Inspection')}</strong><p>${esc([attempt.checkedBy,date(attempt.checkedAt)].filter(Boolean).join(' · '))}</p><ul>${Object.entries(attempt.results||{}).map(([key,value])=>`<li>${esc(checklist.find(([id])=>id===key)?.[1]||key)}: ${esc(value==='na'?'n/a':value)}</li>`).join('')}</ul>${attempt.notes?`<p>${esc(attempt.notes)}</p>`:''}${photos.map(photo=>`<img class="previous-qa-photo" src="${esc(photo)}" alt="Inspection evidence" loading="lazy">`).join('')}${additions.map(addition=>`<div><p>Added by ${esc(addition.addedBy||'Not recorded')} · ${esc(date(addition.addedAt))}</p>${safePhotos(addition.photos).map(photo=>`<img class="previous-qa-photo" src="${esc(photo)}" alt="Additional inspection evidence" loading="lazy">`).join('')}</div>`).join('')}</article>`;
  }).join('');
 }
 function inspectionHistory(component){
  const attempts=component.qaHistory||[];if(!attempts.length)return '';
  return `<details class="inspection-history"><summary>Inspection history (${attempts.length})</summary>${inspectionArticles(attempts,component.qaPhotoAdditions||[])}</details>`;
 }
 function componentDetails(order,component){
  if(!order||!component)return;
  const fields=[['Checked by',component.checkedBy||'Awaiting inspection'],['QA date',date(component.checkedAt)||'Not recorded'],['Dispatch date',date(component.shipment?.at)||'Not dispatched'],['Delivery date',date(component.delivery?.at)||'Not delivered'],...(component.shipment?.destination?[['Dispatch destination',component.shipment.destination]]:[]),...(component.shipment?.driver?[['Driver',component.shipment.driver]]:[]),...(component.delivery?.receivedBy?[['Received by',component.delivery.receivedBy]]:[])];
  const stages=gateProgressStages([component],{scheduled:order.scheduledForProduction?1:0});
  open(`<div class="detail-head"><div><h2>${esc(component.label)}</h2><p>Villa ${esc(order.villa||'not recorded')} · Order ${esc(order.orderNumber)} · Set ${component.set}</p></div><button type="button" data-action="close">Close</button></div><div class="detail-stages">${stages.map(stage=>`<div class="detail-stage is-${stage.state}"><span>${stage.label}</span><strong>${stage.state==='complete'?'✓ Complete':stage.state==='rework'?'! Rework required':'— Pending'}</strong></div>`).join('')}</div><dl class="detail-facts">${fields.map(([label,value])=>`<div><dt>${label}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>${component.shipment?.notes?`<p class="detail-note"><strong>Dispatch notes:</strong> ${esc(component.shipment.notes)}</p>`:''}${component.delivery?.notes?`<p class="detail-note"><strong>Delivery notes:</strong> ${esc(component.delivery.notes)}</p>`:''}${inspectionHistory(component)}`,{type:'details',order,component});
 }
 function drawingFields(){
  const drawn=$('#editor [name=drawn]').value==='true';
  $('#editor [name=areaM2]').required=drawn;
  const review=$('#editor [name=confirmLegacyQa]');if(review){const configuring=drawn||[...$('#setComponents').querySelectorAll('input')].some(input=>Number(input.value)>0);review.required=configuring;review.closest('label').hidden=!configuring;}
  $('#drawingHelp').textContent=context.drawingLocked?'Drawing status cannot be reset after components have been dispatched.':drawn?'Drawn sends these components to QA. Marking a previously undrawn order Drawn starts new QA checks.':'Undrawn removes this order from the current QA queue and clears dispatch readiness. Earlier QA reports are kept; marking Drawn again requires new checks.';
 }
 function plan(order){
  const buggy=String(order.orderType).trim().toLowerCase()==='buggy gate',sets=initialSets(order),drawn=order.drawn??order.legacyStages?.drawn??!!order.components.length,drawingLocked=order.components.some(component=>component.shipment||component.delivery);
  open(`<h2>Edit gate progress</h2><p>Villa ${esc(order.villa)} · Order ${esc(order.orderNumber)}</p>${previousQa(order)}<form data-form="plan"><label>Drawing status<select name="drawn" aria-label="Drawing status" aria-describedby="drawingHelp" ${drawingLocked?'disabled':''}><option value="false" ${drawn?'':'selected'}>Undrawn</option><option value="true" ${drawn?'selected':''}>Drawn</option></select></label><p id="drawingHelp" class="muted"></p><label>Sets<select name="setCount" aria-label="Sets"><option value="1">1 set</option>${buggy?'':`<option value="2" ${sets.length===2?'selected':''}>2 sets</option>`}</select></label><div id="setComponents"></div><p class="muted">${buggy?'Buggy orders contain one or two gates only.':'Choose the parts on the drawing. Use 0 for any part that is not included.'}</p><label>Total order area (m²)<input name="areaM2" type="number" min="0.000001" max="99999" step="any" value="${esc(order.areaM2??'')}"></label><p class="muted">${order.hasRecordedQa?'Earlier order QA will be retained below. The new component checks will determine readiness and production totals.':'Existing approvals stay with the same parts while Drawn. Inspected or dispatched parts cannot be removed.'}</p>${order.hasRecordedQa?`<label class="legacy-qa-review"><input type="checkbox" name="confirmLegacyQa" required> I have reviewed the earlier QA. Keep those reports and create separate QA checks for these components. Readiness will update from the new component checks.</label>`:''}<div class="actions"><button class="primary">Save progress</button>${cancel}</div></form>`,{type:'plan',order,buggy,drawn,drawingLocked});setFields();drawingFields();
 }
 root.addEventListener('focusin',event=>{if(event.target.matches('input[data-part]'))event.target.select();},{signal:controller.signal});
 root.addEventListener('change',event=>{if(event.target.name==='setCount'){setFields();drawingFields();}if(event.target.name==='drawn')drawingFields();},{signal:controller.signal});
 root.addEventListener('input',event=>{if(event.target.matches('input[data-part]'))drawingFields();},{signal:controller.signal});
 root.addEventListener('click',async event=>{
  if(event.target.matches('input[data-part]'))event.target.select();
  if(busy)return;
  const button=event.target.closest('[data-action]');
  try{
   if(!button){
    const row=event.target.closest('[data-row-toggle]');
    if(!row||event.target.closest('button,a,input,select,textarea,label,summary,[role="button"],[contenteditable]')||window.getSelection()?.toString())return;
    toggleSection(row.dataset.rowToggle);return;
   }
   const action=button.dataset.action;
   if(action==='toggle')toggleSection(button.dataset.collapseKey);
   else if(action==='expand-all'){const keys=expansionKeys(data.orders.filter(order=>!isGateProgressComplete(order)));if(keys.every(key=>expanded.has(key)))expanded.clear();else for(const key of keys)expanded.add(key);render();$('#expandAll').focus({preventScroll:true});}
   else if(action==='close'){$('#editor').close();context=null;message('');}
   else if(action==='refresh'){epoch++;message('');await load();}
   else if(action==='plan')plan(orderFor(button.dataset.order));
   else if(action==='details'){const order=orderFor(button.dataset.order);componentDetails(order,order?.components.find(component=>component.id===button.dataset.component));}

  }catch(error){if(!destroyed)message(error.message);}
 },{signal:controller.signal});
 root.addEventListener('submit',async event=>{
  const form=event.target;if(!form.dataset.form)return;event.preventDefault();if(busy)return;
  const version=epoch,ctx=context,values=Object.fromEntries(new FormData(form));busy=true;form.querySelectorAll('button').forEach(button=>button.disabled=true);message('');
  try{
   const sets=Array.from({length:Number(values.setCount)},(_,index)=>ctx.buggy?{gates:Number(values['gates'+index]),highlights:0,posts:0}:Object.fromEntries(['gates','highlights','posts'].map(key=>[key,Number(values[key+index])])));
   const drawn=values.drawn===undefined?ctx.drawn:values.drawn==='true',areaM2=values.areaM2.trim()===''?null:Number(values.areaM2);
   if(!drawn&&!ctx.order.spec&&sets.every(set=>Object.values(set).every(count=>count===0)))await api('/orders/'+ctx.order.id+'/progress',{expectedUpdatedAt:ctx.order.updatedAt,stages:{drawn:'pending'},areaM2});
   else await api('/gate-components/orders/'+ctx.order.id+'/plan',{expectedUpdatedAt:ctx.order.updatedAt,spec:{sets},drawn,areaM2,confirmLegacyQa:values.confirmLegacyQa==='on'});
   if(version!==epoch||destroyed)return;const refreshed=await load();if(version!==epoch||destroyed)return;$('#editor').close();context=null;
   message(!refreshed?'Saved. Use Refresh to load the latest gate progress.':'Saved. Gate progress has been refreshed.');
  }catch(error){if(version===epoch&&!destroyed)message(error.message);}
  finally{busy=false;if(version===epoch&&!destroyed)form.querySelectorAll('button').forEach(button=>button.disabled=false);}
 },{signal:controller.signal});
 const refresh=()=>{if(!busy&&!destroyed&&!$('#editor').open&&!document.hidden)void load();};
 window.addEventListener('panelstock-remote-change',refresh,{signal:controller.signal});window.addEventListener('online',refresh,{signal:controller.signal});document.addEventListener('visibilitychange',refresh,{signal:controller.signal});const timer=setInterval(refresh,30000);
 load();return {destroy(){destroyed=true;epoch++;clearInterval(timer);controller.abort();$('#editor')?.close();root.innerHTML='';}};
}
