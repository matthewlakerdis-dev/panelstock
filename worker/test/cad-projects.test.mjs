import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {handleCadProjects,inspectManifest,CHUNK_LIMIT} from '../src/cad-projects.js';
const id='12345678-1234-1234-1234-123456789abc',actor=username=>({username,tasks:{'factory.cnc':true}});
const context={window:{},structuredClone,Blob,File,TextEncoder,atob,btoa,crypto:webcrypto};
vm.runInNewContext(fs.readFileSync(new URL('./fixtures/cad-projects-client.js',import.meta.url),'utf8'),context);
const client=context.window.PanelCadProjects;
function make(){const docs=new Map(),objects=new Map();let writes=0;const bucket={put:async(k,v)=>{objects.set(k,new Uint8Array(v));writes++;},get:async k=>objects.has(k)?{arrayBuffer:async()=>objects.get(k).buffer}:null,delete:async keys=>{for(const k of Array.isArray(keys)?keys:[keys])objects.delete(k);}};
 const store={env:{CAD_PROJECT_FILES:bucket},read:(k,f=null)=>structuredClone(docs.has(k)?docs.get(k):f),write:(k,v)=>docs.set(k,structuredClone(v)),ctx:{storage:{transactionSync:f=>f()}}};
 const request=(user='a')=>async(path,body)=>{const result=await handleCadProjects(store,path,body?'POST':'GET',body||{},actor(user));if(result.status!==200){const error=Error(result.body.error);Object.assign(error,result.body,{status:result.status});throw error;}return result.body;};
 return {store,docs,objects,bucket,request,get writes(){return writes;}};
}
const data=(drawing='DXF')=>({name:'Job',index:0,panels:[{name:'Panel',quantity:2,spec:{panelId:'Z2-21'},file:new Blob(['sketch'],{type:'image/png'}),result:{dxf:drawing,svg:'<svg>✓</svg>'},correctionRecovery:{traceClosed:false}}]});
test('large project round-trips through independent file uploads; unchanged files are reused',async()=>{
 const s=make(),api=s.request(),source=data('x'.repeat(8*1024*1024));let response=await client.saveCloud(source,id,0,api);assert.equal(response.revision,1);const initial=s.writes;
 const saved=await api('/cad/projects/'+id),restored=await client.restoreCloud(saved,id,api);assert.equal(restored.panels[0].result.dxf,source.panels[0].result.dxf);assert.equal(restored.panels[0].result.svg,source.panels[0].result.svg);assert.equal(await restored.panels[0].file.text(),'sketch');assert.equal(restored.panels[0].quantity,2);
 source.name='Renamed';response=await client.saveCloud(source,id,1,api);assert.equal(s.writes,initial);assert.equal(response.revision,2);
 source.panels[0].result.dxf='changed';await client.saveCloud(source,id,2,api);assert.equal(s.writes,initial+1);
});
test('accounts including admins cannot read or upload another account project',async()=>{
 const s=make(),a=s.request();await client.saveCloud(data(),id,0,a);assert.equal((await s.request('b')('/cad/projects')).projects.length,0);await assert.rejects(s.request('b')('/cad/projects/'+id),e=>e.status===404);
 const manifest=(await a('/cad/projects/'+id)).manifest,hash=manifest.project.panels[0].file.asset.chunks[0].hash;
 const admin=await handleCadProjects(s.store,'/cad/projects/'+id+'/chunks/'+hash,'GET',{}, {...actor('b'),isAdmin:true});assert.notEqual(admin.status,200);
 assert.equal((await handleCadProjects(s.store,'/cad/projects','GET',{}, {username:'c',tasks:{}})).status,403);
});
test('partial uploads and damaged bytes never replace the last complete save',async()=>{
 const s=make(),api=s.request();await client.saveCloud(data('original'),id,0,api);const packed=await client.packCloud(data('replacement')),pending=await api('/cad/projects/'+id+'/prepare',{revision:1,manifest:packed.manifest});
 await assert.rejects(api('/cad/projects/'+id+'/commit',{uploadId:pending.uploadId}),/not finished/);
 await assert.rejects(api('/cad/projects/'+id+'/upload/'+pending.uploadId+'/'+pending.missing[0],{data:btoa('bad')}),/verification/);
 assert.equal((await api('/cad/projects/'+id)).revision,1);
 const restored=await client.restoreCloud(await api('/cad/projects/'+id),id,api);assert.equal(restored.panels[0].result.dxf,'original');
});
test('stale devices cannot overwrite newer saves and commit retries are idempotent',async()=>{
 const s=make(),api=s.request(),packed=await client.packCloud({name:'Empty',index:0,panels:[{quantity:1}]});const p=await api('/cad/projects/'+id+'/prepare',{revision:0,manifest:packed.manifest});const commit={uploadId:p.uploadId};assert.equal((await api('/cad/projects/'+id+'/commit',commit)).revision,1);assert.equal((await api('/cad/projects/'+id+'/commit',commit)).revision,1);
 await assert.rejects(client.saveCloud(data(),id,0,api),e=>e.conflict===true);assert.equal((await api('/cad/projects/'+id)).revision,1);
});
test('100 MB limit counts original bytes plus metadata, not encoded upload size',()=>{
 const hash='a'.repeat(64),manifest={format:'panelstock-cloud-project',version:2,project:{name:'Large',panels:[{quantity:1,result:{size:99*CHUNK_LIMIT,chunks:Array.from({length:99},()=>({hash,size:CHUNK_LIMIT}))}}]}};
 assert.ok(inspectManifest(manifest).size<100*CHUNK_LIMIT);manifest.project.panels[0].result.size+=CHUNK_LIMIT;manifest.project.panels[0].result.chunks.push({hash,size:CHUNK_LIMIT});assert.throws(()=>inspectManifest(manifest),/100 MB/);
});
test('interrupted uploads resume without resending completed files; missing stored files fail clearly',async()=>{
 const s=make(),api=s.request(),packed=await client.packCloud(data()),p=await api('/cad/projects/'+id+'/prepare',{revision:0,manifest:packed.manifest}),h=p.missing[0],blob=packed.chunks.get(h);
 await api('/cad/projects/'+id+'/upload/'+p.uploadId+'/'+h,{data:Buffer.from(await blob.arrayBuffer()).toString('base64')});const resumed=await api('/cad/projects/'+id+'/prepare',{revision:0,manifest:packed.manifest});assert.equal(resumed.uploadId,p.uploadId);assert.ok(!resumed.missing.includes(h));
 await client.saveCloud(data(),id,0,api);s.objects.clear();await assert.rejects(client.restoreCloud(await api('/cad/projects/'+id),id,api),/unavailable/);
});
test('legacy backups migrate and historical files survive collection',async()=>{
 const s=make(),api=s.request(),key='cad-projects:a:'+id;const legacy=await client.backup(data());s.store.write(key,{project:legacy,revision:1,updatedAt:1});s.store.write('cad-projects:a:index',[{projectId:id,revision:1}]);
 const restored=await client.restoreCloud(await api('/cad/projects/'+id),id,api);await client.saveCloud(restored,id,1,api);assert.equal((await api('/cad/projects/'+id)).manifest.version,2);
 await client.saveCloud(data('new'),id,2,api);const state=s.store.read(key);for(const item of state.garbage)item.after=1;s.store.write(key,state);const before=s.objects.size;await client.saveCloud(data('new'),id,3,api);assert.equal(s.objects.size,before);
});

