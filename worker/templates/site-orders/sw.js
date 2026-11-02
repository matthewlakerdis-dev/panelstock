// Release admin Panel order type correction #235 with generated legacy Site client (2026-11-02).
// Release Site app Back navigation in both clients (2026-11-01).
// Release All Orders default #224 with generated legacy Site client (2026-11-01).
// Release first missing Site Order field focus #220 with generated legacy Site client (2026-10-31).
// Release required Site Order field highlights #218 with generated legacy Site client (2026-10-31).
// Release scheduled delivery cards #215 and editable User details #216 with generated legacy Site client (2026-10-30).
// Release default My Orders tab #213 with generated legacy Site client (2026-10-30).
// Release account-based Site Order contacts #211 with generated legacy Site client (2026-10-30).
// Release blank required delivery date #209 with generated legacy Site client (2026-10-30).
// Release Site Order attachment emails #203 with generated legacy client (2026-10-30).
// Release Site item capitals during mobile keyboard entry #200 with generated legacy client (2026-10-29).
// Release Gate Drawn to QA workflow #196 with generated legacy clients (2026-10-29).
// Release manual Gate production progress #194 with generated legacy client (2026-10-29).
// Release admin delivery scheduling #185 with generated legacy client (2026-10-27).
// Release uppercase Site Order descriptions #183 with generated legacy client (2026-10-27).
// Release mobile Site Orders #119 with generated legacy clients (2026-10-12).
// Release orders active until dispatch #117 with generated legacy client (2026-10-12).
// Release Site Orders dispatch #114 with generated legacy clients (2026-10-12).
// Release reviewed Site Orders additions #101-#106 with the generated legacy client (2026-10-11).
// Release order upload success fix in both clients (2026-10-09).
// A new cache discards the old versions that could contain private API data.
const CACHE='panelstock-site-v34';
const ASSETS=['/site/','/site/index.html','/site/install-prompt.js?v=1','/site/styles.css?v=factory-match-2','/site/factory-match.css?v=factory-match-20','/site/cnc-tracker.css?v=1','/site/order-controls.css?v=3','/site/app-loader.js?v=audit-fixes-20261101','/site/app.js?v=audit-fixes-20261101','/site/app.legacy.js?v=audit-fixes-20261101','/worker/src/brand-logo.js','/site/manifest.webmanifest','/icon-mobile-v3-192.png','/icon-mobile-v3-512.png'];
const STATIC_URLS=new Set(ASSETS.map(asset=>new URL(asset,self.location.origin).href));
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('panelstock-site-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  const request=event.request;
  // Do not intercept API calls, authenticated requests, exports or unknown query strings.
  if(request.method!=='GET'||request.headers.has('Authorization')||!STATIC_URLS.has(request.url))return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    try {
      const response=await fetch(request);
      if(response.ok&&!response.redirected&&!/no-store|private/i.test(response.headers.get('Cache-Control')||'')){
        const copy=response.clone();
        event.waitUntil(cache.put(request,copy).catch(()=>{}));
      }
      return response;
    }catch{
      return await cache.match(request)||new Response('Site Orders is unavailable offline.',{status:503,headers:{'Content-Type':'text/plain'}});
    }
  })());
});
