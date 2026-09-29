import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {DatabaseSync} from 'node:sqlite';
const source=readFileSync(new URL('../src/store.js',import.meta.url),'utf8');
test('CAD migration preserves CNC role/user settings without overwriting CAD overrides',()=>{
 const db=new DatabaseSync(':memory:');
 db.exec('CREATE TABLE role_task_access(role_id TEXT,task_code TEXT,allowed INTEGER,PRIMARY KEY(role_id,task_code));CREATE TABLE user_task_access(username TEXT,task_code TEXT,allowed INTEGER,assigned_by TEXT,updated_at TEXT,PRIMARY KEY(username,task_code));');
 db.exec("INSERT INTO role_task_access VALUES('designer','factory.cnc',1),('blocked','factory.cnc',0),('separate','factory.cnc',1),('separate','factory.cad',0);INSERT INTO user_task_access VALUES('alice','factory.cnc',0,'admin','today');");
 const block=source.slice(source.indexOf("if(!this.read('panel-cad-access-migrated'"),source.indexOf("if(!this.read('qa-settings'"));
 const state={},store={read:(k,f)=>state[k]??f,write:(k,v)=>state[k]=v,ctx:{storage:{transactionSync:fn=>fn()}},sql:{exec:sql=>db.exec(sql)}};
 vm.runInNewContext('(function(){'+block+'}).call(store)',{store});
 assert.equal(db.prepare("SELECT allowed FROM role_task_access WHERE role_id='designer' AND task_code='factory.cad'").get().allowed,1);
 assert.equal(db.prepare("SELECT allowed FROM role_task_access WHERE role_id='blocked' AND task_code='factory.cad'").get().allowed,0);
 assert.equal(db.prepare("SELECT allowed FROM role_task_access WHERE role_id='separate' AND task_code='factory.cad'").get().allowed,0);
 assert.equal(db.prepare("SELECT allowed FROM user_task_access WHERE username='alice' AND task_code='factory.cad'").get().allowed,0);
 db.exec("UPDATE role_task_access SET allowed=0 WHERE role_id='designer' AND task_code='factory.cad'");
 vm.runInNewContext('(function(){'+block+'}).call(store)',{store});
 assert.equal(db.prepare("SELECT allowed FROM role_task_access WHERE role_id='designer' AND task_code='factory.cad'").get().allowed,0);
 db.close();
});
test('project API rejects CNC-only accounts before accessing project data',async()=>{
 const {handleCadProjects}=await import('../src/cad-projects.js');
 const denied=await handleCadProjects({},'/cad/projects','GET',{}, {isAdmin:false,tasks:{'factory.cnc':true,'factory.cad':false}});
 assert.equal(denied.status,403);assert.match(denied.body.error,/Panel CAD/);
});
test('CAD-only accounts can open projects without CNC access',async()=>{
 const {handleCadProjects}=await import('../src/cad-projects.js');
 const store={read:(key,fallback)=>fallback};
 const allowed=await handleCadProjects(store,'/cad/projects','GET',{}, {username:'designer',isAdmin:false,tasks:{'factory.cnc':false,'factory.cad':true}});
 assert.equal(allowed.status,200);assert.equal(allowed.body.ok,true);
});
