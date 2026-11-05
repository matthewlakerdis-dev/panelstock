import {createHash} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildAttendancePage} from '../src/attendance-page.js';

export const ATTENDANCE_API_ORIGIN='https://panelstock-reports.matthewlakerdis.workers.dev';

// Keep the web-hosted pages generated from the same UI as the Worker routes.
export function staticAttendancePage(manage=false){
  let html=buildAttendancePage('static-attendance',manage,ATTENDANCE_API_ORIGIN).replaceAll(' nonce="static-attendance"','');
  const hash=source=>"'sha256-"+createHash('sha256').update(source).digest('base64')+"'";
  const script=hash(html.match(/<script>([\s\S]*?)<\/script>/)[1]);
  const style=hash(html.match(/<style>([\s\S]*?)<\/style>/)[1]);
  const policy=`default-src 'none'; script-src ${script}; style-src ${style}; img-src data:; connect-src ${ATTENDANCE_API_ORIGIN}; base-uri 'none'; form-action 'none'`;
  return html.replace('<head>','<head><meta http-equiv="Content-Security-Policy" content="'+policy+'">');
}

export function writeAttendancePages(directory){
  mkdirSync(join(directory,'manage'),{recursive:true});
  writeFileSync(join(directory,'index.html'),staticAttendancePage());
  writeFileSync(join(directory,'manage','index.html'),staticAttendancePage(true));
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2);
  if(args.length!==2||args[0]!=='--output-directory')throw Error('Usage: node scripts/build-attendance.mjs --output-directory <desktop-repo>/sign-in');
  writeAttendancePages(resolve(args[1]));
}
