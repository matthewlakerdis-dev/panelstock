import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normaliseCapralCode,capralReferenceUrl,readCapralResource,extractCapralProducts,extractCapralSearchUrls,searchCapralReference,fetchCapralReferenceImage,CAPRAL_REFERENCE_LIMITS} from '../src/capral-reference.js';

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

const shopUrl='https://shop.capral.com.au/943511/';
const storeImage='https://cdn11.bigcommerce.com/s-gwvwsryafm/images/stencil/1280x1280/products/3748/5097/angles_diagram.png?c=1';
const shopProduct=(patch={})=>product({sku:'943511',name:'EP10189 6060 T5 6.5m Mill Finish',url:shopUrl,image:storeImage,...patch});
const info=(section='EP10189',sku='943511')=>'<dl class="productView-info"><dt class="productView-info-name sku-label">SKU:</dt><dd data-product-sku>'+sku+'</dd><dt class="productView-info-name">SECTION:</dt><dd class="productView-info-value">'+section+'</dd></dl>';
const searchCard=(url=shopUrl)=>'<h3 class="card-title"><a href="'+url+'?searchuuid=public&amp;search_query=EP10189">EP10189</a></h3>';

test('live shop search contract follows bounded canonical product cards and verifies SECTION before returning images',async()=>{
 const calls=[];
 const fetchImpl=async url=>{calls.push(url);return new Response(url.includes('search.php')?searchCard():html(shopProduct())+info(),{headers:{'Content-Type':'text/html'}});};
 const result=await searchCapralReference({code:'EP10189',stock:'PRIVATE_STOCK'},{fetchImpl});
 assert.deepEqual(calls,['https://shop.capral.com.au/search.php?search_query=EP10189',shopUrl]);
 assert.deepEqual(result.products,[{code:'EP10189',title:'EP10189 6060 T5 6.5m Mill Finish',url:shopUrl,images:[{url:storeImage,alt:'EP10189 6060 T5 6.5m Mill Finish'}]}]);
 const image=await fetchCapralReferenceImage({code:result.code,productUrl:shopUrl,imageUrl:storeImage},{fetchImpl:async url=>url===shopUrl?new Response(html(shopProduct())+info()):new Response(png,{headers:{'Content-Type':'image/png'}})});
 assert.equal(image.image.mimeType,'image/png');assert.equal(image.productUrl,shopUrl);
});

test('shop profile evidence requires exact SECTION and matching page SKU; fuzzy titles and related products cannot qualify',()=>{
 for(const [details,node,base]of [[info('EP101890'),shopProduct(),shopUrl],[info('EP10189','999999'),shopProduct(),shopUrl],['<p>EP10189</p>',shopProduct(),shopUrl],[info(),shopProduct({url:'https://shop.capral.com.au/999999/'}),shopUrl],[info(),shopProduct(),'https://capral.com.au/943511/'],['<script>'+info()+'</script>',shopProduct(),shopUrl]]){
  assert.deepEqual(extractCapralProducts(html(node)+details,{code:'EP10189',pageUrl:base}),[]);
 }
 assert.equal(extractCapralProducts(html(shopProduct())+info(),{code:'943511',pageUrl:shopUrl}).length,1);
});

test('only Capral store image paths are permitted on the shared BigCommerce CDN, including redirects',async()=>{
 assert.equal(capralReferenceUrl(storeImage,undefined,{image:true}),storeImage);
 for(const url of [storeImage,storeImage.replace('s-gwvwsryafm','s-anotherstore'),storeImage.replace('/images/','/private/'),storeImage.replace('cdn11','cdn12')]){
  assert.throws(()=>capralReferenceUrl(url),error=>error.status===400);
  if(url!==storeImage)assert.throws(()=>capralReferenceUrl(url,undefined,{image:true}),error=>error.status===400);
 }
 await assert.rejects(readCapralResource(storeImage,{image:true,fetchImpl:async()=>new Response(null,{status:302,headers:{Location:storeImage.replace('s-gwvwsryafm','s-anotherstore')}})}),/outside/);
 const result=extractCapralProducts(html(shopProduct({image:[storeImage.replace('s-gwvwsryafm','s-anotherstore'),storeImage]}))+info(),{code:'EP10189',pageUrl:shopUrl});
 assert.deepEqual(result[0].images.map(image=>image.url),[storeImage]);
});

test('search card discovery drops navigation, foreign links, duplicates, query parameters and excess candidates',()=>{
 const cards=searchCard()+searchCard()+searchCard('https://evil.test/123/')+searchCard('https://shop.capral.com.au/login.php')+Array.from({length:20},(_,i)=>searchCard('https://shop.capral.com.au/'+(100000+i)+'/')).join('');
 const urls=extractCapralSearchUrls('<a href="'+shopUrl+'">Navigation</a>'+cards,shopUrl);
 assert.equal(urls.length,CAPRAL_REFERENCE_LIMITS.candidates);assert.equal(urls[0],shopUrl);assert.ok(urls.every(url=>!url.includes('?')));
 assert.deepEqual(extractCapralSearchUrls('<script>'+searchCard()+'</script><!--'+searchCard()+'-->',shopUrl),[]);
});

test('provider distinguishes no exact match from failed product verification without returning unrelated images',async()=>{
 const fetchImpl=async url=>url.includes('search.php')?new Response(searchCard()):new Response(html(shopProduct())+info('EP101890'));
 assert.deepEqual((await searchCapralReference({code:'EP10189'},{fetchImpl})).products,[]);
 await assert.rejects(searchCapralReference({code:'EP10189'},{fetchImpl:async url=>url.includes('search.php')?new Response(searchCard()):new Response('unavailable',{status:503})}),error=>error.status===503);
 let downloads=0;await assert.rejects(fetchCapralReferenceImage({code:'EP10189',productUrl:shopUrl,imageUrl:storeImage},{fetchImpl:async()=>{downloads++;return new Response(html(shopProduct())+info('EP101890'));}}),error=>error.status===400);assert.equal(downloads,1);
});
