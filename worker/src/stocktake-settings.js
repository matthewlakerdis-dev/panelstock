import {requireCondition as check} from './security.js';

const KEY='stocktake-settings';
const defaultGroups=[
 {id:'cladding',label:'Cladding',accountCode:'51050'},
 {id:'fixings',label:'Fixings',accountCode:'51066'},
 {id:'materials',label:'Materials & Supplies',accountCode:'51097'},
 {id:'route-stiffeners',label:'Route Stiffeners & Z Tags',accountCode:'51085'},
 {id:'silicone',label:'Silicone',accountCode:'51090'}
];
export function defaultStocktakeSettings(){return {version:1,revision:0,cosGroups:defaultGroups.map(group=>({...group})),assetAccountCode:'11350',trackingName:'job',trackingOption:'Factory/Production - BAU',direction:''};}
function settingText(value,label,max){
 check(typeof value==='string'&&!/[\p{Cc}\p{Zl}\p{Zp}<>]/u.test(value),label+' must be plain text without control characters or HTML');
 const result=value.trim();check(result.length>0&&result.length<=max,label+' must contain between 1 and '+max+' characters');return result;
}
function settingFields(input){
 check(input&&typeof input==='object'&&!Array.isArray(input),'Enter stocktake settings');
 check(Array.isArray(input.cosGroups)&&input.cosGroups.length>=1&&input.cosGroups.length<=50,'Add between 1 and 50 COS groups');
 const ids=new Set(),cosGroups=input.cosGroups.map(group=>{
  check(group&&typeof group==='object'&&!Array.isArray(group),'Enter valid COS groups');
  const id=group.id;
  check(typeof id==='string'&&id===id.trim()&&/^[a-z][a-z0-9-]{0,79}$/.test(id)&&!['asset','constructor','prototype','__proto__'].includes(id),'Choose a valid COS group ID');
  check(!ids.has(id),'COS group IDs must be unique');ids.add(id);
  return {id,label:settingText(group.label,'COS group label',120),accountCode:settingText(group.accountCode,'COS account code',30)};
 });
 check(['','asset-debit','asset-credit'].includes(input.direction),'Choose a valid journal direction');
 return {cosGroups,assetAccountCode:settingText(input.assetAccountCode,'Stock asset account code',30),trackingName:settingText(input.trackingName,'Tracking name',120),trackingOption:settingText(input.trackingOption,'Tracking option',120),direction:input.direction};
}
export function readStocktakeSettings(store){
 const saved=store.read(KEY,null);if(saved===null)return defaultStocktakeSettings();
 check(saved.version===1&&Number.isSafeInteger(saved.revision)&&saved.revision>=0,'Stored stocktake settings are invalid');
 return {version:1,revision:saved.revision,...settingFields(saved)};
}
export function handleStocktakeSettings(store,method,body,actor){
 if(method==='GET'){
  check(actor.isAdmin||actor.tasks?.['factory.stock']||actor.tasks?.['factory.settings'],'You do not have access to stocktake settings',403);
  return {status:200,body:{ok:true,stocktakeSettings:readStocktakeSettings(store)}};
 }
 check(method==='POST','Method not allowed',405);check(actor.isAdmin,'Administrator access required',403);
 check(typeof body.mutationId==='string'&&/^[a-zA-Z0-9-]{16,100}$/.test(body.mutationId),'Mutation ID required');
 const key='stocktake-settings-mutation:'+body.mutationId,payload=JSON.stringify(body),prior=store.read(key,null);
 if(prior){check(prior.user===actor.username&&prior.payload===payload,'Mutation ID reused',409);return {status:200,body:{ok:true,duplicate:true,stocktakeSettings:readStocktakeSettings(store)}};}
 const previous=readStocktakeSettings(store);
 check(body.expectedRevision===previous.revision,'Stocktake settings changed. Refresh and try again.',409);
 const fields=settingFields(body),ids=new Set(fields.cosGroups.map(group=>group.id));
 check(previous.cosGroups.every(group=>ids.has(group.id)),'Existing COS groups cannot be removed');
 const settings={version:1,revision:previous.revision+1,...fields},revision=store.read('revision',0)+1;
 store.ctx.storage.transactionSync(()=>{
  store.write(KEY,settings);store.write(key,{user:actor.username,payload});store.write('revision',revision);
  store.audit(actor.username,'stocktake-settings',{settingsRevision:settings.revision,groups:settings.cosGroups.length});
 });
 store.broadcastRevision(revision);
 return {status:200,body:{ok:true,stocktakeSettings:settings}};
}
