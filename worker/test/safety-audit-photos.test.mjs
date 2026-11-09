import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('../templates/safety-audit-photos.js',import.meta.url),'utf8');
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5ZkAAAAASUVORK5CYII=';
function fixture(file){
 const requests=[];
 const context=vm.createContext({crypto,walkUploads:[{id:'pending',...file}],api:async(path,body)=>{requests.push({path,body});return file;}});
 vm.runInContext(source,context);return {run:expression=>vm.runInContext(expression,context),requests};
}
test('saved audit and inherited action previews preserve image bytes in sources allowed by the original page policy',async()=>{
 const f=fixture({mime:'image/png',data:png});
 for(const operation of ['download','download-photo']){
  const result=await f.run(`walkPhotoData({id:'photo',path:'/authenticated/file',operation:'${operation}'})`);
  assert.equal(result,'data:image/png;base64,'+png);
  assert.deepEqual(Buffer.from(result.split(',')[1],'base64'),Buffer.from(png,'base64'));
  const request=f.requests.at(-1);assert.equal(request.path,'/authenticated/file');assert.equal(request.body[operation==='download'?'action':'operation'],operation);assert.equal(request.body.fileId,'photo');
 }
});
test('pending photo previews work without an API call and missing bytes do not become broken images',async()=>{
 const pending=fixture({mime:'image/png',data:png});assert.equal(await pending.run("walkPhotoData({id:'pending',pending:true})"),'data:image/png;base64,'+png);assert.equal(pending.requests.length,0);
 for(const file of [{mime:'image/jpeg'},{mime:'image/png',data:''},{mime:'text/html',data:png}]){
  await assert.rejects(fixture(file).run("walkPhotoData({id:'photo',path:'/authenticated/file',operation:'download'})"),/no image data|cannot be previewed/);
 }
});
