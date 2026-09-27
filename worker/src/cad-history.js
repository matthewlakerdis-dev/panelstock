// Historical manifests reference immutable file objects; restoring creates a new revision.
export function archiveProject(store,key,state,label='Saved version',pinned=false){
 if(!state.revision||(!state.manifest&&!state.project))return;
 const id=crypto.randomUUID(),project=state.manifest?.project||JSON.parse(state.project).project;
 const version={id,revision:state.revision,updatedAt:state.updatedAt,name:project.name,panelCount:project.panels.length,label,pinned:pinned||!!state.importId,importId:state.importId||null,fileKeys:Object.values(state.files||{}).map(f=>f.key)};
 store.write(key+':version:'+id,{manifest:state.manifest,project:state.project,files:state.files||{},revision:state.revision,updatedAt:state.updatedAt});
 state.history=[version,...(state.history||[])];
 // Keep imported copies intact; bound routine automatic-save history separately.
 let automatic=0;state.history=state.history.filter(v=>{
  if(v.pinned||++automatic<=50)return true;
  state.garbage||=[];state.garbage.push(...v.fileKeys.map(key=>({key,after:Date.now()+86400000})));
  store.write(key+':version:'+v.id,null);return false;
 });
 return version;
}
export function historyFileKeys(state){return (state.history||[]).flatMap(v=>v.fileKeys||[]);}
export function readVersion(store,key,state,id){return state.history?.some(v=>v.id===id)?store.read(key+':version:'+id):null;}
export function projectIndex(id,state){const data=state.manifest?.project||JSON.parse(state.project).project;return {projectId:id,name:data.name,panelCount:data.panels.length,updatedAt:state.updatedAt,revision:state.revision};}
export function baseOrderName(name){return String(name||'').trim().replace(/(?:\s*\((?:device copy|copy|restored)\))+$/i,'').trim();}
export function orderKey(name){return baseOrderName(name).replace(/\s+/g,' ').toLowerCase();}
