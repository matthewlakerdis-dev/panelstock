import {HttpError} from './security.js';

// Keep supplier lookup read-only and bounded. Stock images are saved separately.
export const CAPRAL_REFERENCE_LIMITS=Object.freeze({htmlBytes:2*1024*1024,imageBytes:8*1024*1024,timeoutMs:8000,redirects:3,products:10,images:4,candidates:6,galleryCandidates:32});
const officialHosts=new Set(['capral.com.au','www.capral.com.au','shop.capral.com.au']);
const unavailable=()=>new HttpError(503,'Capral image lookup is temporarily unavailable. Retry or upload a reference photo.');
const invalidUrl=()=>new HttpError(400,'Choose an official Capral product or image link.');

export function normaliseCapralCode(value){
 if(typeof value!=='string'||/[\u0000-\u001f\u007f-\u009f]/.test(value))throw new HttpError(400,'Enter a Capral product or profile code.');
 const code=value.trim().toUpperCase().replace(/\s+/g,'');
 if(code.length<2||code.length>32||!/[0-9]/.test(code)||!/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/.test(code))throw new HttpError(400,'Enter a valid Capral product or profile code.');
 return code;
}
const exactCode=(value,code)=>{try{return normaliseCapralCode(typeof value==='number'&&Number.isSafeInteger(value)?String(value):value)===code;}catch{return false;}};