test('a lost commit response can be retried without duplicate uploads or a conflict copy',async()=>{
 const s=make(),api=s.request();let lost=true;const flaky=async(path,body)=>{const r=await api(path,body);if(path.endsWith('/commit')&&lost){lost=false;throw Error('Connection lost');}return r;};
 await assert.rejects(client.saveCloud(data(),id,0,flaky),/Connection lost/);const count=s.writes;const retry=await client.saveCloud(data(),id,0,api);assert.equal(retry.revision,1);assert.equal(s.writes,count);
});
test('a second device committing during upload causes a conflict at commit',async()=>{
 const s=make(),api=s.request(),m=(await client.packCloud({name:'First',panels:[{quantity:1}]})).manifest,p=await api('/cad/projects/'+id+'/prepare',{revision:0,manifest:m});
 await client.saveCloud({name:'Second',panels:[{quantity:1}]},id,0,api);await assert.rejects(api('/cad/projects/'+id+'/commit',{uploadId:p.uploadId}),e=>e.conflict===true);assert.equal((await api('/cad/projects/'+id)).manifest.project.name,'Second');
});
test('failed file storage and corrupt downloads preserve the existing project',async()=>{
 const s=make(),api=s.request();await client.saveCloud(data('first'),id,0,api);const put=s.bucket.put;s.bucket.put=async()=>{throw Error('Storage unavailable');};await assert.rejects(client.saveCloud(data('second'),id,1,api),/Storage unavailable/);assert.equal((await api('/cad/projects/'+id)).revision,1);s.bucket.put=put;
 const response=await api('/cad/projects/'+id);await assert.rejects(client.restoreCloud(response,id,async(path,body)=>path.includes('/chunks/')?{data:btoa('corrupt')}:api(path,body)),/verified/);
});
test('repeated interrupted edits in the same browser supersede unfinished saves',async()=>{
 const s=make(),api=s.request();s.bucket.put=async()=>{throw Error('Offline');};for(let i=0;i<5;i++)await assert.rejects(client.saveCloud(data('change '+i),id,0,api),/Offline/);assert.equal(Object.keys(s.store.read('cad-projects:a:'+id).uploads).length,1);
});
test('renaming changes metadata without uploading files, checks revision and ownership',async()=>{const s=make(),api=s.request();await client.saveCloud(data(),id,0,api);const count=s.writes;await api('/cad/projects/'+id+'/rename',{revision:1,name:'Renamed'});assert.equal(s.writes,count);assert.equal((await api('/cad/projects/'+id)).manifest.project.name,'Renamed');await assert.rejects(api('/cad/projects/'+id+'/rename',{revision:1,name:'Stale'}),e=>e.conflict);await assert.rejects(s.request('b')('/cad/projects/'+id+'/rename',{revision:2,name:'Other'}),e=>e.status===404);});
test('deleted projects disappear and stale devices cannot resurrect them',async()=>{const s=make(),api=s.request();await client.saveCloud(data(),id,0,api);await api('/cad/projects/'+id+'/delete',{revision:1});assert.equal((await api('/cad/projects')).projects.length,0);await assert.rejects(api('/cad/projects/'+id),e=>e.status===404);await assert.rejects(client.saveCloud(data(),id,1,api),e=>e.conflict);const key='cad-projects:a:'+id,state=s.store.read(key);state.garbage.forEach(g=>g.after=1);s.store.write(key,state);await api('/cad/projects');assert.equal(s.objects.size,0);});
test('duplicates survive deletion of their original project',async()=>{const s=make(),api=s.request(),copy='22345678-1234-1234-1234-123456789abc';await client.saveCloud(data(),id,0,api);const source=await client.restoreCloud(await api('/cad/projects/'+id),id,api);source.name='Copy';await client.saveCloud(source,copy,0,api);await api('/cad/projects/'+id+'/delete',{revision:1});const restored=await client.restoreCloud(await api('/cad/projects/'+copy),copy,api);assert.equal(restored.name,'Copy');assert.equal(restored.panels[0].result.dxf,'DXF');});
test('original PDF is uploaded once across panels and restored byte for byte',async()=>{const s=make(),api=s.request(),pdf=new File(['%PDF original source'],'Source.pdf',{type:'application/pdf'}),source={name:'PDF project',index:0,panels:[{quantity:1,sourcePdf:pdf},{quantity:1,sourcePdf:pdf}]};const packed=await client.packCloud(source);assert.equal(packed.manifest.version,3);assert.equal(packed.manifest.project.pdfSources.length,1);assert.equal(inspectManifest(packed.manifest).size,packed.size);await client.saveCloud(source,id,0,api);assert.equal(s.writes,1);const restored=await client.restoreCloud(await api('/cad/projects/'+id),id,api);assert.equal(await restored.panels[1].sourcePdf.text(),'%PDF original source');assert.equal(restored.panels[0].sourcePdfName,'Source.pdf');assert.equal(restored.panels[0].sourcePdf,restored.panels[1].sourcePdf);await client.saveCloud(restored,id,1,api);assert.equal(s.writes,1);packed.manifest.project.panels[0].sourcePdf=2;assert.throws(()=>inspectManifest(packed.manifest),/PDF reference/);});
test('history restores original drawing data and keeps the version it replaced',async()=>{
 const s=make(),api=s.request(),base='/cad/projects/'+id;await client.saveCloud(data('first'),id,0,api);await client.saveCloud(data('second'),id,1,api);
 let history=await api(base+'/versions');assert.equal(history.versions.length,1);const version=history.versions[0];const old=await client.restoreCloud(await api(base+'/versions/'+version.id),id,(p,b)=>api(p.replace(base+'/chunks/',base+'/versions/'+version.id+'/'),b));assert.equal(old.panels[0].result.dxf,'first');
 await api(base+'/restore',{revision:2,versionId:version.id});const current=await client.restoreCloud(await api(base),id,api);assert.equal(current.panels[0].result.dxf,'first');history=await api(base+'/versions');assert.equal(history.versions.length,2);assert.equal(history.versions[0].label,'Before restoring a version');await assert.rejects(api(base+'/restore',{revision:2,versionId:version.id}),e=>e.conflict);await assert.rejects(s.request('b')(base+'/versions/'+version.id),e=>e.status===404);
});
test('combining named order copies keeps newest current and pins other copies in history',async()=>{
 const s=make(),api=s.request(),other='32345678-1234-1234-1234-123456789abc';const a=data('old');a.name='MILTON - ORDER 100';await client.saveCloud(a,id,0,api);const b=data('new');b.name='MILTON - ORDER 100 (device copy)';await client.saveCloud(b,other,0,api);
 const state=s.store.read('cad-projects:a:'+other);state.updatedAt+=10;s.store.write('cad-projects:a:'+other,state);await api('/cad/projects/'+other+'/merge',{revision:1,sources:[{projectId:id,revision:1}]});const projects=(await api('/cad/projects')).projects;assert.equal(projects.length,1);assert.equal(projects[0].name,'MILTON - ORDER 100');const current=await client.restoreCloud(await api('/cad/projects/'+other),other,api);assert.equal(current.panels[0].result.dxf,'new');const history=await api('/cad/projects/'+other+'/versions');assert.equal(history.versions.length,1);assert.equal(history.versions[0].pinned,true);const v=history.versions[0],base='/cad/projects/'+other,old=await client.restoreCloud(await api(base+'/versions/'+v.id),other,(p,b)=>api(p.replace(base+'/chunks/',base+'/versions/'+v.id+'/'),b));assert.equal(old.panels[0].result.dxf,'old');await assert.rejects(client.saveCloud(a,id,1,api),e=>e.mergedInto===other);
});
test('local copies import once, preserving newer account contents and promoting newer local contents',async()=>{
 const s=make(),api=s.request();await client.saveCloud(data('account'),id,0,api);const account=await api('/cad/projects/'+id),older=data('older device');older.updatedAt=account.updatedAt-1000;
 let r=await client.saveCloud(older,id,1,api,()=>{},{importCopy:true});assert.equal((await client.restoreCloud(await api('/cad/projects/'+id),id,api)).panels[0].result.dxf,'account');let history=await api('/cad/projects/'+id+'/versions');assert.equal(history.versions.length,1);r=await client.saveCloud(older,id,r.revision,api,()=>{},{importCopy:true});assert.equal((await api('/cad/projects/'+id+'/versions')).versions.length,1);
 const key='cad-projects:a:'+id,state=s.store.read(key);state.updatedAt=1;s.store.write(key,state);const newer=data('newer device');newer.updatedAt=Date.now();await client.saveCloud(newer,id,r.revision,api,()=>{},{importCopy:true});assert.equal((await client.restoreCloud(await api('/cad/projects/'+id),id,api)).panels[0].result.dxf,'newer device');
});
test('different orders cannot merge and stale merges preserve both copies',async()=>{const s=make(),api=s.request(),other='42345678-1234-1234-1234-123456789abc';await client.saveCloud(data(),id,0,api);const second=data();second.name='Different order';await client.saveCloud(second,other,0,api);await assert.rejects(api('/cad/projects/'+other+'/merge',{revision:1,sources:[{projectId:id,revision:1}]}),/same named order/);assert.equal((await api('/cad/projects')).projects.length,2);await assert.rejects(api('/cad/projects/'+id+'/merge',{revision:0,sources:[]}),e=>e.conflict);});
test('combining browser and account copies imports recoverable data once',async()=>{const s=make(),api=s.request();await client.saveCloud(data('account'),id,0,api);const remote=(await api('/cad/projects')).projects.map(p=>({...p,cloud:true})),local={...data('device'),projectId:'52345678-1234-1234-1234-123456789abc',updatedAt:1,name:'Job (device copy)'};const group=client.mergeSaved(remote,[local])[0];const merged=await client.combineCopies(group,api);assert.equal(merged.projectId,id);assert.equal((await api('/cad/projects')).projects.length,1);assert.equal((await api('/cad/projects/'+id+'/versions')).versions.length,1);const fresh=(await api('/cad/projects')).projects.map(p=>({...p,cloud:true}));await client.combineCopies(client.mergeSaved(fresh,[local])[0],api);assert.equal((await api('/cad/projects/'+id+'/versions')).versions.length,1);});
test('routine history is bounded while imported copies and their files remain protected',async()=>{const s=make(),api=s.request(),base='/cad/projects/'+id;await client.saveCloud(data('start'),id,0,api);const old=data('pinned device');old.updatedAt=1;let saved=await client.saveCloud(old,id,1,api,()=>{},{importCopy:true});for(let n=0;n<52;n++)saved=await client.saveCloud(data('revision '+n),id,saved.revision,api);const history=await api(base+'/versions');assert.equal(history.versions.filter(v=>!v.pinned).length,50);const pinned=history.versions.find(v=>v.pinned);assert.ok(pinned);const state=s.store.read('cad-projects:a:'+id);for(const f of state.garbage)f.after=1;s.store.write('cad-projects:a:'+id,state);await client.saveCloud(data('revision 51'),id,saved.revision,api);const previous=await client.restoreCloud(await api(base+'/versions/'+pinned.id),id,(p,b)=>api(p.replace(base+'/chunks/',base+'/versions/'+pinned.id+'/'),b));assert.equal(previous.panels[0].result.dxf,'pinned device');});
