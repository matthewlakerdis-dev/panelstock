import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..'),desktop=path.resolve(process.argv[2]||'../panelstock-desktop'),out=path.join(root,'dist-staging');
const api='https://panelstock-reports-staging.matthewlakerdis.workers.dev';
fs.rmSync(out,{recursive:true,force:true});
fs.cpSync(path.join(desktop,'dist-production'),out,{recursive:true});
fs.rmSync(path.join(out,'CNAME'),{force:true});
const mobile=path.join(out,'mobile');fs.mkdirSync(mobile,{recursive:true});
for(const file of fs.readdirSync(root)){
 if(fs.statSync(path.join(root,file)).isFile()&&/\.(?:html|js|css|png|pdf)$/.test(file))fs.copyFileSync(path.join(root,file),path.join(mobile,file));
}
const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));manifest.name='PanelStock staging';manifest.short_name='PS Staging';manifest.start_url='/mobile/';manifest.scope='/mobile/';fs.writeFileSync(path.join(mobile,'manifest.json'),JSON.stringify(manifest));
const production='https://panelstock-reports.matthewlakerdis.workers.dev';
function rewrite(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
 const file=path.join(dir,entry.name);if(entry.isDirectory()){rewrite(file);continue;}
 if(!/\.(html|js|css)$/.test(entry.name))continue;
 let text=fs.readFileSync(file,'utf8').replaceAll(production,api).replaceAll('https://cnc.panelstockhq.com',api).replaceAll('https://tv.panelstockhq.com',api);
 if(entry.name.endsWith('.html'))text=text.replace('<title>','<title>STAGING · ');
 fs.writeFileSync(file,text);
}}
rewrite(out);
fs.writeFileSync(path.join(out,'robots.txt'),'User-agent: *\nDisallow: /\n');
fs.writeFileSync(path.join(out,'_headers'),'/*\n  X-Robots-Tag: noindex, nofollow\n  Cache-Control: no-store\n');
for(const file of ['index.html','mobile/panelstock-app.modern.js','cad/cad.js']){
 const source=fs.readFileSync(path.join(out,file),'utf8');if(source.includes(production)||!source.includes(api))throw Error('Staging API configuration invalid: '+file);
}
for(const file of ['workshop-stock.js','workshop-stock.css','mobile/workshop-stock.js','mobile/workshop-stock.css'])if(!fs.existsSync(path.join(out,file)))throw Error('Missing staging asset '+file);
console.log('Isolated desktop and mobile staging assets built.');
// Host the preview on the existing staging Worker; no Pages permissions required.
const workerConfig=JSON.parse(fs.readFileSync(path.join(root,'worker/wrangler.jsonc'),'utf8').replace(/^\s*\/\/.*$/gm,''));
workerConfig.assets={directory:'../dist-staging',binding:'ASSETS',not_found_handling:'none'};
fs.writeFileSync(path.join(root,'worker/wrangler.workshop-staging.json'),JSON.stringify(workerConfig,null,2));
