import assert from 'node:assert/strict';
import {gateProgressClient} from '../generated/gate-progress-client.js';
const base='https://panelstock-reports.matthewlakerdis.workers.dev';
const headers={'Cache-Control':'no-cache','User-Agent':'PanelStock-release-verifier/1.0'};
async function verify(){
 const client=await fetch(base+'/gate-progress/client.js',{headers});assert.equal(client.status,200);assert.equal(await client.text(),gateProgressClient);
 for(const path of ['/gate-components','/gate-progress/export']){const response=await fetch(base+path,{headers});assert.equal(response.status,401,path);}
 const health=await fetch(base+'/gate-progress/health',{headers});assert.equal(health.status,200);assert.deepEqual(await health.json(),{ready:true,staging:false});
 const redirect=await fetch(base+'/gate-progress',{headers,redirect:'manual'});assert.equal(redirect.status,302);assert.equal(redirect.headers.get('location'),'https://web.panelstockhq.com/?page=gate-progress');
 const feed=await fetch(base+'/cnc-tracker/excel-data?token=invalid-release-verification&report=gate-progress&gateProgressVersion=1',{headers});assert.equal(feed.status,404);
 console.log('Verified production Gate Progress client, login protection, store readiness and website link without changing orders.');
}
for(let attempt=0;;attempt++){try{await verify();break;}catch(error){if(attempt===5)throw error;await new Promise(resolve=>setTimeout(resolve,5000));}}
