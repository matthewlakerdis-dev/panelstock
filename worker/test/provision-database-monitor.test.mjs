import test from 'node:test';
import assert from 'node:assert/strict';
import {provisionDatabaseMonitor} from '../scripts/provision-database-monitor.mjs';
const account='a'.repeat(32),groupId='b'.repeat(32),createdId='c'.repeat(32),providedId='d'.repeat(32);
const deploymentToken='private-deployment-secret',createdValue='private-new-analytics-secret',providedValue='private-provided-analytics-secret';
const tokenName='PanelStock database monitoring (read only)',secretName='DATABASE_ANALYTICS_TOKEN';
const time=Date.parse('2026-11-22T12:00:00Z'),baseEnv={CLOUDFLARE_ACCOUNT_ID:account,CLOUDFLARE_API_TOKEN:deploymentToken};
const answer=(result,status=200)=>({ok:status>=200&&status<300,status,json:async()=>({success:status>=200&&status<300,result})});
function fixture({existing=false,provided=false,fault,groups,inventory=[]}={}){
 const calls=[],logs=[];let installed=existing,created=0;
 const env={...baseEnv,...(provided?{CLOUDFLARE_ANALYTICS_API_TOKEN:providedValue}:{})};
 const logger={log:value=>logs.push(value)};
 const fetcher=async(url,options)=>{
  const parsed=new URL(url),body=options.body?JSON.parse(options.body):undefined;
  const call={path:parsed.pathname,query:parsed.search,method:options.method,auth:options.headers.Authorization,body};calls.push(call);
  const injected=await fault?.(call,{setInstalled:value=>installed=value});if(injected)return injected;
  if(call.path.endsWith('/secrets')){
   assert.equal(call.auth,'Bearer '+deploymentToken);
   if(call.method==='PUT'){assert.equal(body.name,secretName);assert.equal(body.type,'secret_text');installed=true;return answer({name:secretName,type:'secret_text'});}
   return answer(installed?[{name:secretName,type:'secret_text'}]:[]);
  }
  if(call.path.endsWith('/permission_groups'))return answer(groups??[{id:groupId,name:'Account Analytics Read',scopes:['com.cloudflare.api.account'],is_selectable:true}]);
  if(call.path.endsWith('/tokens/verify')){
   assert.notEqual(call.auth,'Bearer '+deploymentToken,'The deployment token must never be installed as analytics credential');
   return answer({id:provided?providedId:createdId,status:'active'});
  }
  if(call.path.endsWith('/tokens')){
   assert.equal(call.auth,'Bearer '+deploymentToken);
   if(call.method==='GET')return {...answer(inventory),json:async()=>({success:true,result:inventory,result_info:{total_pages:1}})};
   if(call.method==='POST'){created++;return answer({id:createdId,value:createdValue});}
  }
  if(call.path.endsWith('/tokens/'+createdId)&&call.method==='DELETE'){assert.equal(call.auth,'Bearer '+deploymentToken);return answer({id:createdId});}
  if(call.path.endsWith('/graphql')){
   assert.equal(call.auth,'Bearer '+(provided?providedValue:createdValue));
   return {ok:true,status:200,json:async()=>({data:{viewer:{accounts:[{durableObjectsPeriodicGroups:[{sum:{rowsWritten:12}}]}]}}})};
  }
  throw Error('Unexpected request containing '+deploymentToken);
 };
 const run=()=>provisionDatabaseMonitor(env,{fetcher,logger,now:()=>time});
 return {calls,logs,env,run,get created(){return created;},get installed(){return installed;}};
}
const mutations=f=>f.calls.filter(call=>['POST','PUT','DELETE'].includes(call.method)&&!call.path.endsWith('/graphql'));
const checkPrivacy=(f,result)=>{
 const exposed=JSON.stringify({logs:f.logs,result});
 for(const value of [deploymentToken,createdValue,providedValue,createdId,providedId])assert.equal(exposed.includes(value),false,'Credential values and token IDs must not be returned or logged');
};

