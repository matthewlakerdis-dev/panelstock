import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normaliseSupplierQuery,supplierReferenceUrl,extractSupplierProducts,searchSupplierReference,fetchSupplierReferenceImage,readSupplierResource} from '../src/supplier-reference.js';

const knotPage='https://knotwood.com/au/profiles/battens/';
const knotImage='https://knotwood.com/au/wp-content/uploads/sites/2/2022/09/KEB2550M.png';
const sculptPage='https://sculptform.com/aluminium-click-on-battens-tech-specs/';
const sculptImage='https://sculptform.com/hs-fs/hubfs/L-base-profile.jpg?width=300&height=300&name=L-base-profile.jpg';
const card=(code='KEB2550M',image=knotImage)=>`<div class="profile-inner__grid-item inactive" data-sku="${code}" data-name="Batten Bracket - 25 x 50mm (M)" data-img="${image}" data-type="Profile"><div><img src="${image}" alt="Batten Bracket - 25 x 50mm (M)"></div><div class="profile-inner__sku">${code}</div></div>`;
const knotHtml=`<link rel="canonical" href="${knotPage}"><h1>Battens</h1>${card()}${card('KEB2550F',knotImage.replace('M.png','F.png'))}${card('KEB2550M-03',knotImage.replace('M.png','M-03.png'))}`;
const sculptHtml=`<link rel="canonical" href="${sculptPage}"><h1>Aluminium Click-on Batten&nbsp;Tech Specs</h1><img src="https://sculptform.com/hubfs/project.jpg"><div id="l-profile-base-trim" class="sc-techSpec__section sc-block_light"><h3>L Profile Base Trim</h3><div><img src="${sculptImage.replaceAll('&','&amp;')}" alt="L-base-profile"></div></div><div id="aluminium-profiles-and-sizes"><img src="https://sculptform.com/hubfs/chart.png"></div>`;
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jrXkAAAAASUVORK5CYII=','base64');
const html=value=>new Response(value,{headers:{'Content-Type':'text/html'}});
test('exact profile revisions and decimal stock codes remain distinct strings',()=>{
 assert.equal(normaliseSupplierQuery('knotwood',' keb5050m-03 '),'KEB5050M-03');
 for(const code of ['38.041','38.042','038.041'])assert.equal(normaliseSupplierQuery('baker-packaging',code),code);
 for(const code of ['KEB 2550M','KEB2550M/03','KEB2550M\n'])assert.throws(()=>normaliseSupplierQuery('knotwood',code));
 assert.throws(()=>normaliseSupplierQuery('sculptform','123456'));
});
test('Knotwood requires one exact card, matching visible code and its own child image',()=>{
 const extract=(markup,query='KEB2550M')=>extractSupplierProducts('knotwood',markup,{query,pageUrl:knotPage});
 assert.equal(extract(knotHtml)[0].images[0].url,knotImage);
 assert.equal(extract(knotHtml,'KEB2550F')[0].images[0].url,knotImage.replace('M.png','F.png'));
 assert.equal(extract(knotHtml,'KEB2550M-03')[0].code,'KEB2550M-03');
 assert.deepEqual(extract(knotHtml,'KEB2550'),[]);
 for(const markup of [knotHtml.replace('rel="canonical"','rel="other"'),knotHtml.replace('<div class="profile-inner__sku">KEB2550M','<div class="profile-inner__sku">KEB2550F'),knotHtml.replace(`src="${knotImage}"`,`src="${knotImage.replace('.png','-neighbour.png')}"`),knotHtml+card(),knotHtml.replace('data-sku="KEB2550M"','data-sku="KEB2550M-02"')])assert.deepEqual(extract(markup),[]);
 assert.deepEqual(extract(`<link rel="canonical" href="${knotPage}">`+card().replace(/<\/div>$/,'')),[]);
});
test('Sculptform names resolve only to their verified section reference, never a SKU/chart/project',()=>{
 const extract=(markup,query='L Profile Base Trim')=>extractSupplierProducts('sculptform',markup,{query,pageUrl:sculptPage});
 const p=extract(sculptHtml)[0];assert.equal(p.matchType,'product-name-reference');assert.match(p.title,/not an exact SKU/);assert.equal(p.images[0].url,sculptImage);
 for(const query of ['123456','Block 40','Aluminium Click-on Battens','L Profile Base Trim 40mm','Gyprock L Profile Base Trim']){if(query==='123456')assert.throws(()=>extract(sculptHtml,query));else assert.deepEqual(extract(sculptHtml,query),[]);}
 for(const markup of [sculptHtml.replace('<h3>L Profile Base Trim','<h3>Different Trim'),sculptHtml.replace('id="l-profile-base-trim"','id="project"'),sculptHtml.replace('alt="L-base-profile"','alt="Project"'),sculptHtml.replace('L-base-profile.jpg?','chart.png?')])assert.deepEqual(extract(markup),[]);
});
for(const [source,code,page,image,markup] of [['knotwood','KEB2550M',knotPage,knotImage,knotHtml],['sculptform','L Profile Base Trim',sculptPage,sculptImage,sculptHtml]]){
 test(source+' rechecks association, rejects substitution and bounds transport',async()=>{
  const calls=[],fetchImpl=async url=>{calls.push(url);return url===page?html(markup):url===image?new Response(png,{headers:{'Content-Type':'image/png'}}):html(`<link rel="canonical" href="${url}">`);};
  const result=await searchSupplierReference(source,{code},{fetchImpl});assert.equal(result.products.length,1);
  const selected=await fetchSupplierReferenceImage(source,{code,productUrl:page,imageUrl:image},{fetchImpl});assert.equal(selected.code,code);assert.equal(calls.filter(url=>url===page).length,2);
  let download=false;await assert.rejects(fetchSupplierReferenceImage(source,{code,productUrl:page,imageUrl:image},{fetchImpl:async url=>{if(url===page)return html(markup.replace('rel="canonical"','rel="other"'));download=true;return new Response(png);}}),/not associated/);assert.equal(download,false);
  for(const location of ['https://evil.test/image.png',image.replace(/\.png|\.jpg/,'-other.png')])await assert.rejects(readSupplierResource(source,image,{image:true,fetchImpl:async()=>new Response('',{status:302,headers:{Location:location}})}));
  for(const [bytes,type] of [['<svg/>','image/svg+xml'],[png,'text/html']])await assert.rejects(fetchSupplierReferenceImage(source,{code,productUrl:page,imageUrl:image},{fetchImpl:async url=>url===page?html(markup):new Response(bytes,{headers:{'Content-Type':type}})}),/supported|unexpected/);
  await assert.rejects(readSupplierResource(source,page,{timeoutMs:5,fetchImpl:()=>new Promise(()=>{})}),/temporarily unavailable/);
 });
 test(source+' strict official paths exclude private links, charts, other regions and formats',()=>{
  assert.equal(supplierReferenceUrl(source,page),page);assert.equal(supplierReferenceUrl(source,image,undefined,{image:true}),image);
  for(const url of ['https://knotwood.com/us/profiles/battens/','https://knotwood.com/au/profiles/private/','https://knotwood.com/au/profiles/battens/?code=1','https://sculptform.com/projects/example/','https://sculptform.com/aluminium-click-on-battens-tech-specs/#l-profile-base-trim'])assert.throws(()=>supplierReferenceUrl(source,url));
  for(const url of ['https://knotwood.com/au/wp-content/uploads/sites/2/2022/09/model.obj','https://knotwood.com/au/wp-content/uploads/sites/2/2022/09/model.svg','https://sculptform.com/hs-fs/hubfs/chart.png','https://sculptform.com/hs-fs/hubfs/L-base-profile.jpg?url=https://evil.test/a','https://sculptform.com/hs-fs/hubfs/L-base-profile.jpg?width=300&width=400'])assert.throws(()=>supplierReferenceUrl(source,url,undefined,{image:true}));
 });
}
test('unverified suppliers return explicit limitations without fetching or offering images',async()=>{
 for(const [source,code] of [['baker-packaging','38.041'],['gabbabolt','M10-BOLT']]){
  const fetchImpl=()=>{throw Error('Unverified mappings must not fetch generic images');};
  const result=await searchSupplierReference(source,{code},{fetchImpl});assert.equal(result.code,code);assert.equal(result.availability,'unverified');assert.deepEqual(result.products,[]);assert.match(result.warnings[0],/unverified|no verified/);
  await assert.rejects(fetchSupplierReferenceImage(source,{code,productUrl:'https://gabbabolt.com.au/',imageUrl:knotImage},{fetchImpl}),/unverified|no verified/);
 }
});

