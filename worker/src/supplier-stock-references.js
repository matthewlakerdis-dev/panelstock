import {requireCondition as check} from './security.js';

const text=(value,max=160)=>String(value??'').trim().slice(0,max);
export const poNormal=value=>String(value??'').trim().toLowerCase().replace(/\s+/g,' ');
export const poSource=input=>{
 check(input&&typeof input==='object'&&!Array.isArray(input),'Invalid supplier stock details');
 const result={};
 for(const [field,max] of [['sku',100],['description',500],['colour',160],['dimensions',160],['unit',40]]){
  check(input[field]===undefined||input[field]===null||typeof input[field]==='string','Invalid supplier '+field);
  check(String(input[field]||'').length<=max,'Supplier '+field+' is too long');result[field]=text(input[field],max);
 }
 check(result.sku||result.description,'A supplier code or description is required');
 const n=input.lengthMm;check(n===undefined||n===null||n===''||(Number.isFinite(Number(n))&&Number(n)>0&&Number(n)<=1e6),'Invalid supplier stock length');
 result.lengthMm=n===undefined||n===null||n===''?null:Number(n);return result;
};
export const stockIdentity=item=>JSON.stringify([item.sku,item.colour||item.color,item.dimensions,item.lengthMm,item.unit,item.width,item.height,item.thickness,item.material].map(poNormal));
export const poKey=(supplier,source)=>JSON.stringify([supplier,source.sku,source.description,source.colour,source.dimensions,source.lengthMm||'',source.unit].map(poNormal));

// The PO review and catalogue import use the same optimistic versioned aliases.
// Callers pass only trusted origin metadata; stock names and quantities are never changed here.
export function rememberSupplierStockReference(refs,{supplier,source,item,expectedReferenceVersion,origin={}},actor,now){
 const key=poKey(supplier,source),index=refs.findIndex(reference=>reference.key===key),prior=index<0?null:refs[index];
 check(Number.isInteger(expectedReferenceVersion)&&expectedReferenceVersion===(prior?.version||0),'A supplier stock match changed. Review the latest match before saving.',409);
 const reference={key,supplier,source,itemId:item.id,itemIdentity:stockIdentity(item),version:(prior?.version||0)+1,updatedBy:actor.username,updatedAt:now,...origin};
 if(index<0)refs.push(reference);else refs[index]=reference;
 check(refs.length<=20000,'Supplier stock reference limit reached');
 return {reference,prior};
}
