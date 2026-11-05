import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {compatibleAttendancePage,writeCompatibleAttendancePages} from './build-attendance-compatible.mjs';

export const ATTENDANCE_API_ORIGIN='https://panelstock-reports.matthewlakerdis.workers.dev';

// Keep the web-hosted pages generated from the same UI as the Worker routes.
export function staticAttendancePage(manage=false){
  return compatibleAttendancePage(manage,ATTENDANCE_API_ORIGIN).html;
}

export function writeAttendancePages(directory){
  writeCompatibleAttendancePages(directory,ATTENDANCE_API_ORIGIN);
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2);
  if(args.length!==2||args[0]!=='--output-directory')throw Error('Usage: node scripts/build-attendance.mjs --output-directory <desktop-repo>/sign-in');
  writeAttendancePages(resolve(args[1]));
}
