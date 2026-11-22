// Historical reporting proof needs the stocktake records, not catalogue images,
// movements or purchase orders. Validate all stored JSON while retaining only
// the two top-level fields used by that proof. Never join the source document.
function scanJsonDocument(sql,key,selectedFields,fallback,{onChunk,objectRoot=true}={}){
 const selected=new Set(selectedFields);
 const fields=new Map(),stack=[];let seen=false,rootStarted=false,rootDone=false,token=null,capture=null;
 const invalid=()=>{throw new Error('Invalid workshop reporting document');};
 const whitespace=char=>char===' '||char==='\t'||char==='\n'||char==='\r';
 function append(char){
  if(!capture)return;
  capture.buffer.push(char);
  if(capture.buffer.length>=4096){capture.parts.push(capture.buffer.join(''));capture.buffer=[];}
 }
 function complete(){
  const parent=stack.at(-1);
  if(parent){
   if(parent.state!=='value'&&parent.state!=='valueOrEnd')invalid();
   parent.state='commaOrEnd';
  }else rootDone=true;
  if(capture&&stack.length===1){
   if(capture.buffer.length)capture.parts.push(capture.buffer.join(''));
   fields.set(capture.key,capture.parts.join(''));capture=null;
  }
 }
 function begin(char){
  const parent=stack.at(-1);
  if(parent?.top&&parent.kind==='object'&&selected.has(parent.key))capture={key:parent.key,parts:[],buffer:[]};
  append(char);
  const top=!rootStarted;rootStarted=true;
  if(char==='{'||char==='['){
   if(stack.length>=512)invalid();
   stack.push({kind:char==='{'?'object':'array',state:char==='{'?'keyOrEnd':'valueOrEnd',top,key:null});return;
  }
  if(char==='"'){token={kind:'string',key:false,escaped:false,unicode:0};return;}
  if(char==='t'||char==='f'||char==='n'){token={kind:'literal',expected:char==='t'?'true':char==='f'?'false':'null',index:1};return;}
  if(char==='-'||char>='0'&&char<='9'){token={kind:'number',state:char==='-'?'sign':char==='0'?'zero':'integer'};return;}
  invalid();
 }
 function number(char){
  const digit=char>='0'&&char<='9';
  switch(token.state){
   case 'sign':if(!digit)invalid();token.state=char==='0'?'zero':'integer';return true;
   case 'zero':if(char==='.'){token.state='fractionStart';return true;}if(char==='e'||char==='E'){token.state='exponentStart';return true;}return false;
   case 'integer':if(digit)return true;if(char==='.'){token.state='fractionStart';return true;}if(char==='e'||char==='E'){token.state='exponentStart';return true;}return false;
   case 'fractionStart':if(!digit)invalid();token.state='fraction';return true;
   case 'fraction':if(digit)return true;if(char==='e'||char==='E'){token.state='exponentStart';return true;}return false;
   case 'exponentStart':if(char==='+'||char==='-'){token.state='exponentDigit';return true;}if(!digit)invalid();token.state='exponent';return true;
   case 'exponentDigit':if(!digit)invalid();token.state='exponent';return true;
   case 'exponent':return digit;
   default:invalid();
  }
 }
 function feed(char){
  if(token?.kind==='number'){
   if(number(char)){append(char);return;}
   token=null;complete(); // The delimiter belongs to the enclosing structure.
  }
  if(token?.kind==='literal'){
   if(char!==token.expected[token.index++])invalid();append(char);
   if(token.index===token.expected.length){token=null;complete();}return;
  }
  if(token?.kind==='string'){
   append(char);
   if(token.raw!==undefined){if(token.raw!==null&&token.raw.length<128)token.raw+=char;else token.raw=null;}
   if(token.unicode){if(!/[a-fA-F0-9]/.test(char))invalid();token.unicode--;return;}
   if(token.escaped){token.escaped=false;if(char==='u'){token.unicode=4;return;}if(!'"\\/bfnrt'.includes(char))invalid();return;}
   if(char==='\\'){token.escaped=true;return;}
   if(char.charCodeAt(0)<32)invalid();
   if(char==='"'){
    if(token.key){const parent=stack.at(-1);parent.key=token.raw===null?null:JSON.parse(token.raw);parent.state='colon';token=null;}
    else{token=null;complete();}
   }
   return;
  }
  if(whitespace(char)){append(char);return;}
  if(rootDone)invalid();
  if(!rootStarted){if(objectRoot&&char!=='{')invalid();begin(char);return;}
  const parent=stack.at(-1);if(!parent)invalid();
  if(parent.state==='keyOrEnd'||parent.state==='key'){
   if(char==='}'&&parent.state==='keyOrEnd'){append(char);stack.pop();complete();return;}
   if(char!=='"')invalid();append(char);token={kind:'string',key:true,escaped:false,unicode:0,raw:parent.top?'"':null};return;
  }
  if(parent.state==='colon'){if(char!==':')invalid();append(char);parent.state='value';return;}
  if(parent.state==='value'||parent.state==='valueOrEnd'){
   if(parent.kind==='array'&&parent.state==='valueOrEnd'&&char===']'){append(char);stack.pop();complete();return;}
   begin(char);return;
  }
  if(parent.state==='commaOrEnd'){
   if(char===','){append(char);parent.state=parent.kind==='object'?'key':'value';return;}
   if(char===(parent.kind==='object'?'}':']')){append(char);stack.pop();complete();return;}
  }
  invalid();
 }
 for(const {value}of sql.exec('SELECT value FROM documents WHERE key=? ORDER BY part',key)){
  if(typeof value!=='string')invalid();seen=true;
  for(let index=0;index<value.length;index++)feed(value[index]);
  if(onChunk)onChunk(value);
 }
 if(!seen)return {seen:false,value:fallback};
 if(token?.kind==='number'&&['zero','integer','fraction','exponent'].includes(token.state)){token=null;complete();}
 if(token||stack.length||!rootDone||capture)invalid();
 return {seen:true,value:JSON.parse('{'+[...fields].map(([key,value])=>JSON.stringify(key)+':'+value).join(',')+'}')};
}

export function readDocumentProjection(sql,key,fields,fallback=null){return scanJsonDocument(sql,key,fields,fallback).value;}
export function copyJsonDocument(sql,key,emit){return scanJsonDocument(sql,key,[],null,{onChunk:emit,objectRoot:false}).seen;}
export function readWorkshopReportingState(sql,fallback=null){return readDocumentProjection(sql,'workshop-stock',['revision','stocktakes'],fallback);}