const trackPage='https://sculptform.com/aluminium-click-on-screens-tech-specs/';
const trackImage='https://sculptform.com/hs-fs/hubfs/COS-split-track-45x25mm.png?width=1948&name=COS-split-track-45x25mm.png';
const trackCard=(name='Split Track - 45x25mm',image=trackImage)=>`<div class="sc-card sc-card_manual"><div><img src="${image.replaceAll('&','&amp;')}" alt="COS-split-track-45x25mm"></div><div><h4>${name}</h4></div></div>`;
const trackHtml=`<link rel="canonical" href="${trackPage}"><h1>Aluminium Click-on Screen&nbsp;Tech Specs</h1><div id="mounting-tracks" class="sc-techSpec__section"><h3>Mounting Tracks</h3>${trackCard()}${trackCard('Slim Track - 45x5mm',trackImage.replace('45x25mm','45x5mm'))}</div>`;
test('reviewed track codes and exact public name return an assembly reference with no finish/SKU claim',async()=>{
 for(const [code,part] of [['cosmt45251b','Part 1'],['cosmt45252b','Part 2'],['COSMT45252B','Part 2'],['Split Track - 45x25mm',null],['Split Track 45 × 25 mm',null]]){
  const calls=[],fetchImpl=async url=>{calls.push(url);return url===trackPage?html(trackHtml):new Response(png,{headers:{'Content-Type':'image/png'}});};
  const result=await searchSupplierReference('sculptform',{code},{fetchImpl}),p=result.products[0];assert.equal(p.code,code);assert.equal(p.matchType,'assembly-reference');assert.match(p.title,/both parts and clip shown/);if(part)assert.ok(p.title.includes(part));assert.equal(p.images[0].url,trackImage);assert.match(result.warnings[0],/not an isolated part photo or finish match/);
  await fetchSupplierReferenceImage('sculptform',{code,productUrl:p.url,imageUrl:p.images[0].url},{fetchImpl});assert.equal(calls.filter(url=>url===trackPage).length,2);
 }
});
test('track images must remain in the named card on the correct canonical screen page',()=>{
 const extract=markup=>extractSupplierProducts('sculptform',markup,{query:'cosmt45252b',pageUrl:trackPage});assert.equal(extract(trackHtml).length,1);
 for(const markup of [trackHtml.replace('rel="canonical"','rel="other"'),trackHtml.replace('<h1>Aluminium Click-on Screen','<h1>Other Screen'),trackHtml.replace('<h4>Split Track - 45x25mm','<h4>Slim Track - 45x5mm'),trackHtml.replace('id="mounting-tracks"','id="unrelated"'),trackHtml.replace('alt="COS-split-track-45x25mm"','alt="Different product"'),trackHtml.replace(trackCard(),trackCard()+trackCard()),trackHtml.replace(trackCard(),'<img src="'+trackImage+'">'+trackCard().replace(/<img[^>]*>/,''))])assert.deepEqual(extract(markup),[]);
 assert.deepEqual(extractSupplierProducts('sculptform',trackHtml.replaceAll(trackPage,sculptPage),{query:'cosmt45252b',pageUrl:sculptPage}),[]);
});
test('unknown codes, local track names and RHS codes do not infer individual photos',async()=>{
 const fetchImpl=()=>{throw Error('No public exact product association');};
 for(const code of ['cosmt45252w','cosmt45252b-02','cosmt45252','constructor','toString','Balustrade Mounting Blank Track','Balustrade Mounting Rear Track','RHS','cos40100pp']){
  const result=await searchSupplierReference('sculptform',{code},{fetchImpl});assert.deepEqual(result.products,[]);if(code==='cos40100pp')assert.match(result.warnings.join(' '),/combined profile chart/);
 }
 assert.throws(()=>supplierReferenceUrl('sculptform','https://sculptform.com/hs-fs/hubfs/Sculptform-COS-aluminium-profiles.jpg',undefined,{image:true}));
});
test('track download revalidates membership and rejects an unrelated asset or redirect',async()=>{
 const body={code:'cosmt45252b',productUrl:trackPage,imageUrl:trackImage};let downloaded=false;
 await assert.rejects(fetchSupplierReferenceImage('sculptform',body,{fetchImpl:async url=>{if(url===trackPage)return html(trackHtml.replace('<h4>Split Track - 45x25mm','<h4>Different Track'));downloaded=true;return new Response(png);}}),/not associated/);assert.equal(downloaded,false);
 await assert.rejects(fetchSupplierReferenceImage('sculptform',{...body,imageUrl:sculptImage},{fetchImpl:async()=>html(trackHtml)}),/not associated/);
 await assert.rejects(readSupplierResource('sculptform',trackImage,{image:true,fetchImpl:async()=>new Response('',{status:302,headers:{Location:trackImage.replace('width=1948','width=600')}})}),/different/);
 for(const [bytes,type] of [['<svg/>','image/svg+xml'],[png,'text/html']])await assert.rejects(fetchSupplierReferenceImage('sculptform',body,{fetchImpl:async url=>url===trackPage?html(trackHtml):new Response(bytes,{headers:{'Content-Type':type}})}),/supported|unexpected/);
});
