export function normalizeCncInput(row) {
  const rawOrder = String(row.orderNumber ?? '').trim();
  const orderNumber = /\border(?=\b|\d)/i.test(rawOrder) ? rawOrder.replace(/\D/g, '') : rawOrder;
  const jobReference = String(row.jobReference ?? '').trim().replace(/\s+/g, ' ').toLowerCase().replace(/(^|[\s-])\p{L}/gu, letter => letter.toUpperCase());
  const sheetNumber = String(row.sheetNumber ?? '').trim();
  const panelNumber = String(row.panelNumber ?? '').trim().replace(/^\p{L}/u, letter => letter.toUpperCase());
  const isRemake = row.isRemake === true;
  const isTemplate = row.isTemplate === true;
  const remakeReason = isRemake ? String(row.remakeReason ?? '').trim().replace(/\s+/g, ' ') : '';
  return {...row, orderNumber, jobReference, sheetNumber, panelNumber, isRemake, isTemplate, remakeReason};
}

export function cncDuplicateKey(row) {
  const value=normalizeCncInput(row);
  return JSON.stringify([value.jobReference,value.orderNumber,value.sheetNumber,value.panelNumber].map(part=>String(part??'').trim().toLocaleLowerCase('en-AU')));
}

// Call with panels from one physical sheet. Unmarked/manual areas stay additive.
export function sumCncPanelArea(panels) {
  let individual = 0, sheetTotal = 0;
  for (const panel of panels) {
    const area = Number(panel.totalPanelArea) || 0;
    if (panel.panelAreaScope === 'sheet') sheetTotal = Math.max(sheetTotal, area);
    else individual += area;
  }
  return sheetTotal + individual;
}

export function compareCncOrders(a, b) {
  const left = String(a).match(/\d+/)?.[0];
  const right = String(b).match(/\d+/)?.[0];
  if (left && right) {
    const x = BigInt(left), y = BigInt(right);
    if (x !== y) return x > y ? -1 : 1;
  } else if (left || right) return left ? -1 : 1;
  return String(b).localeCompare(String(a), 'en', {numeric: true});
}
