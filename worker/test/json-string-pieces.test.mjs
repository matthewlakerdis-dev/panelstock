import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {jsonStringPieces} from '../src/document-json-stream.js';

const high=code=>code>=0xd800&&code<=0xdbff;
const low=code=>code>=0xdc00&&code<=0xdfff;
const hash=value=>createHash('sha256').update(value).digest('hex');
const encoder=new TextEncoder();
function inspect(value,{collect=true}={}){
 const pieces=[],digest=createHash('sha256');let count=0,units=0,previous='';
 for(const piece of jsonStringPieces(value)){
  assert.equal(typeof piece,'string');assert.ok(piece.length>0&&piece.length<=4096);
  assert.ok(encoder.encode(piece).length<=16384);
  assert.equal(high(previous.charCodeAt(previous.length-1))&&low(piece.charCodeAt(0)),false,'UTF-8 encoding must not split a surrogate pair');
  digest.update(piece);count++;units+=piece.length;previous=piece;if(collect)pieces.push(piece);
 }
 return {text:collect?pieces.join(''):undefined,digest:digest.digest('hex'),count,units};
}

test('string pieces exactly match native JSON quoting for keys, controls, Unicode and lone surrogates',()=>{
 const strings=['','plain ASCII','data:image/png;base64,AAAA/+==','key "quoted" \\ slash /','\b\f\n\r\t\u0000\u0001\u001f','月 😀 🧰 \u2028 \u2029','\ud800','\udfff','\ud800\ud800\udc00\udfff','prefix\udfff中\ud800tail'];
 for(const value of strings){const result=inspect(value);assert.equal(result.text,JSON.stringify(value));assert.equal(JSON.parse(result.text),value);}
});

test('block edges retain pairs and escaping before and after every boundary',()=>{
 for(const length of [4092,4093,4094,4095,4096,4097,8189,8190,8191,8192]){
  for(const marker of ['😀','月','"','\\','\n','\u0000','\ud800','\udfff','😀\ud800"\\\n']){
   const value='x'.repeat(length)+marker+'y'.repeat(8200),result=inspect(value);assert.equal(result.text,JSON.stringify(value));assert.ok(result.count>2);
  }
 }
});

test('escape-heavy and Unicode blocks are bounded in UTF-8 and retain every code unit',()=>{
 for(const value of ['\u0000"\\\n'.repeat(10000),'月'.repeat(30000),'😀'.repeat(30000),'\ud800月\udfff🧰'.repeat(10000)]){
  const result=inspect(value);assert.equal(result.text,JSON.stringify(value));assert.equal(JSON.parse(result.text),value);
 }
});

test('a four MiB photo emits bounded pieces without stringifying or collecting the complete image',t=>{
 const image='data:image/png;base64,'+Buffer.alloc(4*1024*1024,0x61).toString('base64'),value=image+'月😀\ud800"\\\n';
 const expected=JSON.stringify(value),expectedDigest=hash(expected),original=JSON.stringify;
 t.mock.method(JSON,'stringify',function(value,...args){assert.ok(typeof value!=='string'||value.length<=4096,'A complete image must not be passed to JSON.stringify');return original.call(this,value,...args);});
 const result=inspect(value,{collect:false});assert.equal(result.digest,expectedDigest);assert.equal(result.units,expected.length);assert.ok(result.count>1000);assert.equal(result.text,undefined);
});

test('the string-only interface rejects coercion and does not invoke user-defined conversion hooks',()=>{
 let converted=false;const object={toString(){converted=true;return 'unexpected';}};
 for(const value of [null,undefined,1,true,object,new String('boxed')])assert.throws(()=>[...jsonStringPieces(value)],TypeError);
 assert.equal(converted,false);
});