test('an existing named Worker secret prevents minting, rotation and ambient credential fallback',async()=>{
 const f=fixture({existing:true,provided:true}),result=await f.run();assert.deepEqual(result,{state:'ready',source:'existing_secret',validated:false});assert.equal(f.calls.length,1);assert.equal(mutations(f).length,0);checkPrivacy(f,result);
});
test('minting grants exactly one account-scoped Analytics Read permission and a one-year expiry',async()=>{
 const f=fixture(),result=await f.run();assert.equal(result.state,'ready');assert.equal(result.source,'created_token');assert.equal(result.validated,true);assert.equal(f.created,1);
 const create=f.calls.find(call=>call.path.endsWith('/tokens')&&call.method==='POST');
 assert.deepEqual(create.body,{name:tokenName,expires_on:'2027-11-22T12:00:00.000Z',policies:[{effect:'allow',permission_groups:[{id:groupId}],resources:{['com.cloudflare.api.account.'+account]:'*'}}]});
 const put=f.calls.find(call=>call.method==='PUT');assert.deepEqual(put.body,{name:secretName,type:'secret_text',text:createdValue});
 const graph=f.calls.find(call=>call.path.endsWith('/graphql'));assert.match(graph.body.query,/limit:1/);assert.doesNotMatch(graph.body.query,/mutation/);assert.equal(graph.body.variables.since,'2026-11-22T10:55:00.000Z');assert.equal(graph.body.variables.until,'2026-11-22T11:55:00.000Z');
 assert.ok(f.calls.findIndex(call=>call.path.endsWith('/graphql'))<f.calls.findIndex(call=>call.method==='PUT'));checkPrivacy(f,result);
 const count=f.calls.length;assert.equal((await f.run()).source,'existing_secret');assert.equal(f.calls.length,count+1);assert.equal(f.created,1);
});
test('a privately provided credential is validated and installed without token-management requests',async()=>{
 const f=fixture({provided:true}),result=await f.run();assert.equal(result.source,'provided_token');assert.equal(result.validated,true);
 assert.equal(f.calls.some(call=>call.path.includes('/permission_groups')||call.path.endsWith('/tokens')||call.method==='DELETE'),false);assert.equal(f.calls.find(call=>call.method==='PUT').body.text,providedValue);checkPrivacy(f,result);
});
test('forbidden secret access or provisioning reports manual setup without widening permissions',async()=>{
 for(const blocked of ['secret_list','permission_groups','token_inventory','token_create']){
  const f=fixture({fault:call=>{
   if(blocked==='secret_list'&&call.path.endsWith('/secrets')&&call.method==='GET'||blocked==='permission_groups'&&call.path.endsWith('/permission_groups')||blocked==='token_inventory'&&call.path.endsWith('/tokens')&&call.method==='GET'||blocked==='token_create'&&call.path.endsWith('/tokens')&&call.method==='POST')return answer(null,403);
  }}),result=await f.run();assert.equal(result.state,'setup_required',blocked);assert.match(f.logs.join('\n'),/SETUP_REQUIRED/);assert.equal(f.calls.some(call=>call.method==='PUT'),false);assert.equal(f.calls.some(call=>call.method==='POST'&&call.path.endsWith('/tokens/permission_groups')),false);checkPrivacy(f,result);
 }
});
test('unselectable, ambiguous or incorrectly scoped permission groups cannot mint credentials',async()=>{
 for(const groups of [[],[{id:groupId,name:'Account Analytics Read',scopes:['com.cloudflare.api.account'],is_selectable:false}],[{id:groupId,name:'Account Analytics Read',scopes:['com.cloudflare.api.account.zone'],is_selectable:true}],[{id:groupId,name:'Account Analytics Read',scopes:['com.cloudflare.api.account'],is_selectable:true},{id:providedId,name:'Account Analytics Read',scopes:['com.cloudflare.api.account'],is_selectable:true}]]){
  const f=fixture({groups}),result=await f.run();assert.equal(result.state,'setup_required');assert.equal(mutations(f).length,0);checkPrivacy(f,result);
 }
});
test('an earlier named token blocks replacement when its secret may not have been installed',async()=>{
 const f=fixture({inventory:[{id:createdId,name:tokenName,status:'active'}]}),result=await f.run();assert.equal(result.state,'setup_required');assert.equal(result.reason,'existing_monitor_token');assert.equal(mutations(f).length,0);checkPrivacy(f,result);
});
test('confirmed validation failures revoke only the newly minted uninstalled token',async()=>{
 for(const failing of ['identity','analytics']){
  const f=fixture({fault:call=>{
   if(failing==='identity'&&call.path.endsWith('/tokens/verify'))return answer({id:providedId,status:'active'});
   if(failing==='analytics'&&call.path.endsWith('/graphql'))return {ok:true,status:200,json:async()=>({errors:[{message:createdValue}]})};
  }}),result=await f.run();assert.equal(result.state,'failed');assert.equal(result.cleanup,'revoked');assert.equal(f.calls.filter(call=>call.method==='DELETE').length,1);assert.equal(f.calls.some(call=>call.method==='PUT'),false);checkPrivacy(f,result);
 }
});
test('provided credentials are never revoked or replaced after failed validation',async()=>{
 const f=fixture({provided:true,fault:call=>call.path.endsWith('/graphql')?answer(null,403):undefined}),result=await f.run();assert.equal(result.state,'setup_required');assert.equal(f.calls.some(call=>call.method==='PUT'||call.method==='DELETE'||call.path.endsWith('/tokens')&&call.method==='POST'),false);checkPrivacy(f,result);
});
test('a confirmed rejected secret installation cleans up the new credential, and cleanup denial stays visible',async()=>{
 for(const denyCleanup of [false,true]){
  const f=fixture({fault:call=>call.method==='PUT'?answer(null,403):call.method==='DELETE'&&denyCleanup?answer(null,403):undefined}),result=await f.run();assert.equal(result.state,'setup_required');assert.equal(result.cleanup,denyCleanup?'required':'revoked');checkPrivacy(f,result);
 }
});
test('an ambiguous secret PUT never revokes or retries the credential even if it is listed afterward',async()=>{
 for(const existsAfter of [false,true]){
  const f=fixture({fault:(call,state)=>{if(call.method==='PUT'){state.setInstalled(existsAfter);throw Error('Lost response '+createdValue);}}}),result=await f.run();assert.equal(result.state,'uncertain');assert.equal(result.secretPresent,existsAfter);assert.equal(f.calls.filter(call=>call.method==='PUT').length,1);assert.equal(f.calls.some(call=>call.method==='DELETE'),false);checkPrivacy(f,result);
 }
});
test('server errors and invalid acknowledgements after a secret PUT remain uncertain',async()=>{
 for(const response of [answer(null,503),{ok:true,status:200,json:async()=>{throw Error('Provider text '+createdValue);}}]){
  const f=fixture({fault:call=>call.method==='PUT'?response:undefined}),result=await f.run();assert.equal(result.state,'uncertain');assert.equal(f.calls.some(call=>call.method==='DELETE'),false);checkPrivacy(f,result);
 }
});
test('ambiguous token creation is never retried and cannot expose the provider error',async()=>{
 const f=fixture({fault:call=>{if(call.path.endsWith('/tokens')&&call.method==='POST')throw Error('Connection lost '+createdValue);}}),result=await f.run();assert.equal(result.state,'uncertain');assert.equal(result.reason,'token_creation_uncertain');assert.equal(f.calls.filter(call=>call.path.endsWith('/tokens')&&call.method==='POST').length,1);assert.equal(f.calls.some(call=>call.method==='PUT'||call.method==='DELETE'),false);checkPrivacy(f,result);
});
test('missing credentials fail before network access and an empty authorized dataset is valid',async()=>{
 const logs=[];const result=await provisionDatabaseMonitor({},{fetcher:()=>assert.fail('No ambient credentials may be used'),logger:{log:value=>logs.push(value)},now:()=>time});assert.equal(result.state,'setup_required');
 const f=fixture({provided:true,fault:call=>call.path.endsWith('/graphql')?{ok:true,status:200,json:async()=>({data:{viewer:{accounts:[{durableObjectsPeriodicGroups:[]}]}}})}:undefined});assert.equal((await f.run()).state,'ready');
});

