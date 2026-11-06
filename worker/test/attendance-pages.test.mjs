import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {parse} from 'acorn';
import {buildAttendancePage} from '../src/attendance-page.js';
import {staticAttendancePage,ATTENDANCE_API_ORIGIN} from '../scripts/build-attendance.mjs';

test('web attendance pages use the production API and matching inline CSP hashes',()=>{
  for(const manage of [false,true]){
    const html=staticAttendancePage(manage),script=html.match(/<script>([\s\S]*?)<\/script>/)[1],style=html.match(/<style>([\s\S]*?)<\/style>/)[1];
    new vm.Script(script);
    parse(script,{ecmaVersion:5,sourceType:'script'});
    for(const source of [script,style])assert.ok(html.includes("'sha256-"+createHash('sha256').update(source).digest('base64')+"'"));
    assert.ok(html.includes('connect-src '+ATTENDANCE_API_ORIGIN));
    assert.ok(script.includes('window.attendanceApiOrigin='+JSON.stringify(ATTENDANCE_API_ORIGIN)+';'));
    assert.ok(script.includes('var API_BASE='+JSON.stringify(ATTENDANCE_API_ORIGIN)));
    assert.match(script,/attendanceLegacyRequest\(API_BASE\+path,/);
    assert.doesNotMatch(html,/nonce=|unsafe-inline|Welcome to PanelStock|attendance-test|Lennox Test|ipadtest|103434|install-code|install-pair/);
    assert.ok(html.includes('alt="Lennox Facades"'));
    if(manage)assert.match(script,/location\.origin\s*\+\s*["']\/sign-in\/#['"]/);
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

test('published sign-in page contains the visitor safety controls and the separate arrival steps',()=>{
  const html=staticAttendancePage(false);
  for(const id of ['action-screen','mode-in','mode-out','role-screen','in-screen','back-to-roles','back-to-actions-role','back-to-actions-out','visitor-safety','visitor-safety-acknowledged','workshop-access-yes','workshop-access-no','ppe-confirmed-yes','ppe-confirmed-no'])assert.ok(html.includes('id="'+id+'"'),id);
  assert.match(html,/I have read and understood the visitor safety instructions provided by my host\./);
  assert.match(html,/Ask your host for the instructions if you have not received them\./);
  assert.match(html,/Speak to your host before entering the workshop\./);
  assert.doesNotMatch(html,/Reason for visit|id="purpose"|host has been notified|entry approved|automatic approval/i);
});
