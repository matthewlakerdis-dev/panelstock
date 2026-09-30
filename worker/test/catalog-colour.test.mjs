import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateRecord} from '../src/inventory.js';
test('catalogue accepts optional six-digit hex colours and rejects invalid CSS',()=>{
 const c={id:'c1',sku:'C1',color:'White',material:'ACP',thickness:3,width:0,height:0};
 for(const colorHex of [undefined,'','#FFFFFF','#a1b2c3'])assert.doesNotThrow(()=>validateRecord('catalog',{...c,colorHex},c.id));
 for(const colorHex of ['red','#fff','112233','#GGGGGG','url(x)',null])assert.throws(()=>validateRecord('catalog',{...c,colorHex},c.id),/hex/);
});
