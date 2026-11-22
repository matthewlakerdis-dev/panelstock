import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
const source=fs.readFileSync(new URL('../src/store.js',import.meta.url),'utf8');
const write=source.slice(source.indexOf('  write(key,value) {'),source.indexOf('  audit(',source.indexOf('  write(key,value) {')));
test('ordinary documents preserve Unicode at SQLite chunk boundaries and invalid input cannot erase a saved document',()=>{
 const db=new DatabaseSync(':memory:');
 try{
  db.exec('CREATE TABLE documents(key TEXT,part INTEGER,value TEXT,PRIMARY KEY(key,part))');
  const store=new Function('writeJsonDocument','return ({'+write+'});')(()=>assert.fail('Ordinary document fixture must use its own storage path'));
  store.sql={exec(query,...args){return db.prepare(query).run(...args);}};
  const contentStart=JSON.stringify({notes:''}).indexOf('""')+1;
  const value={notes:'A'.repeat(99999-contentStart)+'😀 café \ud800 END',photos:['qa-r2:v1:'+'a'.repeat(64)+':120']};
  const raw=JSON.stringify(value);assert.equal(raw.charCodeAt(99999),0xd83d);assert.equal(raw.charCodeAt(100000),0xde00);
  store.write('app:photos',value);
  const rows=db.prepare('SELECT value FROM documents WHERE key=? ORDER BY part').all('app:photos');
  assert.equal(rows[0].value.length,99999);assert.ok(rows.every(row=>row.value.length<=100000));assert.equal(rows.map(row=>row.value).join(''),raw);assert.deepEqual(JSON.parse(rows.map(row=>row.value).join('')),value);
  const before=db.prepare('SELECT total_changes() AS n').get().n;assert.throws(()=>store.write('app:photos',undefined),/JSON document/);assert.equal(db.prepare('SELECT total_changes() AS n').get().n,before);assert.deepEqual(db.prepare('SELECT value FROM documents WHERE key=? ORDER BY part').all('app:photos'),rows);
 }finally{db.close();}
});
