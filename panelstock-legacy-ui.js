(function(){
'use strict';
var root=document.getElementById('root');
function esc(v){return String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function page(html){root.innerHTML='<div style="font-family:Arial,sans-serif;max-width:900px;margin:0 auto;padding:24px;color:#1f2937">'+html+'</div>';}
function fail(e){page('<h2>PanelStock</h2><p style="color:#991b1b">Legacy client error</p><pre style="white-space:pre-wrap">'+esc(e&&e.message||e)+'</pre>');}

function showLogin(){
 page('<div style="max-width:420px;margin:14vh auto 0"><h1 style="text-align:center">PanelStock</h1><p style="text-align:center;color:#64748b">Sign in</p><form id="legacy-login"><label style="display:block;margin:18px 0 6px">Username</label><input id="legacy-user" autocomplete="username" style="box-sizing:border-box;width:100%;font-size:18px;padding:12px;border:1px solid #cbd5e1;border-radius:8px"><label style="display:block;margin:14px 0 6px">PIN</label><input id="legacy-pin" type="password" inputmode="numeric" autocomplete="current-password" style="box-sizing:border-box;width:100%;font-size:18px;padding:12px;border:1px solid #cbd5e1;border-radius:8px"><button type="submit" style="width:100%;margin-top:20px;padding:13px;border:0;border-radius:8px;background:#0f172a;color:white;font-size:17px;font-weight:bold">Sign in</button><p id="legacy-login-error" style="color:#991b1b"></p></form></div>');
 var form=document.getElementById('legacy-login');form.onsubmit=function(e){e.preventDefault();var username=document.getElementById('legacy-user').value.replace(/^\\s+|\\s+$/g,''),pin=document.getElementById('legacy-pin').value,err=document.getElementById('legacy-login-error');if(!username||!pin){err.innerHTML='Enter username and PIN.';return false;}err.innerHTML='Signing in…';PanelStock.apiFetch('https://panelstock-reports.matthewlakerdis.workers.dev/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:username,pin:pin})}).then(function(response){return response.json().then(function(body){if(!response.ok)throw new Error(body.error||body.message||'Sign in failed.');location.reload();});}).catch(function(error){err.innerHTML=esc(error.message||error);});return false;};
}

function boot(){
 if(!window.PanelStock){fail('PanelStock client did not load.');return;}
 page('<h2>PanelStock</h2><p>Connecting…</p>');
 PanelStock.init('https://panelstock-reports.matthewlakerdis.workers.dev').then(function(user){
   if(!user){showLogin();return;}
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
