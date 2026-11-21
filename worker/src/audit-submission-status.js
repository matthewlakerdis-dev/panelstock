import {digest,requireCondition as check} from './security.js';
export async function auditSubmissionStatus(store,input,actor){
 store.requireTask(actor,'factory.toolbox');const {path,body}=input||{};
 check(typeof path==='string'&&/^\/toolbox\/walks\/[a-f0-9-]{36}(?:\/file|\/delete|\/actions\/[a-f0-9-]{36})?$/i.test(path)||typeof path==='string'&&/^\/toolbox\/walks\/actions\/[a-f0-9-]{36}\/[a-f0-9-]{36}$/i.test(path),'This submission type does not support status checks');
 check(body&&typeof body==='object'&&/^[a-f0-9-]{36}$/i.test(body.mutationId||''),'A saved request identifier is required');
 const action=path.startsWith('/toolbox/walks/actions/'),key=(action?'safety:audit-action-mutation:':'safety:walk-mutation:')+body.mutationId,saved=store.read(key);
 if(!saved)return {state:'unknown'};
 check(saved.by===actor.username&&saved.hash===await digest(JSON.stringify({path,body})),'Request identifier was used with different details or another account',409);
 return {state:'committed',result:{...saved.response,duplicate:true}};
}
