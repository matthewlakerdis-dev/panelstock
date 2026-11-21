import {requireCondition as check,digest as sha} from './security.js';
export async function storeAuditEvidence(store,file,data){
 if(store.env?.SAFETY_MEDIA_ENABLED!=='true')return {data};
 const bucket=store.env.CAD_PROJECT_FILES;check(bucket,'Private audit evidence storage is unavailable',503);
 const digest=await sha(data),key='safety-evidence/v1/'+encodeURIComponent(store.env.SITE_ID||'panelstock')+'/'+file.id+'/'+digest;
 await bucket.put(key,data,{httpMetadata:{contentType:'text/plain; charset=utf-8'},customMetadata:{sha256:digest,format:'original-base64'}});
 return {storage:'r2',key,sha256:digest,encodedBytes:data.length};
}
export async function readAuditEvidence(store,id){
 const saved=store.read('safety:walk-file:'+id);check(saved,'Audit evidence is unavailable',404);
 if(saved.data)return saved;
 check(saved.storage==='r2'&&typeof saved.key==='string'&&saved.key.startsWith('safety-evidence/v1/'),'Audit evidence reference is invalid',503);
 const object=await store.env.CAD_PROJECT_FILES?.get(saved.key);check(object&&object.size===saved.encodedBytes,'Audit evidence is unavailable',503);
 const data=await object.text();check(await sha(data)===saved.sha256,'Audit evidence failed its integrity check',503);return {data};
}
export async function compactAuditEvidence(store){
 if(store.env?.SAFETY_MEDIA_ENABLED!=='true'||store.env.READ_ONLY==='true'||!store.env.CAD_PROJECT_FILES)return {state:'disabled'};
 const row=store.sql.exec("SELECT key FROM documents WHERE part=0 AND key LIKE 'safety:walk-file:%' AND substr(value,1,9)='{\"data\":\"' LIMIT 1").toArray()[0];if(!row)return {state:'complete'};
 const saved=store.read(row.key);if(!saved?.data)return {state:'deferred'};
 const data=await storeAuditEvidence(store,{id:row.key.slice('safety:walk-file:'.length)},saved.data);
 return store.ctx.storage.transactionSync(()=>{if(store.read(row.key)?.data!==saved.data)return {state:'deferred'};store.write(row.key,data);return {state:'progress',files:1};});
}
