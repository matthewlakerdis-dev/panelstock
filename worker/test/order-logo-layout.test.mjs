import test from 'node:test';
import assert from 'node:assert/strict';
import {enlargeOrderHeaderLogo,ORDER_LOGO_WIDTH_PT} from '../src/order-logo-layout.js';

const emu=12700;
function picture({prefix='xdr:',kind='twoCellAnchor',col=0,row=0,width=60*emu,height=30*emu,left=0,top=0}={}){
 const tag=(name,value)=>'<'+prefix+name+'>'+value+'</'+prefix+name+'>';
 const from=tag('from',tag('col',col)+tag('colOff',0)+tag('row',row)+tag('rowOff',0));
 const size='cx="'+width+'" cy="'+height+'"';
 return '<'+prefix+kind+(kind==='twoCellAnchor'?' editAs="oneCell"':'')+'>'+from+
  (kind==='twoCellAnchor'?tag('to',tag('col',2)+tag('colOff',0)+tag('row',2)+tag('rowOff',0)):'<'+prefix+'ext '+size+'/>')+
  '<'+prefix+'pic><'+prefix+'nvPicPr><'+prefix+'cNvPr id="2" name="Lennox logo"/></'+prefix+'nvPicPr><'+prefix+'blipFill><a:blip r:embed="logo1"/></'+prefix+'blipFill><'+prefix+'spPr><a:xfrm><a:off x="'+left+'" y="'+top+'"/><a:ext '+size+'/></a:xfrm><a:prstGeom prst="rect"/></'+prefix+'spPr></'+prefix+'pic><'+prefix+'clientData/></'+prefix+kind+'>';
}
const dimensions=source=>{const extent=source.match(/<a:ext cx="(\d+)" cy="(\d+)"\/>/);return {width:Number(extent[1]),height:Number(extent[2])};};

for(const prefix of ['','xdr:'])for(const kind of ['twoCellAnchor','oneCellAnchor'])test('larger template logo keeps its position, artwork and aspect ('+prefix+' '+kind+')',()=>{
 const original=picture({prefix,kind}),updated=enlargeOrderHeaderLogo(original),size=dimensions(updated);
 assert.equal(size.width,ORDER_LOGO_WIDTH_PT*emu);assert.equal(size.height,45*emu);
 assert.equal(size.width/size.height,2);
 const from=original.slice(original.indexOf('<'+prefix+'from>'),original.indexOf('</'+prefix+'from>')+('</'+prefix+'from>').length);
 assert.ok(updated.includes(from));assert.ok(updated.includes('<a:blip r:embed="logo1"/>'));assert.ok(updated.includes('<a:off x="0" y="0"/>'));
 assert.ok(updated.startsWith('<'+prefix+'oneCellAnchor>'));assert.ok(updated.endsWith('</'+prefix+'oneCellAnchor>'));
 assert.ok(updated.includes('<'+prefix+'ext cx="'+size.width+'" cy="'+size.height+'"/>'));assert.ok(!updated.includes('<'+prefix+'to>'));assert.ok(!updated.includes('editAs='));
 assert.equal(enlargeOrderHeaderLogo(updated),updated,'an already resized logo is stable');
});

test('logo enlargement respects the header height and text boundaries',()=>{
 for(const values of [{width:60*emu,height:40*emu},{width:50*emu,height:25*emu,left:65*emu,top:24*emu,col:2,row:1}]){
  const size=dimensions(enlargeOrderHeaderLogo(picture(values)));
  assert.ok(size.width>values.width);assert.ok(size.width<=90*emu);assert.ok(size.height<=46*emu);
  assert.ok((values.top||0)+size.height<=62*emu);assert.ok((values.left||0)+size.width<=140*emu);
  assert.ok(Math.abs(size.width/size.height-values.width/values.height)<0.00001);
 }
});

test('body photos, signatures, portrait pictures and already large logos remain untouched',()=>{
 for(const values of [{row:18},{col:8},{width:100*emu,height:50*emu},{width:20*emu,height:40*emu},{top:30*emu},{left:80*emu},{width:0}]){
  const original=picture(values);assert.equal(enlargeOrderHeaderLogo(original),original);
 }
 const withoutTransform=picture().replace(/<a:xfrm>[\s\S]*?<\/a:xfrm>/,'');
 assert.equal(enlargeOrderHeaderLogo(withoutTransform),withoutTransform);
});

test('resizing a header picture does not change other anchors in the drawing',()=>{
 const header=picture(),body=picture({row:20}),source='<xdr:wsDr xmlns:xdr="drawing" xmlns:a="art">'+header+body+'</xdr:wsDr>',updated=enlargeOrderHeaderLogo(source);
 assert.ok(updated.includes(body));assert.equal((updated.match(/Lennox logo/g)||[]).length,2);assert.equal((updated.match(/<xdr:oneCellAnchor>/g)||[]).length,1);assert.equal((updated.match(/<xdr:twoCellAnchor/g)||[]).length,1);
});
