import fs from 'node:fs';
import path from 'node:path';
import {buildSiteOrders} from '../worker/scripts/site-orders.mjs';
const root=path.resolve(import.meta.dirname,'..'),desktop=path.resolve(process.argv[2]||'../panelstock-desktop'),out=path.join(root,'dist-passkeys-staging');
const api='https://panelstock-reports-staging.matthewlakerdis.workers.dev',production='https://panelstock-reports.matthewlakerdis.workers.dev';
fs.rmSync(out,{recursive:true,force:true});fs.cpSync(path.join(desktop,'dist-production'),out,{recursive:true});fs.rmSync(path.join(out,'CNAME'),{force:true});
const mobile=path.join(out,'mobile');fs.mkdirSync(mobile,{recursive:true});
for(const file of fs.readdirSync(root))if(fs.statSync(path.join(root,file)).isFile()&&/\.(?:html|js|css|png|pdf)$/.test(file))fs.copyFileSync(path.join(root,file),path.join(mobile,file));
for(const dir of ['mobile-orders'])fs.cpSync(path.join(root,dir),path.join(mobile,dir),{recursive:true});
const siteOutput=path.join(root,'worker/dist-site-orders');await buildSiteOrders(siteOutput);fs.cpSync(siteOutput,path.join(out,'site'),{recursive:true});fs.cpSync(siteOutput,path.join(mobile,'site'),{recursive:true});
for(const file of fs.readdirSync(root).filter(file=>/^icon.*\.png$/.test(file)))fs.copyFileSync(path.join(root,file),path.join(out,file));
const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json')));Object.assign(manifest,{name:'PanelStock staging',short_name:'PS Staging',start_url:'/mobile/',scope:'/mobile/'});fs.writeFileSync(path.join(mobile,'manifest.json'),JSON.stringify(manifest));
function rewrite(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
 const file=path.join(dir,entry.name);if(entry.isDirectory()){rewrite(file);continue;}if(!/\.(html|js|css)$/.test(entry.name))continue;
 let source=fs.readFileSync(file,'utf8').replaceAll(production,api).replaceAll('https://cnc.panelstockhq.com',api).replaceAll('https://tv.panelstockhq.com',api);
 // Keep the saved trial code out of staging's active login and profile flows.
 if(entry.name==='passkeys.js')source='/* Passkey trial paused: use username and PIN. */\nwindow.PanelStockPasskeys=undefined;\n';
 if(entry.name.endsWith('.html'))source=source.replace(/<script\b[^>]*\bsrc=["'][^"']*\bpasskeys\.js[^"']*["'][^>]*>\s*<\/script>/gi,'');
 if(entry.name.endsWith('.html')){source=source.replace('<title>','<title>STAGING · ');const app=file.startsWith(mobile+path.sep)?'app':file.startsWith(path.join(out,'site')+path.sep)?'site':'web';source=source.replace('</head>',`<script>window.PanelStockPasskeyApp=${JSON.stringify(app)};</script></head>`);}
 fs.writeFileSync(file,source);
}}
rewrite(out);
const loader=path.join(mobile,'panelstock-client.js');fs.writeFileSync(loader,fs.readFileSync(loader,'utf8').replaceAll("'/panelstock-client.","'panelstock-client."));
fs.writeFileSync(path.join(out,'robots.txt'),'User-agent: *\nDisallow: /\n');fs.writeFileSync(path.join(out,'_headers'),'/*\n  X-Robots-Tag: noindex, nofollow\n  Cache-Control: no-store\n');
const config=JSON.parse(fs.readFileSync(path.join(root,'worker/wrangler.jsonc'),'utf8').replace(/^\s*\/\/.*$/gm,''));
if(config.name!=='panelstock-reports-staging'||config.vars.SITE_ID!=='panelstock-staging-review')throw Error('Refusing a non-staging configuration');
config.vars.ALLOWED_ORIGINS=[...new Set([...(config.vars.ALLOWED_ORIGINS||'').split(','),api])].join(',');config.vars.PASSKEY_STAGING_ORIGIN=api;config.vars.PASSKEYS_ENABLED='false';config.vars.EMAIL_ENABLED='false';config.vars.MIGRATION_READY='false';delete config.triggers;delete config.routes;config.workers_dev=true;config.assets={directory:'../dist-passkeys-staging',binding:'ASSETS',not_found_handling:'none'};
fs.writeFileSync(path.join(root,'worker/wrangler.passkeys-staging.json'),JSON.stringify(config,null,2));
for(const file of ['index.html','passkeys.js','mobile/index.html','mobile/site/passkeys.js','site/index.html','site/app.js','site/app.legacy.js','site/passkeys.js'])if(!fs.existsSync(path.join(out,file)))throw Error('Missing staging asset '+file);
for(const file of ['index.html','mobile/panelstock-app.modern.js','site/app.js'])if(fs.readFileSync(path.join(out,file),'utf8').includes(production))throw Error('Staging still points to the production API: '+file);
for(const file of ['index.html','mobile/index.html','mobile/mobile-orders/index.html','site/index.html','mobile/site/index.html'])if(/<script\b[^>]*\bsrc=["'][^"']*\bpasskeys\.js/i.test(fs.readFileSync(path.join(out,file),'utf8')))throw Error('Passkey trial still loaded: '+file);
console.log('Packaged Web, Mobile and Site with the passkey trial paused; username and PIN remain available.');
