import {HttpError} from './security.js';

// Public supplier references only. Never resolve invoice codes via fuzzy text.
export const SUPPLIER_REFERENCE_LIMITS=Object.freeze({htmlBytes:2*1024*1024,imageBytes:8*1024*1024,timeoutMs:8000,candidates:6,images:4});
const labels={rondo:'Rondo','gyprock-trade':'Gyprock Trade',knotwood:'Knotwood','baker-packaging':'Baker Packaging',gabbabolt:'Nut & Bolt Factory Woolloongabba',sculptform:'Sculptform'};
const knotwoodCollections=['battens','boards','geoline','knotwood-standards'];
const sculptformPage='https://sculptform.com/aluminium-click-on-battens-tech-specs/';
// Only independently named, individual product references verified on this page.
// Combined profile charts, finish swatches and project photos are excluded.
const sculptformReferences=[{id:'l-profile-base-trim',name:'L Profile Base Trim',file:'L-base-profile.jpg'},{id:'back-cover-plates',name:'Back Cover Plate',file:'back-cover-plate-aluminium.jpg'}];
const unmappedWarnings={
 'baker-packaging':'Baker Packaging variant-code/image mapping is unverified: its public catalogue currently refuses access. Codes such as 38.041 and 38.042 are distinct strings. Upload a verified item photo; group and neighbouring variant images are not offered.',
 gabbabolt:'Nut & Bolt Factory Woolloongabba (gabbabolt.com.au) has no verified public item-code/image mapping. A supplier catalogue or verified manufacturer part number is required. Generic fastener photos and the Yatala/Toowoomba business are excluded.'
};
const fail=message=>new HttpError(400,message);
const unavailable=()=>new HttpError(503,'Supplier image lookup is temporarily unavailable. Retry or upload a photo.');
export function normaliseSupplierQuery(source,value){
 if(!Object.hasOwn(labels,source)||typeof value!=='string'||/[\u0000-\u001f\u007f-\u009f]/.test(value))throw fail('Choose a supplier and enter its product query.');
 const query=value.trim().replace(/\s+/g,' ');
 if(source==='rondo'){
  if(!/^[a-z0-9][a-z0-9-]{0,31}$/i.test(query)||!/[0-9]/.test(query))throw fail('Enter the Rondo part number from its product page.');
  return query.toUpperCase();
 }
 if(source==='knotwood'){
  if(!/^K[A-Z0-9]+(?:-[A-Z0-9]+)*$/i.test(query)||query.length>40)throw fail('Enter the exact Knotwood profile code, including its revision and male/female suffix.');
  return query.toUpperCase();
 }
 if(Object.hasOwn(unmappedWarnings,source)){
  if(!query||query.length>120||! /^[\p{L}\p{N} ._()+/-]+$/u.test(query))throw fail('Enter the supplier code as printed.');
  return query; // Stock codes are opaque strings, including decimal punctuation.
 }
 if(query.length<3||query.length>120||!/[a-z]{2}/i.test(query)||! /^[\p{L}\p{N} &'’().+/-]+$/u.test(query))throw fail(source==='sculptform'?'Enter a verified Sculptform product reference name, not an invoice code.':'Enter the public Gyprock product name, not a Gyprock Trade invoice code.');
 return query;
}
export function supplierReferenceUrl(source,value,base,{image=false,search=false}={}){
 if(!Object.hasOwn(labels,source)||typeof value!=='string'||value.length>2048||/[\s<>\\]/.test(value))throw fail('Choose an approved official supplier link.');
 let url;try{url=new URL(value,base);}catch{throw fail('Choose an approved official supplier link.');}
 if(url.protocol!=='https:'||url.username||url.password||url.port||url.hash||/%(?:2f|5c|2e)/i.test(url.pathname))throw fail('Choose an approved official supplier link.');
 let allowed=false;
 if(source==='rondo'&&['www.rondo.com.au','rondo.com.au'].includes(url.hostname)){
  allowed=image?/^\/media\/[a-z0-9]+\/[a-z0-9_.-]+\.(?:png|jpe?g|webp)$/i.test(url.pathname):/^\/products\/(?:[a-z0-9-]+\/){1,5}[a-z0-9-]+\/?$/.test(url.pathname)||search&&url.pathname==='/search-results';
 }else if(source==='gyprock-trade'){
  allowed=image?url.hostname==='www.csrassetlibrary.com'&&/^\/celum\/[0-9]+_[a-z0-9_% .()-]+\.(?:png|jpe?g|webp)$/i.test(url.pathname)&&!url.search:['www.gyprock.com.au','gyprock.com.au'].includes(url.hostname)&&(/^\/products\/(?:[a-z0-9-]+\/){1,4}[a-z0-9-]+\/?$/.test(url.pathname)||search&&url.pathname==='/products')&&!url.search;
 }else if(source==='knotwood'&&url.hostname==='knotwood.com'&&!url.search){
  allowed=image?/^\/au\/wp-content\/uploads\/sites\/2\/20\d{2}\/(?:0[1-9]|1[0-2])\/[a-z0-9][a-z0-9_.-]*\.(?:png|jpe?g|webp)$/i.test(url.pathname):knotwoodCollections.some(collection=>url.pathname==='/au/profiles/'+collection+'/');
 }else if(source==='sculptform'&&url.hostname==='sculptform.com'){
  allowed=image?sculptformReferences.some(ref=>url.pathname==='/hs-fs/hubfs/'+ref.file)&&[...url.searchParams].every(([key,value])=>key==='name'?value===url.pathname.split('/').at(-1):['width','height'].includes(key)&&/^[1-9]\d{0,3}$/.test(value))&&new Set(url.searchParams.keys()).size===[...url.searchParams].length:url.href===sculptformPage;
 }
 if(!allowed)throw fail('Choose an approved official supplier product or bitmap image link.');
 return url.href;
}
export async function readSupplierResource(source,value,options={}){
 const maxBytes=options.image?SUPPLIER_REFERENCE_LIMITS.imageBytes:SUPPLIER_REFERENCE_LIMITS.htmlBytes;
 const controller=new AbortController();let reader,timer;
 const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reader?.cancel().catch(()=>{});reject(unavailable());},Math.min(options.timeoutMs??8000,8000));});
 const operation=async()=>{
  let url=supplierReferenceUrl(source,value,undefined,options);
  for(let count=0;count<=3;count++){
   const response=await (options.fetchImpl||fetch)(url,{redirect:'manual',signal:controller.signal,headers:{Accept:options.image?'image/png,image/jpeg,image/webp':'text/html','User-Agent':'PanelStock/1.0 (public supplier reference lookup)'}});
   if([301,302,303,307,308].includes(response.status)){
    const location=response.headers.get('Location');await response.body?.cancel();
    if(!location||count===3)throw new HttpError(502,'Supplier returned too many redirects.');
    const next=supplierReferenceUrl(source,location,url,options);
    // An image redirect must preserve the exact asset path and query. Pages may
    // canonicalise host/trailing slash but cannot substitute another product.
    const a=new URL(url),b=new URL(next);
    if(a.pathname.replace(/\/$/,'')!==b.pathname.replace(/\/$/,'')||a.search!==b.search)throw new HttpError(502,'Supplier redirected to a different product or image.');
    url=next;continue;
   }
   if(!response.ok){await response.body?.cancel();throw unavailable();}
   if(Number(response.headers.get('Content-Length'))>maxBytes){await response.body?.cancel();throw new HttpError(502,'Supplier response exceeds the download limit.');}
   reader=response.body?.getReader();if(!reader)throw unavailable();
   const chunks=[];let size=0;
   while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>maxBytes){await reader.cancel();throw new HttpError(502,'Supplier response exceeds the download limit.');}chunks.push(value);}
   const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
   const contentType=(response.headers.get('Content-Type')||'').split(';')[0].toLowerCase().trim();
   if(!options.image&&!['text/html','application/xhtml+xml'].includes(contentType))throw new HttpError(502,'Supplier did not return a product page.');
   return {url,bytes,contentType};
  }
 };
 try{return await Promise.race([operation(),timeout]);}catch(e){if(e instanceof HttpError)throw e;throw unavailable();}finally{clearTimeout(timer);controller.abort();}
}
const entities=value=>String(value??'').replace(/&(?:amp|quot|apos|lt|gt|#39|#x[0-9a-f]+|#\d+);/gi,e=>({'&amp;':'&','&quot;':'"','&apos;':"'",'&lt;':'<','&gt;':'>','&#39;':"'"}[e.toLowerCase()]??String.fromCodePoint(Math.max(0,Math.min(0x10ffff,e[2].toLowerCase()==='x'?parseInt(e.slice(3,-1),16):parseInt(e.slice(2,-1),10))))));
const plain=value=>entities(value).replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim().slice(0,200);
const attrs=tag=>Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(m=>[m[1].toLowerCase(),entities(m[2]??m[3])]));
const nameKey=value=>plain(value).toLowerCase().replace(/^gyprock\s+/,'').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const exactNameKey=value=>plain(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const clean=html=>html.replace(/<!--[\s\S]*?-->|<script\b[^>]*>[\s\S]*?<\/script\s*>/gi,'');
function bounded(html){if(typeof html!=='string'||new TextEncoder().encode(html).length>SUPPLIER_REFERENCE_LIMITS.htmlBytes)throw new HttpError(502,'Supplier page exceeds the lookup limit.');return clean(html);}
// Keep nested cards/sections together; a lazy .*?</div> can bind a neighbour's
// image after a missing/malformed card. Reject incomplete containers instead.
function divContent(text,start){
 const tags=/<\/?div\b[^>]*>/gi;tags.lastIndex=start;let depth=0,contentStart;
 for(let tag;(tag=tags.exec(text));){
  if(tag[0].startsWith('</')){if(--depth===0)return text.slice(contentStart,tag.index);}
  else{depth++;if(depth===1)contentStart=tags.lastIndex;}
 }
 return '';
}
function extractKnotwoodProducts(text,query,base){
 const products=[];
 for(const tag of text.matchAll(/<div\b([^>]*)>/gi)){
  const a=attrs(tag[1]);
  if(!a.class?.split(/\s+/).includes('profile-inner__grid-item')||a['data-sku']!==query||a['data-type']!=='Profile')continue;
  const card=divContent(text,tag.index),title=plain(a['data-name']);
  const visibleSku=[...card.matchAll(/<div\b([^>]*)>([^<]*)<\/div\s*>/gi)].find(m=>attrs(m[1]).class==='profile-inner__sku');
  if(!title||plain(visibleSku?.[2])!==query)continue;
  try{
   const url=supplierReferenceUrl('knotwood',a['data-img'],base,{image:true});
   if(![...card.matchAll(/<img\b([^>]*)>/gi)].some(m=>{const image=attrs(m[1]);return image.src===url&&plain(image.alt)===title;}))continue;
   products.push({source:'knotwood',code:query,title:query+' — '+title,url:base,images:[{url,alt:title}],matchType:'profile-code'});
  }catch{}
 }
 // Duplicate or conflicting exact-code cards are not a verified association.
 return products.length===1?products:[];
}
function extractSculptformProducts(text,query,base){
 const ref=sculptformReferences.find(ref=>exactNameKey(ref.name)===exactNameKey(query));
 if(!ref||!/<h1\b[^>]*>Aluminium Click-on Batten(?:&nbsp;|\s)+Tech Specs<\/h1>/i.test(text))return [];
 const sections=[...text.matchAll(/<div\b([^>]*)>/gi)].filter(tag=>{const a=attrs(tag[1]);return a.id===ref.id&&a.class?.split(/\s+/).includes('sc-techSpec__section');});
 if(sections.length!==1)return [];
 const section=divContent(text,sections[0].index),heading=section.match(/<h3\b[^>]*>([\s\S]*?)<\/h3>/i);
 if(!heading||exactNameKey(heading[1])!==exactNameKey(ref.name))return [];
 const images=[];
 for(const tag of section.matchAll(/<img\b([^>]*)>/gi)){
  const a=attrs(tag[1]);try{
   const url=supplierReferenceUrl('sculptform',a.src,base,{image:true});
   if(new URL(url).pathname!=='/hs-fs/hubfs/'+ref.file||a.alt!==ref.file.replace(/\.jpg$/,''))continue;
   if(!images.some(image=>image.url===url))images.push({url,alt:ref.name+' — product-name reference; size and finish unverified'});
  }catch{}
 }
 return images.length===1?[{source:'sculptform',code:query,title:ref.name+' — product-name reference (not an exact SKU)',url:base,images,matchType:'product-name-reference'}]:[];
}
export function extractSupplierSearchUrls(source,html,query,pageUrl){
 const urls=[];
 for(const link of bounded(html).matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)){
  try{
   const url=supplierReferenceUrl(source,attrs(link[1]).href,pageUrl),path=new URL(url).pathname;
   // Rondo's search descriptions also mention compatible parts. Only accept a
   // product slug beginning with this exact part; verify the h1 on that page.
   const match=source==='rondo'?path.split('/').filter(Boolean).at(-1).toUpperCase().startsWith(query+'-'):nameKey(link[2])===nameKey(query);
   if(match&&!urls.includes(url))urls.push(url);
  }catch{}
  if(urls.length>=SUPPLIER_REFERENCE_LIMITS.candidates)break;
 }
 return urls;
}
export function extractSupplierProducts(source,html,{query:input,pageUrl}={}){
 const query=normaliseSupplierQuery(source,input),base=supplierReferenceUrl(source,pageUrl),text=bounded(html);
 const canonical=[...text.matchAll(/<link\b([^>]*)>/gi)].map(m=>attrs(m[1])).find(a=>a.rel==='canonical');
 if(!canonical||supplierReferenceUrl(source,canonical.href,base)!==base)return [];
 if(source==='knotwood')return extractKnotwoodProducts(text,query,base);
 if(source==='sculptform')return extractSculptformProducts(text,query,base);
 const heading=text.match(/<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/i);if(!heading)return [];
 let title,region;
 if(source==='rondo'){
  title=plain(heading[1].match(/<span\b[^>]*>([\s\S]*?)<\/span>/i)?.[1]||heading[1]);
  if(title.split(/\s+/)[0].toUpperCase()!==query||!new URL(base).pathname.split('/').filter(Boolean).at(-1).toUpperCase().startsWith(query+'-'))return [];
  // The product's image cell immediately precedes its h1 in the same grid.
  const before=text.slice(0,heading.index),start=before.lastIndexOf('<div class="grid-x grid-padding-x">');
  if(start<0)return [];region=before.slice(start);
 }else{
  title=plain(heading[1]);if(nameKey(title)!==nameKey(query))return [];
  // Use the product overview, excluding site-wide banners and related cards.
  region=[...text.matchAll(/<section\b([^>]*)>([\s\S]*?)<\/section\s*>/gi)].find(m=>attrs(m[1]).id==='overview')?.[2]||'';
 }
 const images=[],diagrams=new Set();
 for(const image of region.matchAll(/<img\b([^>]*)>/gi)){
  const a=attrs(image[1]);let raw=a.src;
  if(source==='gyprock-trade'){
   try{const proxy=new URL(raw,base);if(proxy.origin!==new URL(base).origin||proxy.pathname!=='/_next/image')continue;raw=proxy.searchParams.get('url');}catch{continue;}
  }
  try{const url=supplierReferenceUrl(source,raw,base,{image:true});if(!images.some(i=>i.url===url)){images.push({url,alt:title});if(/diagram|drawing|cross[-_ ]?section/i.test(new URL(url).pathname+' '+(a.alt||'')))diagrams.add(url);}}catch{}
  if(images.length>=16)break;
 }
 // Keep associated diagrams, placing identifiable diagrams after product photos.
 images.sort((a,b)=>Number(diagrams.has(a.url))-Number(diagrams.has(b.url)));
 return images.length?[{source,code:query,title,url:base,images:images.slice(0,SUPPLIER_REFERENCE_LIMITS.images),matchType:source==='rondo'?'part-number':'product-name'}]:[];
}
export async function searchSupplierReference(source,body,options={}){
 const query=normaliseSupplierQuery(source,body?.code);
 if(Object.hasOwn(unmappedWarnings,source))return {source,code:query,products:[],warnings:[unmappedWarnings[source]],availability:'unverified'};
 if(source==='knotwood'||source==='sculptform'){
  const urls=source==='knotwood'?knotwoodCollections.map(collection=>'https://knotwood.com/au/profiles/'+collection+'/'):[sculptformPage];
  const results=await Promise.allSettled(urls.map(async url=>{const page=await readSupplierResource(source,url,options);return extractSupplierProducts(source,new TextDecoder().decode(page.bytes),{query,pageUrl:page.url});}));
  const products=results.flatMap(result=>result.status==='fulfilled'?result.value:[]).slice(0,SUPPLIER_REFERENCE_LIMITS.candidates);
  if(!products.length&&results.some(result=>result.status==='rejected'))throw unavailable();
  const warnings=source==='sculptform'?['Sculptform product-name reference only, not an exact SKU or finish match. Verified names: L Profile Base Trim; Back Cover Plate. Invoice codes, combined profile charts and project photos are not mapped.']:[];
  if(results.some(result=>result.status==='rejected'))warnings.push('Some official profile collections are temporarily unavailable.');
  if(!products.length)warnings.push(source==='knotwood'?'No exact Knotwood profile code with an associated image was found. Preserve revision and male/female suffixes.':'No verified individual Sculptform reference matched that full name. Upload a verified image for other products.');
  return {source,code:query,products,warnings};
 }
 const page=await readSupplierResource(source,source==='rondo'?'https://www.rondo.com.au/search-results?search='+encodeURIComponent(query):'https://www.gyprock.com.au/products',{...options,search:true});
 const urls=extractSupplierSearchUrls(source,new TextDecoder().decode(page.bytes),query,page.url);
 const results=await Promise.allSettled(urls.map(async url=>{const p=await readSupplierResource(source,url,options);return extractSupplierProducts(source,new TextDecoder().decode(p.bytes),{query,pageUrl:p.url});}));
 const products=results.flatMap(r=>r.status==='fulfilled'?r.value:[]);
 if(!products.length&&results.some(r=>r.status==='rejected'))throw unavailable();
 const warnings=source==='gyprock-trade'?['Public Gyprock manufacturer product-name lookup only. Gyprock Trade invoice codes and other manufacturers’ ranges are not mapped.']:[];
 if(!products.length)warnings.push(source==='rondo'?'No exact Rondo part-number match with an image was found.':'No exact public Gyprock product-name match was found. Enter the name shown on its product page.');
 return {source,code:query,products,warnings};
}
function mimeFor(bytes){
 if(bytes.length>=24&&[137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v)&&String.fromCharCode(...bytes.slice(12,16))==='IHDR')return 'image/png';
 if(bytes.length>=4&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255&&bytes.at(-2)===255&&bytes.at(-1)===217)return 'image/jpeg';
 if(bytes.length>=20&&String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP'&&['VP8 ','VP8L','VP8X'].includes(String.fromCharCode(...bytes.slice(12,16))))return 'image/webp';
 throw new HttpError(502,'Supplier did not return a supported PNG, JPEG or WebP image.');
}
export async function fetchSupplierReferenceImage(source,body,options={}){
 if(Object.hasOwn(unmappedWarnings,source))throw fail(unmappedWarnings[source]);
 const query=normaliseSupplierQuery(source,body?.code),productUrl=supplierReferenceUrl(source,body?.productUrl),imageUrl=supplierReferenceUrl(source,body?.imageUrl,undefined,{image:true});
 const page=await readSupplierResource(source,productUrl,options),product=extractSupplierProducts(source,new TextDecoder().decode(page.bytes),{query,pageUrl:page.url}).find(p=>p.url===productUrl&&p.images.some(i=>i.url===imageUrl));
 if(!product)throw fail('That image is not associated with the exact supplier product. Search again.');
 const image=await readSupplierResource(source,imageUrl,{...options,image:true}),mimeType=mimeFor(image.bytes);
 if(image.contentType!==mimeType&&!(mimeType==='image/jpeg'&&image.contentType==='image/jpg')&&image.contentType!=='application/octet-stream')throw new HttpError(502,'Supplier returned an unexpected image format.');
 let raw='';for(let i=0;i<image.bytes.length;i+=32768)raw+=String.fromCharCode(...image.bytes.subarray(i,i+32768));
 return {source,code:query,productUrl:product.url,title:product.title,image:{data:'data:'+mimeType+';base64,'+btoa(raw),mimeType,name:labels[source]+'-reference.'+({'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[mimeType])}};
}
