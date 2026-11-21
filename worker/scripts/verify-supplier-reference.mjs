// Read-only public supplier contract check. Run with NODE_USE_ENV_PROXY=1 behind a proxy.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {searchSupplierReference,fetchSupplierReferenceImage} from '../src/supplier-reference.js';
for(const [source,code,suffix] of [['rondo','129','/furring_channel_129-26.jpg'],['gyprock-trade','Easy Tape','/30755_yConnect_Original_Easytape%20Gyprock.png']]){
 const result=await searchSupplierReference(source,{code});assert.ok(result.products.length);
 const product=result.products.find(p=>p.images.some(i=>new URL(i.url).pathname.endsWith(suffix)));assert.ok(product);
 assert.ok(result.products.every(p=>source!=='rondo'||p.title.startsWith('129 ')));
 const picture=product.images.find(i=>new URL(i.url).pathname.endsWith(suffix));
 const selected=await fetchSupplierReferenceImage(source,{code,productUrl:product.url,imageUrl:picture.url});
 const bytes=Buffer.from(selected.image.data.split(',')[1],'base64');assert.ok(bytes.length>1000);
 console.log(JSON.stringify({source,query:code,product:product.url,image:picture.url,mimeType:selected.image.mimeType,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}));
}
