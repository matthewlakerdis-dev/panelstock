// Keep base64 conversion bounded for order files on the Worker and phone paths.
export function decodeOrderFile(data){
 const padding=data.endsWith('==')?2:data.endsWith('=')?1:0;
 const bytes=new Uint8Array(data.length/4*3-padding);
 for(let offset=0;offset<data.length;offset+=32768){
  const chunk=atob(data.slice(offset,offset+32768)),start=offset/4*3;
  for(let i=0;i<chunk.length;i++)bytes[start+i]=chunk.charCodeAt(i);
 }
 return bytes;
}
