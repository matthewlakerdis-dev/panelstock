import {normalizeCncInput} from './cnc-input.js';

// Export numeric events only: QA photos, notes and inspector details stay private.
export function fabricationProductionReportRows(panels,records){
  const qa=new Map(records.filter(record=>record.kind==='panel').map(record=>[record.id,record]));
  const unique=[...new Map(panels.filter(panel=>panel.id).map(panel=>[panel.id,panel])).values()];
  const approval=panel=>{
    const record=qa.get(panel.id);
    if(panel.status!=='completed'||record?.status!=='approved'||record.latest?.status!=='approved')return null;
    const cut=Date.parse(panel.completedAt);
    const approvals=[...(record.history||[]),record.latest].filter(attempt=>attempt?.status==='approved'&&Number.isFinite(Date.parse(attempt.checkedAt))&&(!Number.isFinite(cut)||Date.parse(attempt.checkedAt)>=cut));
    return approvals.length?approvals.reduce((first,attempt)=>Date.parse(attempt.checkedAt)<Date.parse(first.checkedAt)?attempt:first).checkedAt:null;
  };
  const validArea=value=>Number.isFinite(Number(value))&&Number(value)>0&&Number(value)<=99999;
  const sheets=new Map(),events=[];
  for(const panel of unique){
    if(panel.panelAreaScope==='sheet'){
      const normalized=normalizeCncInput(panel),length=Math.max(Number(panel.sheetWidth)||0,Number(panel.sheetHeight)||0),width=Math.min(Number(panel.sheetWidth)||0,Number(panel.sheetHeight)||0);
      const key=JSON.stringify([normalized.jobReference,normalized.orderNumber,normalized.sheetNumber,panel.stockItemType||'',panel.stockItemId||panel.stockSku||'',length,width]);
      if(!sheets.has(key))sheets.set(key,[]);
      sheets.get(key).push(panel);
    }else{
      const completedAt=approval(panel);
      if(completedAt&&validArea(panel.totalPanelArea))events.push({id:panel.id,completedAt,areaM2:Number(panel.totalPanelArea)});
    }
  }
  // A shared sheet total cannot be split accurately across individual panels.
  // Recognise it once, on the last approval of the panels sharing that total.
  for(const group of sheets.values()){
    const dates=group.map(approval),area=Math.max(...group.map(panel=>Number(panel.totalPanelArea)||0));
    if(dates.every(Boolean)&&validArea(area))events.push({id:'sheet:'+group[0].id,completedAt:dates.reduce((latest,date)=>Date.parse(date)>Date.parse(latest)?date:latest),areaM2:area});
  }
  return events;
}
