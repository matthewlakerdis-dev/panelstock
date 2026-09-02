import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');

test('factory app remains separate from the site order app',()=>{
 const factory=fs.readFileSync(path.join(root,'index.html'),'utf8');
 const site=fs.readFileSync(path.join(root,'site-orders/index.html'),'utf8');
 assert.equal(factory.includes('order-requests.js'),false);
 assert.match(site,/PanelStock Site Orders/);
 assert.match(site,/manifest\.webmanifest/);
});

test('site order app parses and keeps its own offline queue',()=>{
 const app=fs.readFileSync(path.join(root,'site-orders/app.js'),'utf8');
 assert.doesNotThrow(()=>new Function(app));
 assert.match(app,/panelstock:site-orders:outbox:v1/);
 assert.match(app,/\/orders/);
 assert.match(app,/serviceWorker\.register/);
});
