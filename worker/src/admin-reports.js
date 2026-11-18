import {createProductionAreaPdf} from './production-area-pdf.js';
import {HttpError} from './security.js';
import {CNC_COLUMNS, CNC_REPORT_PERIODS, buildCncReportRows} from './cnc-excel.js';
import {buildXlsxBytes} from './reports.js';
import {SITE_ORDER_COLUMNS} from './site-orders-excel.js';

const m2Reports = new Map(CNC_REPORT_PERIODS.flatMap(period =>
  ['all', 'panels', 'gates'].map(product => [`m2-${period}-${product}`, {period, product}])
));
export const supportsAdminReportPdf = report => m2Reports.has(report);
export const ADMIN_REPORT_IDS = new Set([
  'site-orders', 'cnc-tracker', ...CNC_REPORT_PERIODS.map(period => 'cnc-' + period), ...m2Reports.keys()
]);
const dateLabels = {daily:'Date', weekly:'Week starting', monthly:'Month starting'};

// ISO weeks start on Monday, and week 1 contains 4 January.
const firstWeek = year => {
  const january4 = new Date(Date.UTC(year, 0, 4));
  return january4.getTime() - ((january4.getUTCDay() + 6) % 7) * 86400000;
};
const isoDate = date => date.toISOString().slice(0, 10);
function periodStart(value, period) {
  if (period === 'weekly') {
    const match = /^([1-9]\d{3})-W(0[1-9]|[1-4]\d|5[0-3])$/.exec(value);
    if (match) {
      const year = Number(match[1]);
      const start = firstWeek(year) + (Number(match[2]) - 1) * 7 * 86400000;
      if (start < firstWeek(year + 1)) return isoDate(new Date(start));
    }
  } else {
    const date = period === 'monthly' ? value + '-01' : value;
    if (/^[1-9]\d{3}-\d{2}-\d{2}$/.test(date)) {
      const parsed = new Date(date + 'T00:00:00Z');
      if (Number.isFinite(parsed.getTime()) && isoDate(parsed) === date) return date;
    }
  }
  throw new HttpError(400, 'Enter a valid ' + {daily:'date', weekly:'week', monthly:'month'}[period] + '.');
}

export function productionAreaPdfFilename(report, filters) {
  const {period, product} = m2Reports.get(report);
  const from = filters.get('from'), to = filters.get('to');
  const productLabel = {all:'Panels-and-Gates', panels:'Panels', gates:'Gates'}[product];
  const grouping = {daily:'Daily', weekly:'Weekly', monthly:'Monthly'}[period];
  const range = from && to ? (from === to ? from : `${from}_to_${to}`)
    : from ? `From_${from}` : to ? `Through_${to}` : 'All-Periods';
  return `Production-m2_${productLabel}_${grouping}_${range}.pdf`;
}

async function buildProductionAreaReport(store, {period, product}, filters) {
  const from = filters.get('from'), to = filters.get('to');
  const start = from ? periodStart(from, period) : '';
  const end = to ? periodStart(to, period) : '';
  if (start && end && start > end) throw new HttpError(400, 'From must be on or before To.');
  const includePanels = product !== 'gates';
  const includeGates = product !== 'panels';
  const {rows, gateRows} = await store.readPublicCncExcelData(includeGates);
  const dateLabel = dateLabels[period];
  const columns = [
    dateLabel,
    ...(includePanels ? ['Panel area (m²)'] : []),
    ...(includeGates ? ['Gate area (m²)'] : []),
    ...(product === 'all' ? ['Total area (m²)'] : [])
  ];
  const periods = buildCncReportRows(includePanels ? rows : [], new Date(), includeGates ? gateRows ?? [] : undefined);
  const matching = periods[period].filter(row => {
    const [day, month, year] = row.date.split('/');
    const date = `${year}-${month}-${day}`;
    return (!start || date >= start) && (!end || date <= end);
  });
  const data = matching.map(row => ({
    [dateLabel]: row.date,
    'Panel area (m²)': row.area,
    'Gate area (m²)': row.gateArea,
    'Total area (m²)': row.totalArea
  }));
  return filters.get('format') === 'pdf'
    ? createProductionAreaPdf({columns, data, product, period, from, to})
    : buildXlsxBytes(data, columns);
}
const siteDate = serial => Number.isFinite(serial)
  ? new Date(Date.UTC(1899, 11, 30) + serial * 86400000).toISOString().slice(0, 10)
  : '';

export async function buildAdminReport(store, report, filters = new URLSearchParams()) {
  if (m2Reports.has(report)) return buildProductionAreaReport(store, m2Reports.get(report), filters);
  if (report === 'site-orders') {
    const rows = (await store.readPublicSiteOrders()).map(row => ({
      ...row,
      'Date ordered': siteDate(row['Date ordered']),
      'Requested date': siteDate(row['Requested date']),
      'Order number': {text: row['Order number']}
    }));
    return buildXlsxBytes(rows, SITE_ORDER_COLUMNS);
  }

  const {rows, gateRows} = await store.readPublicCncExcelData(report !== 'cnc-tracker');
  if (report === 'cnc-tracker') {
    const tracker = rows.map(row => ({
      ...row,
      'Order No.': {text: row['Order No.']},
      Sheet: {text: row.Sheet},
      'Panel IDs': {text: row['Panel IDs']},
      Waste: row.Waste.value === '' ? '' : Math.round(row.Waste.value * 100) + '%'
    }));
    return buildXlsxBytes(tracker, CNC_COLUMNS);
  }

  const period = report.slice('cnc-'.length);
  const dateLabel = dateLabels[period];
  const data = buildCncReportRows(rows, new Date(), gateRows)[period].map(row => ({
    [dateLabel]: row.date, 'Sheets cut': row.sheets, 'Panels cut': row.panels, 'Panel area (m²)': row.area,
    ...(gateRows ? {'Gate area (m²)': row.gateArea, 'Total area (m²)': row.totalArea} : {})
  }));
  return buildXlsxBytes(data, [dateLabel, 'Sheets cut', 'Panels cut', 'Panel area (m²)', ...(gateRows ? ['Gate area (m²)', 'Total area (m²)'] : [])]);
}
