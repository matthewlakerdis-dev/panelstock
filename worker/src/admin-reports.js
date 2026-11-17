import {CNC_COLUMNS, CNC_REPORT_PERIODS, buildCncReportRows} from './cnc-excel.js';
import {buildXlsxBytes} from './reports.js';
import {SITE_ORDER_COLUMNS} from './site-orders-excel.js';

export const ADMIN_REPORT_IDS = new Set(['site-orders', 'cnc-tracker', ...CNC_REPORT_PERIODS.map(period => 'cnc-' + period)]);
const siteDate = serial => Number.isFinite(serial)
  ? new Date(Date.UTC(1899, 11, 30) + serial * 86400000).toISOString().slice(0, 10)
  : '';

export async function buildAdminReport(store, report) {
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
  const dateLabel = {daily:'Date', weekly:'Week starting', monthly:'Month starting'}[period];
  const data = buildCncReportRows(rows, new Date(), gateRows)[period].map(row => ({
    [dateLabel]: row.date, 'Sheets cut': row.sheets, 'Panels cut': row.panels, 'Panel area (m²)': row.area,
    ...(gateRows ? {'Gate area (m²)': row.gateArea, 'Total area (m²)': row.totalArea} : {})
  }));
  return buildXlsxBytes(data, [dateLabel, 'Sheets cut', 'Panels cut', 'Panel area (m²)', ...(gateRows ? ['Gate area (m²)', 'Total area (m²)'] : [])]);
}
