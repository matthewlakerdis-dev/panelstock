import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function fixture(){
 const elements=new Map();let root,reader,blocked=false,destroyed=false,rejectRender,failPage=0;
 function element(tag='div'){const el={tag,style:{},dataset:{},children:[],clientWidth:600,offsetHeight:64,textContent:'',disabled:false,addEventListener(){},removeEventListener(){},setAttribute(){},getContext(){return {}},append(...nodes){for(const n of nodes){n.parentElement=this;this.children.push(n)}},replaceChildren(...nodes){this.children=[];for(const n of nodes)n.tag==='fragment'?this.append(...n.children):this.append(n)},getBoundingClientRect(){if(this===root)return {top:0,bottom:800};if(this.dataset.page){let top=200-root.scrollTop;for(const sibling of this.parentElement?.children||[]){if(sibling===this)break;top+=parseFloat(sibling.style.height)+16}return {top,bottom:top+parseFloat(this.style.height)}}return {top:0,bottom:800}}};return el}
 const doc={numPages:30,async getPage(n){return {getViewport:({scale})=>({width:600*scale,height:(n%2?800:460)*scale}),cleanup(){},render(){if(n===failPage){failPage=0;return {promise:Promise.reject(Error('Decoder failed')),cancel(){}}}if(blocked){let reject;const promise=new Promise((resolve,r)=>{reject=r;rejectRender=r});return {promise,cancel(){reject(Object.assign(Error('Cancelled'),{name:'RenderingCancelledException'}))}}}return {promise:Promise.resolve(),cancel(){}}}}}};
 const task={promise:Promise.resolve(doc),destroy(){destroyed=true;return Promise.resolve()}};
 const context=vm.createContext({Map,Math,Number,Uint8Array,requestAnimationFrame:()=>1,cancelAnimationFrame(){},document:{getElementById(id){if(!elements.has(id))elements.set(id,element());return elements.get(id)},createElement:element,createDocumentFragment:()=>element('fragment')},window:{devicePixelRatio:3,addEventListener(){},removeEventListener(){}}});
 vm.runInContext(fs.readFileSync(new URL('../templates/safety-pdf-reader.js',import.meta.url),'utf8'),context);context.library={getDocument:()=>task};vm.runInContext('pdfReaderLibrary=async()=>library',context);
 const Reader=vm.runInContext('SafetyPdfReader',context);reader=new Reader('sign');root=reader.root;let scroll=0;Object.defineProperty(root,'scrollTop',{get:()=>scroll,set:v=>scroll=Math.max(0,v)});
 return {reader,elements,block(){blocked=true},fail(n){failPage=n},get destroyed(){return destroyed},get rendering(){return !!rejectRender}};
}

test('continuous PDFs preserve every page slot while scrolling evicts distant canvases and zoom keeps the current page',async()=>{
 const f=fixture(),r=f.reader;assert.equal(await r.load(new Uint8Array([1])),true);assert.equal(r.slots.length,30);const first=r.canvases.get(1);assert.ok(first);assert.ok(r.canvases.size<=4);
 await r.change(25);assert.equal(r.page,25);assert.ok(r.canvases.has(25));assert.equal(first.width,0);assert.equal(first.height,0);assert.equal(r.slots.length,30);assert.ok(r.canvases.size<=4);
 await r.change(25,2);assert.equal(r.page,25);assert.equal(r.zoom,2);for(const c of r.canvases.values())assert.ok(c.width*c.height<=3000000);await r.change(1);assert.equal(r.page,1);assert.ok(r.canvases.has(1));
 r.close();assert.equal(f.destroyed,true);assert.equal(r.canvases.size,0);assert.equal(r.slots.length,0);assert.equal(r.element('').children.length,0);
});

test('closing a PDF during rendering cancels work and cannot append pages after the reader is dismissed',async()=>{
 const f=fixture(),r=f.reader;await r.load(new Uint8Array([1]));f.block();const pending=r.change(25);for(let i=0;i<10&&!f.rendering;i++)await Promise.resolve();assert.equal(f.rendering,true);r.close();await pending;assert.equal(r.element('').children.length,0);assert.equal(r.canvases.size,0);assert.equal(r.ready,false);assert.equal(f.destroyed,true);
});

test('a later page decoder failure shows an error and can be retried without losing document position',async()=>{
 const f=fixture(),r=f.reader;await r.load(new Uint8Array([1]));f.fail(25);await r.change(25);assert.equal(r.page,25);assert.equal(r.canvases.has(25),false);assert.match(r.slots[24].el.textContent,/could not load/);await r.change(1);await r.change(25);assert.equal(r.canvases.has(25),true);assert.equal(r.slots.length,30);r.close();
});
