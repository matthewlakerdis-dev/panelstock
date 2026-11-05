import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
import {mkdtemp,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {digest} from '../src/security.js';

test('initialized database restarts without writes; quota preserves valid reads and fails login closed',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'panelstock-quota-'));
 const db=new DatabaseSync(':memory:');
 try{
  const outfile=join(directory,'store.mjs');
  await build({entryPoints:[new URL('../src/store.js',import.meta.url).pathname],outfile,bundle:true,platform:'node',format:'esm',packages:'external',plugins:[{name:'durable-object-test-base',setup(builder){builder.onResolve({filter:/^cloudflare:workers$/},()=>({path:'base',namespace:'stub'}));builder.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:'export class DurableObject { constructor(ctx,env){this.ctx=ctx;this.env=env;} }'}));}}]});
  await symlink(new URL('../node_modules',import.meta.url).pathname,join(directory,'node_modules'),'dir');
  const {InventoryStore}=await import(pathToFileURL(outfile));
  let denyWrites=false,writes=0;const pending=[];
  const sql={exec(query,...params){if(!/^\s*(SELECT|PRAGMA)\b/i.test(query)){writes++;if(denyWrites)throw Error('Exceeded allowed rows written in Durable Objects free tier.');}const statement=db.prepare(query);return {toArray:()=>statement.columns().length?statement.all(...params):(statement.run(...params),[])};}};
  // Execute writes immediately, matching Durable Object SQL cursors.
  const execute=sql.exec;sql.exec=(query,...params)=>{const rows=execute(query,...params).toArray();return {toArray:()=>rows};};
  const ctx={storage:{sql,transactionSync:fn=>fn()},blockConcurrencyWhile:fn=>pending.push(fn())};
  const env={MIGRATION_READY:'false'};
  const first=new InventoryStore(ctx,env);await Promise.all(pending);
  first.write('initialized',true);first.write('users',{admin:{isAdmin:true,active:true,displayName:'Admin'}});first.syncAccessUser('admin',first.read('users').admin);
  const token='a'.repeat(64);sql.exec('INSERT INTO sessions(token,username,expires,app) VALUES(?,?,?,?)',await digest(token),'admin',Date.now()+60000,'');
  const originalWrites=writes;denyWrites=true;
  const restarted=new InventoryStore(ctx,env);await Promise.all(pending);
  assert.equal(writes,originalWrites,'unchanged startup must not attempt writes');
  assert.equal((await restarted.handle('/session','GET',{},'', 'test')).status,401);
  assert.equal((await restarted.handle('/session','GET',{},token,'test')).status,200,'activity logging must not block valid sessions');
  const login=await restarted.handle('/login','POST',{username:'admin',pin:'123456'},'','test');
  assert.equal(login.status,503);assert.equal(login.body.code,'DATABASE_WRITE_QUOTA');
  denyWrites=false;sql.exec("UPDATE access_tasks SET label='outdated' WHERE code=(SELECT code FROM access_tasks LIMIT 1)");
  new InventoryStore(ctx,env);await Promise.all(pending);
  assert.equal(sql.exec("SELECT code FROM access_tasks WHERE label='outdated'").toArray().length,0,'changed task definitions still update');
 }finally{db.close();await rm(directory,{recursive:true,force:true});}
});
