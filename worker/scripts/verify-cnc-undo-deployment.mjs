import assert from 'node:assert/strict';
const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN;
assert.ok(account&&token,'Cloudflare deployment credentials are required');
const base=`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/workers/scripts/panelstock-reports`;
const headers={Authorization:`Bearer ${token}`};
const response=await fetch(base+'/content',{headers});
assert.equal(response.status,200,'Cannot read the deployed production Worker bundle');
const source=await response.text();
const checks={undoRoute:source.includes('/cnc/undo-completion'),adminGuard:source.includes('Only administrators can undo a CNC cut'),stockGuard:source.includes('The original stock reference is ambiguous.')};
console.log('Production Worker CNC undo code:',JSON.stringify(checks));
const deployment=await fetch(base+'/deployments',{headers});
if(deployment.ok){const data=await deployment.json();console.log('Active Worker deployment:',JSON.stringify(data.result?.deployments?.[0]??data.result?.[0]??null,(key,value)=>['id','version_id','percentage','created_on','source','strategy','versions'].includes(key)||key===''||Array.isArray(value)?value:undefined));}
assert.ok(Object.values(checks).every(Boolean),'Production is serving a Worker bundle without the current CNC undo implementation');
