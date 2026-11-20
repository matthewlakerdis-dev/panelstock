import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normaliseCapralCode,capralReferenceUrl,readCapralResource,extractCapralProducts,searchCapralReference,fetchCapralReferenceImage,CAPRAL_REFERENCE_LIMITS} from '../src/capral-reference.js';

const code='AA12345',pageUrl='https://www.capral.com.au/products/example-profile',imageUrl='https://www.capral.com.au/media/example-profile.png';
const png=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jBkAAAAAASUVORK5CYII=','base64'));
const product=patch=>({'@type':'Product',sku:code,name:'Example channel',url:pageUrl,image:[imageUrl],...patch});
const html=value=>'<html><script type="application/ld+json">'+JSON.stringify(value)+'</script></html>';
const page=(value=product())=>new Response(html(value),{headers:{'Content-Type':'text/html; charset=utf-8'}});

test('Capral codes preserve significant digits and reject generic names, controls and URL-shaped requests',()=>{
 for(const [value,expected]of [[' aa 12345 ','AA12345'],['001234','001234'],['EK-45678','EK-45678']])assert.equal(normaliseCapralCode(value),expected);
 for(const value of [undefined,null,12345,'SHS','','A','A'.repeat(33),'https://capral.com.au','ABC/123','AA_123','AA123?x=1','AA123\u0000','AA\n123'])assert.throws(()=>normaliseCapralCode(value),error=>error.status===400);
});

test('only explicit official HTTPS hosts without credentials or custom ports are eligible',()=>{
 assert.equal(capralReferenceUrl('/media/reference.png',pageUrl),imageUrl.replace('example-profile.png','reference.png'));
 assert.equal(capralReferenceUrl(pageUrl+'#profile'),pageUrl);
 assert.throws(()=>capralReferenceUrl('//www.capral.com.au:443/image.png',pageUrl),error=>error.status===400);
 assert.throws(()=>capralReferenceUrl(' https://www.capral.com.au:443/image.png'),error=>error.status===400);
 for(const value of ['http://www.capral.com.au/x','https://capral.com.au.evil.test/x','https://evilcapral.com.au/x','https://www.capral.com.au@evil.test/x','https://user:secret@www.capral.com.au/x','https://www.capral.com.au:443/x','https://www.capral.com.au:8443/x','https://unknown.capral.com.au/x','https://127.0.0.1/x','https://[::1]/x','data:image/png;base64,AA==','javascript:alert(1)','file:///etc/passwd'])assert.throws(()=>capralReferenceUrl(value),error=>error.status===400,value);
});

test('JSON-LD requires an exact SKU or MPN and returns only bounded official review fields',()=>{
 const checked=extractCapralProducts(html({'@graph':[product({sku:'AA123450'}),product({sku:'other-987',mpn:code,name:'<b>Example</b> &amp; channel',quantity:500,unitCost:50}),product({sku:'private',name:code+' only in a fuzzy title'})]}),{code,pageUrl});
 assert.equal(checked.length,1);assert.deepEqual(checked[0],{code,title:'Example & channel',url:pageUrl,images:[{url:imageUrl,alt:'Example & channel'}]});
 assert.equal(checked[0].quantity,undefined);assert.equal(checked[0].unitCost,undefined);
 assert.deepEqual(extractCapralProducts('<html>'+code+'<img src="'+imageUrl+'"></html>',{code,pageUrl}),[]);
 assert.deepEqual(extractCapralProducts(html(product({image:['https://evil.test/image.png']})),{code,pageUrl}),[]);
 const oversizedTitle=extractCapralProducts(html(product({name:'<'.repeat(20000)+'private suffix'})),{code,pageUrl});assert.equal(oversizedTitle[0].title.length,200);assert.ok(!oversizedTitle[0].title.includes('private suffix'));
 assert.deepEqual(extractCapralProducts('<script type="application/ld+json">'.repeat(20000),{code,pageUrl}),[]);
});

test('nested product lists merge duplicated official images and limit review candidates',()=>{
 const list={'@type':'ItemList',itemListElement:Array.from({length:20},(_,index)=>({item:product({url:pageUrl+'-'+index,image:Array.from({length:8},(_,image)=>imageUrl+'?image='+image)})}))};
 const checked=extractCapralProducts(html(list),{code,pageUrl});assert.equal(checked.length,CAPRAL_REFERENCE_LIMITS.products);assert.ok(checked.every(item=>item.images.length===CAPRAL_REFERENCE_LIMITS.images));
 const merged=extractCapralProducts(html([product(),product({image:[imageUrl,imageUrl+'?second=1']})]),{code,pageUrl});assert.equal(merged.length,1);assert.equal(merged[0].images.length,2);
});

test('lookup uses a verified internal search provider and never forwards unrelated stock data',async()=>{
 await assert.rejects(searchCapralReference({code}),error=>error.status===503&&/not configured/.test(error.message));
 const requests=[],value=await searchCapralReference({code,stock:'PRIVATE_STOCK',items:[{id:'private'}]},{searchUrl:code=>'https://www.capral.com.au/search?code='+code,fetchImpl:async(url,options)=>{requests.push({url,options});return page();}});
 assert.equal(value.products.length,1);assert.equal(requests.length,1);assert.equal(requests[0].options.method,'GET');assert.equal(requests[0].options.body,undefined);assert.equal(requests[0].options.redirect,'manual');assert.equal(requests[0].options.headers.Authorization,undefined);assert.ok(!JSON.stringify(requests).includes('PRIVATE_STOCK'));
 const missing=await searchCapralReference({code},{searchUrl:()=>pageUrl,fetchImpl:async()=>page(product({sku:'AA123450'}))});assert.equal(missing.products.length,0);assert.equal(missing.warnings.length,1);
});

