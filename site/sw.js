const CACHE='panelstock-site-v16';
const ASSETS=['/site/','/site/index.html','/site/styles.css?v=factory-match-2','/site/factory-match.css?v=factory-match-13','/site/app.js?v=factory-match-6','/worker/src/brand-logo.js','/site/manifest.webmanifest','/icon-mobile-v3-192.png','/icon-mobile-v3-512.png'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{if(event.request.method!=='GET')return;event.respondWith(fetch(event.request).then(response=>{const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy));return response;}).catch(()=>caches.match(event.request).then(hit=>hit||caches.match('/site/'))));});
