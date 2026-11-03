/** Embed browser-rendered JPEG pages in a PDF without a remote conversion service. */
export function rasterPDF(pages:Uint8Array[]):Uint8Array{
 if(!pages.length)throw Error('No hay páginas para guardar.');
 const encode=(text:string)=>new TextEncoder().encode(text),chunks:Uint8Array[]=[],offsets:number[]=[0];let length=0;
 const append=(bytes:Uint8Array)=>{chunks.push(bytes);length+=bytes.length};
 const object=(id:number,parts:(string|Uint8Array)[])=>{offsets[id]=length;append(encode(`${id} 0 obj\n`));for(const part of parts)append(typeof part==='string'?encode(part):part);append(encode('\nendobj\n'))};
 append(new Uint8Array([37,80,68,70,45,49,46,52,10,37,226,227,207,211,10]));
 object(1,['<< /Type /Catalog /Pages 2 0 R >>']);
 object(2,[`<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_,i)=>`${3+i*3} 0 R`).join(' ')}] >>`]);
 pages.forEach((image,index)=>{const pageId=3+index*3,imageId=pageId+1,contentId=pageId+2,content='q 595 0 0 842 0 0 cm /Image0 Do Q';
  object(pageId,[`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Image0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`]);
  object(imageId,[`<< /Type /XObject /Subtype /Image /Width 1190 /Height 1684 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.length} >>\nstream\n`,image,'\nendstream']);
  object(contentId,[`<< /Length ${encode(content).length} >>\nstream\n${content}\nendstream`]);
 });
 const xref=length;append(encode(`xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets.slice(1).map(offset=>String(offset).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`));
 const bytes=new Uint8Array(length);let cursor=0;for(const chunk of chunks){bytes.set(chunk,cursor);cursor+=chunk.length}return bytes;
}
