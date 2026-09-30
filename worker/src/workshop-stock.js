import {requireCondition as check} from './security.js';
const empty=()=>({revision:0,items:[],movements:[],metadata:{}});
const text=(v,max=160)=>String(v??'').trim().slice(0,max);
const number=(v,label)=>{check(v!==''&&v!==null&&v!==undefined&&Number.isFinite(Number(v))&&Number(v)>=0&&Number(v)<=1e9,`${label} must be a non-negative number`);check(Math.abs(Number(v)*1000-Math.round(Number(v)*1000))<0.0001,`${label} supports up to three decimal places`);return Number(v);};
const stockLength=v=>{if(v===undefined||v===null||v==='')return null;const n=number(v,'Length');check(n>0,'Length must be greater than zero');return n;};
const normal=v=>text(v).replace(/\s+/g,' ').toLowerCase();
const sameProfile=(a,b)=>normal(a.sku)===normal(b.sku);
function uniqueVariant(items,item){check(!items.some(row=>row.id!==item.id&&sameProfile(row,item)&&normal(row.colour)===normal(item.colour)&&(row.lengthMm??null)===(item.lengthMm??null)),'This stock code, colour and length already exists',409);}
const round=v=>Math.round(v*1000)/1000;
const reserved=item=>round(Object.values(item.reservations||{}).reduce((n,v)=>n+v,0));
export function stockImage(value){
 if(value===undefined||value==='')return '';
 check(typeof value==='string'&&value.length<=700000,'Stock image must be under 500 KB');
 const match=value.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
 check(match&&match[2].length%4===0,'Choose a PNG, JPEG or WebP image');
 let bytes;try{bytes=atob(match[2]);}catch{check(false,'Invalid image data');}
 const valid=match[1]==='png'?bytes.startsWith('\x89PNG\r\n\x1a\n'):match[1]==='jpeg'?bytes.startsWith('\xff\xd8\xff'):bytes.startsWith('RIFF')&&bytes.slice(8,12)==='WEBP';
 check(valid&&bytes.length<=512000,'Invalid image or image exceeds 500 KB');return value;
}
export function workshopView(store){
 const state=store.read('workshop-stock',empty()),counts=new Map(),seen=new Set();
 for(const panel of store.read('app:cncPanels',[])){
  if(panel.status==='completed'||!panel.stockItemId)continue;
  const key=`${panel.stockItemType||'variant'}:${panel.stockItemId}`,sheet=JSON.stringify([panel.jobReference||'',panel.orderNumber||'',panel.sheetNumber||'',key]);
  if(!seen.has(sheet)){seen.add(sheet);counts.set(key,(counts.get(key)||0)+1);}
 }
 const sheets=['variants','offcuts'].flatMap(field=>store.read('app:'+field,[]).map(item=>{
  const key=`${field==='variants'?'variant':'offcut'}:${item.id}`,meta=state.metadata[key]||{},held=counts.get(key)||0;
  return {...item,...meta,id:key,legacy:true,category:field==='variants'?'panels':'offcuts',name:[item.color,item.material,`${item.thickness} mm`,`${item.width} × ${item.height} mm`].join(' · '),unit:'sheets',reserved:held,available:round(Number(item.qty||0)-held)};
 }));
 return {...state,items:[...sheets,...state.items.map(item=>({...item,reserved:reserved(item),available:round(item.qty-reserved(item))}))]};
}
export function applyWorkshop(state,input,actor){
 const next=structuredClone(state),action=input.action,id=text(input.itemId,120),now=new Date().toISOString();
 let item=next.items.find(row=>row.id===id),quantity=0;
 const reason=text(input.reason,500),job=text(input.job,160);
 check(!['__proto__','constructor','prototype'].includes(job),'Invalid job reference');
 if(action==='stocktake_batch'){
  check(Array.isArray(input.counts)&&input.counts.length>0&&input.counts.length<=1000,'Enter between 1 and 1000 counts');
  check(reason,'A stocktake reference is required');
  const ids=new Set();let result=next;const movements=[];
  for(const count of input.counts){
   check(!ids.has(count.itemId),'Duplicate stocktake item');ids.add(count.itemId);
   const row=result.items.find(i=>i.id===count.itemId);check(row,'Stock item not found',404);
   check(row.qty===count.expectedQty,'Stock changed since counting. Recount the changed items.',409);
   check(Number(count.quantity)>=reserved(row),row.sku+' '+(row.colour||'')+': count is below reserved stock. Release allocations first.',409);
   const applied=applyWorkshop(result,{action:'stocktake',itemId:row.id,quantity:count.quantity,reason},actor);
   result=applied.next;movements.push(applied.movement);
  }
  result.revision=state.revision+1;return {next:result,movement:movements[0],movements};
 }
 if(action==='create'){
  const v=input.item||{},category=text(v.category),unit=text(v.unit);
  check(['extrusions','fixings','consumables','offcuts'].includes(category),'Choose a workshop category');
  check(['lengths','each','boxes','packs','rolls','tubes','litres','metres','kg'].includes(unit),'Choose a valid stock unit');
  check(text(v.name)&&text(v.sku),'Name and stock code are required');
  if(category==='offcuts')check(text(v.details)||text(v.dimensions),'Record the offcut profile and remaining dimensions');
  const profile=next.items.find(row=>sameProfile(row,v));
  if(profile)check(profile.category===category&&profile.unit===unit,'Use the existing profile category and stock unit',409);
  quantity=number(v.qty,'Opening quantity');
  item={id:crypto.randomUUID(),category,unit,name:text(v.name),sku:text(v.sku),qty:quantity,reservations:{},location:text(v.location),supplier:text(v.supplier),details:text(v.details,500),lengthMm:stockLength(v.lengthMm),dimensions:text(v.dimensions),colour:text(v.colour),reorderLevel:number(v.reorderLevel??0,'Reorder level'),packSize:number(v.packSize??1,'Pack size'),createdAt:now,image:stockImage(v.image)};
  if(profile)Object.assign(item,{sku:profile.sku,name:profile.name,dimensions:profile.dimensions||'',image:profile.image||''});
  uniqueVariant(next.items,item);
  check(item.packSize>0,'Pack size must be greater than zero');next.items.push(item);
 }else if(action==='metadata'){
  check(item||/^(variant|offcut):.+/.test(id),'Stock item not found',404);
  const meta={location:text(input.location),supplier:text(input.supplier),reorderLevel:number(input.reorderLevel??0,'Reorder level')};
  for(const field of ['dimensions','colour','details'])if(Object.hasOwn(input,field))meta[field]=text(input[field],field==='details'?500:160);
  if(Object.hasOwn(input,'lengthMm'))meta.lengthMm=stockLength(input.lengthMm);
  if(Object.hasOwn(input,'image'))meta.image=stockImage(input.image);
  if(item){
   uniqueVariant(next.items,{...item,...meta});
   Object.assign(item,meta);
   // Keep the shared profile drawing and cross-section consistent across variants.
   for(const row of next.items.filter(row=>sameProfile(row,item)))for(const field of ['dimensions','image'])if(Object.hasOwn(meta,field))row[field]=meta[field];
  }else next.metadata[id]={...next.metadata[id],...meta};
 }else{
  check(item,'Stock item not found',404);check(['receive','use','return','reserve','release','stocktake','damage'].includes(action),'Unknown stock action');
  quantity=number(input.quantity,'Quantity');check(action==='stocktake'||quantity>0,'Quantity must be greater than zero');
  if(['use','return','reserve','release'].includes(action))check(job,'Job reference is required');
  if(['stocktake','damage'].includes(action))check(reason,'A reason is required');
  const held=reserved(item),allocated=Object.hasOwn(item.reservations,job)?item.reservations[job]:0,available=round(item.qty-held);
  if(action==='receive'||action==='return')item.qty=round(item.qty+quantity);
  if(action==='reserve'){check(quantity<=available,'Not enough available stock',409);item.reservations[job]=round(allocated+quantity);}
  if(action==='release'){check(quantity<=allocated,'Quantity exceeds this job’s reservation',409);item.reservations[job]=round(allocated-quantity);}
  if(action==='use'){
   check(quantity<=round(available+allocated),'Stock is unavailable or reserved for another job',409);
   item.qty=round(item.qty-quantity);item.reservations[job]=round(Math.max(0,allocated-quantity));
  }
  if(action==='damage'){check(quantity<=available,'Release reserved stock before recording damage',409);item.qty=round(item.qty-quantity);}
  if(action==='stocktake'){check(quantity>=held,'Count is below reserved stock. Release allocations first.',409);const before=item.qty;item.qty=quantity;quantity=round(quantity-before);}
  check(item.qty<=1e9,'Stock quantity is too large');
 }
 const movement={id:crypto.randomUUID(),itemId:item?.id||id,sku:item?.sku||id,action,quantity,job,reason,user:actor.username,at:now};
 next.movements.unshift(movement);next.revision++;return {next,movement};
}
export function handleWorkshop(store,method,body,actor){
 store.requireTask(actor,'factory.stock');
 if(method==='GET')return {status:200,body:{ok:true,...workshopView(store)}};
 check(method==='POST','Method not allowed',405);
 const action=body.action,admin=['create','metadata','stocktake'].includes(action);
 if(admin)check(actor.isAdmin,'Administrator access required',403);
 else store.requireTask(actor,action==='stocktake_batch'?'factory.stock':action==='damage'?'factory.damage':['receive','return'].includes(action)?'factory.receive':'factory.dispatch');
 check(typeof body.mutationId==='string'&&/^[a-zA-Z0-9-]{16,100}$/.test(body.mutationId),'Mutation ID required');
 const key='workshop-mutation:'+body.mutationId,payload=JSON.stringify(body),prior=store.read(key,null);
 if(prior){check(prior.user===actor.username&&prior.payload===payload,'Mutation ID reused',409);return {status:200,body:{ok:true,duplicate:true,...workshopView(store)}};}
 const state=store.read('workshop-stock',empty());
 check(body.expectedRevision===state.revision,'Workshop stock changed. Refresh and try again.',409);
 if(body.action==='metadata'&&/^(variant|offcut):/.test(body.itemId||''))check(workshopView(store).items.some(i=>i.id===body.itemId),'Stock item not found',404);
 const {next,movement,movements=[movement]}=applyWorkshop(state,body,actor);
 const revision=store.read('revision',0)+1;
 store.ctx.storage.transactionSync(()=>{
  store.write('workshop-stock',next);store.write(key,{user:actor.username,payload});store.write('revision',revision);
  const history=store.read('app:transactions',[]);for(const movement of movements)history.unshift({id:movement.id,type:'workshop',desc:`Workshop ${action}: ${movement.sku}${movement.job?' · '+movement.job:''}${movement.reason?' · '+movement.reason:''}`,qty:movement.quantity,user:actor.username,timestamp:movement.at});store.write('app:transactions',history);
  for(const entry of movements)store.audit(actor.username,'workshop-stock',entry);
 });
 store.broadcastRevision(revision);return {status:200,body:{ok:true,...workshopView(store)}};
}
