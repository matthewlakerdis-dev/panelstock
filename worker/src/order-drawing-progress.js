// Only committed CAD project summaries contribute. Never inspect private files
// or infer an order link from a user-editable drawing name.
const normalized=value=>String(value||'').trim().replace(/\s+/g,' ').toLowerCase();
export function cadDrawingSummary(project){
 const details=project.projectDetails||{},panels=Array.isArray(project.panels)?project.panels:[];
 const ready=panels.filter(panel=>{
  if(panel.drawingReadiness?.version!==1||panel.drawingReadiness.ready!==true||!panel.reviewed||panel.correctionRecovery||!panel.result||!panel.spec||!panel.generatedSpec)return false;
  const spec={...panel.spec};delete spec.reviewed;
  return panel.generatedSpec===JSON.stringify(spec);
 }).length;
 return {projectId:String(details.projectId||'').slice(0,100),projectName:String(details.projectName||'').slice(0,100),orderNumber:String(details.orderNumber||'').slice(0,50),total:panels.length,ready,drawn:panels.length>0&&ready===panels.length};
}
export function orderDrawingProgress(order,projects){
 const number=normalized(order.orderNumber),name=normalized(order.project);
 const matches=projects.filter(p=>{
  const d=p.drawingProgress;if(!p.revision||!d||!number||normalized(d.orderNumber)!==number)return false;
  return order.projectId&&d.projectId?order.projectId===d.projectId:!!name&&normalized(d.projectName)===name;
 });
 return {drawn:matches.length>0&&matches.every(p=>p.drawingProgress.drawn===true),ready:matches.reduce((n,p)=>n+p.drawingProgress.ready,0),total:matches.reduce((n,p)=>n+p.drawingProgress.total,0)};
}
