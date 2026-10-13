import {requireCondition as check,randomToken,digest} from './security.js';
import {requireAppAccess} from './app-access.js';
export async function createToolboxTicket(store,actor,appHint){
 const app=actor.app||appHint;check(['app','web'].includes(app),'Open Toolbox Talks from PanelStock.',400);requireAppAccess(store.read('users',{})[actor.username],app);
 store.requireTask(actor,'factory.toolbox');store.consumeLimit('toolbox-ticket:'+actor.username,30);
 const link=store.sql.exec('SELECT parent_token FROM toolbox_session_links WHERE token=?',actor.tokenHash).toArray()[0];
 const parent=link?.parent_token||actor.tokenHash;
 const ticket=randomToken(),hash=await digest(ticket),expiresAt=Date.now()+60000;
 store.sql.exec('DELETE FROM toolbox_session_tickets WHERE expires<=?',Date.now());
 store.sql.exec('INSERT INTO toolbox_session_tickets(token,parent_token,username,app,expires) VALUES(?,?,?,?,?)',hash,parent,actor.username,app,expiresAt);
 return {ticket,expiresAt};
}
export async function createSafetySelfTicket(store,actor,appHint){
 const app=actor.app||appHint;check(['app','web'].includes(app),'Open Toolbox Talks from PanelStock.',400);requireAppAccess(store.read('users',{})[actor.username],app);
 store.consumeLimit('toolbox-ticket:'+actor.username,30);
 const link=store.sql.exec('SELECT parent_token FROM toolbox_session_links WHERE token=?',actor.tokenHash).toArray()[0];
 const parent=link?.parent_token||actor.tokenHash;
 const ticket=randomToken(),hash=await digest(ticket),expiresAt=Date.now()+60000;
 store.sql.exec('DELETE FROM toolbox_session_tickets WHERE expires<=?',Date.now());
 store.sql.exec('INSERT INTO toolbox_session_tickets(token,parent_token,username,app,expires,purpose) VALUES(?,?,?,?,?,?)',hash,parent,actor.username,app,expiresAt,'safety-self');
 return {ticket,expiresAt};
}
export async function redeemToolboxTicket(store,body,ip,purpose='toolbox'){
 store.consumeLimit('toolbox-redeem:'+ip,50);
 check(typeof body.ticket==='string'&&/^[a-f0-9]{64}$/.test(body.ticket),'Open Toolbox Talks from PanelStock.',401);
 const hash=await digest(body.ticket),now=Date.now();
 const entry=store.ctx.storage.transactionSync(()=>{const row=store.sql.exec('SELECT * FROM toolbox_session_tickets WHERE token=?',hash).toArray()[0];if(row&&(row.purpose||'toolbox')===purpose)store.sql.exec('DELETE FROM toolbox_session_tickets WHERE token=?',hash);return row;});
 check(entry&&(entry.purpose||'toolbox')===purpose&&entry.expires>now&&body.app===entry.app,'Open Toolbox Talks again from PanelStock.',401);
 const parent=()=>store.sql.exec('SELECT username,expires,app FROM sessions WHERE token=?',entry.parent_token).toArray()[0];
 const source=parent();check(source&&source.expires>now&&source.username===entry.username&&(!source.app||source.app===entry.app),'PanelStock session ended. Open Toolbox Talks from PanelStock.',401);
 const user=store.read('users',{})[entry.username];check(user&&user.active!==false&&!user.mustChangePin,'PanelStock session ended.',401);requireAppAccess(user,entry.app);if(purpose==='toolbox')store.requireTask({username:entry.username,isAdmin:!!user.isAdmin,tasks:store.taskAccess(entry.username,!!user.isAdmin)},'factory.toolbox');
 const session=await store.issueSession(entry.username,entry.app),childHash=await digest(session.token);
 const latest=parent();check(latest&&latest.expires>Date.now()&&latest.username===entry.username&&(!latest.app||latest.app===entry.app),'PanelStock session ended.',401);
 session.expiresAt=Math.min(session.expiresAt,latest.expires);
 store.ctx.storage.transactionSync(()=>{store.sql.exec('UPDATE sessions SET expires=? WHERE token=?',session.expiresAt,childHash);store.sql.exec('DELETE FROM toolbox_session_links WHERE expires<=?',Date.now());store.sql.exec('INSERT INTO toolbox_session_links(token,parent_token,expires,purpose) VALUES(?,?,?,?)',childHash,entry.parent_token,session.expiresAt,purpose);});
 return session;
}
