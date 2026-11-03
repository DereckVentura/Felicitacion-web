import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
const source=stripTypeScriptTypes(await readFile(new URL('../lib/editor-network.ts',import.meta.url),'utf8'),{mode:'strip'});
const {editorJSON,editorBlob}=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const nativeFetch=globalThis.fetch;
let checks=0;
const check=(value,message)=>{assert.ok(value,message);checks++};
try{
 let received;
 globalThis.fetch=async(url,init)=>{received={url,init};return Response.json({letter:'Carta guardada',photos:[]})};
 const card=await editorJSON('/api/editor',{headers:{Authorization:'Bearer private-test-only'}});
 check(card.letter==='Carta guardada','existing text is returned');
 check(received.init.headers.Authorization==='Bearer private-test-only'&&received.init.cache==='no-store','private editor keeps auth and bypasses stale cache');
 globalThis.fetch=async()=>Response.json({error:'Este sobre está sellado y ya no admite cambios.'},{status:403});
 await assert.rejects(editorJSON('/api/editor'),/sellado/);checks++;
 globalThis.fetch=async()=>new Response('<html>gateway unavailable</html>',{status:502});
 await assert.rejects(editorJSON('/api/editor'),/respuesta del servidor/);checks++;
 let stalledSignal;
 globalThis.fetch=async(url,init)=>{stalledSignal=init.signal;return await new Promise(()=>{})};
 await assert.rejects(editorJSON('/api/editor',{},15),/tardó demasiado/);checks++;
 check(stalledSignal.aborted,'timeout also aborts the network request');
 // A response can start successfully while its body never finishes.
 globalThis.fetch=async(url,init)=>{stalledSignal=init.signal;return {ok:true,json:()=>new Promise(()=>{})}};
 await assert.rejects(editorJSON('/api/editor',{},15),/tardó demasiado/);checks++;
 check(stalledSignal.aborted,'stalled JSON body is aborted');
 globalThis.fetch=async(url,init)=>{stalledSignal=init.signal;return {ok:true,blob:()=>new Promise(()=>{})}};
 await assert.rejects(editorBlob('/api/media/test',{},15),/tardó demasiado/);checks++;
 check(stalledSignal.aborted,'stalled photo/audio body is aborted');
 globalThis.fetch=async()=>new Response(new Uint8Array([1,2,3]),{headers:{'Content-Type':'audio/wav'}});
 check((await editorBlob('/api/audio/test')).size===3,'voice or photo loads normally');
 const controller=new AbortController();
 globalThis.fetch=async(url,init)=>new Promise((resolve,reject)=>{init.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true})});
 const pending=editorBlob('/api/media/test',{signal:controller.signal});controller.abort();
 await assert.rejects(pending,{name:'AbortError'});checks++;
 console.log(`PASS editor network: ${checks} checks, including hung request, hung bodies, cancellation, authorization and server errors.`);
}finally{globalThis.fetch=nativeFetch}
