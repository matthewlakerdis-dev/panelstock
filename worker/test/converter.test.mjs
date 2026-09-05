import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('hosted LibreOffice converter is private, bounded and keeps a PDF fallback',async()=>{
  const [server,docker,entrypoint,worker,analyser]=await Promise.all([
    readFile(new URL('../../converter/server.py',import.meta.url),'utf8'),
    readFile(new URL('../../converter/Dockerfile',import.meta.url),'utf8'),
    readFile(new URL('../../converter/entrypoint.sh',import.meta.url),'utf8'),
    readFile(new URL('../src/index.js',import.meta.url),'utf8'),
    readFile(new URL('../../converter/cnc_pdf.py',import.meta.url),'utf8'),
  ]);
  assert.match(server,/hmac\.compare_digest/);
  assert.match(server,/MAX_INPUT = 10 \* 1024 \* 1024/);
  assert.match(server,/ScaleToPagesX = 1/);
  assert.match(server,/TopMargin = 0/);
  assert.match(server,/BottomMargin = 0/);
  assert.match(server,/HeaderIsOn = False/);
  assert.match(docker,/libreoffice-calc/);
  assert.match(docker,/fonts-crosextra-carlito/);
  assert.match(entrypoint,/127\.0\.0\.1,port=2002/);
  assert.match(worker,/bytes\|\|buildOrderPdf/);
  assert.match(worker,/AbortSignal\.timeout\(45000\)/);
  assert.match(server,/\/analyse-cnc/);
  assert.match(docker,/pdfplumber==0\.11\.7/);
  assert.match(analyser,/def analyse_cnc_pdf/);
  assert.match(analyser,/"proposedOffcut": _offcut/);
  assert.match(worker,/\/cnc-pdf\/analyse/);
  assert.match(worker,/Admin access required/);
});
