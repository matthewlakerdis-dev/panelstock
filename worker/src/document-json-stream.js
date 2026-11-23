import {copyJsonDocument,readDocumentProjection} from './workshop-reporting-state.js';

const CHUNK_SIZE=100000;
const high=value=>value>=0xd800&&value<=0xdbff;
const low=value=>value>=0xdc00&&value<=0xdfff;
const omitted=value=>value===undefined||typeof value==='function'||typeof value==='symbol';

// Callers own the storage transaction, including rollback if a getter, toJSON,
// cycle or invalid stored JSON prevents completion. Parts never contain half a
// surrogate pair, since SQLite independently encodes every bound string.
function documentWriter(sql,key){
 let buffer='',part=0;
 const save=value=>sql.exec('INSERT INTO documents(key,part,value) VALUES(?,?,?) ON CONFLICT(key,part) DO UPDATE SET value=excluded.value WHERE documents.value<>excluded.value',key,part++,value);
 return {
  emit(value){
   for(let index=0;index<value.length;index+=CHUNK_SIZE){
    buffer+=value.slice(index,index+CHUNK_SIZE);
    while(buffer.length>=CHUNK_SIZE){
     if(buffer.length===CHUNK_SIZE&&high(buffer.charCodeAt(CHUNK_SIZE-1)))break;
     const end=high(buffer.charCodeAt(CHUNK_SIZE-1))&&low(buffer.charCodeAt(CHUNK_SIZE))?CHUNK_SIZE-1:CHUNK_SIZE;
     save(buffer.slice(0,end));buffer=buffer.slice(end);
    }
   }
  },
  finish(){if(buffer)save(buffer);sql.exec('DELETE FROM documents WHERE key=? AND part>=?',key,part);}
 };
}

const STRING_BLOCK_SIZE=4096;

// Quote one existing string without materializing another full JSON string.
// Each yielded block is independently safe to encode as UTF-8.
export function* jsonStringPieces(value){
 if(typeof value!=='string')throw new TypeError('A string value is required');
 let pieces=['"'],length=1,start=0;
 function* append(fragment){
  for(let offset=0;offset<fragment.length;){
   if(length===STRING_BLOCK_SIZE){yield pieces.join('');pieces=[];length=0;}
   let end=Math.min(fragment.length,offset+STRING_BLOCK_SIZE-length);
   if(end<fragment.length&&high(fragment.charCodeAt(end-1))&&low(fragment.charCodeAt(end)))end--;
   if(end===offset){yield pieces.join('');pieces=[];length=0;continue;}
   const part=fragment.slice(offset,end);pieces.push(part);length+=part.length;offset=end;
  }
 }
 const escapes={'"':'\\"','\\':'\\\\','\b':'\\b','\f':'\\f','\n':'\\n','\r':'\\r','\t':'\\t'};
 for(let index=0;index<value.length;index++){
  const code=value.charCodeAt(index),char=value[index];let escape;
  if(char==='"'||char==='\\'||code<32)escape=escapes[char]||'\\u'+code.toString(16).padStart(4,'0');
  else if(high(code)){if(low(value.charCodeAt(index+1)))index++;else escape='\\u'+code.toString(16);}
  else if(low(code))escape='\\u'+code.toString(16);
  if(escape!==undefined){if(index>start)yield* append(value.slice(start,index));yield* append(escape);start=index+1;}
  else if(index-start>=STRING_BLOCK_SIZE-1){yield* append(value.slice(start,index+1));start=index+1;}
 }
 if(start<value.length)yield* append(value.slice(start));yield* append('"');
 if(length)yield pieces.join('');
}

function emitString(value,emit){for(const piece of jsonStringPieces(value))emit(piece);}

