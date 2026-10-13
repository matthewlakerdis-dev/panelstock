import {requireCondition as check} from './security.js';
import {safetyProfileDirectory} from './safety-profiles.js';
import {handleSafetyDocuments} from './safety-documents.js';
// This dedicated namespace permits document reading and self acknowledgement only.
export async function handleSafetySelfService(store,path,method,body,actor){
 check(actor?.username,'Please sign in',401);
 if(path==='/toolbox/self/users'){check(method==='GET','Method not allowed',405);return {status:200,body:{ok:true,users:await safetyProfileDirectory(store,actor.username)}};}
 const base='/toolbox/self/safety-documents',tail=path.slice(base.length);check(path.startsWith(base),'Not found',404);
 const list=tail==='/list'&&method==='POST',match=tail.match(/^\/([a-f0-9-]{36})(?:\/(detail|file|acknowledge))?$/i);
 check(list||match&&(match[2]?method==='POST':method==='GET'),'Self-service permits reading documents and signing your own acknowledgement only',403);
 if(match?.[2]==='acknowledge')check(body.username===actor.username,'You can acknowledge only for yourself',403);
 const result=await handleSafetyDocuments(store,'/toolbox/safety-documents'+tail,method,body,actor,true);
 if(result.body.acknowledgements)result.body={...result.body,acknowledgements:result.body.acknowledgements.filter(a=>a.username===actor.username)};
 return result;
}
