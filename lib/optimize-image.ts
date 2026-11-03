import {rasterMime,stripImageMetadata} from './image-safety';
export const IMAGE_PRIVACY_NOTICE='✓ Imagen optimizada y metadatos GPS eliminados por privacidad';
export async function optimizeImage(file:File):Promise<File>{
 if(!file.size||file.size>5*1024*1024)throw Error('Elige una imagen de hasta 5 MB.');
 if(!['image/png','image/jpeg','image/webp'].includes(file.type)||!/^.+\.(png|jpe?g|webp)$/i.test(file.name))throw Error('Solo se admiten archivos JPG, PNG o WebP. SVG y HTML no están permitidos.');
 const source=new Uint8Array(await file.arrayBuffer());if(rasterMime(source)!==file.type)throw Error('El contenido no coincide con el tipo de imagen.');
 const bitmap=await createImageBitmap(file);
 try{
  if(!bitmap.width||!bitmap.height||bitmap.width>10000||bitmap.height>10000||bitmap.width*bitmap.height>40_000_000)throw Error('La imagen tiene demasiada resolución.');
  const ratio=Math.min(1,1200/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*ratio));canvas.height=Math.max(1,Math.round(bitmap.height*ratio));const ctx=canvas.getContext('2d');if(!ctx)throw Error('No pudimos preparar la imagen.');ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
  const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('No pudimos convertir la imagen.')),'image/webp',.8));if(blob.type!=='image/webp')throw Error('Este navegador no permite exportar WebP. Prueba un navegador actualizado.');
  const clean=stripImageMetadata(new Uint8Array(await blob.arrayBuffer()));if(clean.length>3*1024*1024)throw Error('La imagen optimizada sigue siendo demasiado grande.');return new File([clean as BlobPart],'ramo-imagen.webp',{type:'image/webp'});
 }finally{bitmap.close()}
}
