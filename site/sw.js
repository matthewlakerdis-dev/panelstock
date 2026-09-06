// A new cache discards the old versions that could contain private API data.
const CACHE='panelstock-site-v33';
const ASSETS=['/site/','/site/index.html','/site/styles.css?v=factory-match-2','/site/factory-match.css?v=factory-match-20','/site/cnc-tracker.css?v=1','/site/order-controls.css?v=3','/site/app.js?v=security-2','/worker/src/brand-logo.js','/site/manifest.webmanifest','/icon-mobile-v3-192.png','/icon-mobile-v3-512.png'];
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
