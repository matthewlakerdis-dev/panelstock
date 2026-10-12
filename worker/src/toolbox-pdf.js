import {PDFDocument,rgb} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import {TOOLBOX_TITLES} from './toolbox.js';

// Coordinates are measured from the top of each supplied daily/weekly PDF.
// Keep its logo, printed questions and tables; write only inside the blank cells.
export async function createToolboxPdf(record,templateBytes,fontBytes,logoBytes,exportedAt=new Date().toISOString()){
 const pdf=await PDFDocument.create();pdf.registerFontkit(fontkit);
 const font=await pdf.embedFont(fontBytes,{subset:true});
 const template=await PDFDocument.load(templateBytes);
 const [first,second]=await pdf.copyPages(template,[0,1]);pdf.addPage(first);pdf.addPage(second);
 const width=first.getWidth(),height=first.getHeight(),ink=rgb(.08,.13,.16);
 const supported=new Set(font.getCharacterSet());
 const clean=value=>{const text=String(value??'').replace(/\r\n?/g,'\n').replace(/\t/g,'    ').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'');for(const c of text)if(c!=='\n'&&!supported.has(c.codePointAt(0)))throw Error('The PDF font cannot display '+c+'. Please use a supported character in this record.');return text;};
 const write=(page,text,x,top,size=10)=>page.drawText(clean(text),{x,y:height-top-size,font,size,color:ink});
 const date=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||'')?value.split('-').reverse().join('/'):(value||'Not recorded');
 const stamp=value=>value?new Date(value).toLocaleString('en-AU',{timeZone:'Australia/Brisbane'})+' AEST':'Not recorded';
 function lines(value,max,size){const result=[];for(const paragraph of clean(value).split('\n')){if(!paragraph){result.push('');continue;}let line='';for(const c of paragraph){if(line&&font.widthOfTextAtSize(line+c,size)>max){const space=line.lastIndexOf(' ');if(space>0){result.push(line.slice(0,space));line=line.slice(space+1)+c;}else{result.push(line);line=c;}}else line+=c;}result.push(line);}return result;}
 const overflow=[];
 function box(page,value,x,top,max,count,pitch,label){const all=lines(value||'Not recorded',max,9.5);const needs=all.length>count;const visible=all.slice(0,needs?count-1:count);visible.forEach((s,i)=>write(page,s,x,top+i*pitch,9.5));if(needs){write(page,'Continued in attached notes',x,top+(count-1)*pitch,9);overflow.push({title:label+' (continued)',text:all.slice(count-1).join('\n')});}}
 function fitted(page,value,x,top,max){let size=10;const text=clean(value);while(size>7&&font.widthOfTextAtSize(text,size)>max)size-=.25;if(font.widthOfTextAtSize(text,size)<=max)write(page,text,x,top,size);else box(page,text,x,top,max,1,12,'Session details');}
 async function signature(page,sig,x,top,maxW,maxH){if(!sig){write(page,'Not signed',x,top,8);return;}const png=await pdf.embedPng(sig.image);const scale=Math.min(maxW/png.width,maxH/png.height);page.drawImage(png,{x,y:height-top-png.height*scale,width:png.width*scale,height:png.height*scale});}
 const people=record.people||[];
 if(record.type==='daily'){
  fitted(first,record.site,80,132,550);fitted(first,date(record.date),675,132,130);fitted(first,record.facilitator,143,150,660);
  const checklist=record.prestart?.checklist||[];
  const cells=[[274,220],[274,238],[274,256],[274,280],[274,303],[535,220],[535,238],[535,256],[535,280],[797,220],[797,238],[797,256],[797,280]];
  cells.forEach(([x,y],i)=>fitted(first,checklist[i]||'—',x,y,17));
  box(first,record.tasks,36,363,773,9,21,'Tasks for the day');
  box(second,record.prestart?.highRisk,36,120,773,11,21,'High-risk activities');
  box(second,record.prestart?.previousShift,36,372,773,8,21,'Issues from the previous shift');
  for(let offset=0;offset<Math.max(1,people.length);offset+=17){const [page]=await pdf.copyPages(template,[3]);pdf.addPage(page);for(const [i,p] of people.slice(offset,offset+17).entries()){const top=195+i*20.45;fitted(page,date(record.date),36,top+4,102);fitted(page,p.name,148,top+4,246);fitted(page,p.timeIn||'—',405,top+4,88);fitted(page,p.timeOut||'—',504,top+4,88);await signature(page,p.signature,604,top+1,202,16);}}
 }else{
  function weeklyHeader(page){fitted(page,record.site,97,125,316);fitted(page,date(record.date),457,125,96);fitted(page,record.facilitator,122,144,428);fitted(page,record.focus,108,163,442);}
  weeklyHeader(first);
  const content=i=>'Talking points: '+record.topics[i].text+'\nComments: '+(record.topics[i].notes||'None recorded')+'\nDiscussed: '+(record.topics[i].reviewed?'Yes':'No');
  box(first,content(0),60,633,491,5,21.9,TOOLBOX_TITLES[0]);
  for(const [i,top,count] of [[1,136,6],[2,289,6],[3,442,6],[5,595,7]])box(second,content(i),60,top,491,count,21.9,TOOLBOX_TITLES[i]);
  for(let offset=0;offset<Math.max(1,people.length);offset+=15){let page=first;if(offset){[page]=await pdf.copyPages(template,[0]);pdf.addPage(page);weeklyHeader(page);box(page,'Attendance continues from the first sheet. Discussion is recorded on the first two sheets and accompanying notes.',60,633,491,5,21.9,'Attendance continuation');}for(const [i,p] of people.slice(offset,offset+15).entries()){const top=244+i*21.9;fitted(page,p.name,60,top+5,203);fitted(page,p.employer||'—',276,top+5,135);await signature(page,p.signature,420,top+2,134,16);}}
 }
 // All discussion and action content belongs to the signed record, even when it
 // has no matching box on the original paper form. Paginate rather than truncate.
 const logo=await pdf.embedJpg(Uint8Array.from(logoBytes));
 let page,y;
 function newNotes(){page=pdf.addPage([width,height]);page.drawImage(logo,{x:30,y:height-91,width:150,height:150*logo.height/logo.width});const x=record.type==='weekly'?205:280;write(page,record.type==='weekly'?'WEEKLY TOOLBOX — NOTES':'DAILY PRESTART — NOTES',x,38,14);let summary=record.site+' · '+date(record.date);while(font.widthOfTextAtSize(summary,9)>width-x-32)summary=summary.slice(0,-2);write(page,summary,x,61,9);y=110;}
 function ensure(space){if(!page||y+space>height-45)newNotes();}
 function heading(text){ensure(38);write(page,text,32,y,12);y+=22;}
 function paragraph(text){const all=lines(text||'Not recorded',width-64,10);for(const line of all){ensure(16);write(page,line,32,y,10);y+=15;}y+=10;}
 heading('Session details');paragraph('Project: '+record.site+'\nCompany: '+(record.company||'Not recorded')+'\nStart time: '+record.time+'\nSupervisor / foreman: '+record.facilitator+'\nFocus / team: '+(record.focus||'Not recorded')+'\nRecord status: '+record.status);
 if(record.type==='weekly'){heading('Work and changes this week');paragraph(record.tasks);if(record.prestart){heading('Previously recorded inspection details');paragraph('High-risk activities: '+record.prestart.highRisk+'\nPrevious-shift issues: '+record.prestart.previousShift+'\nInspection results: '+record.prestart.checklist.map((v,i)=>(i+1)+': '+(v||'Not recorded')).join(', '));}}
 for(const extra of overflow){heading(extra.title);paragraph(extra.text);}
 for(const [i,t] of record.topics.entries()){heading((i+1)+'. '+TOOLBOX_TITLES[i]);paragraph('Talking points: '+t.text);paragraph('Comments / discussion / agreed controls: '+(t.notes||'None recorded'));paragraph('Discussed: '+(t.reviewed?'Yes':'No'));}
 heading('Follow-up actions');if(!record.actions.length)paragraph('No actions recorded');for(const [i,a] of record.actions.entries())paragraph((i+1)+'. '+a.text+'\nOwner: '+a.owner+' · Due: '+date(a.due)+'\nStatus: '+(a.closed?'Resolved '+stamp(a.resolvedAt)+' by '+(a.resolvedBy||'Not recorded'):'Open'));
 heading('Attendance acknowledgement');paragraph(record.type==='weekly'?'Each attendee signed on the supervisor’s device to acknowledge the issues discussed as understood and an opportunity to ask questions.':'Each attendee signed on the supervisor’s device to acknowledge attendance and an opportunity to ask questions. Attendance times are entered by the supervisor; a blank time is not inferred from the signature.');for(const p of people)paragraph(p.name+' · Employer: '+(p.employer||'Not recorded')+' · Time in / out: '+(p.timeIn||'Not recorded')+' / '+(p.timeOut||'Not recorded')+' · Acknowledgement: '+(p.ack?'Yes':'No')+' · Signed: '+stamp(p.signature?.at));
 heading('Supervisor sign-off');paragraph('I confirm I conducted this talk and recorded the attendance, discussion and agreed actions.');paragraph(record.facilitator+' · Signed: '+stamp(record.supervisorSignature?.at));ensure(65);await signature(page,record.supervisorSignature,32,y,200,60);y+=70;
 heading('Record details');paragraph('Record ID: '+record.id+'\nCompleted: '+stamp(record.completedAt)+'\nExported: '+stamp(exportedAt));
 if(record.status!=='Completed')paragraph('DRAFT — This record has not been completed.');
 const pages=pdf.getPages();for(const [i,p] of pages.entries()){write(p,(record.status==='Completed'?'COMPLETED':'DRAFT')+' · '+record.id,32,height-25,7);write(p,'Page '+(i+1)+' of '+pages.length,width-100,height-25,7);}
 pdf.setTitle((record.type==='weekly'?'Weekly toolbox talk':'Factory daily prestart')+' — '+record.site);pdf.setAuthor(record.facilitator);pdf.setSubject('PanelStock toolbox record '+record.id);pdf.setCreationDate(new Date(exportedAt));
 return pdf.save();
}