test('the deployment credential cannot be supplied as the dedicated runtime analytics token',async()=>{
 const f=fixture({provided:true});f.env.CLOUDFLARE_ANALYTICS_API_TOKEN=deploymentToken;
 const result=await f.run();assert.deepEqual(result,{state:'setup_required',reason:'analytics_credential_not_dedicated'});
 assert.equal(f.calls.length,1);assert.ok(f.calls[0].path.endsWith('/secrets'));assert.equal(mutations(f).length,0);assert.equal(f.calls.some(call=>call.path.endsWith('/tokens/verify')||call.path.endsWith('/graphql')),false);checkPrivacy(f,result);
 const existing=fixture({existing:true,provided:true});existing.env.CLOUDFLARE_ANALYTICS_API_TOKEN=deploymentToken;
 assert.equal((await existing.run()).source,'existing_secret');assert.equal(existing.calls.length,1);assert.equal(mutations(existing).length,0);
});

test('an omitted optional selectable flag still creates only the validated narrow credential',async()=>{
 const f=fixture({groups:[{id:groupId,name:'Account Analytics Read',scopes:['com.cloudflare.api.account']}]}),result=await f.run();
 assert.equal(result.state,'ready');assert.equal(result.source,'created_token');assert.equal(result.validated,true);assert.equal(f.created,1);
 const create=f.calls.find(call=>call.path.endsWith('/tokens')&&call.method==='POST');
 assert.deepEqual(create.body.policies,[{effect:'allow',permission_groups:[{id:groupId}],resources:{['com.cloudflare.api.account.'+account]:'*'}}]);
 assert.ok(f.calls.findIndex(call=>call.path.endsWith('/graphql'))<f.calls.findIndex(call=>call.method==='PUT'));checkPrivacy(f,result);
});
