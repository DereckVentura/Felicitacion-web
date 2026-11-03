/** PCM WAV used by both audio imports and the soundtrack extracted from a local video. */
export function pcmWav(input:Float32Array,sampleRate:number):Blob{
 const count=Math.min(45*16000,Math.floor(input.length*16000/sampleRate));
 if(!count)throw Error('El archivo no contiene audio.');
 const bytes=new ArrayBuffer(44+count*2),v=new DataView(bytes);
 const text=(offset:number,s:string)=>{for(let i=0;i<s.length;i++)v.setUint8(offset+i,s.charCodeAt(i))};
 text(0,'RIFF');v.setUint32(4,bytes.byteLength-8,true);text(8,'WAVEfmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,16000,true);v.setUint32(28,32000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);text(36,'data');v.setUint32(40,count*2,true);
 for(let i=0;i<count;i++){const pos=i*sampleRate/16000,idx=Math.floor(pos),blend=pos-idx,sample=(input[idx]||0)*(1-blend)+(input[Math.min(idx+1,input.length-1)]||0)*blend;v.setInt16(44+i*2,Math.max(-1,Math.min(1,sample))*32767,true)}
 return new Blob([bytes],{type:'audio/wav'});
}
export async function extractAudio(file:File,{start=0,seconds=30,signal,onProgress}:{start?:number;seconds?:number;signal?:AbortSignal;onProgress?:(seconds:number)=>void}={}):Promise<Blob>{
 if(!file.size||file.size>80*1024*1024)throw Error('Elige un archivo de hasta 80 MB.');
 if(!Number.isFinite(start)||start<0||![15,30,45].includes(seconds))throw Error('Revisa el fragmento que quieres usar.');
 signal?.throwIfAborted();
 if(!file.type.startsWith('video/')&&!/\.(mp4|mov|webm|m4v)$/i.test(file.name)){
  if(file.size>20*1024*1024)throw Error('El audio debe pesar hasta 20 MB. Para un video puedes usar hasta 80 MB.');
  const context=new AudioContext();
  try{
   const audio=await context.decodeAudioData(await file.arrayBuffer());signal?.throwIfAborted();
   const offset=Math.floor(start*audio.sampleRate),length=Math.min(Math.floor(seconds*audio.sampleRate),audio.length-offset);
   if(length<=0)throw Error('El inicio del fragmento está después del final del audio.');
   const mono=new Float32Array(length);for(let channel=0;channel<audio.numberOfChannels;channel++){const data=audio.getChannelData(channel);for(let i=0;i<length;i++)mono[i]+=data[offset+i]/audio.numberOfChannels}
   return pcmWav(mono,audio.sampleRate);
  }catch(e){if(signal?.aborted)throw e;throw Error(e instanceof Error&&e.message.startsWith('El inicio')?e.message:'No pudimos leer este audio. Prueba un archivo MP3, M4A o WAV compatible con tu navegador.');}
  finally{await context.close()}
 }
 // Video uses the browser's media decoder, then captures only its audio graph.
 // The video itself is never uploaded and no microphone permission is requested.
 const context=new AudioContext(),media=document.createElement('video'),url=URL.createObjectURL(file);
 const resume=context.resume();media.playsInline=true;media.preload='auto';media.src=url;
 let source:MediaElementAudioSourceNode|undefined,node:AudioWorkletNode|undefined,finishTimer:ReturnType<typeof setTimeout>|undefined,poll:ReturnType<typeof setInterval>|undefined;
 const chunks:Float32Array[]=[];let count=0,peak=0;
 try{
  await resume;
  if(!context.audioWorklet)throw Error('Este navegador no permite extraer el audio. Prueba Chrome o Edge actualizado.');
  await context.audioWorklet.addModule('/audio-extractor.js');signal?.throwIfAborted();
  await new Promise<void>((resolve,reject)=>{
   const done=()=>{clearTimeout(timer);media.removeEventListener('loadedmetadata',ready);media.removeEventListener('error',failed);signal?.removeEventListener('abort',abort)};
   const ready=()=>{done();resolve()},failed=()=>{done();reject(Error('Este formato de video no se puede abrir aquí. Prueba MP4 con audio AAC.'))},abort=()=>{done();reject(new DOMException('Cancelado','AbortError'))};
   const timer=setTimeout(failed,15000);media.addEventListener('loadedmetadata',ready,{once:true});media.addEventListener('error',failed,{once:true});signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();else if(media.readyState>=1)ready();else media.load();
  });
  if(!Number.isFinite(media.duration)||start>=media.duration)throw Error('Revisa el inicio: debe estar dentro del video.');
  media.currentTime=start;
  source=context.createMediaElementSource(media);node=new AudioWorkletNode(context,'ramo-audio-extractor');source.connect(node);node.connect(context.destination);
  const limit=Math.min(seconds,media.duration-start),max=Math.ceil(limit*context.sampleRate);
  await new Promise<void>((resolve,reject)=>{
   const done=(error?:Error)=>{if(finished)return;finished=true;clearTimeout(finishTimer);clearInterval(poll);media.pause();signal?.removeEventListener('abort',abort);error?reject(error):resolve()};let finished=false;
   const abort=()=>done(new DOMException('Cancelado','AbortError'));signal?.addEventListener('abort',abort,{once:true});
   node!.port.onmessage=e=>{if(finished)return;const block=new Float32Array(e.data);const kept=block.slice(0,Math.max(0,max-count));for(const value of kept)peak=Math.max(peak,Math.abs(value));chunks.push(kept);count+=kept.length;if(count>=max)done()};
   media.onplaying=()=>node!.port.postMessage('start');media.onended=()=>done();media.onerror=()=>done(Error('No pudimos extraer el audio del video.'));
   poll=setInterval(()=>{onProgress?.(Math.min(limit,Math.max(0,media.currentTime-start)));if(media.currentTime>=start+limit)done()},150);
   finishTimer=setTimeout(()=>done(Error('El video dejó de responder. Vuelve a intentarlo con un fragmento más corto.')),(limit+20)*1000);
   if(signal?.aborted)abort();else void media.play().catch(()=>done(Error('No se pudo reproducir el video. Vuelve a pulsar «Usar fragmento» o prueba un MP4 con audio AAC.')));
  });
  if(!count||peak<.00001)throw Error('No encontramos sonido en este fragmento. Elige otro video o cambia el inicio.');
  const samples=new Float32Array(count);let offset=0;for(const chunk of chunks){samples.set(chunk,offset);offset+=chunk.length}
  return pcmWav(samples,context.sampleRate);
 }finally{clearTimeout(finishTimer);clearInterval(poll);media.pause();media.removeAttribute('src');media.load();source?.disconnect();node?.disconnect();URL.revokeObjectURL(url);await context.close()}
}
