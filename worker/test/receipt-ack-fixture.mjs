import UPNGModule from '@pdf-lib/upng';
const UPNG=UPNGModule.default||UPNGModule;
const width=300,height=100,pixels=new Uint8Array(width*height*4).fill(255);
for(let x=30;x<260;x++)for(let y=45;y<51;y++){const i=(y*width+x)*4;pixels[i]=pixels[i+1]=pixels[i+2]=15;}
const image='data:image/png;base64,'+Buffer.from(UPNG.encode([pixels.buffer],width,height,0)).toString('base64');
export const receiptAck=()=>({name:'Site Recipient',image});
