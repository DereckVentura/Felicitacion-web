import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
const load=async path=>import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(await readFile(new URL(path,import.meta.url),'utf8'),{mode:'strip'})).toString('base64')}`);
const {pcmWav,extractAudio}=await load('../lib/audio-import.ts');
let n=0;const check=(value,message)=>{assert.ok(value,message);n++};
const wav=await pcmWav(Float32Array.from([1,-1,.5,-.5]),16000).arrayBuffer(),view=new DataView(wav);
check(new TextDecoder().decode(wav.slice(0,4))==='RIFF'&&view.getUint32(24,true)===16000&&view.getUint16(22,true)===1,'valid mono 16 kHz WAV header');
check(view.getInt16(44,true)===32767&&view.getInt16(46,true)===-32767,'signed PCM samples preserve waveform');
check((await pcmWav(new Float32Array(48000),48000).arrayBuffer()).byteLength===32044,'resample to 16 kHz');
check((await pcmWav(new Float32Array(16000*50),16000).arrayBuffer()).byteLength===1440044,'output limited to 45 seconds');
await assert.rejects(extractAudio(new File([], 'empty.mp4',{type:'video/mp4'})),/hasta 80 MB/);n++;
await assert.rejects(extractAudio(new File(['x'],'test.wav'),{start:-1}),/Revisa/);n++;
const original=globalThis.AudioContext;let closed=0;
globalThis.AudioContext=class{async decodeAudioData(){return {sampleRate:16000,length:32000,numberOfChannels:2,getChannelData:channel=>new Float32Array(32000).fill(channel===0?1:-.5)}}async close(){closed++}};
try{const imported=await extractAudio(new File(['audio'],'source.wav',{type:'audio/wav'}),{start:1,seconds:15});const b=new DataView(await imported.arrayBuffer());check(imported.size===32044&&b.getInt16(44,true)===8191,'selected segment and stereo-to-mono mix');check(closed===1,'audio context released');const cancelled=new AbortController();cancelled.abort();await assert.rejects(extractAudio(new File(['x'],'source.mp4'),{signal:cancelled.signal}),{name:'AbortError'});n++;}finally{globalThis.AudioContext=original}
const {rasterPDF}=await load('../lib/raster-pdf.ts');
const pages=[new Uint8Array([255,216,255,217]),new Uint8Array([255,216,1,2,3,255,217])],pdf=rasterPDF(pages),text=new TextDecoder('latin1').decode(pdf);
check(text.startsWith('%PDF-1.4')&&text.includes('/Count 2'),'multipage PDF header and page tree');
const xref=Number(text.match(/startxref\n(\d+)/)[1]);check(new TextDecoder().decode(pdf.slice(xref,xref+4))==='xref','xref uses byte offsets even with binary data');
const entries=text.slice(xref).split('\n').slice(3,11);for(let i=0;i<entries.length;i++){const offset=Number(entries[i].slice(0,10));check(new TextDecoder().decode(pdf.slice(offset,offset+12)).startsWith(`${i+1} 0 obj`),'every PDF object offset resolves');}
check(text.includes('/DCTDecode')&&text.includes('/MediaBox [0 0 595 842]'),'JPEG pages use A4 geometry');
assert.throws(()=>rasterPDF([]),/páginas/);n++;
await mkdir(new URL('../work/',import.meta.url),{recursive:true});await writeFile(new URL('../work/keepsake-structure.pdf',import.meta.url),pdf);
console.log(`PASS audio import and PDF: ${n} assertions for PCM, trimming, limits, cleanup, cancellation and PDF binary offsets.`);
