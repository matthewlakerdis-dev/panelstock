(function(){
'use strict';
var root=document.getElementById('root');
function esc(v){return String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function page(html){root.innerHTML='<div style="font-family:Arial,sans-serif;max-width:900px;margin:0 auto;padding:24px;color:#1f2937">'+html+'</div>';}
function fail(e){page('<h2>PanelStock</h2><p style="color:#991b1b">Legacy client error</p><pre style="white-space:pre-wrap">'+esc(e&&e.message||e)+'</pre>');}
function boot(){
 if(!window.PanelStock){fail('PanelStock client did not load.');return;}
 page('<h2>PanelStock</h2><p>Connecting…</p>');
 PanelStock.init('https://panelstock-reports.matthewlakerdis.workers.dev').then(function(user){
   if(!user){page('<div style="text-align:center;padding-top:18vh"><h1 style="margin-bottom:8px">PanelStock</h1><p style="color:#64748b">Legacy iPad client is connected.</p><p style="margin-top:24px">Sign-in support is the next compatibility step.</p></div>');return;}
   return PanelStock.snapshot().then(function(data){
     data=data||{};var rows=[];var variants=data.variants||[];var offcuts=data.offcuts||[];
     for(var i=0;i<variants.length;i++){var v=variants[i];if(Number(v.qty)>0)rows.push('<tr><td>Panel</td><td>'+esc(v.color)+'</td><td>'+esc(v.material)+'</td><td>'+esc(v.thickness)+'mm</td><td>'+esc(Math.max(v.width,v.height))+' × '+esc(Math.min(v.width,v.height))+'</td><td><b>'+esc(v.qty)+'</b></td></tr>');}
     for(var j=0;j<offcuts.length;j++){var o=offcuts[j];if(Number(o.qty)>0)rows.push('<tr><td>Offcut</td><td>'+esc(o.color)+'</td><td>'+esc(o.material)+'</td><td>'+esc(o.thickness)+'mm</td><td>'+esc(Math.max(o.width,o.height))+' × '+esc(Math.min(o.width,o.height))+'</td><td><b>'+esc(o.qty)+'</b></td></tr>');}
     page('<h2>PanelStock</h2><p>Signed in as <b>'+esc(user.username)+'</b></p><h3>Stock on Hand</h3><div style="overflow:auto"><table style="width:100%;border-collapse:collapse"><thead><tr><th>Type</th><th>Colour</th><th>Material</th><th>Thickness</th><th>Size</th><th>Qty</th></tr></thead><tbody>'+rows.join('')+'</tbody></table></div>');
     var cells=root.getElementsByTagName('td'),heads=root.getElementsByTagName('th');for(var k=0;k<cells.length;k++)cells[k].style.cssText='padding:10px;border-bottom:1px solid #e5e7eb;text-align:left';for(var h=0;h<heads.length;h++)heads[h].style.cssText='padding:10px;border-bottom:2px solid #cbd5e1;text-align:left';
   });
 }).catch(fail);
}
var c=document.createElement('script');c.src='panelstock-client.legacy.js?v=6';c.onload=boot;c.onerror=function(){fail('Could not load legacy PanelStock client.');};document.body.appendChild(c);
})();