test('manual redirect checks block foreign hosts before any second fetch and bound redirect loops',async()=>{
 const calls=[];await assert.rejects(readCapralResource(pageUrl,{fetchImpl:async(url,options)=>{calls.push({url,options});return new Response(null,{status:302,headers:{Location:'https://evil.test/private'}});}}),error=>error.status===502&&/outside/.test(error.message));assert.equal(calls.length,1);
 let redirects=0;await assert.rejects(readCapralResource(pageUrl,{fetchImpl:async()=>{redirects++;return new Response(null,{status:301,headers:{Location:'/redirect'}});}}),/too many redirects/);assert.equal(redirects,CAPRAL_REFERENCE_LIMITS.redirects+1);
 const followed=[];const value=await readCapralResource('https://capral.com.au/products/example',{fetchImpl:async url=>{followed.push(url);return followed.length===1?new Response(null,{status:301,headers:{Location:pageUrl}}):page();}});assert.equal(value.url,pageUrl);assert.equal(followed.length,2);
});

test('bounded reads reject declared and streamed oversized pages, interrupted streams and upstream failures',async()=>{
 const invalid=[()=>new Response('small',{headers:{'Content-Length':String(CAPRAL_REFERENCE_LIMITS.htmlBytes+1)}}),()=>new Response('x'.repeat(CAPRAL_REFERENCE_LIMITS.htmlBytes+1)),()=>new Response('temporarily unavailable',{status:503}),()=>new Response(new ReadableStream({start(controller){controller.error(Error('PRIVATE_STREAM_DETAIL'));}}))];
 for(const response of invalid)await assert.rejects(readCapralResource(pageUrl,{fetchImpl:async()=>response()}),error=>[502,503].includes(error.status)&&!error.message.includes('PRIVATE_STREAM_DETAIL'));
 await assert.rejects(readCapralResource(pageUrl,{fetchImpl:async()=>{throw Error('PRIVATE_TRANSPORT_DETAIL');}}),error=>error.status===503&&!error.message.includes('PRIVATE_TRANSPORT_DETAIL'));
});

test('lookup timeouts abort the outstanding provider request without leaking transport details',async()=>{
 let aborted=false;await assert.rejects(readCapralResource(pageUrl,{timeoutMs:5,fetchImpl:(_url,options)=>new Promise((_,reject)=>options.signal.addEventListener('abort',()=>{aborted=true;reject(Error('PRIVATE_TIMEOUT'));}))}),error=>error.status===503&&!error.message.includes('PRIVATE_TIMEOUT'));assert.equal(aborted,true);
});

test('image download revalidates its product association before copying only a supported bitmap',async()=>{
 const requests=[];const value=await fetchCapralReferenceImage({code,productUrl:pageUrl,imageUrl,qty:999,stock:'PRIVATE_STOCK'},{fetchImpl:async(url,options)=>{requests.push({url,options});return url===pageUrl?page():new Response(png,{headers:{'Content-Type':'image/png'}});}});
 assert.equal(requests.length,2);assert.equal(value.productUrl,pageUrl);assert.equal(value.title,'Example channel');assert.equal(value.image.mimeType,'image/png');assert.equal(value.image.name,'Capral-'+code+'.png');assert.deepEqual(Buffer.from(value.image.data.split(',')[1],'base64'),Buffer.from(png));assert.equal(value.qty,undefined);assert.ok(!JSON.stringify(requests).includes('PRIVATE_STOCK'));
 let calls=0;await assert.rejects(fetchCapralReferenceImage({code,productUrl:pageUrl,imageUrl:imageUrl+'?unrelated=1'},{fetchImpl:async()=>{calls++;return page();}}),error=>error.status===400&&/associated/.test(error.message));assert.equal(calls,1);
});

test('image downloads reject partial code matches, unsupported formats, empty data and MIME confusion',async()=>{
 for(const response of [()=>new Response('<svg xmlns="http://www.w3.org/2000/svg"/>',{headers:{'Content-Type':'image/svg+xml'}}),()=>new Response(new Uint8Array()),()=>new Response(png,{headers:{'Content-Type':'text/html'}}),()=>new Response(new Uint8Array([137,80,78,71,13,10,26,10]),{headers:{'Content-Type':'image/png'}})])await assert.rejects(fetchCapralReferenceImage({code,productUrl:pageUrl,imageUrl},{fetchImpl:async url=>url===pageUrl?page():response()}),error=>error.status===502);
 await assert.rejects(fetchCapralReferenceImage({code,productUrl:pageUrl,imageUrl},{fetchImpl:async()=>page(product({sku:code+'0'}))}),error=>error.status===400&&/exact Capral code/.test(error.message));
});

test('oversized image headers and foreign image redirects stop before returning any encoded image',async()=>{
 await assert.rejects(fetchCapralReferenceImage({code,productUrl:pageUrl,imageUrl},{fetchImpl:async url=>url===pageUrl?page():new Response('x',{headers:{'Content-Length':String(CAPRAL_REFERENCE_LIMITS.imageBytes+1),'Content-Type':'image/png'}})}),/8 MB/);
 const called=[];await assert.rejects(fetchCapralReferenceImage({code,productUrl:pageUrl,imageUrl},{fetchImpl:async url=>{called.push(url);return url===pageUrl?page():new Response(null,{status:302,headers:{Location:'https://evil.test/image.png'}});}}),/outside/);assert.equal(called.length,2);
});
