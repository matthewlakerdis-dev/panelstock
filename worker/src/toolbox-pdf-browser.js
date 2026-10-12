import {createToolboxPdf} from './toolbox-pdf.js';
import dailyTemplate from '../assets/prestart.pdf';
import weeklyTemplate from '../assets/weekly.pdf';
import font from '../assets/DejaVuSans.ttf';
import logo from '../assets/prestart-logo.jpg';
// Crop only the export copy; the stored signature and its content hash stay intact.
async function cropSignature(sig){if(!sig)return sig;const image=new Image();image.src=sig.image;await image.decode();const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);const {data}=ctx.getImageData(0,0,canvas.width,canvas.height);let left=canvas.width,top=canvas.height,right=-1,bottom=-1;for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++){const i=(y*canvas.width+x)*4;if(data[i+3]>32&&Math.min(data[i],data[i+1],data[i+2])<220){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}}if(right<0)return sig;left=Math.max(0,left-4);top=Math.max(0,top-4);right=Math.min(canvas.width-1,right+4);bottom=Math.min(canvas.height-1,bottom+4);const cropped=document.createElement('canvas');cropped.width=right-left+1;cropped.height=bottom-top+1;cropped.getContext('2d').drawImage(canvas,left,top,cropped.width,cropped.height,0,0,cropped.width,cropped.height);return {...sig,image:cropped.toDataURL('image/png')};}
export async function createPdf(record){const copy=structuredClone(record);for(const p of copy.people)p.signature=await cropSignature(p.signature);copy.supervisorSignature=await cropSignature(copy.supervisorSignature);return createToolboxPdf(copy,copy.type==='weekly'?weeklyTemplate:dailyTemplate,font,logo);}

