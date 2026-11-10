import '../../offcut-labels.js';
import {normalizeCncInput} from './cnc-input.js';

const labels = globalThis.PanelStockOffcutLabels;
const reference = value => String(value ?? '').trim().toLocaleLowerCase('en-AU');
const sheetKey = value => JSON.stringify([value.jobReference,value.orderNumber,value.sheetNumber].map(reference));

// Keep stock lookup on the server. The public tracker receives counts and the
// printable material/finish/dimensions, never the underlying inventory records.
export function collectPublicCncOffcutLabels(panels, stock) {
  return labels.collectForCnc(panels.map(normalizeCncInput), stock);
}

export function cncOffcutLabelCounts(items) {
  const sheets = new Map();
  for (const item of items) {
    const scope = {jobReference:item.job,orderNumber:item.order,sheetNumber:item.sheet};
    const key = sheetKey(scope), current = sheets.get(key) || {...scope,count:0};
    current.count++;
    sheets.set(key,current);
  }
  return [...sheets.values()];
}

export function selectCncOffcutLabels(items, query) {
  if (!query.has('job') || !query.has('order') || !query.get('order').trim() || (query.has('sheet') && !query.get('sheet').trim())) return [];
  const scope = normalizeCncInput({jobReference:query.get('job'),orderNumber:query.get('order'),sheetNumber:query.get('sheet')});
  return items.filter(item => reference(item.job) === reference(scope.jobReference) && reference(item.order) === reference(scope.orderNumber) && (!query.has('sheet') || reference(item.sheet) === reference(scope.sheetNumber)));
}

export function buildCncOffcutLabelDocument(items) {
  return labels.buildDocument(items);
}
