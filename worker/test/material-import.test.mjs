import {test} from 'node:test';
import assert from 'node:assert/strict';
import {analyseMaterialCatalogue,validateMaterialImportResult,materialImportUnitCost,materialImportDimensions} from '../src/material-import.js';
const env={PDF_CONVERTER_URL:'https://converter.test',PDF_CONVERTER_TOKEN:'test-only'},body={name:'Materials.pdf',data:btoa('%PDF-test')};
const result=()=>({ok:true,supplier:'',warnings:['Check the unit'],lines:[{sku:'001-ANG/30',description:'Angle',colour:'Black',dimensions:'30 x 30',lengthMm:6000,unit:'lengths',category:'extrusions',supplier:'Metal supplier'}]});
test('material PDF reader forwards only the document and returns bounded review fields without stock balances',async()=>{
 const prior=globalThis.fetch;let sent;
 globalThis.fetch=async(url,options)=>{sent={url,options};const value=result();value.lines[0].quantity=500;value.lines[0].unitCost=99;value.lines[0].itemId='invented';return Response.json(value);};
 try{
  const value=await analyseMaterialCatalogue({...body,stock:'PRIVATE_STOCK',items:[{id:'private-stock'}]},env);
  assert.equal(sent.url,'https://converter.test/material-analyse');assert.equal(sent.options.headers.Authorization,'Bearer test-only');
  assert.deepEqual(JSON.parse(sent.options.body),body);assert.equal(value.lines[0].sku,'001-ANG/30');
  assert.equal(value.lines[0].supplier,'Metal supplier');assert.equal(value.lines[0].unitCost,99);for(const field of ['quantity','itemId'])assert.equal(Object.hasOwn(value.lines[0],field),false);
 }finally{globalThis.fetch=prior;}
});
test('material PDF reader rejects invalid files and configuration before a provider request',async()=>{
 const prior=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw Error('must not be called');};
 try{
  await assert.rejects(analyseMaterialCatalogue(body,{}),/unavailable/);
  for(const value of [null,{}, {...body,name:'list.xlsx'},{...body,data:'invalid*'}, {...body,data:btoa('<html>wrong')},{...body,data:'x'.repeat(7*1024*1024)},{...body,name:'X'.repeat(201)+'.pdf'}])await assert.rejects(analyseMaterialCatalogue(value,env),/PDF|Choose/);
  await assert.rejects(analyseMaterialCatalogue(body,{...env,PDF_CONVERTER_URL:'http://public.test'}),/HTTPS/);
  await assert.rejects(analyseMaterialCatalogue(body,{...env,PDF_CONVERTER_URL:'not a URL'}),/configured/);
  assert.equal(calls,0);
 }finally{globalThis.fetch=prior;}
});
test('material PDF reader rejects corrupt, oversized and structurally invalid responses',async()=>{
 const prior=globalThis.fetch;
 try{
  for(const response of [new Response('<html>not ready</html>',{status:503}),new Response('x'.repeat(512*1024+1)),Response.json({...result(),lines:Array(201).fill({})}),Response.json({...result(),supplier:null}),Response.json({...result(),lines:[{...result().lines[0],category:'panels'}]}),Response.json({...result(),lines:[{...result().lines[0],lengthMm:true}]})]){
   globalThis.fetch=async()=>response;await assert.rejects(analyseMaterialCatalogue(body,env),/unavailable|size limit|invalid material/);
  }
  globalThis.fetch=async()=>Response.json({error:'Check the model configuration.'},{status:503});await assert.rejects(analyseMaterialCatalogue(body,env),/model configuration/);
  globalThis.fetch=async()=>{throw Error('PRIVATE_TRANSPORT_DETAIL');};await assert.rejects(analyseMaterialCatalogue(body,env),error=>error.status===503&&!error.message.includes('PRIVATE_TRANSPORT_DETAIL'));
 }finally{globalThis.fetch=prior;}
});
test('material results preserve uncertain fields and repeated source codes without merging variants',()=>{
 const value=result();value.lines.push({...value.lines[0],colour:'White',lengthMm:null,unit:'',category:'',supplier:''});
 const checked=validateMaterialImportResult(value);assert.equal(checked.lines.length,2);assert.equal(checked.lines[0].sku,checked.lines[1].sku);assert.equal(checked.lines[1].unit,'');assert.equal(checked.lines[1].lengthMm,null);
 for(const patch of [{sku:'X'.repeat(101)},{description:1},{unit:'X'.repeat(41)},{lengthMm:Infinity},{lengthMm:0},{category:'offcuts'}])assert.throws(()=>validateMaterialImportResult({...result(),lines:[{...result().lines[0],...patch}]}),/invalid material/);
});
test('optional PDF name, stock unit and printed price fields survive validation with safe legacy defaults',()=>{
 const value=result(),legacy=validateMaterialImportResult(value).lines[0];
 for(const [key,expected]of Object.entries({name:'',stockUnit:'',unitCost:null,priceUnit:'',currency:'',taxBasis:'unknown'}))assert.equal(legacy[key],expected);
 const fields={name:'Square angle',stockUnit:'lengths',unitCost:0,priceUnit:'EA',currency:'AUD',taxBasis:'exGST'};
 Object.assign(value.lines[0],fields);const checked=validateMaterialImportResult(value).lines[0];
 for(const [key,expected]of Object.entries(fields))assert.equal(checked[key],expected);
 for(const patch of [{name:'x'.repeat(161)},{stockUnit:'x'.repeat(41)},{priceUnit:'x'.repeat(81)},{unitCost:'12.50'},{unitCost:true},{unitCost:-1},{unitCost:Infinity},{unitCost:NaN},{unitCost:1e9+0.01},{unitCost:0.001},{unitCost:999999999.9999999},{currency:'aud'},{currency:'A$'},{taxBasis:'excluding'}])assert.throws(()=>validateMaterialImportResult({...result(),lines:[{...result().lines[0],...patch}]}),/invalid material/);
 for(const unitCost of [null,0,0.01,12.5,1e9])assert.equal(validateMaterialImportResult({...result(),lines:[{...result().lines[0],unitCost}]}).lines[0].unitCost,unitCost);
});
const pricedSource=(patch={})=>({category:'extrusions',colour:'Black',dimensions:'32X20X1.6',lengthMm:6500,unit:'EA',stockUnit:'lengths',unitCost:42.75,priceUnit:'EA',currency:'AUD',taxBasis:'exGST',...patch});
const lengthItem=(patch={})=>({category:'extrusions',colour:'Black',dimensions:'32 x 20 x 1.6 mm',lengthMm:6500,unit:'lengths',unitCost:12,costBasis:'unit',...patch});
test('a printed each price for an explicitly identified full extrusion length is never divided by millimetres',()=>{
 assert.deepEqual(materialImportUnitCost(pricedSource(),lengthItem()),{unitCost:42.75,reason:''});
 assert.deepEqual(materialImportUnitCost(pricedSource({priceUnit:'$/EA',unitCost:0}),lengthItem()),{unitCost:0,reason:''});
 assert.equal(materialImportDimensions('32.0 × 20.00 x 1.60 mm'),'32x20x1.6');
 for(const patch of [{lengthMm:6000},{lengthMm:null},{stockUnit:''},{category:'fixings'},{unit:'metres'},{priceUnit:'100 EA'},{priceUnit:'per 100 EA'},{priceUnit:'$/m'},{dimensions:'25 x 25'},{colour:'White'}]){
  const value=materialImportUnitCost(pricedSource(patch),lengthItem());assert.equal(value.unitCost,null,JSON.stringify(patch));assert.ok(value.reason);
 }
 for(const patch of [{lengthMm:6000},{lengthMm:null},{category:'fixings'},{costBasis:'pack'},{costBasis:'area'}])assert.equal(materialImportUnitCost(pricedSource(),lengthItem(patch)).unitCost,null,JSON.stringify(patch));
});
test('every full-length price needs an explicit matching PDF length and known profile dimensions',()=>{
 const source=pricedSource({unit:'lengths',priceUnit:'lengths'});
 assert.equal(materialImportUnitCost(source,lengthItem()).unitCost,42.75);
 for(const lengthMm of [undefined,null,'',0,6000])assert.equal(materialImportUnitCost({...source,lengthMm},lengthItem()).unitCost,null);
 assert.equal(materialImportUnitCost({...source,dimensions:''},lengthItem()).unitCost,null);
});
test('an existing each-counted full extrusion bar accepts its printed each price without changing stock unit',()=>{
 const source=pricedSource({unitCost:12.02}),item=lengthItem({unit:'each'});
 assert.deepEqual(materialImportUnitCost(source,item),{unitCost:12.02,reason:''});
 for(const patch of [{lengthMm:null},{lengthMm:6000},{dimensions:''},{dimensions:'25x25'},{colour:'White'},{category:'fixings'},{stockUnit:'metres'},{priceUnit:'100 EA'}])assert.equal(materialImportUnitCost({...source,...patch},item).unitCost,null,JSON.stringify(patch));
 assert.equal(materialImportUnitCost(source,{...item,category:'fixings'}).unitCost,null);
});
test('only explicit AUD prices excluding GST with compatible single-unit bases are usable',()=>{
 const source={unit:'EA',stockUnit:'each',unitCost:1.5,priceUnit:'per each',currency:'AUD',taxBasis:'exGST'};
 assert.deepEqual(materialImportUnitCost(source,{unit:'pcs'}),{unitCost:1.5,reason:''});
 assert.equal(materialImportUnitCost({...source,unit:'metres'},{unit:'each'}).unitCost,null);
 for(const patch of [{unitCost:null},{unitCost:'1.50'},{unitCost:NaN},{unitCost:Infinity},{unitCost:1.001},{currency:''},{currency:'USD'},{taxBasis:'unknown'},{taxBasis:'incGST'},{priceUnit:''},{priceUnit:'100EA'},{stockUnit:'packs'}])assert.equal(materialImportUnitCost({...source,...patch},{unit:'each'}).unitCost,null,JSON.stringify(patch));
 assert.equal(materialImportUnitCost({...source,unit:'M',stockUnit:'metres',priceUnit:'$/m'},{unit:'metres'}).unitCost,1.5);
 assert.equal(materialImportUnitCost({...source,lengthMm:6000},{unit:'each'}).unitCost,null);
 assert.equal(materialImportUnitCost({...source,dimensions:'M6 x 20'},{unit:'each',dimensions:'M6 x 25'}).unitCost,null);
});
