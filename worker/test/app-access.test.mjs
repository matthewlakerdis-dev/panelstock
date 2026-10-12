import {test} from 'node:test';
import assert from 'node:assert/strict';
import {appAccess,normalizeAppAccess,requireAppAccess,originApp} from '../src/app-access.js';

test('existing users retain app access; app permissions do not come from roles',()=>{
 assert.deepEqual(appAccess({roleIds:['site-only']}),{web:true,app:true,site:true});
 assert.deepEqual(appAccess({appAccess:{web:false,app:false,site:true}}),{web:false,app:false,site:true});
 assert.deepEqual(appAccess({isAdmin:true,appAccess:{web:false,app:false,site:false}}),{web:true,app:true,site:true});
 assert.throws(()=>normalizeAppAccess({web:'false'}),/Invalid app access/);
 assert.throws(()=>normalizeAppAccess({other:true}),/Invalid app access/);
 assert.throws(()=>requireAppAccess({appAccess:{web:false}},'web'),error=>error.status===403&&error.code==='APP_ACCESS_DENIED'&&/Web app.*administrator/.test(error.message));
 assert.throws(()=>requireAppAccess({appAccess:{web:false}},''),error=>error.code==='APP_ACCESS_DENIED');
 assert.doesNotThrow(()=>requireAppAccess({appAccess:{web:false}},'site'));
});

test('known app origins identify their app without trusting the app field',()=>{
 for(const [origin,expected] of [['https://web.panelstockhq.com','web'],['https://app.panelstockhq.com','app'],['https://site.panelstockhq.com','site'],['http://localhost:8090','web'],['http://localhost:8091','app'],['http://localhost:8092','site']])assert.equal(originApp(origin),expected);
 assert.equal(originApp('https://app.panelstockhq.com.evil.test'),'');
});
