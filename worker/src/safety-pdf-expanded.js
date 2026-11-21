import {rgb} from 'pdf-lib';
import {safetyPdfLicenceRowsWithAdditions} from './safety-pdf-licences.js';

const fields=['name','role','type','class','number','date','signature'];
const ink=rgb(.05,.1,.14),rule=rgb(.35,.38,.4),shade=rgb(.88,.9,.91),white=rgb(1,1,1);
const median=values=>{const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.floor(sorted.length/2)];};

export const needsExpandedSafetySignoff=acknowledgements=>acknowledgements.some(a=>Array.isArray(a.details?.allLicences)&&a.details.allLicences.length>3);

// Only the configured, measured table body is redrawn. In particular, gaps
// between detected rows can contain source text or a supervisor field and are
// separate regions, never part of a rectangle that we clear.
function tableRegions(pdf,pages){
 const regions=[],used=new Set();
 for(const table of pages){
  if(!Number.isInteger(table.page)||table.page<1||table.page>pdf.getPageCount()||used.has(table.page)||!Array.isArray(table.rows)||!table.rows.length)throw Error('Invalid expanded sign-off page.');
  used.add(table.page);const page=pdf.getPage(table.page-1),width=page.getWidth(),height=page.getHeight();
  if(page.getRotation().angle%360||!Number.isFinite(table.width)||!Number.isFinite(table.height)||Math.abs(width-table.width)>1||Math.abs(height-table.height)>1)throw Error('Detected page dimensions changed.');
  let edge=null;
  for(const key of fields){const column=table.columns?.[key];if(!Array.isArray(column)||column.length!==2||!column.every(Number.isFinite)||column[0]<0||column[1]<15||column[0]+column[1]>width+.05||edge!==null&&Math.abs(column[0]-edge)>.05)throw Error('Unsupported sign-off columns for additional licence rows.');edge=column[0]+column[1];}
  let current=null,bottom=0;
  for(const row of table.rows){
   if(!Number.isFinite(row.top)||!Number.isFinite(row.height)||row.top<0||row.height<24||row.top<bottom-.05||row.top+row.height>height)throw Error('Invalid expanded sign-off rows.');
   if(!current||Math.abs(row.top-bottom)>.05){current={...table,pdfPage:page,top:row.top,bottom:row.top+row.height,rows:[],blocks:[]};regions.push(current);}
   current.rows.push(row);current.bottom=row.top+row.height;bottom=current.bottom;
  }
 }
 for(const region of regions){
  region.unit=Math.max(8,median(region.rows.flatMap(row=>row.licenceRows?.map(r=>r.height)||[row.height/3])));
  region.cursor=region.top;
 }
 if(!regions.length)throw Error('No detected sign-off tables.');
 return regions;
}

function textTools(font){
 const supported=new Set(font.getCharacterSet());
 function lines(value,width,size){
  const text=String(value||'').replace(/[\r\n\t]+/g,' ').trim();
  for(const c of text)if(!supported.has(c.codePointAt(0)))throw Error('The PDF font cannot display '+c);
  if(!text)return [];
  const result=[];let line='';
  for(const word of text.split(/ +/)){
   const candidate=line?line+' '+word:word;
   if(font.widthOfTextAtSize(candidate,size)<=width){line=candidate;continue;}
   if(line){result.push(line);line='';}
   for(const c of word){if(line&&font.widthOfTextAtSize(line+c,size)>width){result.push(line);line='';}line+=c;}
  }
  if(line)result.push(line);
  return result;
 }
 function draw(page,values,x,top,width,height,size){
  const leading=size+1,block=values.length*leading;
  values.forEach((value,i)=>page.drawText(value,{x:x+3,y:page.getHeight()-top-(height-block)/2-size-i*leading,font,size,color:ink}));
 }
 return {lines,draw};
}

