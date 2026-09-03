import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('hosted LibreOffice converter is private, bounded and keeps a PDF fallback',async()=>{
  const [server,docker,entrypoint,worker]=await Promise.all([
    readFile(new URL('../../converter/server.py',import.meta.url),'utf8'),
    readFile(new URL('../../converter/Dockerfile',import.meta.url),'utf8'),
    readFile(new URL('../../converter/entrypoint.sh',import.meta.url),'utf8'),
    readFile(new URL('../src/index.js',import.meta.url),'utf8'),
  ]);
  assert.match(server,/hmac\.compare_digest/);
  assert.match(server,/MAX_INPUT = 10 \* 1024 \* 1024/);
  assert.match(server,/ScaleToPagesX = 1/);
  assert.match(server,/TopMargin = 0/);
  assert.match(server,/BottomMargin = 0/);
  assert.match(server,/HeaderIsOn = False/);
  assert.match(docker,/libreoffice-calc/);
  assert.match(entrypoint,/127\.0\.0\.1,port=2002/);
  assert.match(worker,/bytes\|\|buildOrderPdf/);
  assert.match(worker,/AbortSignal\.timeout\(45000\)/);
});