export function capralReferenceUrl(value,base,{image=false}={}){
 if(typeof value!=='string'||!value.trim()||value.length>2048)throw invalidUrl();
 value=value.trim();
 let url;try{url=new URL(value,base);}catch{throw invalidUrl();}
 const authority=url.href.match(/^https:\/\/([^/?#]+)/i)?.[1]||'';
 const suppliedAuthority=value.match(/^(?:https:)?\/\/([^/?#]+)/i)?.[1];
 // Capral's shop publishes its images in this specific BigCommerce store.
 const storeImage=image&&(url.hostname==='cdn11.bigcommerce.com'&&/^\/s-gwvwsryafm\/images\/(?:stencil|products)\//.test(url.pathname)||url.hostname==='store-gwvwsryafm.mybigcommerce.com'&&/^\/content\/product\/[a-z0-9][a-z0-9_.-]*\.(?:png|jpe?g|webp)$/i.test(url.pathname));
 if(url.protocol!=='https:'||(!officialHosts.has(url.hostname.toLowerCase())&&!storeImage)||url.username||url.password||url.port||authority.includes('@')||suppliedAuthority&&/[@:]/.test(suppliedAuthority))throw invalidUrl();
 url.hash='';return url.href;
}

export async function readCapralResource(value,options={}){
 const fetchImpl=options.fetchImpl||fetch,maxBytes=options.maxBytes??CAPRAL_REFERENCE_LIMITS.htmlBytes,timeoutMs=Math.min(options.timeoutMs??CAPRAL_REFERENCE_LIMITS.timeoutMs,CAPRAL_REFERENCE_LIMITS.timeoutMs);
 let url=capralReferenceUrl(value,undefined,options),reader,timer;
 const controller=new AbortController();
 const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();if(reader)reader.cancel().catch(()=>{});reject(unavailable());},timeoutMs);});
 const operation=async()=>{
  for(let redirect=0;redirect<=CAPRAL_REFERENCE_LIMITS.redirects;redirect++){
   const response=await fetchImpl(url,{method:'GET',redirect:'manual',headers:{Accept:options.image?'image/png,image/jpeg,image/webp':'text/html,application/xhtml+xml','User-Agent':'PanelStock/1.0 (Capral material reference lookup)'},signal:controller.signal});
   if([301,302,303,307,308].includes(response.status)){
    const location=response.headers.get('Location');await response.body?.cancel();
    if(!location||redirect===CAPRAL_REFERENCE_LIMITS.redirects)throw new HttpError(502,'Capral returned too many redirects. Try its product page directly.');
    try{url=capralReferenceUrl(location,url,options);}catch{throw new HttpError(502,'Capral redirected outside its approved product website.');}
    continue;
   }
   if(!response.ok){await response.body?.cancel();throw unavailable();}
   const length=response.headers.get('Content-Length');
   if(length&&/^\d+$/.test(length)&&Number(length)>maxBytes){await response.body?.cancel();throw new HttpError(502,options.image?'The Capral image exceeds the 8 MB download limit.':'Capral returned a page larger than the lookup limit.');}
   reader=response.body?.getReader();if(!reader)throw new HttpError(502,'Capral returned an empty response.');
   let size=0;const chunks=[];
   while(true){
    const {done,value:chunk}=await reader.read();if(done)break;
    size+=chunk.length;if(size>maxBytes){await reader.cancel();throw new HttpError(502,options.image?'The Capral image exceeds the 8 MB download limit.':'Capral returned a page larger than the lookup limit.');}chunks.push(chunk);
   }
   const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
   return {url,bytes,contentType:(response.headers.get('Content-Type')||'').split(';')[0].trim().toLowerCase()};
  }
  throw unavailable();
 };
 try{return await Promise.race([operation(),timeout]);}catch(error){if(error instanceof HttpError)throw error;throw unavailable();}finally{clearTimeout(timer);controller.abort();}
}

function entities(value){
 return String(value??'').replace(/&(?:amp|quot|apos|lt|gt|#39|#x[0-9a-f]+|#\d+);/gi,entity=>{
  const names={'&amp;':'&','&quot;':'"','&apos;':"'",'&lt;':'<','&gt;':'>','&#39;':"'"};
  if(Object.hasOwn(names,entity.toLowerCase()))return names[entity.toLowerCase()];
  const point=entity[2]?.toLowerCase()==='x'?parseInt(entity.slice(3,-1),16):parseInt(entity.slice(2,-1),10);
  return point>0&&point<=0x10ffff&&!(point>=0xd800&&point<=0xdfff)?String.fromCodePoint(point):'';
 });
}
const plain=(value,max=200)=>entities(typeof value==='string'?value.slice(0,4096):'').replace(/<[^<>]*>/g,' ').replace(/[\u0000-\u001f\u007f-\u009f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);
const values=value=>Array.isArray(value)?value:[value];
const attributes=tag=>Object.fromEntries([...tag.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)].map(match=>[match[1].toLowerCase(),entities(match[2]??match[3]??match[4])]));
const markup=html=>html.replace(/<!--[\s\S]*?-->|<script\b[^>]*>[\s\S]*?<\/script\s*>/gi,'');

// The live shop identifies profile codes with SECTION, separately from its SKU.
// Bind that field to the page's SKU and URL, never a title or a related product.
function shopProductFields(html,node,base){
 if(new URL(base).hostname!=='shop.capral.com.au')return [];
 let productUrl;try{productUrl=capralReferenceUrl(node.url,base);}catch{return [];}
 if(productUrl!==base||!/^\/[0-9]+\/$/.test(new URL(base).pathname))return [];
 for(const block of markup(html).matchAll(/<dl\b([^>]*)>([\s\S]*?)<\/dl\s*>/gi)){
  if(!attributes(block[1]).class?.split(/\s+/).includes('productView-info'))continue;
  const fields=[...block[2].matchAll(/<dt\b[^>]*>([\s\S]*?)<\/dt\s*>\s*<dd\b[^>]*>([\s\S]*?)<\/dd\s*>/gi)].map(match=>[plain(match[1]),plain(match[2])]);
  if(fields.some(([key,value])=>key==='SKU:'&&value===String(node.sku)))return fields;
 }
 return [];
}
function shopSectionMatches(html,node,code,base){
 return shopProductFields(html,node,base).some(([key,value])=>key==='SECTION:'&&exactCode(value,code));
}

// The shop's JSON-LD omits its custom product photo. Read only the verified
// product's own gallery, never recommendation cards or unrelated page images.
function shopGalleryImages(html,node,base){
 if(!shopProductFields(html,node,base).length)return [];
 const images=[];
 const add=(raw,alt)=>{
  try{
   const url=capralReferenceUrl(raw,base,{image:true});
   if(images.some(image=>image.url===url)||images.length>=CAPRAL_REFERENCE_LIMITS.galleryCandidates)return;
   images.push({url,alt:plain(alt||String(node.name)+(new URL(url).hostname==='store-gwvwsryafm.mybigcommerce.com'?' — product photo':''))});
  }catch{}
 };
 for(const section of markup(html).matchAll(/<section\b([^>]*)>([\s\S]*?)<\/section\s*>/gi)){
  const attrs=attributes(section[1]);
  if(!attrs.class?.split(/\s+/).includes('productView-images')||!Object.hasOwn(attrs,'data-image-gallery'))continue;
  for(const figure of section[2].matchAll(/<figure\b([^>]*)>/gi)){
   const attrs=attributes(figure[1]);if(attrs.class?.split(/\s+/).includes('productView-image'))add(attrs['data-image-gallery-main']);
  }
  for(const link of section[2].matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)){
   const attrs=attributes(link[1]);
   if(!attrs.class?.split(/\s+/).includes('productView-thumbnail-link')||!Object.hasOwn(attrs,'data-image-gallery-item'))continue;
   const image=link[2].match(/<img\b([^>]*)>/i),alt=image?attributes(image[1]).alt:'';
   add(attrs['data-image-gallery-zoom-image-url']||attrs['data-image-gallery-new-image-url']||attrs.href,alt);
  }
  break;
 }
 // Capral's custom content/product image is the product photo shown by its shop.
 return images.sort((a,b)=>Number(new URL(b.url).hostname==='store-gwvwsryafm.mybigcommerce.com')-Number(new URL(a.url).hostname==='store-gwvwsryafm.mybigcommerce.com')).slice(0,CAPRAL_REFERENCE_LIMITS.images);
}

export function extractCapralSearchUrls(html,pageUrl){
 if(typeof html!=='string'||new TextEncoder().encode(html).length>CAPRAL_REFERENCE_LIMITS.htmlBytes)throw new HttpError(502,'Capral returned a page larger than the lookup limit.');
 const urls=[];
 for(const heading of markup(html).matchAll(/<h3\b([^>]*)>([\s\S]*?)<\/h3\s*>/gi)){
  if(!attributes(heading[1]).class?.split(/\s+/).includes('card-title'))continue;
  const link=heading[2].match(/<a\b([^>]*)>/i);if(!link)continue;
  try{
   const url=new URL(capralReferenceUrl(attributes(link[1]).href,pageUrl));
   if(url.hostname!=='shop.capral.com.au'||!/^\/[0-9]+\/$/.test(url.pathname))continue;
   url.search='';if(!urls.includes(url.href))urls.push(url.href);
  }catch{}
  if(urls.length>=CAPRAL_REFERENCE_LIMITS.candidates)break;
 }
 return urls;
}

export function extractCapralProducts(html,{code:input,pageUrl}={}){
 const code=normaliseCapralCode(input),base=capralReferenceUrl(pageUrl);
 if(typeof html!=='string'||new TextEncoder().encode(html).length>CAPRAL_REFERENCE_LIMITS.htmlBytes)throw new HttpError(502,'Capral returned a page larger than the lookup limit.');
 const roots=[],opening=/<script\b([^<>]{0,10000})>/gi,closing=/<\/script\s*>/gi;
 for(let match;roots.length<64&&(match=opening.exec(html));){
  const start=opening.lastIndex;closing.lastIndex=start;const close=closing.exec(html);if(!close)break;
  opening.lastIndex=closing.lastIndex;
  if(!/\btype\s*=\s*["']application\/ld\+json["']/i.test(match[1]))continue;
  try{roots.push(JSON.parse(html.slice(start,close.index).trim()));}catch{}
 }
 const products=[],seen=new Map();let visited=0;
 function walk(node,depth=0){
  if(!node||typeof node!=='object'||depth>12||++visited>2000)return;
  if(Array.isArray(node)){for(const child of node)walk(child,depth+1);return;}
  const isProduct=values(node['@type']).some(type=>typeof type==='string'&&/(?:^|\/)Product$/i.test(type));
  if(isProduct&&(exactCode(node.sku,code)||exactCode(node.mpn,code)||exactCode(node.productID,code)||shopSectionMatches(html,node,code,base))){
   const title=plain(node.name),rawUrl=node.url||node['@id']||values(node.offers)[0]?.url||base;
   let url;try{url=capralReferenceUrl(typeof rawUrl==='object'?rawUrl?.['@id']:rawUrl,base);}catch{url='';}
   if(title&&url){
    const images=shopGalleryImages(html,node,base);
    for(const image of values(node.image)){
     if(images.length>=CAPRAL_REFERENCE_LIMITS.images)break;
     const raw=typeof image==='string'?image:image?.contentUrl||image?.url;
     try{const imageUrl=capralReferenceUrl(raw,base,{image:true});if(!images.some(image=>image.url===imageUrl))images.push({url:imageUrl,alt:plain(image?.caption||image?.name)||title});}catch{}
     if(images.length>=CAPRAL_REFERENCE_LIMITS.images)break;
    }
    if(images.length){
     const existing=seen.get(url);
     if(existing){for(const image of images)if(existing.images.length<CAPRAL_REFERENCE_LIMITS.images&&!existing.images.some(current=>current.url===image.url))existing.images.push(image);}
     else if(products.length<CAPRAL_REFERENCE_LIMITS.products){const product={code,title,url,images};products.push(product);seen.set(url,product);}
    }
   }
  }
  for(const [key,child]of Object.entries(node))if(key!=='image')walk(child,depth+1);
 }
 for(const root of roots)walk(root);
 return products;
}

function mimeFor(bytes){
 if(bytes.length>=24&&[137,80,78,71,13,10,26,10].every((value,index)=>bytes[index]===value)&&String.fromCharCode(...bytes.slice(12,16))==='IHDR')return 'image/png';
 if(bytes.length>=4&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255&&bytes.at(-2)===255&&bytes.at(-1)===217)return 'image/jpeg';
 if(bytes.length>=20&&String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP'&&['VP8 ','VP8L','VP8X'].includes(String.fromCharCode(...bytes.slice(12,16))))return 'image/webp';
 throw new HttpError(502,'Capral did not return a supported PNG, JPEG or WebP reference image.');
}
const base64=bytes=>{let raw='';for(let offset=0;offset<bytes.length;offset+=32768)raw+=String.fromCharCode(...bytes.subarray(offset,offset+32768));return btoa(raw);};

export async function searchCapralReference(body,options={}){
 const code=normaliseCapralCode(body?.code);
 // Verified against Capral's public BigCommerce search and product pages.
 const url=capralReferenceUrl((options.searchUrl||((code)=>'https://shop.capral.com.au/search.php?search_query='+encodeURIComponent(code)))(code));
 const page=await readCapralResource(url,options),html=new TextDecoder().decode(page.bytes),products=extractCapralProducts(html,{code,pageUrl:page.url});
 const candidates=extractCapralSearchUrls(html,page.url);
 const results=await Promise.allSettled(candidates.map(async url=>{
  const page=await readCapralResource(url,options);
  return extractCapralProducts(new TextDecoder().decode(page.bytes),{code,pageUrl:page.url});
 }));
 for(const result of results)if(result.status==='fulfilled')for(const product of result.value){
  const existing=products.find(existing=>existing.url===product.url);
  if(existing){existing.title=product.title;existing.images=[...product.images,...existing.images].filter((image,index,images)=>images.findIndex(other=>other.url===image.url)===index).slice(0,CAPRAL_REFERENCE_LIMITS.images);}
  else if(products.length<CAPRAL_REFERENCE_LIMITS.products)products.push(product);
 }
 if(!products.length&&results.some(result=>result.status==='rejected'))throw unavailable();
 return {code,products,warnings:products.length?[]:['No exact Capral code match with a reference image was found. Check the product or profile code.']};
}

export async function fetchCapralReferenceImage(body,options={}){
 const code=normaliseCapralCode(body?.code),productUrl=capralReferenceUrl(body?.productUrl),imageUrl=capralReferenceUrl(body?.imageUrl,undefined,{image:true});
 const page=await readCapralResource(productUrl,options),products=extractCapralProducts(new TextDecoder().decode(page.bytes),{code,pageUrl:page.url});
 const product=products.find(product=>product.images.some(image=>image.url===imageUrl));
 if(!product)throw new HttpError(400,'That image is not associated with the exact Capral code. Search for the product again.');
 const image=await readCapralResource(imageUrl,{...options,image:true,maxBytes:CAPRAL_REFERENCE_LIMITS.imageBytes});
 const mimeType=mimeFor(image.bytes),reported=image.contentType==='image/jpg'?'image/jpeg':image.contentType;
 if(reported&&reported!=='application/octet-stream'&&reported!==mimeType)throw new HttpError(502,'Capral returned an unexpected image format. Upload a reference photo instead.');
 const extension={'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[mimeType];
 return {code,productUrl:product.url,title:product.title,image:{data:'data:'+mimeType+';base64,'+base64(image.bytes),mimeType,name:'Capral-'+code+'.'+extension}};
}
