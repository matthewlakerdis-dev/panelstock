import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {safetyProfileDetails} from '../src/safety-profiles.js';

test('White Card fills the construction-card slot and leaves both extra licence rows available',()=>{
 const source={title:'Fabricator',licenses:[{id:'white',type:'  wHiTe   CaRd  ',class:'General',number:'WC-1'},{id:'lift',type:'Forklift',class:'LF',number:'FL-2'},{id:'ewp',type:'Elevated Work Platform',class:'BL',number:'EWP-3'}]},before=structuredClone(source);
 const details=safetyProfileDetails(source);
 assert.equal(details.licenceClass,'General');assert.equal(details.licenceNumber,'WC-1');
 assert.deepEqual(details.licences,[{description:'Forklift',class:'LF',number:'FL-2'},{description:'Elevated Work Platform',class:'BL',number:'EWP-3'}]);
 assert.deepEqual(source,before);assert.deepEqual(safetyProfileDetails(source,['lift','ewp']),details);
 assert.throws(()=>safetyProfileDetails(source,['white','lift']),/no longer/);
});

test('existing construction cards take precedence over White Cards without losing either record',()=>{
 for(const type of ['Construction Card','  CONSTRUCTION   INDUCTION CARD  ']){
  const source={title:'Fabricator',licenses:[{id:'white',type:'White Card',number:'WC-2'},{id:'construction',type,class:'General',number:'CC-1'},{id:'lift',type:'Forklift',class:'LF',number:'FL-3'}]},details=safetyProfileDetails(source);
  assert.equal(details.licenceNumber,'CC-1');assert.deepEqual(details.licences.map(l=>l.number),['WC-2','FL-3']);
 }
});

test('browser licence selection matches the server snapshot for White Card and construction-card profiles',()=>{
 const template=fs.readFileSync(new URL('../templates/toolbox.html',import.meta.url),'utf8'),source=template.match(/^function profileExtraLicences\(u\)\{.*\}$/m)?.[0];
 assert.ok(source,'Browser profile licence helper exists');const browserExtraLicences=vm.runInNewContext('('+source+')');
 const scenarios=[
  [{id:'white',type:' White   CARD ',number:'WC-1'},{id:'lift',type:'Forklift',class:'LF',number:'FL-2'},{id:'ewp',type:'EWP',class:'BL',number:'EWP-3'}],
  [{id:'white',type:'White Card',number:'WC-1'},{id:'construction',type:' construction   induction card ',number:'CC-2'},{id:'lift',type:'Forklift',number:'FL-3'}],
  [{id:'lift',type:'Forklift',number:'FL-1'}],[],
 ];
 for(const licenses of scenarios){
  const user={title:'Fabricator',licenses},before=structuredClone(user),ids=Array.from(browserExtraLicences(user),l=>l.id).slice(0,2);while(ids.length<2)ids.push('');
  assert.deepEqual(safetyProfileDetails(user,ids),safetyProfileDetails(user));assert.deepEqual(user,before);
 }
});
