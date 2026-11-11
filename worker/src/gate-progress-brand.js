import {siteOrdersBrandDrawing} from './site-orders-brand.js';

// Use the Site Orders artwork, keeping the title inside Gate Progress's identity columns.
export function gateProgressBrandDrawing({sample=false,staging=false}={}){
 const title=sample?'Gate Progress — Sample':staging?'Gate Progress — Staging':'Gate Progress';
 return siteOrdersBrandDrawing.replaceAll('Site Orders',title).replace('<xdr:col>6</xdr:col>','<xdr:col>5</xdr:col>');
}
