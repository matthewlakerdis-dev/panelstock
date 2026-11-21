// Read-only public reference verification. No inventory calls or writes.
// NODE_USE_ENV_PROXY=1 node scripts/verify-sculptform-track.mjs [evidence-directory]
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {searchSupplierReference,fetchSupplierReferenceImage} from '../src/supplier-reference.js';
const out=process.argv[2];if(out)fs.mkdirSync(out,{recursive:true});
for(const code of ['cosmt45251b','cosmt45252b','Split Track - 45x25mm','L Profile Base Trim','Back Cover Plate']){
 const result=await searchSupplierReference('sculptform',{code}),product=result.products[0];assert.ok(product,code);
 const track=code.startsWith('cosmt')||code.startsWith('Split Track');assert.equal(product.matchType,track?'assembly-reference':'product-name-reference');
 if(track){assert.match(product.title,/both parts and clip shown/);assert.match(result.warnings.join(' '),/not an isolated part photo or finish match/);}
 const selected=await fetchSupplierReferenceImage('sculptform',{code,productUrl:product.url,imageUrl:product.images[0].url});
 const bytes=Buffer.from(selected.image.data.split(',')[1],'base64');assert.ok(bytes.length>1000);
 const record={source:'sculptform',query:code,product:product.url,image:product.images[0].url,matchType:product.matchType,mimeType:selected.image.mimeType,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
 if(out)fs.writeFileSync(path.join(out,code.replace(/[^a-z0-9-]/gi,'_')+'.json'),JSON.stringify({result,selected,record}));
 console.log(JSON.stringify(record));
}
for(const code of ['cos40100pp','cosmt45252w','Balustrade Mounting Blank Track']){
 const result=await searchSupplierReference('sculptform',{code});assert.equal(result.products.length,0);console.log(JSON.stringify(result));
}
