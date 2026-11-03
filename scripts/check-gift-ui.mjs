import assert from 'node:assert/strict';
import ts from 'typescript';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const root=fileURLToPath(new URL('../',import.meta.url)),output=path.join(root,'work','ui-check'),seen=new Set();
async function compile(file){const target=path.join(output,path.relative(root,file).replace(/\.tsx?$/,'.mjs'));if(seen.has(file))return target;seen.add(file);let source=await readFile(file,'utf8');
 const specs=[...source.matchAll(/(?:from\s*|import\s*\()(["'])([^"']+)\1/g)].map(m=>m[2]);
 for(const spec of specs){if(!(spec.startsWith('@/')||spec.startsWith('.')))continue;const base=spec.startsWith('@/')?path.join(root,spec.slice(2)):path.resolve(path.dirname(file),spec);let found;for(const extension of ['.tsx','.ts']){try{await readFile(base+extension);found=base+extension;break}catch{}}if(found){const resolved=await compile(found);source=source.split(JSON.stringify(spec)).join(JSON.stringify(pathToFileURL(resolved).href)).split("'"+spec+"'").join(JSON.stringify(pathToFileURL(resolved).href));}}
 await mkdir(path.dirname(target),{recursive:true});await writeFile(target,ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText);return target;
}
const giftPath=await compile(path.join(root,'components','GiftView.tsx')),controlsPath=await compile(path.join(root,'components','LetterControls.tsx'));
const {default:GiftView}=await import(pathToFileURL(giftPath).href),{default:LetterControls}=await import(pathToFileURL(controlsPath).href);
const gift=renderToStaticMarkup(React.createElement(GiftView,{preview:true,card:{recipient:'Prueba',sender:'Tu tienda',theme:'noche',greetingColor:'#432639',options:{music:'aurora'}},letter:'Una carta con cariño.',photos:[]}));
for(const removed of ['gift-reactions','🌸','💚','🥹','💌','legal-footer','removal-request','Términos y condiciones'])assert.ok(!gift.includes(removed),'final gift excludes '+removed);
assert.ok(gift.includes('Guardar mi recuerdo')&&gift.includes('Preparar PDF para compartir')&&gift.includes('gv-action-primary'),'integrated save/share PDF controls');
assert.ok(gift.includes('Luz de mañana')&&gift.includes('--gv-bg:#432639'),'gift uses selected soundtrack and custom palette');
const controls=renderToStaticMarkup(React.createElement(LetterControls,{value:{},onChange:()=>{},onVoice:async()=>{}}));
assert.ok(!controls.includes('Grabar mi voz')&&!controls.includes('getUserMedia'),'microphone recording removed');
assert.ok(controls.includes('video/*')&&controls.includes('Buscar música')&&controls.includes('Cerquita de ti'),'video import and searchable curated selector');
assert.ok(controls.includes('aria-pressed')&&controls.includes('Escuchar Rosa de papel'),'accessible selection and independent previews');
await writeFile(path.join(output,'gift.html'),gift);await writeFile(path.join(output,'controls.html'),controls);
console.log('PASS real React rendering: final card excludes emoji/legal blocks, keeps themed PDF actions, music and accessible searchable video/audio selector.');
