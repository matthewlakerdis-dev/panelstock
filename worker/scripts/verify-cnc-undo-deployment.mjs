import assert from 'node:assert/strict';
const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN;
assert.ok(account&&token,'Cloudflare deployment credentials are required');
const base=`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/workers/scripts/panelstock-reports`;
const headers={Authorization:`Bearer ${token}`};
let response=await fetch(base,{headers});
// Service Workers use their default environment's content endpoint.
if(response.status===404){
 const services=`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/workers/services/panelstock-reports`;
 const metadata=await fetch(services,{headers});
 assert.equal(metadata.status,200,'Cannot read the deployed production Worker service');
 const environment=(await metadata.json()).result?.default_environment?.environment;
 assert.ok(environment,'Production Worker default environment is missing');
 response=await fetch(services+'/environments/'+encodeURIComponent(environment)+'/content/v2',{headers});
}
assert.equal(response.status,200,'Cannot read the deployed production Worker bundle');
const source=await response.text();
assert.ok(source.includes('timeChange')&&source.includes('The changed time must be on a 30-minute increment')&&source.includes('This booking changed. Refresh the schedule before resizing it'),'Production Worker is missing the protected schedule entry time-save route');
console.log('Production Worker schedule entry time-save route and validation verified.');
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