// Plan every page before painting any of them. Continuation pages therefore
// copy the blank source table, never earlier workers or a supervisor stamp.
export async function fillExpandedSafetySignoff(pdf,font,pages,acknowledgements,updates=null){
 const regions=tableRegions(pdf,pages),last=regions.at(-1),{lines,draw}=textTools(font);let regionIndex=0;
 const nextShape=index=>regions[index]||last;
 async function advance(){
  regionIndex++;
  if(regionIndex===regions.length){const [copy]=await pdf.copyPages(pdf,[last.page-1]);pdf.addPage(copy);regions.push({...last,pdfPage:copy,cursor:last.top,blocks:[]});}
 }
 function blockFor(region,ack,entries,continued){
  const size=Math.min(6.5,region.unit-2),columns=region.columns;
  const rows=entries.map(entry=>{const values={type:lines(entry.description,columns.type[1]-6,size),class:lines(entry.class,columns.class[1]-6,size),number:lines(entry.number,columns.number[1]-6,size)};return {values,height:Math.max(region.unit,...Object.values(values).map(v=>v.length*(size+1)+1))};});
  const dateValue=new Date(ack.signature.at).toLocaleDateString('en-GB',{timeZone:'Australia/Brisbane',day:'2-digit',month:'2-digit',year:'numeric'}).replaceAll('/','-');
  const name=lines(ack.name,columns.name[1]-6,8),role=lines(ack.details?.role,columns.role[1]-6,8),date=lines(dateValue,columns.date[1]-6,8),labels=continued?['Continued']:[];
  const identityHeight=Math.max(name.length*9+labels.length*9,role.length*9,date.length*9,18)+6;
  const height=Math.max(rows.reduce((sum,row)=>sum+row.height,0),region.unit*3,identityHeight);
  const extra=(height-rows.reduce((sum,row)=>sum+row.height,0))/rows.length;
  for(const row of rows)row.height+=extra;
  return {ack,rows,name,role,date,continued,height,size,labels};
 }
 const jobs=acknowledgements.map(ack=>({ack,entries:safetyPdfLicenceRowsWithAdditions(ack.details,updates?.entries.get(ack.id))}));
 for(const {ack,entries} of jobs){
  let offset=0;
  while(offset<entries.length){
   const region=regions[regionIndex],remaining=entries.slice(offset),continued=offset>0,full=blockFor(region,ack,remaining,continued),available=region.bottom-region.cursor;
   let block=full,count=remaining.length;
   if(full.height>available+.01){
    const fresh=nextShape(regionIndex+1),fitsFresh=blockFor(fresh,ack,remaining,continued).height<=fresh.bottom-fresh.top+.01;
    if(region.blocks.length&&fitsFresh){await advance();continue;}
    count=0;block=null;
    for(let length=1;length<=remaining.length;length++){const candidate=blockFor(region,ack,remaining.slice(0,length),continued);if(candidate.height>available+.01)break;count=length;block=candidate;}
    if(!count){
     if(region.blocks.length||regionIndex<regions.length-1){await advance();continue;}
     throw Error('The detected sign-off area is too small for additional licence rows.');
    }
   }
   region.blocks.push({...block,top:region.cursor});region.cursor+=block.height;offset+=count;
   if(offset<entries.length)await advance();
  }
 }
 const imageCache=new Map();
 for(const region of regions){
  if(!region.blocks.length)continue;
  const page=region.pdfPage,c=region.columns,left=c.name[0],right=c.signature[0]+c.signature[1],height=region.bottom-region.top;
  const horizontal=(top,x=left,end=right)=>page.drawLine({start:{x,y:page.getHeight()-top},end:{x:end,y:page.getHeight()-top},thickness:.5,color:rule});
  page.drawRectangle({x:left,y:page.getHeight()-region.bottom,width:right-left,height,color:white});
  for(const [index,block] of region.blocks.entries()){
   if(index%2===0)page.drawRectangle({x:left,y:page.getHeight()-block.top-block.height,width:right-left,height:block.height,color:shade});
   const drawField=(field,values,top=block.top,fieldHeight=block.height,size=8)=>draw(page,values,c[field][0],top,c[field][1],fieldHeight,size);
   const labelHeight=block.labels.length*9;drawField('name',block.name,block.top,block.height-labelHeight);
   block.labels.forEach((label,i)=>drawField('name',[label],block.top+block.height-labelHeight+i*9-1,9,6));
   drawField('role',block.role);drawField('date',block.date);
   let top=block.top;
   for(const row of block.rows){for(const field of ['type','class','number'])drawField(field,row.values[field],top,row.height,block.size);top+=row.height;if(top<block.top+block.height-.05)horizontal(top,c.type[0],c.number[0]+c.number[1]);}
   if(!imageCache.has(block.ack.signature.image))imageCache.set(block.ack.signature.image,await pdf.embedPng(block.ack.signature.image));
   const image=imageCache.get(block.ack.signature.image),[x,width]=c.signature,scale=Math.min((width-8)/image.width,Math.min(35,block.height-6)/image.height);
   page.drawImage(image,{x:x+(width-image.width*scale)/2,y:page.getHeight()-block.top-(block.height+image.height*scale)/2,width:image.width*scale,height:image.height*scale});
   horizontal(block.top);horizontal(block.top+block.height);
  }
  // Keep the unused table area blank and ruled, ready to read as part of the
  // same source form rather than stretching the final person's signature.
  for(let top=region.cursor;top<region.bottom-.05;){const blockHeight=Math.min(region.unit*3,region.bottom-top);for(let i=1;i<3;i++)horizontal(top+blockHeight*i/3,c.type[0],c.number[0]+c.number[1]);top+=blockHeight;horizontal(top);}
  for(const x of [left,...fields.map(key=>c[key][0]+c[key][1])])page.drawLine({start:{x,y:page.getHeight()-region.top},end:{x,y:page.getHeight()-region.bottom},thickness:.5,color:rule});
  horizontal(region.top);horizontal(region.bottom);
 }
}

