// Read-only official supplier contracts; no inventory access or writes.
// Behind the managed proxy: NODE_USE_ENV_PROXY=1 node scripts/verify-supplier-expansion.mjs
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {searchSupplierReference,fetchSupplierReferenceImage} from '../src/supplier-reference.js';
const out=process.argv[2];if(out)fs.mkdirSync(out,{recursive:true});
for(const [source,code,collection] of [
 ['knotwood','KEB2550M','battens'],['knotwood','KEB5050M-03','battens'],
 ['knotwood','KECCSF-02','boards'],['knotwood','KEGS252516','geoline'],['knotwood','KEGA505016','knotwood-standards'],
 ['sculptform','L Profile Base Trim'],['sculptform','Back Cover Plate']
]){
 const result=await searchSupplierReference(source,{code});assert.ok(result.products.length,source+' '+code);
 const product=result.products.find(p=>!collection||new URL(p.url).pathname==='/au/profiles/'+collection+'/');assert.ok(product);
 assert.equal(product.matchType,source==='knotwood'?'profile-code':'product-name-reference');
 const picture=product.images[0],selected=await fetchSupplierReferenceImage(source,{code,productUrl:product.url,imageUrl:picture.url});
 const bytes=Buffer.from(selected.image.data.split(',')[1],'base64');assert.ok(bytes.length>1000);
 const record={source,query:code,product:product.url,image:picture.url,mimeType:selected.image.mimeType,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),matchType:product.matchType};
 if(out)fs.writeFileSync(path.join(out,source+'-'+code.replaceAll(' ','-')+'.json'),JSON.stringify({result,selected,record}));
 console.log(JSON.stringify(record));
}
for(const source of ['baker-packaging','gabbabolt']){
 const result=await searchSupplierReference(source,{code:'38.041'});assert.equal(result.products.length,0);assert.equal(result.availability,'unverified');console.log(JSON.stringify(result));
}
