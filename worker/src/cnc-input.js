export function normalizeCncInput(row) {
  const rawOrder = String(row.orderNumber ?? '').trim();
  const orderNumber = /\border(?=\b|\d)/i.test(rawOrder) ? rawOrder.replace(/\D/g, '') : rawOrder;
  const jobReference = String(row.jobReference ?? '').trim().replace(/\s+/g, ' ').toLowerCase().replace(/(^|[\s-])\p{L}/gu, letter => letter.toUpperCase());
  return {...row, orderNumber, jobReference};
}
