import {PDFDocument,rgb} from 'pdf-lib';

// Copy a blank strip from the original cell, so replacing a preprinted label
// keeps its shading and horizontal rules. Snapshot in a separate document:
// drawing an embedded page back onto itself would share mutable resources.
export async function safetyLabelBackgrounds(pdf,cells){
 if(!cells.length)return [];
 const original=await PDFDocument.create(),pages=pdf.getPages(),indices=[...new Set(cells.map(c=>pages.indexOf(c.page)))];
 const copies=await original.copyPages(pdf,indices);copies.forEach(p=>original.addPage(p));
 const source=cells.map(c=>copies[indices.indexOf(pages.indexOf(c.page))]);
 // An empty page has no content stream; add a white strip to the isolated copy.
 for(const p of copies)if(!p.node.Contents())p.drawRectangle({x:0,y:0,width:p.getWidth(),height:p.getHeight(),color:rgb(1,1,1)});
 const bounds=cells.map(c=>({left:c.x+c.width-2,right:c.x+c.width-1.25,bottom:c.page.getHeight()-c.top-c.height,top:c.page.getHeight()-c.top}));
 const backgrounds=await pdf.embedPages(source,bounds);
 for(const background of backgrounds)await background.embed();
 return cells.map((c,i)=>()=>{
  const position={x:c.x+.75,y:c.page.getHeight()-c.top-c.height,width:c.width-1.5,height:c.height};
  c.page.drawRectangle({...position,color:rgb(1,1,1)});
  c.page.drawPage(backgrounds[i],position);
 });
}
