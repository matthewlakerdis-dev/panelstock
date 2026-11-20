// Read-only supplier smoke check. Uses public Capral codes; never reads stock.
import assert from 'node:assert/strict';
import {searchCapralReference,fetchCapralReferenceImage} from '../src/capral-reference.js';
for(const [code,productUrl] of [['EP10189','https://shop.capral.com.au/943511/'],['815581','https://shop.capral.com.au/815581/']]){
const result=await searchCapralReference({code});
assert.equal(result.code,code);
assert.ok(result.products.length,'Capral did not return an exact public profile match');
const product=result.products.find(product=>product.url===productUrl);
assert.ok(product,'The verified public Capral profile is missing');
const image=await fetchCapralReferenceImage({code,productUrl:product.url,imageUrl:product.images[0].url});
assert.equal(image.code,code);
assert.equal(image.productUrl,product.url);
assert.match(image.image.mimeType,/^image\/(png|jpeg|webp)$/);
assert.ok(image.image.data.length>100,'Capral returned an empty reference image');
console.log('Verified live Capral profile',code,'and associated',image.image.mimeType,'image. No stock was accessed or changed.');
}
