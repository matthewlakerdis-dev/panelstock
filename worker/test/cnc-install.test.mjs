import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildCncManifest,cncInstallIcon} from '../src/cnc-install.js';
import {buildCncTrackerHtml} from '../src/cnc-tracker.js';
test('installed tracker stays in standalone scope and retains encoded share access',()=>{
 const token='a&b"</script>?';const manifest=buildCncManifest(token);
 const start=new URL(manifest.start_url,'https://example.test');
 assert.equal(start.searchParams.get('token'),token);
 assert.ok(start.pathname.startsWith(manifest.scope));
 assert.equal(manifest.display,'standalone');
 const html=buildCncTrackerHtml(token);
 assert.ok(html.includes('manifest.webmanifest?v=adaptive-v4&amp;token='+encodeURIComponent(token)));
 assert.ok(html.includes('name="apple-mobile-web-app-capable" content="yes"'));
 assert.ok(!html.includes(token));
});
test('install icons have the declared PNG dimensions',()=>{
 for(const size of [192,512]){
 const bytes=cncInstallIcon(size);const view=new DataView(bytes.buffer);
 assert.deepEqual([...bytes.slice(0,8)],[137,80,78,71,13,10,26,10]);
 assert.equal(view.getUint32(16),size);assert.equal(view.getUint32(20),size);
 }
});

import fs from 'node:fs';
import vm from 'node:vm';
test('scheduled reports run without HTTP request context',async()=>{
 const src=fs.readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
 const body=src.slice(src.indexOf('async scheduled(event,env,ctx) {')+'async scheduled(event,env,ctx) {'.length,src.lastIndexOf('\n  }'));
 const run=vm.runInNewContext('(async(event,env,ctx)=>{'+body+'})');
 let read=false;
 await run({}, {READ_ONLY:'false',EMAIL_ENABLED:'false',INVENTORY:{getByName:()=>({scheduledData:async()=>{read=true;return {data:{},config:{}};}})}}, {});
 assert.ok(read);
});

test('Android receives a dedicated adaptive icon rather than a combined-purpose fallback',()=>{
 const icons=buildCncManifest('test').icons;
 assert.ok(icons.some(icon=>icon.purpose==='maskable'&&icon.sizes==='512x512'));
 assert.ok(icons.some(icon=>icon.purpose==='any'));
 assert.ok(icons.every(icon=>!icon.purpose.includes(' ')));
 assert.equal(new Set(icons.map(icon=>icon.src)).size,icons.length);
});
