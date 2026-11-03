import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
const moduleURL=s=>`data:text/javascript;base64,${Buffer.from(s).toString('base64')}`;
const safetyURL=moduleURL(stripTypeScriptTypes(await readFile(new URL('../lib/image-safety.ts',import.meta.url),'utf8'),{mode:'strip'}));
const {rasterMime,stripImageMetadata}=await import(safetyURL);
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=','base64');
const chunk=(name,content,little=false)=>{const size=Buffer.alloc(4);little?size.writeUInt32LE(content.length):size.writeUInt32BE(content.length);return little?Buffer.concat([Buffer.from(name),size,content,Buffer.alloc(content.length%2)]):Buffer.concat([size,Buffer.from(name),content,Buffer.alloc(4)])};
const privateBytes=Buffer.from('GPS: exact location; device and date');
const pngWithMetadata=Buffer.concat([png.subarray(0,-12),...['eXIf','tEXt','iTXt','zTXt','tIME'].map(name=>chunk(name,privateBytes)),png.subarray(-12)]);
assert.deepEqual(Buffer.from(stripImageMetadata(pngWithMetadata)),png);
assert.deepEqual(Buffer.from(stripImageMetadata(png)),png);
const jpegSegment=marker=>Buffer.concat([Buffer.from([255,marker,0,privateBytes.length+2]),privateBytes]);
const jpeg=Buffer.from([255,216,255,218,0,2,1,2,3,255,217]);
assert.deepEqual(Buffer.from(stripImageMetadata(Buffer.concat([jpeg.subarray(0,2),jpegSegment(225),jpegSegment(226),jpegSegment(254),jpeg.subarray(2)]))),jpeg);
const vp8x=Buffer.alloc(10);vp8x[0]=0x3c; // metadata flags plus alpha flag
const webpChunks=Buffer.concat([chunk('VP8X',vp8x,true),chunk('VP8 ',Buffer.alloc(10),true),...['EXIF','XMP ','ICCP'].map(name=>chunk(name,privateBytes,true))]);
const header=Buffer.alloc(12);header.write('RIFF');header.writeUInt32LE(webpChunks.length+4,4);header.write('WEBP',8);
const webp=Buffer.concat([header,webpChunks]),clean=Buffer.from(stripImageMetadata(webp));
assert.equal(clean.readUInt32LE(4),clean.length-8);
assert.equal(clean[20],0x10,'Transparency flag remains while metadata flags disappear.');
assert.ok(!clean.includes(privateBytes));assert.equal(rasterMime(clean),'image/webp');
for(const input of [Buffer.from('<svg onload="alert(1)"/>'),Buffer.from('<html><script>x</script>'),Buffer.from('RIFF0000WEBP'),Buffer.concat([png,Buffer.from('hidden data')])])assert.throws(()=>stripImageMetadata(input));
const truncated=Buffer.from(webp);truncated.writeUInt32LE(0xffffffff,16);assert.throws(()=>stripImageMetadata(truncated));
let optimizeSource=stripTypeScriptTypes(await readFile(new URL('../lib/optimize-image.ts',import.meta.url),'utf8'),{mode:'strip'}).replace("'./image-safety'",JSON.stringify(safetyURL));
const {optimizeImage}=await import(moduleURL(optimizeSource));
let decoded=0,closed=0,drawn=0,requestedFormat,requestedQuality,canvas;
globalThis.createImageBitmap=async()=>{decoded++;return {width:2400,height:1600,close(){closed++}}};
globalThis.document={createElement(kind){assert.equal(kind,'canvas');canvas={width:0,height:0,getContext(){return {drawImage(){drawn++}}},toBlob(callback,format,quality){requestedFormat=format;requestedQuality=quality;callback(new Blob([webp],{type:format}))}};return canvas}};
try{
 const result=await optimizeImage(new File([pngWithMetadata],'foto.png',{type:'image/png'}));
 assert.equal(result.type,'image/webp');assert.equal(result.name,'ramo-imagen.webp');
 assert.equal(canvas.width,1200);assert.equal(canvas.height,800);assert.equal(requestedFormat,'image/webp');assert.equal(requestedQuality,.8);
 assert.equal(drawn,1);assert.equal(closed,1);assert.deepEqual(Buffer.from(await result.arrayBuffer()),clean);
 for(const file of [new File([png],'foto.svg',{type:'image/png'}),new File(['<svg/>'],'foto.png',{type:'image/png'}),new File([png],'foto.jpg',{type:'image/jpeg'}),new File([new Uint8Array(5*1024*1024+1)],'grande.png',{type:'image/png'})])await assert.rejects(()=>optimizeImage(file));
 assert.equal(decoded,1,'Unsafe files are rejected before browser decoding.');
}finally{delete globalThis.document;delete globalThis.createImageBitmap}
console.log('PASS image privacy: PNG/JPEG/WebP metadata removal, malformed files, MIME/extension/signature/size validation and browser canvas conversion contract. Actual browser rendering still requires interactive QA.');
