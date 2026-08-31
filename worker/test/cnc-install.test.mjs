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
 assert.ok(html.includes('manifest.webmanifest?token='+encodeURIComponent(token)));
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
