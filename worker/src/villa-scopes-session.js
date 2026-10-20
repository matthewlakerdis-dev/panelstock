import {requireCondition as check,randomToken,digest} from './security.js';
import {requireAppAccess} from './app-access.js';
import {villaScopeAccess} from './villa-scopes.js';
export function initVillaScopeSessions(store){
 store.sql.exec('CREATE TABLE IF NOT EXISTS villa_scope_tickets (token TEXT PRIMARY KEY,parent_token TEXT NOT NULL,username TEXT NOT NULL,app TEXT NOT NULL,read_only INTEGER NOT NULL,expires INTEGER NOT NULL)');
 store.sql.exec('CREATE TABLE IF NOT EXISTS villa_scope_sessions (token TEXT PRIMARY KEY,parent_token TEXT NOT NULL,read_only INTEGER NOT NULL,expires INTEGER NOT NULL)');
}
export async function createVillaScopeTicket(store,actor,body){
 const app=actor.app||body.app;check(['web','app'].includes(app),'Open Villa Scopes from PanelStock',400);
 requireAppAccess(store.read('users',{})[actor.username],app);check(villaScopeAccess(actor).canView,'Villa scope report access required',403);
 check(['report','manage'].includes(body.view),'Choose the report or management view');const readOnly=body.view==='report';
 check(readOnly||villaScopeAccess(actor).canManage,'Manage villa scopes access required',403);
 store.consumeLimit('villa-ticket:'+actor.username,30);
 const linked=store.sql.exec('SELECT parent_token FROM villa_scope_sessions WHERE token=?',actor.tokenHash).toArray()[0],parent=linked?.parent_token||actor.tokenHash;
 const ticket=randomToken(),hash=await digest(ticket),expiresAt=Date.now()+60000;
 store.sql.exec('DELETE FROM villa_scope_tickets WHERE expires<=?',Date.now());
 store.sql.exec('INSERT INTO villa_scope_tickets(token,parent_token,username,app,read_only,expires) VALUES(?,?,?,?,?,?)',hash,parent,actor.username,app,readOnly?1:0,expiresAt);
 return {ticket,expiresAt};
}
export async function redeemVillaScopeTicket(store,body,ip){
 store.consumeLimit('villa-redeem:'+ip,50);check(typeof body.ticket==='string'&&/^[a-f0-9]{64}$/.test(body.ticket),'Open Villa Scopes again from PanelStock',401);
 const hash=await digest(body.ticket),entry=store.ctx.storage.transactionSync(()=>{const entry=store.sql.exec('SELECT * FROM villa_scope_tickets WHERE token=?',hash).toArray()[0];if(entry)store.sql.exec('DELETE FROM villa_scope_tickets WHERE token=?',hash);return entry;});
 check(entry&&entry.expires>Date.now()&&body.app===entry.app,'Open Villa Scopes again from PanelStock',401);
 const parent=()=>store.sql.exec('SELECT username,expires,app FROM sessions WHERE token=?',entry.parent_token).toArray()[0];
 const current=parent();check(current&&current.expires>Date.now()&&current.username===entry.username&&current.app===entry.app,'PanelStock session ended',401);
 const user=store.read('users',{})[entry.username];check(user&&user.active!==false&&!user.mustChangePin,'PanelStock session ended',401);requireAppAccess(user,entry.app);
 const access=villaScopeAccess({isAdmin:!!user.isAdmin,tasks:store.taskAccess(entry.username,!!user.isAdmin)});check(access.canView&&(entry.read_only||access.canManage),'Villa scopes access changed',403);
 const session=await store.issueSession(entry.username,entry.app),childHash=await digest(session.token),latest=parent();
 check(latest&&latest.expires>Date.now()&&latest.username===entry.username&&latest.app===entry.app,'PanelStock session ended',401);
 session.expiresAt=Math.min(session.expiresAt,latest.expires);store.ctx.storage.transactionSync(()=>{store.sql.exec('UPDATE sessions SET expires=? WHERE token=?',session.expiresAt,childHash);store.sql.exec('DELETE FROM villa_scope_sessions WHERE expires<=?',Date.now());store.sql.exec('INSERT INTO villa_scope_sessions(token,parent_token,read_only,expires) VALUES(?,?,?,?)',childHash,entry.parent_token,entry.read_only,session.expiresAt);});
 return {...session,username:entry.username,readOnly:!!entry.read_only};
}
