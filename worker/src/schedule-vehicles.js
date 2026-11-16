import {requireCondition as check} from './security.js';
export const scheduleVehicles=store=>store.read('schedule-vehicles',[]).filter(vehicle=>vehicle.active!==false);
export const vehicleRows=store=>scheduleVehicles(store).map(vehicle=>({username:'vehicle:'+vehicle.id,displayName:vehicle.name+(vehicle.registration?' · '+vehicle.registration:''),profilePhoto:'',kind:'vehicle',vehicleId:vehicle.id}));
const response=store=>({ok:true,vehicles:scheduleVehicles(store),people:store.scheduleAllPeople(),settings:store.scheduleSettings()});
export function saveScheduleVehicle(store,input,actor,id){
 const vehicles=store.read('schedule-vehicles',[]),index=id?vehicles.findIndex(vehicle=>vehicle.id===id&&vehicle.active!==false):-1;
 check(!id||index>=0,'Vehicle not found',404);check(typeof input.name==='string'&&input.name.trim()&&input.name.trim().length<=100,'Enter a vehicle name of up to 100 characters');check(input.registration==null||typeof input.registration==='string','Invalid vehicle registration');
 const name=input.name.trim(),registration=String(input.registration||'').trim().toUpperCase();check(registration.length<=30,'Registration must be 30 characters or fewer');
 check(!vehicles.some(vehicle=>vehicle.active!==false&&vehicle.id!==id&&vehicle.name.toLowerCase()===name.toLowerCase()),'A vehicle with this name already exists',409);check(id||vehicles.filter(vehicle=>vehicle.active!==false).length<50,'Up to 50 vehicles can be scheduled');
 const settings=store.scheduleSettings(),now=new Date().toISOString(),vehicle={...(index>=0?vehicles[index]:{id:crypto.randomUUID(),createdAt:now}),name,registration,active:true,updatedAt:now,updatedBy:actor.username};
 if(index>=0)vehicles[index]=vehicle;else{vehicles.push(vehicle);settings.visibleUsernames.push('vehicle:'+vehicle.id);}
 store.ctx.storage.transactionSync(()=>{store.write('schedule-vehicles',vehicles);store.write('schedule-settings',settings);if(id)store.write('schedule',store.read('schedule',[]).map(entry=>entry.assignedUsername==='vehicle:'+id?{...entry,assignedTo:name+(registration?' · '+registration:'')}:entry));store.audit(actor.username,id?'schedule-vehicle-updated':'schedule-vehicle-created',{vehicleId:vehicle.id,name});});return {...response(store),vehicle};
}
export function archiveScheduleVehicle(store,id,actor){
 const vehicles=store.read('schedule-vehicles',[]),index=vehicles.findIndex(vehicle=>vehicle.id===id&&vehicle.active!==false);check(index>=0,'Vehicle not found',404);const settings=store.scheduleSettings();vehicles[index]={...vehicles[index],active:false,updatedAt:new Date().toISOString(),updatedBy:actor.username};settings.visibleUsernames=settings.visibleUsernames.filter(value=>value!=='vehicle:'+id);
 store.ctx.storage.transactionSync(()=>{store.write('schedule-vehicles',vehicles);store.write('schedule-settings',settings);store.audit(actor.username,'schedule-vehicle-archived',{vehicleId:id});});return response(store);
}
