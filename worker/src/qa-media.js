import {createHash} from 'node:crypto';
import {requireCondition as check} from './security.js';
const pattern=/^qa-r2:v1:([a-f0-9]{64}):([1-9][0-9]{0,7})$/;
const inline=/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
const hash=value=>createHash('sha256').update(value).digest('hex');
export const qaMediaReference=value=>typeof value==='string'?pattern.exec(value):null;
export const qaMediaSize=value=>qaMediaReference(value)?Number(qaMediaReference(value)[2]):typeof value==='string'?value.length:0;
export const qaMediaIdentity=value=>qaMediaReference(value)?.[1]||hash(String(value));
const mediaKey=(store,sha)=>'qa-evidence/v1/'+encodeURIComponent(store.env.SITE_ID||'panelstock')+'/'+sha;
export function documentDigest(store,key){const h=createHash('sha256');for(const row of store.sql.exec('SELECT value FROM documents WHERE key=? ORDER BY part',key))h.update(row.value);return h.digest('hex');}
function accessDigest(store){const h=createHash('sha256');for(const table of ['access_users','user_task_access','role_task_access','user_roles'])for(const row of store.sql.exec(table==='access_users'?'SELECT username,active,is_admin,role_id FROM access_users ORDER BY username':'SELECT * FROM '+table+' ORDER BY rowid'))h.update(JSON.stringify(row));return h.digest('hex');}
export function qaWriteGuard(store){return [['@access',accessDigest(store)],...['qa-checks','app:cncPanels','orders','qa-settings','users'].map(key=>[key,documentDigest(store,key)])];}
export function assertQaWriteGuard(store,guard,actor){check(guard.every(([key,value])=>(key==='@access'?accessDigest(store):documentDigest(store,key))===value),'QA, permissions or production changed while evidence was saved. Review the latest record before retrying.',409);if(actor?.tokenHash)check(store.sql.exec('SELECT expires FROM sessions WHERE token=?',actor.tokenHash).toArray()[0]?.expires>Date.now(),'Session expired while evidence was saved. Sign in and retry the same request.',401);}
export async function storeQaPhoto(store,value){
 if(!inline.test(value||''))return value;
 check(value.length<=1500000,'Choose a smaller QA photo');
 const bucket=store.env.CAD_PROJECT_FILES;check(bucket,'Private QA photo storage is unavailable',503);
 const sha=hash(value),key=mediaKey(store,sha),existing=await bucket.head(key);
 if(existing)check(existing.size===value.length&&existing.customMetadata?.sha256===sha,'Saved QA evidence failed its integrity check',503);
 else await bucket.put(key,value,{httpMetadata:{contentType:'text/plain; charset=utf-8'},customMetadata:{sha256:sha,format:'original-data-url'}});
 return 'qa-r2:v1:'+sha+':'+value.length;
}
export async function externalizeQaValue(store,value){
 if(store.env.QA_MEDIA_ENABLED!=='true')return value;
 const cache=new Map();
 async function visit(input){
  if(typeof input==='string'&&inline.test(input)){const sha=hash(input);if(!cache.has(sha))cache.set(sha,storeQaPhoto(store,input));return cache.get(sha);}
  if(Array.isArray(input)){const result=[];for(const item of input)result.push(await visit(item));return result;}
  if(input&&typeof input==='object'){const result={};for(const [key,item]of Object.entries(input))result[key]=await visit(item);return result;}
  return input;
 }
 return visit(value);
}
export async function readQaPhoto(store,value){
 const ref=qaMediaReference(value);if(!ref)return value;
 const object=await store.env.CAD_PROJECT_FILES?.get(mediaKey(store,ref[1]));check(object&&object.size===Number(ref[2]),'Saved QA evidence is unavailable',503);
 const text=await object.text();check(hash(text)===ref[1]&&inline.test(text),'Saved QA evidence failed its integrity check',503);return text;
}
// Return legacy-compatible JSON incrementally. Private evidence never gets a
// public URL; only an already-authorized QA/Gate response can resolve references.
export function qaJsonResponse(store,body,status=200,{resolveEvidence=true}={}){
 const encoder=new TextEncoder();
 async function* visit(value,photo=false){
  const ref=photo&&resolveEvidence?qaMediaReference(value):null;
  if(ref){
   const object=await store.env.CAD_PROJECT_FILES?.get(mediaKey(store,ref[1]));check(object&&object.size===Number(ref[2]),'Saved QA evidence is unavailable',503);
   yield encoder.encode('"');const reader=object.body.getReader(),h=createHash('sha256');let size=0;
   try{while(true){const {value:chunk,done}=await reader.read();if(done)break;size+=chunk.length;h.update(chunk);yield chunk;}}finally{reader.releaseLock();}
   check(size===Number(ref[2])&&h.digest('hex')===ref[1],'Saved QA evidence failed its integrity check',503);yield encoder.encode('"');return;
  }
  if(Array.isArray(value)){yield encoder.encode('[');for(let i=0;i<value.length;i++){if(i)yield encoder.encode(',');yield*visit(value[i]===undefined?null:value[i],photo);}yield encoder.encode(']');return;}
  if(value&&typeof value==='object'){
   if(typeof value.toJSON==='function'){yield*visit(value.toJSON(),photo);return;}
   yield encoder.encode('{');let first=true;
   for(const [key,item]of Object.entries(value)){if(item===undefined||typeof item==='function')continue;if(!first)yield encoder.encode(',');first=false;yield encoder.encode(JSON.stringify(key)+':');yield*visit(item,key==='photo'||key==='photos');}
   yield encoder.encode('}');return;
  }
  yield encoder.encode(JSON.stringify(value)??'null');
 }
 const iterator=visit(body);return new Response(new ReadableStream({async pull(controller){try{const chunks=[];let length=0,done=false;while(length<16384){const next=await iterator.next();if(next.done){done=true;break;}chunks.push(next.value);length+=next.value.length;}if(length){const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}controller.enqueue(bytes);}if(done)controller.close();}catch(error){console.error('qa_evidence_stream_failed',{code:'EVIDENCE_STREAM_FAILED',name:error.name});controller.error(error);}},async cancel(){await iterator.return?.();}}),{status,headers:{'Content-Type':'application/json'}});
}
// Incremental, reversible backfill. New R2 objects are written first; the old
// document is replaced atomically only when its exact digest is still current.
export async function compactQaEvidence(store,{maxObjects=8}={}){
 if(store.env.QA_MEDIA_ENABLED!=='true'||!store.env.CAD_PROJECT_FILES||store.env.READ_ONLY==='true')return {state:'disabled'};
 const before=documentDigest(store,'qa-checks');if(store.read('qa-media:scan-complete')===before)return {state:'complete',changed:0};
 let carry='',candidate=false;for(const row of store.sql.exec('SELECT value FROM documents WHERE key=? ORDER BY part','qa-checks')){const text=carry+row.value;if(text.includes('data:image/')){candidate=true;break;}carry=text.slice(-10);}
 if(!candidate){store.write('qa-media:scan-complete',before);return {state:'complete',changed:0};}
 const temp='reliability:qa-stage:'+crypto.randomUUID(),original=createHash('sha256'),known=new Map();let changed=0,created=0,part=0,buffer='',inString=false,escaped=false,token='',probe=false,image=false;
 function emit(value){buffer+=value;while(buffer.length>=100000){store.sql.exec('INSERT INTO documents(key,part,value) VALUES(?,?,?)',temp,part++,buffer.slice(0,100000));buffer=buffer.slice(100000);}}
 try{
  for(let inputPart=0;;inputPart++){
   const row=store.sql.exec('SELECT value FROM documents WHERE key=? AND part=?','qa-checks',inputPart).toArray()[0];if(!row)break;original.update(row.value);
   for(const char of row.value){
    if(!inString){if(char==='"'){inString=true;token='';probe=true;image=false;}else emit(char);continue;}
    if(escaped){token+=char;escaped=false;continue;}
    if(char==='\\'){token+=char;escaped=true;continue;}
    if(char==='"'){
     if(image){const value=JSON.parse('"'+token+'"'),sha=hash(value);let ref=known.get(sha);
      if(!ref&&created<maxObjects&&inline.test(value)){ref=await storeQaPhoto(store,value);known.set(sha,ref);created++;}
      if(ref){emit(JSON.stringify(ref));changed++;}else emit('"'+token+'"');
     }else emit('"'+token+'"');inString=false;token='';continue;
    }
    token+=char;
    if(probe&&!('data:image/'.startsWith(token))){probe=false;}
    if(token==='data:image/'){image=true;probe=false;}
    // Non-image strings are bounded by application validation; photo strings
    // are at most the existing 1.5 MB upload limit.
    check(token.length<=1500000,'Legacy QA value exceeds the supported migration size',409);
   }
  }
  check(!inString,'QA evidence changed during migration',409);if(buffer)store.sql.exec('INSERT INTO documents(key,part,value) VALUES(?,?,?)',temp,part++,buffer);
  if(!changed){store.write('qa-media:scan-complete',before);return {state:'complete',changed:0};}
  if(original.digest('hex')!==before||documentDigest(store,'qa-checks')!==before)return {state:'deferred',changed:0};
  store.ctx.storage.transactionSync(()=>{check(documentDigest(store,'qa-checks')===before,'QA changed during migration',409);store.sql.exec('DELETE FROM documents WHERE key=?','qa-checks');store.sql.exec('UPDATE documents SET key=? WHERE key=?','qa-checks',temp);});
  console.log('qa_evidence_compaction',{changed,objects:created});return {state:'progress',changed,objects:created};
 }finally{store.sql.exec('DELETE FROM documents WHERE key=?',temp);}
}
