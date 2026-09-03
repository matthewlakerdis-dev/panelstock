import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');

test('factory app remains separate from the site order app',()=>{
 const factory=fs.readFileSync(path.join(root,'index.html'),'utf8');
 const site=fs.readFileSync(path.join(root,'site/index.html'),'utf8');
 assert.equal(factory.includes('order-requests.js'),false);
 assert.match(site,/PanelStock Site Orders/);
 assert.match(site,/manifest\.webmanifest/);
});

test('site order app parses and keeps its own offline queue',()=>{
 const app=fs.readFileSync(path.join(root,'site/app.js'),'utf8');
 const classicBody=app.replace(/^import .*?;\s*/,'');
 assert.doesNotThrow(()=>new Function(classicBody));
 assert.match(app,/panelstock:site-orders:outbox:v1/);
 assert.match(app,/panelstock:site-orders:projects:v1/);
 assert.match(app,/\/orders/);
 assert.match(app,/serviceWorker\.register/);
});

test('site orders use the simplified status filters and PDF and Excel actions',()=>{
 const app=fs.readFileSync(path.join(root,'site/app.js'),'utf8');
 assert.match(app,/\+ New order/);
 assert.match(app,/<select name="projectId" required>/);
 assert.match(app,/result\.projectRecords/);
 assert.match(app,/projectId:selected\?\.id\|\|null/);
 assert.match(app,/google\.com\/maps\/search\/\?api=1&query=/);
 assert.match(app,/Open in Google Maps/);
 assert.match(app,/Select a project/);
 assert.match(app,/Submitted \/ Ordered/);
 assert.match(app,/data-order-filter="completed"/);
 assert.match(app,/data-order-filter="cancelled"/);
 assert.doesNotMatch(app,/<option value="approved">/);
 assert.match(app,/\/pdf-link/);
  assert.match(app,/data-export="xlsx"/);
  assert.match(app,/finally\{if\(button\.isConnected\)\{button\.disabled=false;button\.innerHTML=original;/);
 assert.match(app,/id\+'\/\'\+format\+'\?ticket='/);
 assert.match(app,/\?ticket=/);
 assert.match(app,/window\.open\('about:blank','_blank'\)/);
 assert.match(app,/Promise\.all\(\[ticket\(\),ticket\(\)\]\)/);
 assert.match(app,/\?download=1&ticket=/);
});

test('old site-orders address redirects to the short site address',()=>{
 const redirect=fs.readFileSync(path.join(root,'site-orders/index.html'),'utf8');
 assert.match(redirect,/url=\/site\//);
});
