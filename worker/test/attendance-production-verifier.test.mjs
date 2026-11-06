import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {compatibleAttendancePage} from '../scripts/build-attendance-compatible.mjs';
import {validateAttendancePage,verifyAttendanceSurface} from '../scripts/verify-attendance-production.mjs';

for(const surface of ['worker','web'])test('production '+surface+' verifier performs only public GET checks',async()=>{
  const worker=surface==='worker',api=worker?'':'https://panelstock-reports.matthewlakerdis.workers.dev';
  const pages=[compatibleAttendancePage(false,api),compatibleAttendancePage(true,api)];
  const icon=await readFile(new URL('../../icon-adaptive-v4-192.png',import.meta.url));
  const calls=[];
  const fetcher=async(url,options)=>{
    calls.push({url,options});
    const path=new URL(url).pathname;
    if(path==='/session')return Response.json({error:'Please log in'},{status:401});
    if(path.endsWith('.png'))return new Response(icon,{headers:{'Content-Type':'image/png'}});
    const page=pages[path.includes('manage')?1:0];
    return new Response(page.html,{headers:{'Content-Type':'text/html',...(worker?{'X-Attendance-Environment':'production','Cache-Control':'no-store','Referrer-Policy':'no-referrer','Content-Security-Policy':page.policy+"; frame-ancestors 'none'"}:{})}});
  };
  await verifyAttendanceSurface(surface,{fetcher,attempts:1,expectedPages:pages.map(page=>page.html),expectedIcon:icon});
  assert.equal(calls.length,worker?6:5);
  for(const {url,options} of calls){
    assert.equal(new URL(url).origin,worker?'https://panelstock-reports.matthewlakerdis.workers.dev':'https://web.panelstockhq.com');
    assert.equal(options.method,'GET');assert.equal(options.body,undefined);assert.equal(options.headers.Authorization,undefined);
    assert.ok(!/\/login|\/attendance\//.test(new URL(url).pathname),'Verifier must never authenticate, pair or change attendance');
  }
});

test('production page verifier rejects stale markup, test account notices and incorrect script hashes',()=>{
  const html=compatibleAttendancePage(false).html;
  assert.throws(()=>validateAttendancePage(html.replace('name="company" required','name="company"'),{worker:true}),/Missing required field/);
  assert.throws(()=>validateAttendancePage(html.replace('<body>','<body><p>Demo administrator: ipadtest</p>'),{worker:true}),/Demo administrator/);
  assert.throws(()=>validateAttendancePage(html.replace('window.attendanceApiOrigin=','window.attendanceApiOrigin ='),{worker:true}),/script hash/);
  assert.throws(()=>validateAttendancePage(html.replace('id="action-screen"','id="removed-start"'),{worker:true}),/wizard/i);
  assert.throws(()=>validateAttendancePage(html.replace('id="visitor-safety-acknowledged"','id="removed-ack"'),{worker:true}),/acknowledgement/i);
  assert.throws(()=>validateAttendancePage(html.replace('id="emergency-procedure-understood-no"','id="removed-emergency-answer"'),{worker:true}),/Required safety choice missing/i);
  assert.throws(()=>validateAttendancePage(html.replace('id="site-induction-completed-yes"','id="removed-induction-answer"'),{worker:true}),/Conditional contractor choice missing/i);
});
