// Download errors stay internal; never log request URLs, credentials or records.
export function trackerExportFailure(error,stage,secret=''){
 const redact=value=>{
  let text=String(value||'');
  if(secret)text=text.split(secret).join('[credential]');
  return text.replace(/https?:\/\/[^\s<>]+/gi,'[url]')
   .replace(/\b(?:Bearer\s+|(?:token|tracker|ticket|authorization)\s*[:=]\s*)[^\s,;]+/gi,'[credential]')
   .replace(/\b[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\b/gi,'[id]')
   .replace(/\b[a-f0-9]{32,}\b/gi,'[id]')
   .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,'[email]')
   .replace(/(["'`])[^\n]*?\1/g,'[quoted value]')
   .replace(/[\r\n\t]+/g,' ').slice(0,400);
 };
 return {stage:['workbook-data','pdf-links','workbook-build'].includes(stage)?stage:'unknown',name:String(error?.name||'Error').replace(/[^a-z0-9_]/gi,'').slice(0,40),detail:redact(error?.message),retryable:error?.retryable===true,overloaded:error?.overloaded===true,...(error?.cause?{cause:redact(error.cause?.message||error.cause)}:{})};
}
