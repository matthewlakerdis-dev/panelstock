import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {buildAttendancePage} from '../src/attendance-page.js';
import {staticAttendancePage,ATTENDANCE_API_ORIGIN} from '../scripts/build-attendance.mjs';

test('web attendance pages use the production API and matching inline CSP hashes',()=>{
  for(const manage of [false,true]){
    const html=staticAttendancePage(manage),script=html.match(/<script>([\s\S]*?)<\/script>/)[1],style=html.match(/<style>([\s\S]*?)<\/style>/)[1];
    new vm.Script(script);
    for(const source of [script,style])assert.ok(html.includes("'sha256-"+createHash('sha256').update(source).digest('base64')+"'"));
    assert.ok(html.includes('connect-src '+ATTENDANCE_API_ORIGIN));
    assert.ok(script.startsWith('const API_BASE='+JSON.stringify(ATTENDANCE_API_ORIGIN)+';'));
    assert.ok(script.includes('fetch(API_BASE+path,'));
    assert.doesNotMatch(html,/nonce=|unsafe-inline|Welcome to PanelStock/);
    assert.ok(html.includes('alt="Lennox Facades"'));
    if(manage)assert.ok(script.includes("location.origin+'/sign-in/#'"));
  }
});

test('Worker pages retain same-origin API calls and safely encode configured API origins',()=>{
  for(const manage of [false,true]){
    const html=buildAttendancePage('nonce',manage),script=html.match(/<script nonce="nonce">([\s\S]*?)<\/script>/)[1];
    assert.ok(script.startsWith('const API_BASE="";'));
    new vm.Script(script);
  }
  const origin='https://example.test/</script><img src=x>',html=buildAttendancePage('nonce',false,origin);
  const script=html.match(/<script nonce="nonce">([\s\S]*?)<\/script>/)[1];
  assert.equal(JSON.parse(script.match(/^const API_BASE=(.*?);/)[1]),origin);
  assert.equal((html.match(/<script/g)||[]).length,1);
  new vm.Script(script);
});
