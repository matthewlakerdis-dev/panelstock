import {requireCondition as check} from './security.js';

export const validReportingMonth=value=>typeof value==='string'&&/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(value)&&Number(value.slice(0,4))>0;

// A reporting correction changes classification only. Actual count dates,
// quantities, completion prices and the creation-time month filter stay intact.
export function correctStocktakeReportingMonth(count,input,actor,at=new Date().toISOString(),source='admin'){
 check(actor.isAdmin,'Administrator access required',403);
 check(count,'Stocktake not found',404);check(count.status==='completed','Only completed stocktakes can have their reporting month corrected',409);
 check(validReportingMonth(input.reportingMonth),'Choose a valid reporting month (YYYY-MM)');
 check(typeof input.reason==='string'&&input.reason.trim()&&input.reason.trim().length<=500,'A correction reason of up to 500 characters is required');
 const previousMonth=validReportingMonth(count.reportingMonth)?count.reportingMonth:validReportingMonth(count.report?.reportingMonth)?count.report.reportingMonth:null;
 check(previousMonth!==input.reportingMonth,'This stocktake already has that reporting month',409);
 const correction={id:input.mutationId||crypto.randomUUID(),stocktakeId:count.id,previousMonth,reportingMonth:input.reportingMonth,reason:input.reason.trim(),user:actor.username,at,source};
 const next={...count,reportingMonth:input.reportingMonth,reportingMonthAudit:[...(Array.isArray(count.reportingMonthAudit)?count.reportingMonthAudit:[]),correction],...(count.report?{report:{...count.report,reportingMonth:input.reportingMonth}}:{})};
 return {count:next,correction};
}
