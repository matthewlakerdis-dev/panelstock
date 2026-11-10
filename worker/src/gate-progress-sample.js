import {gateComponentSlots} from './gate-components.js';
export function gateProgressSample(){
 const date='2026-11-09T00:30:00Z',orders=[];
 for(const [i,orderType,villa,spec,areaM2,approved,sent,delivered]of [[1,'Bin Gate','V135',{highlights:[2,1]},12.5,4,2,1],[2,'Buggy Gate','V136',{gateCount:2},8,1,0,0],[3,'Side Access Gate','V137',{highlights:[1]},5.75,3,3,3]]){
  const components=gateComponentSlots(orderType,spec).map((slot,index)=>({...slot,id:`sample-${i}-${slot.key}`,qaId:'sample-qa-'+i+'-'+index,qaStatus:index<approved?'approved':'awaiting',checkedBy:index<approved?'sample.inspector':'',checkedAt:index<approved?date:'',ready:index<approved&&index>=sent,shipment:index<sent?{at:date,by:'sample.dispatcher'}:null,delivery:index<delivered?{at:date,by:'sample.receiver'}:null}));
  orders.push({id:'sample-order-'+i,project:'Sample — Palm Lakes',villa,orderNumber:String(40+i),orderType,status:sent===components.length?'dispatched':'approved',areaM2,spec,scheduledForProduction:i!==2,components,summary:{total:components.length,qa:approved,dispatched:sent,delivered},updatedAt:date});
 }
 return {ok:true,sample:true,orders,username:'Sample view',canManage:false,canCreate:false,canQa:false,canDispatch:false,checklist:[]};
}
