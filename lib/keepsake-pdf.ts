import {cardPalette} from './print-card';
import {rasterPDF} from './raster-pdf';
import {editorBlob} from './editor-network';
import {defaultOptions,type LetterOptions} from './letter-options';
export type KeepsakeData={card:{recipient:string;sender?:string;storeName?:string;theme?:string;printColor?:string|null;greetingColor?:string|null;options?:Partial<LetterOptions>};letter:string;photos:{url:string}[]};
export async function createKeepsakePDF({card,letter,photos}:KeepsakeData):Promise<File>{
 const pages:Uint8Array[]=[];
 const palette=cardPalette(card.theme||'rosa',card.greetingColor??card.printColor),o={...defaultOptions,...card.options};
 const canvas=document.createElement('canvas');canvas.width=1190;canvas.height=1684;const context=canvas.getContext('2d');if(!context)throw Error('Tu navegador no pudo preparar el PDF.');const c=context;
 let y=0,pageNumber=0;
 const text=(value:string,size:number,x:number,top:number,align:CanvasTextAlign='left',italic=false)=>{c.font=`${italic?'italic ':''}${size}px Georgia,serif`;c.textAlign=align;c.fillStyle=palette.ink;c.fillText(value,x,top,960)};
 function page(){pageNumber++;c.fillStyle=palette.paper;c.fillRect(0,0,1190,1684);c.strokeStyle=palette.border;c.lineWidth=2;c.strokeRect(46,46,1098,1592);c.lineWidth=1;c.strokeRect(60,60,1070,1564);c.fillStyle=palette.bloom;c.font='18px Arial';c.textAlign='center';c.fillText((card.storeName||'RAMO · RECUERDOS QUE FLORECEN').toLocaleUpperCase('es'),595,112);c.beginPath();c.moveTo(160,145);c.lineTo(1030,145);c.stroke();y=205;}
 async function flush(){c.fillStyle=palette.bloom;c.font='17px Georgia';c.textAlign='left';c.fillText('ramo.',105,1586);c.font='14px Arial';c.textAlign='right';c.fillText(String(pageNumber).padStart(2,'0'),1085,1586);const encoded=canvas.toDataURL('image/jpeg',.92).split(',')[1];pages.push(Uint8Array.from(atob(encoded),character=>character.charCodeAt(0)))}

 const font=o.font==='sans'?'Arial,sans-serif':o.font==='hand'?'cursive':'Georgia,serif',size=Math.round(o.size*1.5),lineHeight=size*o.lineHeight;
 async function line(value:string){if(y+lineHeight>1490){await flush();page();}c.font=`${size}px ${font}`;c.fillStyle=palette.ink;c.textAlign=o.align==='center'?'center':o.align==='right'?'right':'left';c.fillText(value,o.align==='center'?595:o.align==='right'?1040:150,y);y+=lineHeight;}
 page();text('Para',32,595,y,'center',true);y+=68;
 // Long names wrap as part of the title, preserving every character.
 c.font='60px Georgia';let title='';for(const word of card.recipient.split(/\s+/)){if(title&&c.measureText(title+' '+word).width>880){text(title,60,595,y,'center');y+=72;title=word}else title+=(title?' ':'')+word}text(title,60,595,y,'center');y+=55;
 if(card.sender){text('Con cariño, '+card.sender,24,595,y,'center',true);y+=45;}y+=35;
 for(const paragraph of letter.split('\n')){if(!paragraph){await line('');continue}c.font=`${size}px ${font}`;let current='';for(const character of paragraph){if(current&&c.measureText(current+character).width>880){const space=current.lastIndexOf(' ');if(space>0){await line(current.slice(0,space));current=current.slice(space+1)+character;}else{await line(current);current=character;}c.font=`${size}px ${font}`;}else current+=character;}if(current)await line(current);}
 await flush();
 const photoBlobs=await Promise.all(photos.slice(0,5).map(async(photo,index)=>{try{return await editorBlob(photo.url,{},45000);}catch{throw Error(`No pudimos incluir la foto ${index+1}. Vuelve a cargarla antes de crear el PDF.`);}}));
 for(let index=0;index<photoBlobs.length;index++){
  const url=URL.createObjectURL(photoBlobs[index]);
  try{const image=await new Promise<HTMLImageElement>((resolve,reject)=>{const img=new Image();const timer=setTimeout(()=>reject(Error('Una fotografía tardó demasiado en abrirse.')),15000);img.onload=()=>{clearTimeout(timer);resolve(img)};img.onerror=()=>{clearTimeout(timer);reject(Error('No pudimos abrir una fotografía para el PDF.'))};img.src=url;});page();text('Pequeños momentos, grandes recuerdos',26,595,220,'center',true);const scale=Math.min(900/image.naturalWidth,1090/image.naturalHeight),w=image.naturalWidth*scale,h=image.naturalHeight*scale,x=(1190-w)/2,top=300+(1090-h)/2;c.fillStyle='#fffdf8';c.fillRect(x-18,top-18,w+36,h+80);c.strokeStyle=palette.border;c.strokeRect(x-18,top-18,w+36,h+80);c.drawImage(image,x,top,w,h);text(o.captions[index]||`Recuerdo ${String(index+1).padStart(2,'0')}`,21,595,top+h+43,'center');await flush();}finally{URL.revokeObjectURL(url)}
 }
 const bytes=rasterPDF(pages),name=(card.recipient||'para-ti').replace(/[^\p{L}\p{N} -]/gu,'').trim().slice(0,60)||'para-ti';return new File([new Uint8Array(bytes)],`RAMO - ${name}.pdf`,{type:'application/pdf'});
}
