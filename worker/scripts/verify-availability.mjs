// Read-only probes: no credentials, submissions, or synthetic customer records.
const targets=[
 ['Web','https://web.panelstockhq.com/',200],
 ['Mobile','https://app.panelstockhq.com/',200],
 ['Site','https://site.panelstockhq.com/',200],
 ['Safety','https://safety.panelstockhq.com/',200],
 ['TV','https://tv.panelstockhq.com/',200],
 ['Shared API authentication','https://panelstock-reports.matthewlakerdis.workers.dev/session',401]
];
const results=await Promise.allSettled(targets.map(async([name,url,expected])=>{
 const started=Date.now(),response=await fetch(url,{signal:AbortSignal.timeout(20000),headers:{'Cache-Control':'no-cache'}});
 if(response.status!==expected)throw Error(`${name}: expected ${expected}, received ${response.status}`);
 if(expected===401){const body=await response.json();if(!body.error)throw Error(`${name}: invalid authentication response`);}
 else{const body=await response.text();if(!/<html/i.test(body))throw Error(`${name}: invalid page response`);}
 console.log(`${name}: HTTP ${response.status}, ${Date.now()-started} ms`);
}));
let failed=false;for(const result of results)if(result.status==='rejected'){failed=true;console.error(result.reason.message);}if(failed)process.exitCode=1;
