import assert from 'node:assert/strict';
const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN;
assert.ok(account&&token,'Cloudflare deployment credentials are required');
const base=`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/workers/scripts/panelstock-reports`;
const headers={Authorization:`Bearer ${token}`};
async function readSource(){
 const fresh={headers:{...headers,'Cache-Control':'no-cache'}};
 let response=await fetch(base+'?verification='+Date.now(),fresh);
 if(response.status===404){
  const services=`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/workers/services/panelstock-reports`;
  const metadata=await fetch(services,fresh);
  assert.equal(metadata.status,200,'Cannot read the deployed production Worker service');
  const service=(await metadata.json()).result,environment=service?.default_environment?.environment;
  assert.ok(environment,'Production Worker default environment is missing');
  console.log('Reading production Worker environment:',environment);
  response=await fetch(services+'/environments/'+encodeURIComponent(environment)+'/content/v2?verification='+Date.now(),fresh);
 }
 assert.equal(response.status,200,'Cannot read the deployed production Worker bundle');
 return response.text();
}
let source;
for(let attempt=0;attempt<12;attempt++){
 source=await readSource();
 const capabilities={panelArea:source.includes('/qa/panels/area')&&source.includes('Enter a positive panel length and width in millimetres')&&source.includes('Panel area changed on another device.'),entryTime:source.includes('timeChange'),dragMove:source.includes('moveChange'),durationValidation:source.includes('Moving a booking must preserve its duration'),planDateSync:source.includes('order-production-plan-date-rescheduled')};
 console.log('Production schedule capabilities:',JSON.stringify(capabilities));
 if(Object.values(capabilities).every(Boolean))break;
 if(attempt<11)await new Promise(resolve=>setTimeout(resolve,2000));
}
assert.ok(source.includes('timeChange')&&source.includes('The changed time must be on a 30-minute increment')&&source.includes('This booking changed. Refresh the schedule before resizing it'),'Production Worker is missing the protected schedule entry time-save route');
assert.ok(source.includes('moveChange')&&source.includes('Moving a booking must preserve its duration')&&source.includes('order-production-plan-date-rescheduled'),'Production Worker is missing protected drag movement and linked plan date synchronization');
console.log('Production Worker schedule resize, move and linked plan date validation verified.');
assert.ok(source.includes('/qa/panels/area')&&source.includes('Enter a positive panel length and width in millimetres')&&source.includes('Panel area changed on another device.'),'Production Worker is missing per-item QA area capture and validation');
console.log('Verified production per-panel area capture, server dimension calculation and stale-edit protection.');
const checks={undoRoute:source.includes('/cnc/undo-completion'),adminGuard:source.includes('Only administrators can undo a CNC cut'),stockGuard:source.includes('The original stock reference is ambiguous.')};
console.log('Production Worker CNC undo code:',JSON.stringify(checks));
const deployment=await fetch(base+'/deployments',{headers});
if(deployment.ok){const data=await deployment.json(),active=data.result?.deployments?.[0]??data.result?.[0];console.log('Active Worker deployment:',JSON.stringify(active?{id:active.id,createdOn:active.created_on,versions:active.versions}:null));}
assert.ok(Object.values(checks).every(Boolean),'Production is serving a Worker bundle without the current CNC undo implementation');
assert.match(source,/\["siteDelivery",\s*"Delivery"\]/,'The production Worker must expose Delivery in the booking defaults');
assert.match(source,/productionBookingStages[,:]/,'The production Worker must publish the booking task list');
console.log('Verified Delivery in the deployed Worker booking defaults.');

const website=await fetch('https://web.panelstockhq.com/',{headers:{'Cache-Control':'no-cache'}});
assert.equal(website.status,200,'Cannot read the production website');
const html=await website.text(),start=html.indexOf('async function undoCncCutRequest('),end=html.indexOf('\n    function ',start);
assert.ok(start>=0&&end>start,'Published Undo cut handler is missing');
const handler=html.slice(start,end);
console.log('Production website Undo cut request:',JSON.stringify({correctRoute:handler.includes('/cnc/undo-completion'),post:handler.includes('method:"POST"'),jsonBody:handler.includes('JSON.stringify(payload)'),correctApi:html.includes('var BAKED_WORKER_URL = "https://panelstock-reports.matthewlakerdis.workers.dev"')}));
assert.ok(handler.includes('/cnc/undo-completion')&&handler.includes('method:"POST"')&&handler.includes('JSON.stringify(payload)'),'Published Undo cut request differs from the tested implementation');
