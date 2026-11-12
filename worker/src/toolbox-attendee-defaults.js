import {requireCondition as check,digest} from './security.js';

const defaultsKey=username=>'toolbox:attendee-defaults:'+username;
const mutationKey=id=>'toolbox:attendee-defaults-mutation:'+id;
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const currentDefaults=(store,username)=>store.read(defaultsKey(username),{usernames:[],revision:0});
// Match /toolbox/users, including active accounts without Toolbox task access.
const eligible=(users,username)=>Object.hasOwn(users,username)&&users[username].active!==false;

export function toolboxAttendeeDefaults(store,actor){
 const saved=currentDefaults(store,actor.username),users=store.read('users',{});
 // Directory changes affect future talks without rewriting a saved preference.
 return {...saved,usernames:saved.usernames.filter(username=>eligible(users,username))};
}

export async function saveToolboxAttendeeDefaults(store,body,actor){
 check(body&&Array.isArray(body.usernames)&&body.usernames.length<=60,'Choose up to 60 default attendees');
 const usernames=[...body.usernames],expectedRevision=body.expectedRevision;
 check(usernames.every(username=>typeof username==='string'&&username.length>0&&username.length<=80),'Choose valid PanelStock users');
 check(new Set(usernames).size===usernames.length,'Choose each default attendee once');
 check(Number.isSafeInteger(expectedRevision)&&expectedRevision>=0,'Default team revision is required');
 check(uuid(body.mutationId),'Mutation identifier is required');
 const hash=await digest(JSON.stringify({usernames,expectedRevision}));
 return store.ctx.storage.transactionSync(()=>{
  const duplicate=store.read(mutationKey(body.mutationId));
  if(duplicate){
   check(duplicate.username===actor.username&&duplicate.hash===hash,'Mutation identifier reused with different data',409);
   // Return the original response even if the team or directory changed later.
   return {defaults:duplicate.defaults,duplicate:true};
  }
  const previous=currentDefaults(store,actor.username);
  check(expectedRevision===previous.revision,'Default team changed. Reload it before saving.',409);
  const users=store.read('users',{});
  check(usernames.every(username=>eligible(users,username)),'Choose active PanelStock users for the default team');
  const saved={usernames,revision:previous.revision+1,updatedAt:new Date().toISOString(),updatedBy:actor.username};
  store.write(defaultsKey(actor.username),saved);
  store.write(mutationKey(body.mutationId),{username:actor.username,hash,defaults:saved});
  store.audit(actor.username,'toolbox-attendee-defaults-saved',{revision:saved.revision,attendeeCount:usernames.length});
  return {defaults:saved};
 });
}
