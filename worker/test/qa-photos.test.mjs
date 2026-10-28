import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {requireCondition as check} from '../src/security.js';
import {qaInspectionEvidence} from '../src/qa-photos.js';

// Use the same existing image validation as support tickets and single-photo QA.
const source=fs.readFileSync(new URL('../src/store.js',import.meta.url),'utf8');
const declaration=source.slice(source.indexOf('const supportPhoto='),source.indexOf('function normalizeEmployeeProfile'));
const validatePhoto=new Function('check',`${declaration}return supportPhoto;`)(check);
const png='data:image/png;base64,aGVsbG8=',jpeg='data:image/jpeg;base64,d29ybGQ=',webp='data:image/webp;base64,dGhpcmQ=';
const evidence=(body,isGate=true)=>qaInspectionEvidence(body,isGate,validatePhoto);
const sizedPhoto=size=>png.slice(0,png.indexOf(',')+1)+'A'.repeat(size-png.indexOf(',')-1);

test('Gate evidence accepts every selected image and keeps the first photo for older clients',()=>{
  const body={photos:[png,jpeg,webp]},result=evidence(body);
  assert.deepEqual(result,{photo:png,photos:[png,jpeg,webp]});
  body.photos[0]=webp;body.photos.push(png);assert.deepEqual(result.photos,[png,jpeg,webp]);
  assert.deepEqual(evidence({photo:png,photos:[png,jpeg]}),{photo:png,photos:[png,jpeg]});
  assert.deepEqual(evidence({photo:'',photos:[png,jpeg]}),{photo:png,photos:[png,jpeg]});
});

test('legacy single Gate photos are preserved and an explicitly empty list means no selected photos',()=>{
  assert.deepEqual(evidence({photo:png}),{photo:png,photos:[png]});
  assert.deepEqual(evidence({}),{photo:'',photos:[]});
  assert.deepEqual(evidence({photos:[]}),{photo:'',photos:[]});
  assert.throws(()=>evidence({photo:png,photos:[]}),/must match/);
});

test('malformed arrays, empty entries, invalid images and conflicting legacy images are rejected',()=>{
  for(const photos of [null,'photo',{},[null],[undefined],[''],[42],[{}],Array(1),['https://example.com/image.jpg'],['data:image/gif;base64,aGVsbG8='],['data:image/png;base64,']]){
    assert.throws(()=>evidence({photos}),error=>error.status===400);
  }
  assert.throws(()=>evidence({photos:[png],photo:'invalid'}),/Attachment must/);
  for(const photo of [null,[],false,0])assert.throws(()=>evidence({photos:[png],photo}),/must be image text/);
  assert.throws(()=>evidence({photos:[png],photo:jpeg}),/must match/);
});

test('photo count, individual encoded size and combined encoded size limits never truncate evidence',()=>{
  assert.equal(evidence({photos:Array(10).fill(png)}).photos.length,10);
  assert.throws(()=>evidence({photos:Array(11).fill(png)}),/no more than 10/);
  const atLimit=sizedPhoto(1500000);assert.equal(evidence({photos:[atLimit]}).photos[0].length,1500000);
  assert.throws(()=>evidence({photos:[sizedPhoto(1500001)]}),/Attachment must/);
  assert.equal(evidence({photos:Array(4).fill(atLimit)}).photos.reduce((sum,value)=>sum+value.length,0),6000000);
  assert.throws(()=>evidence({photos:[...Array(4).fill(atLimit),png]}),/total no more than/);
});

test('ordinary QA retains its single-photo contract and rejects additional photo lists',()=>{
  assert.deepEqual(evidence({photo:jpeg},false),{photo:jpeg});
  assert.deepEqual(evidence({photo:jpeg,photos:[]},false),{photo:jpeg});
  assert.deepEqual(evidence({},false),{photo:''});
  for(const photos of [[png],null,{},'photo'])assert.throws(()=>evidence({photos},false),/only available for Gate/);
});
