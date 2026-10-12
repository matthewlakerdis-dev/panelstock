import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {requireCondition as check} from '../src/security.js';
const source=fs.readFileSync(new URL('../src/store.js',import.meta.url),'utf8');
const methods=source.slice(source.indexOf('  orderProjectKey(project)'),source.indexOf('  deleteProject(id,actor)'));
const projectTitleCase=source.match(/const projectTitleCase=[^\r\n]+/)[0];
const ProjectStore=vm.runInNewContext(`${projectTitleCase}\n(class ProjectStore {${methods}})`,{crypto:webcrypto,check,ok:(body,status=200)=>({body,status})});
function store(seed={}){
 const data=new Map(Object.entries(seed)),store=new ProjectStore();
 Object.assign(store,{read:(key,fallback)=>structuredClone(data.has(key)?data.get(key):fallback),write:(key,value)=>data.set(key,structuredClone(value)),audit:()=>{},ctx:{storage:{transactionSync:fn=>fn()}}});
 return store;
}
const actor={username:'admin'};
test('project numbers are optional text, preserved by old clients and can be edited or cleared',()=>{
 const s=store(),added=s.addOrderProject({name:'Test project',projectNumber:' 00123-A '},actor);
 assert.equal(added.status,201);const id=added.body.project.id;
 assert.equal(s.ensureProjectRecords()[0].projectNumber,'00123-A');
 assert.equal(s.updateProject(id,{name:'Test project',active:false},actor).body.project.projectNumber,'00123-A');
 assert.equal(s.updateProject(id,{name:'Test project',active:true,projectNumber:' 00007 '},actor).body.project.projectNumber,'00007');
 assert.throws(()=>s.updateProject(id,{name:'Test project',projectNumber:'X'.repeat(51)},actor),/50 characters/);
 assert.equal(s.ensureProjectRecords()[0].projectNumber,'00007');
 assert.equal(s.updateProject(id,{name:'Test project',projectNumber:''},actor).body.project.projectNumber,'');
 assert.equal(s.addOrderProject({name:'Unnumbered project'},actor).body.project.projectNumber,'');
 assert.throws(()=>s.addOrderProject({name:'Too long',projectNumber:'X'.repeat(51)},actor),/50 characters/);
});
test('existing and migrated project records get a blank number without losing details',()=>{
 const s=store({projects:[{id:'existing',name:'Existing',address:'1 Road',notes:'Gate 2',active:true}],'order-projects':['Legacy']});
 const records=s.ensureProjectRecords();
 assert.equal(records.find(p=>p.id==='existing').projectNumber,'');
 assert.equal(records.find(p=>p.id==='existing').address,'1 Road');
 assert.equal(records.find(p=>p.name==='Legacy').projectNumber,'');
 assert.equal(s.read('projects',[]).length,2);
});

test('project names preserve casing while duplicate matching ignores case and whitespace',()=>{
 const s=store(),added=s.addOrderProject({name:'  ACME HQ   iQ  '},actor),id=added.body.project.id;
 assert.equal(added.body.project.name,'ACME HQ iQ');
 assert.throws(()=>s.addOrderProject({name:'acme hq iq'},actor),/already exists/);
 s.write('orders',[{id:'order',projectId:id,project:'ACME HQ iQ'}]);
 s.write('schedule',[{id:'schedule',projectId:id,project:'ACME HQ iQ'}]);
 const renamed=s.updateProject(id,{name:'McDONALD eBay HQ'},actor);
 assert.equal(renamed.body.project.name,'McDONALD eBay HQ');
 assert.equal(s.read('orders',[])[0].project,'McDONALD eBay HQ');
 assert.equal(s.read('schedule',[])[0].project,'McDONALD eBay HQ');
 const legacy=store({'order-projects':['NAB HQ iQ']});
 assert.equal(legacy.ensureProjectRecords()[0].name,'NAB HQ iQ');
});
