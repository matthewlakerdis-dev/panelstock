import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../src/store.js',import.meta.url),'utf8');
const methods=['dispatchUserOptions','dispatchDriverOptions','validateDispatchDrivers'].map(name=>source.split('\n').find(line=>line.trim().startsWith(name+'('))).join('\n');
const Store=vm.runInNewContext(`(class {${methods}})`,{check:(ok,message)=>{if(!ok)throw Error(message);}});
const store=new Store();
store.read=()=>({alex:{displayName:'Alex',active:true},sam:{active:true},inactive:{active:false}});
store.qaSettings=()=>({dispatchDrivers:['alex','inactive']});
test('driver options include only configured active users',()=>{
 assert.deepEqual(JSON.parse(JSON.stringify(store.dispatchDriverOptions())),[{username:'alex',displayName:'Alex'}]);
});
test('driver configuration rejects missing, inactive and duplicate users',()=>{
 for(const value of [['missing'],['inactive'],['alex','alex'],'alex'])assert.throws(()=>store.validateDispatchDrivers(value));
 assert.deepEqual(store.validateDispatchDrivers(['alex','sam']),['alex','sam']);
 assert.deepEqual(store.validateDispatchDrivers([]),[]);
});
