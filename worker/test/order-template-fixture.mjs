import {buildZip} from '../src/reports.js';
const enc=new TextEncoder();
export async function orderTemplateFixture(){
  const placeholders=['ORDER_NUMBER','PAGE_COUNT','PROJECT','DATE_ORDERED','SITE_CONTACT','PHONE','ORDER_TYPE','REQUESTED_DATE','REQUESTED_TIME','SCHEDULED_DATE','SCHEDULED_TIME','LOCATION_NOTES','ITEM_NUMBER','QUANTITY','ON_TRUCK','DESCRIPTION','RECEIVED','BACK_ORDER'];
  const shared=`<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${placeholders.map(value=>`<si><t>{{${value}}}</t></si>`).join('')}</sst>`;
  const rows=Array.from({length:30},(_,index)=>{const row=index+18;return `<row r="${row}"><c r="A${row}" s="1"><v>${index+1}</v></c><c r="B${row}" s="2"/><c r="C${row}" s="3"/><c r="K${row}" s="4" t="b"><v>0</v></c><c r="L${row}" s="5"/><c r="M${row}" s="6"/></row>`;}).join('');
  const sheet=`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData><pageMargins left="0.19685039370078741" right="0.19685039370078741" top="0.19685039370078741" bottom="0.19685039370078741"/><pageSetup paperSize="9" orientation="portrait"/></worksheet>`;
  return buildZip([{name:'xl/sharedStrings.xml',data:enc.encode(shared)},{name:'xl/worksheets/sheet1.xml',data:enc.encode(sheet)}]);
}
