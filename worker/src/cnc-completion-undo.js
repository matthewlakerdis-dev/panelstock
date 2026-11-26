import {requireCondition as check} from './security.js';
import {cncDuplicateKey} from './cnc-input.js';
import {validateRecord,validateOffcutCreations,offcutStockKey} from './inventory.js';
import {matchesSiteOrder} from './site-orders-excel.js';
import {prepareCncStickerUndoQa} from './cnc-sticker-review.js';
const clean=value=>String(value??'').trim();
const sheetKey=panel=>JSON.stringify(JSON.parse(cncDuplicateKey(panel)).slice(0,3));
const stockType=panel=>panel.stockItemType||'variant';
const materialKey=item=>JSON.stringify([clean(item.color).toLowerCase(),clean(item.material).toLowerCase(),Number(item.thickness),Number(item.width),Number(item.height),item.dimensionOrder||'']);
const isCompletion=change=>change.field==='cncPanels'&&change.before?.status==='pending'&&change.after?.status==='completed';
function planUndo(store,body){
 const panels=store.read('app:cncPanels',[]),panel=panels.find(value=>value.id===body.panelId);
 check(panel,'CNC panel not found',404);
 check(panel.status==='completed','This panel is no longer marked as cut. Refresh the tracker.',409);
 check(panel.completedAt&&panel.completedAt===body.expectedCompletedAt,'This completion changed. Refresh the tracker.',409);
 const origin=store.sql.exec("SELECT id,payload,revision FROM mutations WHERE EXISTS (SELECT 1 FROM json_each(mutations.payload) AS entry WHERE json_extract(entry.value,'$.field')='cncPanels' AND json_extract(entry.value,'$.id')=? AND json_extract(entry.value,'$.before.status')='pending' AND json_extract(entry.value,'$.after.status')='completed') ORDER BY revision DESC LIMIT 1",panel.id).toArray()[0];
 check(origin,'The original completion history is unavailable; this older cut cannot be undone automatically.',409);
 const changes=JSON.parse(origin.payload),selected=changes.find(change=>isCompletion(change)&&change.id===panel.id),stamp=selected?.after?.completedAt;
 check(selected&&sheetKey(selected.after)===sheetKey(panel),'The original completion no longer matches this panel.',409);
 const batch=changes.filter(change=>isCompletion(change)&&change.after.completedAt===stamp&&sheetKey(change.after)===sheetKey(panel));
 const ids=new Set(batch.map(change=>change.id)),targets=panels.filter(value=>ids.has(value.id));
 check(targets.length===ids.size&&targets.every(value=>value.status==='completed'&&value.completedAt===panel.completedAt),'Another panel in this completion changed. Refresh the tracker.',409);
 const qa=store.read('qa-checks',[]),stickerQa=prepareCncStickerUndoQa(store,origin.id,panels,qa,ids);
 check(!qa.some(record=>ids.has(record.id)&&!stickerQa.allowed.has(record.id)&&(record.latest||record.history?.length||record.photoAdditions?.length||record.qaExemptionHistory?.length||record.qaReset||record.qaResetHistory?.length||record.replacementId||record.remakeOf||['approved','recut','replaced'].includes(record.status))),'QA has already been recorded for this cut. Review the QA record before undoing it.',409);
 check(!store.read('panel-dispatch-loads',[]).some(load=>load.panelIds?.some(id=>ids.has(id))&&(load.status!=='waiting'||load.legs?.length||load.coatingCompleted||load.finalQa||load.dispatchReversals?.length)),'This cut has progressed to coating or dispatch and cannot be undone.',409);
 check(!store.read('qa-dispatches',[]).some(dispatch=>dispatch.lines?.some(line=>line.kind==='panel'&&ids.has(line.id))),'Dispatch has already been recorded for this panel.',409);
 check(!store.read('orders',[]).some(order=>targets.some(target=>matchesSiteOrder(order,target))&&(order.status==='dispatched'||order.receipts?.length||order.dispatches?.length||order.dispatch)),'The associated order has been dispatched or received and cannot have its cut undone.',409);
 const additions=changes.filter(change=>change.field==='transactions'&&change.before===null).map(change=>change.after);
 const dispatches=additions.filter(txn=>txn.type==='dispatch'&&txn.source==='cnc'&&txn.timestamp===stamp&&clean(txn.orderNumber)===clean(panel.orderNumber)&&txn.sku===panel.stockSku&&txn.panelIds?.includes(selected.after.panelNumber));
 const sheetCompletion=targets.some(value=>['none','confirmed'].includes(value.offcutOutcome))||dispatches.length>0;
 check(!sheetCompletion||dispatches.length===1,'The stock movement for this sheet cannot be identified safely.',409);
 if(!sheetCompletion)check(!panels.some(value=>!ids.has(value.id)&&value.status==='completed'&&sheetKey(value)===sheetKey(panel)&&['none','confirmed'].includes(value.offcutOutcome)),'This sheet was completed later. Undo that sheet completion first.',409);
 const relevant=sheetCompletion?[dispatches[0],...additions.filter(txn=>txn.type==='offcut_add'&&txn.timestamp===stamp&&clean(txn.orderNumber)===clean(panel.orderNumber)&&clean(txn.sheetNumber)===clean(panel.sheetNumber))]:[];
 const transactions=store.read('app:transactions',[]),effects=[];
 for(const original of relevant){
  const txn=transactions.find(value=>value.id===original.id);
  check(txn,'The original stock activity is missing; review stock before undoing this cut.',409);
  if(txn.voided)continue;
  check(txn.type===original.type&&txn.sku===original.sku&&Number.isSafeInteger(txn.qty)&&txn.qty>0,'The original stock activity changed.',409);
  const type=txn.type==='offcut_add'?'offcut':txn.itemType,field=type==='offcut'?'offcuts':'variants';
  check(['variant','offcut'].includes(type),'The stock movement is not supported for automatic undo.',409);
  if(txn.type==='offcut_add')check(!transactions.some(later=>!later.voided&&!additions.some(value=>value.id===later.id)&&Date.parse(later.serverTimestamp||later.timestamp)>=Date.parse(panel.completedAt)&&['dispatch','damage','transfer'].includes(later.type)&&(later.sku===txn.sku||later.sourceSku===txn.sku)),'An offcut from this cut has already been used. Review that stock movement first.',409);
  const originalItems=changes.filter(change=>change.field===field&&(change.before?.sku===txn.sku||change.after?.sku===txn.sku));
  check(originalItems.length===1,'The original stock reference is ambiguous. Review stock before undoing.',409);
  const originalItem=originalItems[0];
  check(originalItem,'The original stock item is missing from the completion history.',409);
  effects.push({field,type,sku:txn.sku,delta:txn.type==='dispatch'?txn.qty:-txn.qty,original:originalItem.before||originalItem.after,transactionId:txn.id});
 }
 const variants=structuredClone(store.read('app:variants',[])),offcuts=structuredClone(store.read('app:offcuts',[])),stockChanges=[],adjustments=[];
 for(const effect of effects){
  const list=effect.field==='offcuts'?offcuts:variants;
  check(list.filter(value=>value.sku===effect.sku).length<=1,'The current stock reference is ambiguous. Review stock before undoing.',409);
  let index=list.findIndex(value=>value.sku===effect.sku);
  if(index<0){
   check(effect.type==='offcut'&&effect.delta>0,'The original stock item is no longer available.',409);
   check(!offcuts.some(value=>offcutStockKey(value)===offcutStockKey(effect.original)),'A matching offcut now uses a different stock reference. Review stock before undoing.',409);
   list.push({...effect.original,qty:0});index=list.length-1;
  }
  const item=list[index];check(materialKey(item)===materialKey(effect.original),'The stock dimensions or material have changed. Review stock before undoing.',409);
  const qty=Number(item.qty)+effect.delta;
  check(Number.isSafeInteger(qty)&&qty>=0&&qty<=10000000,'An offcut from this cut is no longer available in stock.',409);
  list[index]={...item,qty};validateRecord(effect.field,list[index],item.id);
  stockChanges.push({field:effect.field,id:item.id,before:store.read('app:'+effect.field,[]).find(value=>value.id===item.id)||null,after:list[index]});
  adjustments.push({type:effect.type,sku:effect.sku,delta:effect.delta});
 }
 const nextPanels=panels.map(value=>{
  if(!ids.has(value.id))return value;
  const next={...value,status:'pending',completedBy:null,completedAt:null};
  delete next.offcutOutcome;delete next.offcutDetails;delete next.savedOffcuts;
  const type=stockType(next),matches=(type==='offcut'?offcuts:variants).filter(item=>item.sku===next.stockSku);
  check(matches.length<=1,'The current stock reference is ambiguous. Review stock before undoing.',409);
  const item=matches[0];
  check(item,'The original stock item is no longer available for scheduling.',409);
  next.stockItemId=item.id;if(next.stockVariantId)next.stockVariantId=item.id;
  return next;
 });
 for(const effect of [...adjustments,...targets.map(value=>({type:stockType(value),sku:value.stockSku}))]){
  const item=(effect.type==='offcut'?offcuts:variants).find(value=>value.sku===effect.sku);
  const reservations=new Set(nextPanels.filter(value=>value.status==='pending'&&stockType(value)===effect.type&&value.stockSku===effect.sku).map(sheetKey));
  check(item&&item.qty>=reservations.size,'Undo would leave another scheduled sheet without enough stock. Review the schedule or offcuts first.',409);
 }
 validateOffcutCreations([...new Map(stockChanges.map(value=>[value.field+':'+value.id,value])).values()],store.read('app:offcuts',[]));
 return {panels:nextPanels,variants,offcuts,transactions,effects,stickerQa,sourceMutationId:origin.id,summary:{panelId:panel.id,expectedCompletedAt:panel.completedAt,revision:store.read('revision',0),restoreEpoch:store.read('restoreEpoch',0),project:panel.jobReference||'',orderNumber:panel.orderNumber,sheetNumber:panel.sheetNumber,panels:targets.map(value=>({id:value.id,panelNumber:value.panelNumber})),stockAdjustments:adjustments}};
}
export function undoCncCompletion(store,body,actor){
 check(actor.isAdmin===true,'Only administrators can undo a CNC cut',403);store.requireTask(actor,'factory.cnc');
 check(['preview','undo'].includes(body.action)&&typeof body.panelId==='string'&&body.panelId.length>0&&body.panelId.length<=100,'Choose a completed CNC panel');
 let fingerprint,recordKey;
 if(body.action==='undo'){
  check(typeof body.mutationId==='string'&&/^[a-zA-Z0-9-]{16,100}$/.test(body.mutationId),'An undo request ID is required');
  check(typeof body.reason==='string'&&body.reason.trim().length>0&&body.reason.trim().length<=1000&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(body.reason),'Enter a reason for undoing the cut');
  fingerprint=JSON.stringify({panelId:body.panelId,expectedCompletedAt:body.expectedCompletedAt,revision:body.revision,restoreEpoch:body.restoreEpoch,reason:body.reason.trim()});recordKey='cnc-completion-undo:'+body.mutationId;
  const previous=store.read(recordKey,null);
  if(previous){check(previous.by===actor.username&&previous.fingerprint===fingerprint,'This undo request has already been used with different details.',409);return {ok:true,summary:previous.summary,idempotent:true};}
 }
 const plan=planUndo(store,body);
 if(body.action==='preview')return {ok:true,plan:plan.summary};
 check(body.revision===plan.summary.revision&&body.restoreEpoch===plan.summary.restoreEpoch,'Stock or the schedule changed. Refresh the undo details before confirming.',409);
 const now=new Date().toISOString(),revision=plan.summary.revision+1,ids=new Set(plan.summary.panels.map(value=>value.id)),reversed=new Set(plan.effects.map(value=>value.transactionId));
 const activity={id:crypto.randomUUID(),type:'cnc',source:'cnc-undo',user:actor.username,timestamp:now,serverTimestamp:now,qty:'',panelRecordIds:[...ids],sourceMutationId:plan.sourceMutationId,reason:body.reason.trim(),desc:`Undid CNC cut: ${plan.summary.project||'No project'} · Order ${plan.summary.orderNumber} · Sheet ${plan.summary.sheetNumber} · ${ids.size} panel${ids.size===1?'':'s'} returned to Pending`,reversedTransactionIds:[...reversed]};
 const transactions=[activity,...plan.transactions.map(value=>reversed.has(value.id)?{...value,voided:true,voidedBy:actor.username,voidedAt:now}:value)];
 store.ctx.storage.transactionSync(()=>{
  store.write('app:cncPanels',plan.panels);
  if(plan.stickerQa.qaChanged)store.write('qa-checks',plan.stickerQa.records);
  if(plan.effects.some(value=>value.field==='variants'))store.write('app:variants',plan.variants);
  if(plan.effects.some(value=>value.field==='offcuts'))store.write('app:offcuts',plan.offcuts);
  store.write('app:transactions',transactions);store.syncPanelLoads();store.write('revision',revision);
  store.write(recordKey,{by:actor.username,at:now,fingerprint,summary:plan.summary,sourceMutationId:plan.sourceMutationId});
  store.audit(actor.username,'cnc-completion-undone',{panelIds:[...ids],sourceMutationId:plan.sourceMutationId,mutationId:body.mutationId,reason:body.reason.trim(),stockAdjustments:plan.summary.stockAdjustments,revision});
 });
 store.broadcastRevision(revision);
 return {ok:true,summary:plan.summary,revision};
}

