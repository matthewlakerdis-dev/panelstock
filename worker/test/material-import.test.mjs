import {test} from 'node:test';
import assert from 'node:assert/strict';
import {analyseMaterialCatalogue,validateMaterialImportResult} from '../src/material-import.js';
const env={PDF_CONVERTER_URL:'https://converter.test',PDF_CONVERTER_TOKEN:'test-only'},body={name:'Materials.pdf',data:btoa('%PDF-test')};
const result=()=>({ok:true,supplier:'',warnings:['Check the unit'],lines:[{sku:'001-ANG/30',description:'Angle',colour:'Black',dimensions:'30 x 30',lengthMm:6000,unit:'lengths',category:'extrusions',supplier:'Metal supplier'}]});
test('material PDF reader forwards only the document and returns bounded review fields without stock balances',async()=>{
 const prior=globalThis.fetch;let sent;
 globalThis.fetch=async(url,options)=>{sent={url,options};const value=result();value.lines[0].quantity=500;value.lines[0].unitCost=99;value.lines[0].itemId='invented';return Response.json(value);};
 try{
  const value=await analyseMaterialCatalogue({...body,stock:'PRIVATE_STOCK',items:[{id:'private-stock'}]},env);
  assert.equal(sent.url,'https://converter.test/material-analyse');assert.equal(sent.options.headers.Authorization,'Bearer test-only');
  assert.deepEqual(JSON.parse(sent.options.body),body);assert.equal(value.lines[0].sku,'001-ANG/30');
  assert.equal(value.lines[0].supplier,'Metal supplier');for(const field of ['quantity','unitCost','itemId'])assert.equal(Object.hasOwn(value.lines[0],field),false);
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