function boxedValue(value){
 if(!value||typeof value!=='object')return value;
 // Native valueOf calls identify actual boxed primitives without consulting a
 // user-controlled Symbol.toStringTag. Number/String then use normal coercion,
 // as JSON.stringify does; Boolean/BigInt use their internal primitive value.
 let number=false,string=false;
 try{Number.prototype.valueOf.call(value);number=true;}catch{}
 if(number)return +value;
 try{String.prototype.valueOf.call(value);string=true;}catch{}
 if(string)return String(value);
 try{return Boolean.prototype.valueOf.call(value);}catch{}
 try{return BigInt.prototype.valueOf.call(value);}catch{}
 return value;
}
function prepare(value,key){
 if(value!==null&&(typeof value==='object'||typeof value==='function'||typeof value==='bigint')){
  const toJSON=value.toJSON;if(typeof toJSON==='function')value=toJSON.call(value,key);
 }
 return boxedValue(value);
}
function serializer(emit){
 const ancestors=new Set();
 function write(value,key='',arrayEntry=false,prepared=false){
  if(!prepared)value=prepare(value,key);
  if(omitted(value)){if(arrayEntry)emit('null');return arrayEntry;}
  if(value===null){emit('null');return true;}
  if(typeof value==='string'){emitString(value,emit);return true;}
  if(typeof value!=='object'){
   // Native scalar serialization handles finite numbers, -0 and BigInt errors.
   emit(JSON.stringify(value));return true;
  }
  if(ancestors.has(value))throw new TypeError('Converting circular structure to JSON');
  ancestors.add(value);
  try{
   if(Array.isArray(value)){
    const length=Math.min(Number.MAX_SAFE_INTEGER,Math.max(0,Math.trunc(+value.length)||0));emit('[');
    for(let index=0;index<length;index++){if(index)emit(',');write(value[index],String(index),true);}
    emit(']');
   }else{
    const keys=Object.keys(value);emit('{');let first=true;
    for(const name of keys){
     const item=prepare(value[name],name);if(omitted(item))continue;
     if(!first)emit(',');first=false;emitString(name,emit);emit(':');write(item,name,false,true);
    }
    emit('}');
   }
  }finally{ancestors.delete(value);}
  return true;
 }
 return {write,prepare};
}

export function writeJsonDocument(sql,key,value){
 const writer=documentWriter(sql,key),json=serializer(value=>writer.emit(value));
 if(!json.write(value))throw new TypeError('A JSON document value is required');
 writer.finish();
}

// Existing backup format, assembled from already-serialized document parts.
// No app collection or workshop history becomes an extra parsed object/string.
export function writeBackupDocument(store,key,{timestamp,username,fields,attendance}){
 if(!Array.isArray(fields)||fields.some(field=>typeof field!=='string'))throw new TypeError('Backup fields are required');
 const entries=Object.create(null),source=(key,fallback)=>({source:key,fallback}),value=input=>({value:input});
 for(const field of fields)entries[field]=source('app:'+field,field==='photos'?{}:[]);
 Object.assign(entries,{revision:source('revision',0),restoreEpoch:source('restoreEpoch',0),attendance:value(attendance),workshopStock:source('workshop-stock',null),users:source('users',{}),config:source('config',null),registration_code:source('registration_code',null),takenAt:value(timestamp),takenBy:value(username)});
 const writer=documentWriter(store.sql,key),json=serializer(value=>writer.emit(value));let first=true;
 writer.emit('{');
 for(const name of Object.keys(entries)){
  const entry=entries[name],prepared=Object.hasOwn(entry,'value')?prepare(entry.value,name):undefined;
  if(Object.hasOwn(entry,'value')&&omitted(prepared))continue;
  if(!first)writer.emit(',');first=false;emitString(name,value=>writer.emit(value));writer.emit(':');
  if(entry.source){if(!copyJsonDocument(store.sql,entry.source,value=>writer.emit(value)))json.write(entry.fallback,name);}
  else json.write(prepared,name,false,true);
 }
 writer.emit('}');writer.finish();
}

export function readBackupTakenBy(sql,key){return readDocumentProjection(sql,key,['takenBy'],null)?.takenBy;}
