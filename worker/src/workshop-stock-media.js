import {copyJsonDocument} from './workshop-reporting-state.js';

const markerPrefix='stock-image:deferred:v1:';
const markerPattern=/^stock-image:deferred:v1:([1-9][0-9]*)$/;
const own=(value,key)=>!!value&&Object.hasOwn(value,key);
const version=value=>Number.isSafeInteger(value)&&value>=0||typeof value==='string'&&/^[A-Za-z0-9._:-]{1,100}$/.test(value);

function blocks(){
 const parts=[];let chars=[];
 return {
  add(char){chars.push(char);if(chars.length===4096){parts.push(chars.join(''));chars=[];}},
  finish(){if(chars.length)parts.push(chars.join(''));return parts.join('');}
 };
}

// The existing streaming validator checks the complete JSON grammar. This
// lexical pass sees those validated chunks and omits every non-empty image
// property before any document is parsed. Object key order is immaterial.
function imageProjection(sql,key,targetOrdinal=null){
 const lean=targetOrdinal===null?blocks():null,stack=[];let atom=false,string=null,ordinal=0,captured=null;
 const emit=char=>lean?.add(char);
 const complete=()=>{const parent=stack.at(-1);if(parent)parent.state='comma';};
 function feed(char){
  if(string){
   if(string.key&&string.raw!==null){if(string.raw.length<128)string.raw+=char;else string.raw=null;}
   if(!string.image)emit(char);
   const closing=char==='"'&&!string.escaped;
   if(string.image){
    if(!closing&&!string.ordinal){
     string.ordinal=++ordinal;
     if(ordinal===targetOrdinal){string.capture=blocks();string.capture.add('"');}
    }
    string.capture?.add(char);
   }
   if(closing){
    if(string.key){const parent=stack.at(-1);parent.key=string.raw===null?null:JSON.parse(string.raw);parent.state='colon';}
    else{
     if(string.image){
      const replacement=string.ordinal?markerPrefix+string.ordinal:'';
      for(const part of JSON.stringify(replacement))emit(part);
      if(string.capture)captured=string.capture.finish();
     }
     complete();
    }
    string=null;return;
   }
   if(string.escaped)string.escaped=false;else if(char==='\\')string.escaped=true;
   return;
  }
  if(atom){
   if(!/[\s,\]}]/.test(char)){emit(char);return;}
   atom=false;complete();
  }
  if(char===' '||char==='\t'||char==='\r'||char==='\n'){emit(char);return;}
  const parent=stack.at(-1);
  if(char==='"'){
   const isKey=parent?.kind==='object'&&parent.state==='key',image=!isKey&&parent?.kind==='object'&&parent.state==='value'&&parent.key==='image';
   string={key:isKey,image,escaped:false,raw:isKey?'"':null,ordinal:0,capture:null};if(!image)emit(char);return;
  }
  emit(char);
  if(char==='{'||char==='['){stack.push({kind:char==='{'?'object':'array',state:char==='{'?'key':'value',key:null});return;}
  if(char==='}'||char===']'){stack.pop();complete();return;}
  if(char===':'){parent.state='value';return;}
  if(char===','){parent.state=parent.kind==='object'?'key':'value';return;}
  atom=true;
 }
 const seen=copyJsonDocument(sql,key,chunk=>{for(let index=0;index<chunk.length;index++)feed(chunk[index]);});
 if(!seen)return {seen:false,value:null};
 return {seen:true,value:lean?JSON.parse(lean.finish()):captured===null?null:JSON.parse(captured)};
}

export function readDeferredWorkshopState(sql,fallback=null){
 const result=imageProjection(sql,'workshop-stock');return result.seen?result.value:fallback;
}

export function readWorkshopItemImage(sql,itemId){
 if(typeof itemId!=='string'||!itemId)return null;
 const state=readDeferredWorkshopState(sql);if(!state||typeof state!=='object')return null;
 let selected,document='workshop-stock';
 const legacy=itemId.startsWith('variant:')?{key:'app:variants',id:itemId.slice(8)}:itemId.startsWith('offcut:')?{key:'app:offcuts',id:itemId.slice(7)}:null;
 if(legacy){
  const source=imageProjection(sql,legacy.key).value,item=Array.isArray(source)?source.find(value=>value?.id===legacy.id&&!value.archivedAt):null;
  if(!item)return null;
  const metadata=state.metadata?.[itemId];
  if(own(metadata,'image'))selected=metadata.image;
  else{selected=item.image;document=legacy.key;}
 }else{
  const item=Array.isArray(state.items)?state.items.find(value=>value?.id===itemId&&!value.archivedAt):null;
  if(!item)return null;selected=item.image;
 }
 if(typeof selected!=='string'||!selected)return null;
 const match=markerPattern.exec(selected);if(!match)return null;
 const target=Number(match[1]);if(!Number.isSafeInteger(target))return null;
 const image=imageProjection(sql,document,target).value;
 if(typeof image!=='string'||!image||markerPattern.test(image))return null;
 return {itemId,image,...(Number.isSafeInteger(state.revision)&&state.revision>=0?{imageVersion:state.revision}:{})};
}

// Deferred responses contain only authenticated relative image endpoints. Any
// historical/nested image fields and all private markers are removed as well.
// The stored state and the legacy full-image response are never modified.
export function deferStockResponse(body){
 if(!body||typeof body!=='object')return body;
 const clones=new WeakMap();
 function strip(input){
  if(typeof input==='string'&&markerPattern.test(input))return undefined;
  if(!input||typeof input!=='object')return input;
  if(clones.has(input))return clones.get(input);
  if(Array.isArray(input)){const result=[];clones.set(input,result);for(const item of input)result.push(strip(item)??null);return result;}
  const result={};clones.set(input,result);
  for(const [key,value]of Object.entries(input)){if(key==='image')continue;const next=strip(value);if(next!==undefined)Object.defineProperty(result,key,{value:next,writable:true,enumerable:true,configurable:true});}
  return result;
 }
 const result=strip(body),imageVersion=body.stockImageRevision??body.revision;
 const available=row=>own(row,'image')?typeof row.image==='string'&&!!row.image:row?.hasImage===true;
 function decorate(target,row,id,fallback=false){
  if(!target||typeof target!=='object'||Array.isArray(target))return;
  target.hasImage=own(row,'image')?available(row):fallback||available(row);
  delete target.imageUrl;delete target.imageVersion;
  if(!target.hasImage||typeof id!=='string'||!id)return;
  try{target.imageUrl='/workshop-stock/images/'+encodeURIComponent(id);}catch{target.hasImage=false;return;}
  if(version(imageVersion))target.imageVersion=imageVersion;
 }
 const items=Array.isArray(body.items)?body.items:[],byId=new Map(items.filter(item=>item&&typeof item.id==='string').map(item=>[item.id,available(item)]));
 if(Array.isArray(result.items))for(let index=0;index<items.length;index++)decorate(result.items[index],items[index],items[index]?.id);
 if(body.metadata&&typeof body.metadata==='object'&&!Array.isArray(body.metadata))for(const [id,row]of Object.entries(body.metadata))decorate(result.metadata?.[id],row,id,byId.get(id)===true);
 return result;
}
