// Server and browser share the same raster allowlist and metadata stripping.
export function rasterMime(bytes: Uint8Array): string {
 if(bytes.length>=24&&[137,80,78,71,13,10,26,10].every((b,i)=>bytes[i]===b))return 'image/png';
 if(bytes.length>=4&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255&&bytes[bytes.length-2]===255&&bytes[bytes.length-1]===217)return 'image/jpeg';
 if(bytes.length>=20&&new TextDecoder().decode(bytes.slice(0,4))==='RIFF'&&new TextDecoder().decode(bytes.slice(8,12))==='WEBP'&&['VP8 ','VP8L','VP8X'].includes(new TextDecoder().decode(bytes.slice(12,16)))&&new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(4,true)+8===bytes.length)return 'image/webp';
 throw Error('El contenido no corresponde a una imagen JPG, PNG o WebP válida.');
}
function join(parts:Uint8Array[]):Uint8Array{const out=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let n=0;for(const p of parts){out.set(p,n);n+=p.length}return out}
export function stripImageMetadata(bytes:Uint8Array):Uint8Array{
 const mime=rasterMime(bytes),v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 if(mime==='image/webp'){
  const parts=[bytes.slice(0,12)];let i=12;
  while(i<bytes.length){if(i+8>bytes.length)throw Error('Imagen WebP incompleta.');const size=v.getUint32(i+4,true),end=i+8+size+(size%2);if(end>bytes.length)throw Error('Imagen WebP incompleta.');const name=new TextDecoder().decode(bytes.slice(i,i+4));if(!['EXIF','XMP ','ICCP'].includes(name)){const p=bytes.slice(i,end);if(name==='VP8X'&&p.length>=18)p[8]&=~(0x20|0x08|0x04);parts.push(p)}i=end}
  const out=join(parts);new DataView(out.buffer).setUint32(4,out.length-8,true);return out;
 }
 if(mime==='image/png'){
  const parts=[bytes.slice(0,8)];let i=8;
  while(i<bytes.length){if(i+12>bytes.length)throw Error('Imagen PNG incompleta.');const size=v.getUint32(i),end=i+12+size;if(end>bytes.length)throw Error('Imagen PNG incompleta.');const name=new TextDecoder().decode(bytes.slice(i+4,i+8));if(!['eXIf','tEXt','zTXt','iTXt','tIME'].includes(name))parts.push(bytes.slice(i,end));i=end;if(name==='IEND'){if(i!==bytes.length)throw Error('La imagen contiene datos adicionales.');return join(parts)}}throw Error('Imagen PNG incompleta.');
 }
 const parts=[bytes.slice(0,2)];let i=2;
 while(i<bytes.length){const start=i;if(bytes[i++]!==255)throw Error('Imagen JPEG incompleta.');while(bytes[i]===255)i++;const marker=bytes[i++];if(marker===0xda){parts.push(bytes.slice(start));return join(parts)}if(marker===0xd9){parts.push(bytes.slice(start,i));return join(parts)}if(i+2>bytes.length)throw Error('Imagen JPEG incompleta.');const size=v.getUint16(i),end=i+size;if(size<2||end>bytes.length)throw Error('Imagen JPEG incompleta.');if(!((marker>=0xe1&&marker<=0xef)||marker===0xfe))parts.push(bytes.slice(start,end));i=end}throw Error('Imagen JPEG incompleta.');
}
