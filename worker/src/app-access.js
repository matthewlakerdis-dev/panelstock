import {HttpError,requireCondition as check} from './security.js';

export const APPS={web:'Web',app:'Mobile',site:'Site'};
export function appAccess(user={}) {
 return Object.fromEntries(Object.keys(APPS).map(app=>[app,user.isAdmin===true||user.appAccess?.[app]!==false]));
}
export function normalizeAppAccess(value) {
 check(value&&typeof value==='object'&&!Array.isArray(value),'Invalid app access');
 check(Object.keys(value).every(app=>Object.hasOwn(APPS,app)&&typeof value[app]==='boolean'),'Invalid app access');
 return appAccess({appAccess:value});
}
export function originApp(origin) {
 try {
  const url=new URL(origin);
  const hosts={'web.panelstockhq.com':'web','app.panelstockhq.com':'app','site.panelstockhq.com':'site','panelstock-desktop-staging.pages.dev':'web'};
  if(Object.hasOwn(hosts,url.hostname))return hosts[url.hostname];
  if(['localhost','127.0.0.1'].includes(url.hostname))return {'8090':'web','8091':'app','8092':'site'}[url.port]||'';
 }catch{}
 return '';
}
export function requireAppAccess(user,app) {
 const access=appAccess(user);
 if(app)check(Object.hasOwn(APPS,app),'Unknown app');
 if(app?access[app]:Object.values(access).every(Boolean))return;
 const error=new HttpError(403,app?'You do not have access to the '+APPS[app]+' app. Contact an administrator to request access.':'Choose an app to sign in. Contact an administrator if you need access.');
 error.code='APP_ACCESS_DENIED';throw error;
}
