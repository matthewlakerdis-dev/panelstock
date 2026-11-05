// New arrivals in the isolated iPad test use a shorter form. Historical records
// and the production attendance validator remain unchanged.
import {attendanceText as text} from './attendance.js';
import {requireCondition as check} from './security.js';

export function normalizeIos10Visit(body){
  check(['visitor','contractor','employee'].includes(body.type),'Choose visitor, contractor or employee');
  return {
    type:body.type,
    name:text(body.name,'Full name',120,true),
    company:body.type==='employee'?'':text(body.company,'Company',160,true),
    contact:text(body.contact,'Contact',160),
    host:text(body.host,'Person you’re visiting',120,true),
    purpose:''
  };
}
