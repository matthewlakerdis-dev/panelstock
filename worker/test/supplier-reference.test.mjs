import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normaliseSupplierQuery,supplierReferenceUrl,extractSupplierSearchUrls,extractSupplierProducts,readSupplierResource,searchSupplierReference,fetchSupplierReferenceImage} from '../src/supplier-reference.js';
const rondo='https://www.rondo.com.au/products/ceilings/key-lock/129-furring-channel',rondoImage='https://www.rondo.com.au/media/1349/furring_channel_129-26.jpg';
const gyprock='https://www.gyprock.com.au/products/jointing-tapes/easy-tape',tape='https://www.csrassetlibrary.com/celum/30755_yConnect_Original_Easytape%20Gyprock.png';
const rhtml=`<link rel="canonical" href="${rondo}"><img src="/media/111/banner.jpg"><div class="grid-x grid-padding-x"><div class="cell large-6 py24 text-center"><img src="${rondoImage}"></div><div><h1><span class='text-secondary'>129 Furring Channel</span><br>FURRING CHANNELS</h1><img src="/media/222/related.jpg"></div></div>`;
const ghtml=`<link rel="canonical" href="${gyprock}"><h1>Easy Tape</h1><img src="/_next/image?url=${encodeURIComponent('https://www.csrassetlibrary.com/celum/123_wrong.png')}&amp;w=320"><section id="overview"><p>Product Overview</p><img src="/_next/image?url=${encodeURIComponent(tape)}&amp;w=1640&amp;q=80"></section><section><img src="/_next/image?url=${encodeURIComponent('https://www.csrassetlibrary.com/celum/234_related.png')}&amp;w=320"></section>`;
const png=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jrXkAAAAASUVORK5CYII=','base64'));
const html=value=>new Response(value,{headers:{'Content-Type':'text/html'}});
const cases=[['rondo','129',rondo,rondoImage,rhtml],['gyprock-trade','Easy Tape',gyprock,tape,ghtml]];
test('supplier inputs distinguish official part numbers from public names',()=>{
 assert.equal(normaliseSupplierQuery('rondo',' 129 '),'129');assert.equal(normaliseSupplierQuery('gyprock-trade',' Easy   Tape '),'Easy Tape');
 for(const [source,q] of [['rondo','129 compatible'],['gyprock-trade','123456'],['gyprock-trade','Easy Tape\n'],['other','129']])assert.throws(()=>normaliseSupplierQuery(source,q));
});
test('strict official page and bitmap path allowlists reject credential, port and path tricks',()=>{
 for(const [source,,page,image] of cases){assert.equal(supplierReferenceUrl(source,page),page);assert.equal(supplierReferenceUrl(source,image,undefined,{image:true}),image);
  for(const url of ['http://www.rondo.com.au/products/ceilings/key-lock/129','https://www.rondo.com.au.evil.test/products/a/b','https://user@www.rondo.com.au/products/a/b','https://www.rondo.com.au:8443/products/a/b','https://www.rondo.com.au/products/a/%2e%2e/private','https://www.rondo.com.au/products/a/b#private','https://www.gyprock.com.au/private/easy-tape'])assert.throws(()=>supplierReferenceUrl(source,url));
  for(const url of ['https://evil.test/image.png','https://www.rondo.com.au/private/image.png','https://www.rondo.com.au/media/1349/example.svg','https://www.csrassetlibrary.com/celum/123_doc.pdf','https://www.csrassetlibrary.com/private/123_photo.png','https://www.gyprock.com.au/_next/image?url=https://evil.test/image.png'])assert.throws(()=>supplierReferenceUrl(source,url,undefined,{image:true}));
 }
});
test('Rondo excludes compatible-part mentions and part prefixes',()=>{
 const search=`<a href="${rondo}"><mark>129</mark> Furring Channel</a><a href="/products/ceilings/key-lock/1290-channel">1290</a><a href="/products/ceilings/key-lock/139-clip">Clip compatible with 129</a>`;
 assert.deepEqual(extractSupplierSearchUrls('rondo',search,'129','https://www.rondo.com.au/search-results?search=129'),[rondo]);
 const products=extractSupplierProducts('rondo',rhtml,{query:'129',pageUrl:rondo});assert.equal(products.length,1);assert.deepEqual(products[0].images,[{url:rondoImage,alt:'129 Furring Channel'}]);
 assert.deepEqual(extractSupplierProducts('rondo',rhtml.replace('129 Furring Channel','139 Clip for 129'),{query:'129',pageUrl:rondo}),[]);
 assert.deepEqual(extractSupplierProducts('rondo',rhtml.replace('rel="canonical"','rel="unrelated"'),{query:'129',pageUrl:rondo}),[]);
});
test('Gyprock matches the full public product name and only its own overview image',()=>{
 const search=`<a href="${gyprock}">Easy Tape</a><a href="/products/jointing-tapes/other-tape">Other Tape compatible with Easy Tape</a>`;
 assert.deepEqual(extractSupplierSearchUrls('gyprock-trade',search,'Easy Tape','https://www.gyprock.com.au/products'),[gyprock]);
 const p=extractSupplierProducts('gyprock-trade',ghtml,{query:'Easy Tape',pageUrl:gyprock});assert.equal(p.length,1);assert.equal(p[0].matchType,'product-name');assert.deepEqual(p[0].images,[{url:tape,alt:'Easy Tape'}]);
 assert.deepEqual(extractSupplierProducts('gyprock-trade',ghtml,{query:'Tape',pageUrl:gyprock}),[]);
 assert.deepEqual(extractSupplierProducts('gyprock-trade',ghtml.replace('<h1>Easy Tape</h1>','<h1>Other Tape</h1>'),{query:'Easy Tape',pageUrl:gyprock}),[]);
});
for(const [source,code,page,image,markup] of cases){
 test(source+' search/download revalidates exact page association without stock access',async()=>{
  const calls=[],fetchImpl=async(url,init)=>{calls.push(url);assert.equal(init.redirect,'manual');return url===page?html(markup):url===image?new Response(png,{headers:{'Content-Type':'image/png'}}):html(`<a href="${page}">${code}</a>`);};
  const result=await searchSupplierReference(source,{code},{fetchImpl});assert.equal(result.products.length,1);if(source==='gyprock-trade')assert.match(result.warnings.join(' '),/invoice codes.*not mapped/);
  const selected=await fetchSupplierReferenceImage(source,{code,productUrl:page,imageUrl:image},{fetchImpl});assert.equal(selected.image.mimeType,'image/png');assert.equal(selected.source,source);assert.equal(calls.filter(c=>c===page).length,2);assert.ok(calls.every(c=>!c.includes('stock')));
  let downloaded=false;await assert.rejects(fetchSupplierReferenceImage(source,{code,productUrl:page,imageUrl:image.replace(/\.(jpg|png)$/,'-unrelated.png')},{fetchImpl:async url=>{if(url===page)return html(markup);downloaded=true;return new Response(png);}}),/not associated/);assert.equal(downloaded,false);
 });
 test(source+' rejects unrelated redirects and unsupported/mislabeled images',async()=>{
  for(const location of ['https://evil.test/private',page.replace(/[^/]+$/,'different-product')])await assert.rejects(readSupplierResource(source,page,{fetchImpl:async()=>new Response('',{status:302,headers:{Location:location}})}));
  for(const [bytes,type] of [['<svg/>','image/svg+xml'],[png,'text/html']])await assert.rejects(fetchSupplierReferenceImage(source,{code,productUrl:page,imageUrl:image},{fetchImpl:async url=>url===page?html(markup):new Response(bytes,{headers:{'Content-Type':type}})}),/supported|unexpected/);
  await assert.rejects(readSupplierResource(source,image,{image:true,fetchImpl:async()=>new Response(png,{status:302,headers:{Location:image.replace(/\.(jpg|png)$/,'-other.png')}})}),/different/);
 });
 test(source+' bounds pages, images and timeouts',async()=>{
  await assert.rejects(readSupplierResource(source,page,{fetchImpl:async()=>new Response('x',{headers:{'Content-Type':'text/html','Content-Length':String(2*1024*1024+1)}})}),/limit/);
  await assert.rejects(readSupplierResource(source,image,{image:true,fetchImpl:async()=>new Response('x',{headers:{'Content-Length':String(8*1024*1024+1)}})}),/limit/);
  await assert.rejects(readSupplierResource(source,page,{timeoutMs:5,fetchImpl:()=>new Promise(()=>{})}),/temporarily unavailable/);
 });
}


test('verified product photos precede associated diagrams and unrelated page images stay excluded',()=>{
 const markup=rhtml.replace('<img src="'+rondoImage+'">','<img src="/media/1349/129-diagram.png" alt="Section drawing"><img src="'+rondoImage+'">');
 const products=extractSupplierProducts('rondo',markup,{query:'129',pageUrl:rondo});
 assert.deepEqual(products[0].images.map(i=>i.url),[rondoImage,'https://www.rondo.com.au/media/1349/129-diagram.png']);
});
