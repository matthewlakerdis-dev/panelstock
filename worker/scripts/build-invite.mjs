import {createHash} from 'node:crypto';
import {writeFileSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {buildUserInvitePage} from '../src/user-invite-page.js';
export function brandedInvitePage(){
 const api='https://panelstock-reports.matthewlakerdis.workers.dev';
 let html=buildUserInvitePage('static-invite','https://app.panelstockhq.com,https://web.panelstockhq.com',api+'/invite/accept').replaceAll(' nonce="static-invite"','');
 const hash=text=>"'sha256-"+createHash('sha256').update(text).digest('base64')+"'";
 const script=hash(html.match(/<script>([\s\S]*?)<\/script>/)[1]),style=hash(html.match(/<style>([\s\S]*?)<\/style>/)[1]);
 const policy=`default-src 'none'; script-src ${script}; style-src ${style}; connect-src ${api}; base-uri 'none'; form-action 'none'`;
 return html.replace('<head>','<head><meta http-equiv="Content-Security-Policy" content="'+policy+'">');
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const directory=new URL('../../invite/',import.meta.url);mkdirSync(directory,{recursive:true});writeFileSync(new URL('index.html',directory),brandedInvitePage());
}
