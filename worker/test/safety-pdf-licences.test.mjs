import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fillDetectedSignoff} from '../src/safety-pdf-detected.js';
import {safetyPdfLicenceRows} from '../src/safety-pdf-licences.js';
import {safetyAcknowledgementContent} from '../src/safety-documents.js';

async function printed(details,needsConstructionCardLabel=true){
 const draws=[],page={getWidth:()=>792,getHeight:()=>612,drawText:(text,options)=>draws.push({text,...options}),drawImage(){}};
 const pdf={getPageCount:()=>1,getPage:()=>page,embedPng:async()=>({width:100,height:30})};
 const font={getCharacterSet:()=>Array.from({length:95},(_,i)=>i+32),widthOfTextAtSize:(text,size)=>text.length*size/2};
 const columns={name:[50,90],role:[140,100],type:[240,90],class:[330,90],number:[420,90],date:[510,80],signature:[590,140]};
 const row={top:200,height:36,needsConstructionCardLabel,licenceRows:[{top:200,height:12},{top:212,height:12},{top:224,height:12}]};
 const ack={name:'Worker',details,signature:{image:'synthetic-test',at:'2026-10-23T00:00:00Z'}};
 const version={id:'version',documentId:'document',fileHash:'original',signoff:{layout:'lf-swms-detected-v1',pages:[{page:1,width:792,height:612,columns,rows:[row]}]}};
 const before=safetyAcknowledgementContent(version,ack);
 await fillDetectedSignoff(pdf,font,version.signoff.pages,[ack]);
 assert.equal(safetyAcknowledgementContent(version,ack),before,'Export must preserve the signed snapshot');
 return draws;
}
const blank={description:'',class:'',number:''};

test('previously signed White Card values print in the first licence slot and keep the remaining licence',async()=>{
 const details=Object.freeze({licenceClass:'',licenceNumber:'',licences:Object.freeze([
  Object.freeze({description:'  White   Card  ',class:'General',number:'WC-OLD'}),
  Object.freeze({description:'Forklift',class:'LF',number:'FL-OLD'})
 ])});
 const draws=await printed(details);
 assert.ok(draws.some(d=>d.text==='Construction Card'&&d.x===243&&d.y===402.75));
 assert.ok(draws.some(d=>d.text==='WC-OLD'&&d.x===423&&d.y===402.5));
 assert.ok(draws.some(d=>d.text==='Forklift'&&d.x===243&&d.y===390.75));
 assert.ok(draws.some(d=>d.text==='FL-OLD'&&d.x===423&&d.y===390.75));
 assert.equal(draws.filter(d=>d.text==='WC-OLD').length,1);
 assert.ok(!draws.some(d=>/white\s+card/i.test(d.text)));
});

test('preprinted construction labels are retained while historical card values move to their first slot',async()=>{
 const draws=await printed({licences:[{description:'White Card',number:'WC-OLD'},blank]},false);
 assert.ok(draws.some(d=>d.text==='WC-OLD'&&d.y===402.5));
 assert.ok(!draws.some(d=>d.text==='Construction Card'));
});

test('explicit construction details and a distinct additional White Card are both retained',async()=>{
 const details={licenceClass:'General',licenceNumber:'CC-1',licences:[{description:'White Card',number:'WC-2'},{description:'Forklift',class:'LF',number:'FL-3'}]};
 const draws=await printed(details);
 assert.ok(draws.some(d=>d.text==='CC-1'&&d.y===402.5));
 assert.ok(draws.some(d=>d.text==='WC-2'&&d.y===390.75));
 assert.ok(draws.some(d=>d.text==='FL-3'&&d.y===378.75));
});

test('blank forms show the first field label without inventing licence values',async()=>{
 const draws=await printed({});
 assert.ok(draws.some(d=>d.text==='Construction Card'));
 assert.ok(draws.filter(d=>d.x===333||d.x===423).every(d=>d.text===''));
});

test('licence arrangement does not mislabel other credentials or replace partial primary details',()=>{
 assert.deepEqual(safetyPdfLicenceRows({licences:[{description:'Forklift',class:'LF',number:'FL-1'},blank]}),[
  {description:'Construction Card',class:'',number:''},{description:'Forklift',class:'LF',number:'FL-1'},blank
 ]);
 const rows=safetyPdfLicenceRows({licenceClass:'General',licences:[{description:'White Card',number:'WC-2'},blank]});
 assert.equal(rows[0].number,'');assert.equal(rows[1].number,'WC-2');
 assert.equal(safetyPdfLicenceRows({qualifications:'Welder training'})[1].description,'Welder training');
});
