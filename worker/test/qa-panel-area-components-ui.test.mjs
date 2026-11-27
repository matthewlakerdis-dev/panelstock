import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {matchRows,candidateState}=require('../../qa-panel-area-import.js');
test('mobile sticker areas target the main record once when an included legacy cap shares its printed ID',()=>{
  const sticker={reference:'P-5',areaM2:1.25,page:1};
  const main={id:'main',kind:'panel',reference:'P-5',project:'College',orderNumber:'BATCH 3',status:'awaiting',panelArea:null};
  for(const extra of [{qaStandaloneRequired:false},{qaAssembly:{role:'cap'}},{qaStandaloneRequired:false,qaAssembly:{role:'cap'}}]){
    const cap={...main,...extra,id:'cap'};
    const [matched]=matchRows([sticker],[main,cap],{project:'College',orderNumber:'BATCH 3'},true);
    assert.equal(matched.item?.id,'main');assert.equal(matched.state,'ready');assert.equal(matched.ambiguous,undefined);
    assert.equal(candidateState(sticker,cap,true).state,'blocked');
    const [onlyCap]=matchRows([sticker],[cap],{project:'College',orderNumber:'BATCH 3'},true);assert.equal(onlyCap.state,'blocked');
  }
});
