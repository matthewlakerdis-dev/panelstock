// Shared by browser downloads and email attachments. Keep names portable to OneDrive.
export function toolboxExportName(record){
 const part=(value,fallback,max)=>String(value||'').normalize('NFKC').replace(/[^\p{L}\p{N}\p{M} .&'()-]+/gu,' ').replace(/\s+/g,' ').replace(/^[. ]+|[. ]+$/g,'').slice(0,max).replace(/[\uD800-\uDBFF]$/,'').replace(/[. ]+$/g,'')||fallback;
 const label=record.type==='daily'?'Daily Pre-start':'Weekly Toolbox Talk',date=/^\d{4}-\d{2}-\d{2}$/.test(record.date||'')?record.date.split('-').reverse().join('-'):'Undated';
 return [part(record.company,'Lennox Facades',50),label,part(record.site,'Workshop',80),date,...(record.status==='Draft'?['Draft']:[])].join(' - ');
}
