import {test} from 'node:test';
import assert from 'node:assert/strict';
import {digest} from '../src/security.js';
import {manageVillaReportLink,readVillaReport} from '../src/villa-scopes-report.js';

const actor={username:'manager',app:'web',tasks:{'site.scopes.manage':true}};
const token='a'.repeat(64),replacement='b'.repeat(64);
function store(){const docs=new Map([['users',{manager:{active:true}}]]);return {read:(k,f=null)=>structuredClone(docs.has(k)?docs.get(k):f),write:(k,v)=>docs.set(k,structuredClone(v)),audit(){},consumeLimit(){},taskAccess:()=>({'site.scopes.manage':true}),ctx:{storage:{transactionSync:fn=>fn()}}};}
test('private reports start disabled; only a managing session may create or revoke a link',async()=>{
 const s=store();assert.equal((await manageVillaReportLink(s,'GET',{},actor)).body.enabled,false);
 await assert.rejects(readVillaReport(s,'GET',token,'test'),{status:401});
 for(const viewer of [{username:'viewer',tasks:{'site.scopes.view':true}},{...actor,isAdmin:true,villaScopesReadOnly:true}])await assert.rejects(manageVillaReportLink(s,'POST',{action:'create',token,expectedRevision:0},viewer),{status:403});
});
test('only a digest is stored or returned; retries preserve the same link and stale replacement is rejected',async()=>{
 const s=store(),packet={action:'create',token,expectedRevision:0};
 const first=await manageVillaReportLink(s,'POST',packet,actor);assert.equal(first.body.revision,1);assert.equal(JSON.stringify(first).includes(token),false);
 assert.equal(s.read('villa-scopes:report-link').tokenHash,await digest(token));assert.equal(JSON.stringify(s.read('villa-scopes:report-link')).includes(token),false);
 assert.equal((await manageVillaReportLink(s,'POST',packet,actor)).body.revision,1);
 await assert.rejects(manageVillaReportLink(s,'POST',{...packet,token:replacement},actor),{status:409});
 await manageVillaReportLink(s,'POST',{...packet,token:replacement,expectedRevision:1},actor);
 await assert.rejects(readVillaReport(s,'GET',token,'test'),{status:401});assert.equal((await readVillaReport(s,'GET',replacement,'test')).body.canManage,false);
});
test('private report responses omit user and session metadata; revocation and creator access changes stop reads',async()=>{
 const s=store();await manageVillaReportLink(s,'POST',{action:'create',token,expectedRevision:0},actor);
 const data=(await readVillaReport(s,'GET',token,'test')).body;assert.deepEqual(data.records,[]);assert.equal(data.username,undefined);assert.equal(data.token,undefined);assert.equal(data.report,true);
 await assert.rejects(readVillaReport(s,'POST',token,'test'),{status:405});
 s.taskAccess=()=>({});await assert.rejects(readVillaReport(s,'GET',token,'test'),{status:401});s.taskAccess=()=>({'site.scopes.manage':true});
 s.write('users',{manager:{active:false}});await assert.rejects(readVillaReport(s,'GET',token,'test'),{status:401});s.write('users',{manager:{active:true}});
 await manageVillaReportLink(s,'POST',{action:'revoke',expectedRevision:1},actor);await assert.rejects(readVillaReport(s,'GET',token,'test'),{status:401});assert.equal(s.read('villa-scopes:report-link').tokenHash,null);
});
