import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PDFDocument,PDFName,PDFDict,StandardFonts,rgb} from 'pdf-lib';
import {createSignedSafetyPdf} from '../src/safety-pdf.js';
const font=fs.readFileSync(new URL('../assets/DejaVuSans.ttf',import.meta.url)),image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';

for(const layout of ['lf-swms-detected-v1','lf-swms-v1'])test(layout+' replaces preprinted card labels without sharing mutable page resources',async()=>{
 const original=await PDFDocument.create(),printedFont=await original.embedFont(StandardFonts.Helvetica);
 for(let i=0;i<2;i++){const page=original.addPage([792,612]);page.drawRectangle({x:240,y:376,width:90,height:36,color:rgb(.85,.85,.85)});page.drawText('Construction Card',{x:243,y:403,size:6.5,font:printedFont});}
 const bytes=await original.save(),before=Buffer.from(bytes),columns={name:[50,90],role:[140,100],type:[240,90],class:[330,90],number:[420,90],date:[510,80],signature:[590,140]};
 const signoff=layout==='lf-swms-v1'?{layout,firstPage:1,continuationPage:2}:{layout,pages:[{page:1,width:792,height:612,columns,rows:[{top:200,height:36,licenceRows:[{top:200,height:12},{top:212,height:12},{top:224,height:12}]}]}]};
 const count=layout==='lf-swms-v1'?20:3,acks=Array.from({length:count},(_,i)=>({name:'Worker '+i,details:{licenceDescription:i%2?'CONSTRUCTION INDUCTION CARD':'White Card',licenceNumber:'WC-'+i},signature:{image,at:'2026-10-23T00:00:00Z'}})),snapshot=JSON.stringify(acks);
 const exported=await createSignedSafetyPdf(bytes,{title:'Profile names',label:'Rev 1',fileHash:'a'.repeat(64),signoff},acks,font),signed=await PDFDocument.load(exported);
 assert.equal(JSON.stringify(acks),snapshot);assert.deepEqual(Buffer.from(bytes),before);assert.equal(signed.getPageCount(),layout==='lf-swms-v1'?3:4);
 let masks=0;
 for(const page of signed.getPages())for(const [,ref] of page.node.Resources().lookup(PDFName.of('XObject'),PDFDict)?.entries()||[]){
  const object=signed.context.lookup(ref);if(object.dict?.get(PDFName.of('Subtype'))?.toString()!=='/Form')continue;masks++;
  const bbox=object.dict.lookup(PDFName.of('BBox')).asArray().map(v=>v.asNumber());assert.ok(bbox[2]-bbox[0]<2,'Background is cropped to the blank cell edge');
  const resources=object.dict.lookup(PDFName.of('Resources'),PDFDict);
  assert.equal(resources.lookupMaybe(PDFName.of('XObject'),PDFDict)?.entries().length||0,0,'Background snapshot must not capture its own form or newly drawn signatures');
 }
 assert.equal(masks,count);assert.ok(exported.length<100000,'Small source pages must not recursively duplicate embedded resources');
});
