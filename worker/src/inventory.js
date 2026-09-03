import {normalizeCncInput} from './cnc-input.js';
import { requireCondition as check } from './security.js';
export const FIELDS = ['variants','offcuts','catalog','reasons','transactions','photos','cncPanels'];
const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v,max=500) => typeof v === 'string' && v.length <= max;
const quantity = v => Number.isSafeInteger(v) && v >= 0 && v <= 10000000;
const dimension = v => typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 1000000;
export function validateRecord(field, value, id) {
  check(plain(value), 'Each record must be an object');
  check(text(id,100) && id.length > 0 && !['__proto__','constructor','prototype'].includes(id), 'Invalid record ID');
  if (field !== 'photos') check(value.id === id, 'Record ID mismatch');
  check(JSON.stringify(value).length <= 1500000, 'Record too large',413);
  if (['variants','offcuts','catalog'].includes(field)) {
    check(text(value.sku,100) && value.sku.length > 0, 'SKU required');
    check(text(value.color) && text(value.material), 'Material and colour must be text');
    check(dimension(value.width) && dimension(value.height) && dimension(value.thickness), 'Dimensions must be positive numbers');
    if (field !== 'catalog') check(quantity(value.qty), 'Quantity must be a nonnegative whole number');
    if (value.reorderPoint !== undefined) check(quantity(value.reorderPoint), 'Invalid reorder quantity');
  }
  if (field === 'reasons') check(text(value.label,200) && value.label.trim(), 'Damage reason required');
  if (field === 'transactions') {
    check(text(value.type,50) && text(value.desc,4000), 'Invalid activity entry');
    check(value.qty === '' || quantity(value.qty), 'Invalid activity quantity');
    check(text(value.timestamp,50) && Number.isFinite(Date.parse(value.timestamp)), 'Invalid activity timestamp');
  }
  if (field === 'photos') {
    check(text(value.data,1500000) && /^data:image\/(jpeg|png|webp);base64,[a-zA-Z0-9+/=]+$/.test(value.data), 'Invalid photo');
    check(dimension(value.width) && dimension(value.height), 'Invalid photo dimensions');
  }
  if (field === 'cncPanels') {
    check(['pending','completed'].includes(value.status), 'Invalid CNC status');
    for (const key of ['orderNumber','sheetNumber','panelNumber']) check(text(value[key],200) && value[key].trim(), 'CNC reference required');
    if(value.stockVariantId!==undefined)check(text(value.stockVariantId,100)&&value.stockVariantId.trim(),'Invalid CNC stock sheet');
    if(value.stockItemId!==undefined)check(text(value.stockItemId,100)&&value.stockItemId.trim(),'Invalid CNC stock sheet');
    if(value.stockItemType!==undefined)check(['variant','offcut'].includes(value.stockItemType),'Invalid CNC stock type');
    if(value.stockSku!==undefined)check(text(value.stockSku,100)&&value.stockSku.trim(),'Invalid CNC stock SKU');
    if(value.sheetWidth!==undefined)check(dimension(value.sheetWidth),'Invalid CNC sheet width');
    if(value.sheetHeight!==undefined)check(dimension(value.sheetHeight),'Invalid CNC sheet height');
    if(value.totalPanelArea!==undefined)check(typeof value.totalPanelArea==='number'&&Number.isFinite(value.totalPanelArea)&&value.totalPanelArea>0&&value.totalPanelArea<=1000000,'Invalid CNC panel area');
  }
}
export function validateConfig(config) {
  check(plain(config), 'Invalid report settings');
  check(typeof config.enabled === 'boolean', 'Invalid report enabled flag');
  check(Array.isArray(config.recipients) && config.recipients.length <= 20 && config.recipients.every(r=>text(r,254) && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(r)), 'Invalid email recipients');
  check(Array.isArray(config.days) && config.days.every(d=>Number.isInteger(d)&&d>=0&&d<=6), 'Invalid report days');
  check(/^([01]\d|2[0-3]):[0-5]\d$/.test(config.time), 'Invalid report time');
  try { new Intl.DateTimeFormat('en',{timeZone:config.timezone}).format(); } catch { check(false,'Invalid time zone'); }
  return {enabled:config.enabled,recipients:config.recipients,days:config.days,time:config.time,timezone:config.timezone};
}
export function validateChanges(changes, actor) {
  check(Array.isArray(changes) && changes.length > 0 && changes.length <= 10000, 'Invalid change batch');
  // Staff may introduce a catalog item only as part of its linked stock receipt.
  const receiptCatalogIds = new Set();
  if (!actor.isAdmin) for (const c of changes) {
    if (c?.field !== 'catalog' || c.before !== null || !plain(c.after)) continue;
    const cat = c.after;
    const linked = changes.filter(v => v?.field === 'variants' && v.before === null && plain(v.after) && v.after.catalogId === c.id);
    if (linked.length !== 1) continue;
    const stock = linked[0].after;
    const keys = ['sku','color','material','thickness','width','height','reorderPoint'];
    if (!keys.every(key => stock[key] === cat[key]) || !quantity(stock.qty) || stock.qty <= 0 || !cat.color?.trim() || !cat.material?.trim()) continue;
    const receipts = changes.filter(t => t?.field === 'transactions' && t.before === null && t.after?.type === 'receipt' && t.after.itemType === 'variant' && keys.slice(0,-1).every(key => t.after[key] === cat[key]));
    if (receipts.length && receipts.every(t => quantity(t.after.qty) && t.after.qty > 0) && receipts.reduce((sum,t) => sum + t.after.qty,0) === stock.qty) receiptCatalogIds.add(c.id);
  }
  const seen = new Set();
  for (const c of changes) {
    check(plain(c) && FIELDS.includes(c.field) && text(c.id,100), 'Invalid change');
    const key=c.field+':'+c.id;
    check(!seen.has(key),'Duplicate change'); seen.add(key);
    check(c.before === null || plain(c.before),'Previous record required');
    check(c.after !== undefined,'New record required');
    if(c.after !== null) validateRecord(c.field,c.after,c.id);
    if(['catalog','reasons'].includes(c.field)) check(actor.isAdmin || (c.field==='catalog' && c.before===null && c.after && receiptCatalogIds.has(c.id)),'Admin access required',403);
    if(c.field==='photos' && c.before!==null)check(actor.isAdmin,'Only admins may change existing evidence photos',403);
    if(c.field === 'transactions') {
      check(c.after !== null,'Activity history cannot be deleted');
      if(!actor.isAdmin && c.before===null)check(['receipt','dispatch','damage','offcut_add','cnc'].includes(c.after.type),'Admin access required for this activity',403);
      if(c.before !== null) {
        check(actor.isAdmin,'Only an admin may void activity',403);
        const {voided:av,voidedBy:ab,voidedAt:at,...a}=c.after;
        const {voided:bv,voidedBy:bb,voidedAt:bt,...b}=c.before;
        check(!bv && av === true && JSON.stringify(a)===JSON.stringify(b),'Existing activity can only be voided');
      }
    }
    if(c.field==='cncPanels' && !actor.isAdmin) {
      check(c.before && c.after && c.before.status==='pending' && c.after.status==='completed','Only admins may schedule/remove CNC panels',403);
      const {status:as,completedBy:ab,completedAt:at,...a}=c.after;
      const {status:bs,completedBy:bb,completedAt:bt,...b}=c.before;
      check(JSON.stringify(a)===JSON.stringify(b),'Only CNC completion is allowed',403);
    }
    if(['variants','offcuts'].includes(c.field) && !actor.isAdmin) {
      check(c.after !== null || (c.field==='offcuts' && c.before),'Only admins may remove stock types',403);
      if(c.field==='variants') {
        if (c.before===null) check(c.after && receiptCatalogIds.has(c.after.catalogId),'New stock types require a linked catalog receipt',403);
        else {
          check(c.before && c.after,'Only admins may remove stock types',403);
          const {qty:a,...restA}=c.after; const {qty:b,...restB}=c.before;
          check(JSON.stringify(restA)===JSON.stringify(restB),'Only admins may edit material details',403);
        }
      }
      if(c.field==='offcuts' && c.before && c.after) {
        const {qty:a,...restA}=c.after;const {qty:b,...restB}=c.before;
        check(JSON.stringify(restA)===JSON.stringify(restB),'Only admins may correct offcut details',403);
      }
    }
  }
}
// Preserve every historical activity record; client omission never means deletion.
export function normalizeChanges(changes,actor,now) {
  return changes.map(c=> {
    const after=c.after ? {...c.after}:null;
    if(after && c.field==='transactions') {
      if(c.before) {after.voidedBy=actor.username;after.voidedAt=now;}
      else {after.user=actor.username;after.serverTimestamp=now;}
    }
    if(after && c.field==='cncPanels') {
      if(!c.before) {Object.assign(after,normalizeCncInput(after));validateRecord('cncPanels',after,c.id);after.uploadedBy=actor.username;after.uploadedAt=now;}
      if(after.status==='completed') {after.completedBy=actor.username;after.completedAt=now;}
    }
    return {...c,after};
  });
}
