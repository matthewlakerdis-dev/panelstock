// Retirement worker for old home-screen shortcuts. The active worker is built
// from worker/templates/site-orders/sw.js, never from this file.
const DESTINATION='https://site.panelstockhq.com/';
function isRetiredPage(value){
  const url=new URL(value);
  return url.origin==='https://app.panelstockhq.com'&&
    /^\/(?:site|site-orders)(?:\/|$)/.test(url.pathname);
}
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  if(self.location.origin!=='https://app.panelstockhq.com')return;
  // Only obsolete Site Orders assets; do not touch factory caches or local queues.
  const keys=await caches.keys();
  await Promise.all(keys.filter(key=>key.startsWith('panelstock-site-')).map(key=>caches.delete(key)));
  await self.clients.claim();
  const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  await Promise.all(windows.filter(client=>isRetiredPage(client.url)).map(async client=>{
    try{await client.navigate(DESTINATION);}catch{/* A closing tab must not block activation. */}
  }));
})()));
self.addEventListener('fetch',event=>{
  const request=event.request;
  if(request.method!=='GET'||request.mode!=='navigate'||!isRetiredPage(request.url))return;
  // Never forward old query strings, fragments, tokens or API requests.
  event.respondWith(Response.redirect(DESTINATION,302));
});