// A supervisor-only form has no worker table to extend. Continue the affected
// people's sign-offs on a standard table, retaining their original signatures
// and dates alongside the combined licence rows.
export async function appendSafetyLicenceSignoffPage(pdf,font,version,acknowledgements,updates){
 if(!updates?.entries.size)return;
 const page=pdf.addPage([842.04,594.96]),width=page.getWidth(),height=page.getHeight(),{lines,draw}=textTools(font),left=28;
 const heading=(value,top,size)=>{
  const values=lines(value,width-left*2,size);draw(page,values,left,top,width-left*2,values.length*(size+1)+2,size);
 };
 heading('Lennox Facades',24,17);heading('SWMS sign-off continuation',47,13);
 heading(version.title+' · '+version.label,69,9);
 const widths=[100,115,140,60,105,105,161],columns={};let x=left;
 fields.forEach((key,i)=>{columns[key]=[x,widths[i]];x+=widths[i];});
 const headings=['Name','Role','Type / Description','Class','Number','Date','Signature'];
 page.drawRectangle({x:left,y:height-156,width:x-left,height:20,color:ink});
 fields.forEach((key,i)=>page.drawText(headings[i],{x:columns[key][0]+3,y:height-149,font,size:7,color:white}));
 const rows=Array.from({length:11},(_,i)=>({top:156+i*36,height:36}));
 await fillExpandedSafetySignoff(pdf,font,[{page:pdf.getPageCount(),width,height,columns,rows}],acknowledgements.filter(ack=>updates.entries.has(ack.id)),updates);
}

export function legacySafetySignoffTables(pdf,firstPage,continuationPage){
 const columns={name:[52.92,98.28],role:[151.2,140.52],type:[291.72,89.88],class:[381.6,89.88],number:[471.48,89.88],date:[561.36,80.64],signature:[642,110.88]};
 return [{page:firstPage,top:277.5,count:8},{page:continuationPage,top:161.7,count:9}].map(({page,top,count})=>{
  const actual=pdf.getPage(page-1),sx=actual.getWidth()/792,sy=actual.getHeight()/612;
  return {page,width:actual.getWidth(),height:actual.getHeight(),columns:Object.fromEntries(Object.entries(columns).map(([key,[x,width]])=>[key,[x*sx,width*sx]])),rows:Array.from({length:count},(_,i)=>({top:(top+i*30.6)*sy,height:30.6*sy}))};
 });
}
