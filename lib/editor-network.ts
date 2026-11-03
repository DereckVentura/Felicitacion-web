/** Bound both the request and its body: a stalled image must never block editing. */
async function readEditor<T>(url:string,init:RequestInit,read:(response:Response)=>Promise<T>,timeoutMs:number):Promise<T>{
 const controller=new AbortController();
 const cancel=()=>controller.abort(init.signal?.reason);
 if(init.signal?.aborted)cancel();
 else init.signal?.addEventListener("abort",cancel,{once:true});
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{
  return await Promise.race([
   (async()=>{
    const response=await fetch(url,{...init,signal:controller.signal,cache:"no-store"});
    return await read(response);
   })(),
   new Promise<never>((_,reject)=>{timer=setTimeout(()=>{
    reject(new Error("La conexión tardó demasiado. Recarga para volver a intentarlo; si estabas guardando, comprueba primero los cambios."));
    controller.abort();
   },timeoutMs);})
  ]);
 }finally{
  clearTimeout(timer);
  init.signal?.removeEventListener("abort",cancel);
 }
}
export function editorJSON<T>(url:string,init:RequestInit={},timeoutMs=20000):Promise<T>{
 return readEditor(url,init,async response=>{
  let data:T&{error?:string};
  try{data=await response.json();}catch{throw new Error("No pudimos abrir la respuesta del servidor. Recarga para intentarlo de nuevo.");}
  if(!response.ok)throw new Error(data.error||"No se pudo completar la acción.");
  return data;
 },timeoutMs);
}
export function editorBlob(url:string,init:RequestInit={},timeoutMs=15000):Promise<Blob>{
 return readEditor(url,init,async response=>{
  if(!response.ok)throw new Error("No pudimos cargar este archivo.");
  return await response.blob();
 },timeoutMs);
}
