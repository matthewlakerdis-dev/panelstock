// Read-only probes: no credentials, submissions, or synthetic customer records.
const targets=[
 ['Web','https://web.panelstockhq.com/',200],
 ['Mobile','https://app.panelstockhq.com/',200],
 ['Site','https://site.panelstockhq.com/',200],
 ['Safety','https://safety.panelstockhq.com/',200],
 ['Web recovery','https://web.panelstockhq.com/site-order-bulk-dispatch.js',200,'/dispatch/orders/batch-status'],
 ['Site recovery','https://site.panelstockhq.com/app.js',200,'/orders/submission-status'],
 ['Safety recovery','https://safety.panelstockhq.com/',200,'/toolbox/submission-status'],
 ['TV authentication','https://tv.panelstockhq.com/session',401],
 ['Shared API authentication','https://panelstock-reports.matthewlakerdis.workers.dev/session',401]
];
const results=await Promise.allSettled(targets.map(async([name,url,expected,marker])=>{
 const started=Date.now(),response=await fetch(url,{signal:AbortSignal.timeout(20000),headers:{'Cache-Control':'no-cache'}});
 if(response.status!==expected)throw Error(`${name}: expected ${expected}, received ${response.status}`);
 if(expected===401){const body=await response.json();if(!body.error)throw Error(`${name}: invalid authentication response`);}
 else{const body=await response.text();if(marker?!body.includes(marker):!/<html/i.test(body))throw Error(`${name}: invalid or outdated response`);}
 console.log(`${name}: HTTP ${response.status}, ${Date.now()-started} ms`);
}));
let failed=false;for(const result of results)if(result.status==='rejected'){failed=true;console.error(result.reason.message);}if(failed)process.exitCode=1;
