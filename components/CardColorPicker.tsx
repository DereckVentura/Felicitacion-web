"use client";
import {useEffect,useId,useState} from "react";
export default function CardColorPicker({value,onChange}:{value:string|null;onChange:(color:string)=>void}){
 const id=useId(),active=value||"#b87d91";
 const [text,setText]=useState(active);
 useEffect(()=>setText(active),[active]);
 const rgb=[1,3,5].map(i=>parseInt(active.slice(i,i+2),16));
 function edit(raw:string,allowShort=false){setText(raw);let hex=raw.trim().replace(/^#/,"");if(allowShort&&/^[a-f\d]{3}$/i.test(hex))hex=hex.split("").map(c=>c+c).join("");if(/^[a-f\d]{6}$/i.test(hex))onChange("#"+hex.toLowerCase())}
 function channel(index:number,n:number){const next=[...rgb];next[index]=n;onChange("#"+next.map(v=>v.toString(16).padStart(2,"0")).join(""))}
 const valid=/^#?([a-f\d]{3}|[a-f\d]{6})$/i.test(text.trim());
 return <div className="card-color-control"><label htmlFor={id}>Color personalizado</label><div className="card-color-main"><span className="card-color-chip" style={{background:active}}/><input id={id} type="text" aria-label="Código de color personalizado" value={text} placeholder="#B87D91" maxLength={7} onChange={e=>edit(e.target.value)} onBlur={()=>edit(text,true)} aria-invalid={!valid}/><input type="color" aria-label="Abrir selector de color" value={active} onChange={e=>onChange(e.target.value)}/></div><details className="color-more"><summary>Ajustar color</summary><div className="card-color-swatches">{["#fff9f4","#d9a0ad","#9caa87","#5435a2","#203f34","#e6bd70","#83b9cb","#ffffff"].map(c=><button type="button" key={c} style={{background:c}} aria-label={`Usar color ${c}`} aria-pressed={value===c} onClick={()=>onChange(c)}/>)}</div><div className="card-color-sliders">{["Rojo","Verde","Azul"].map((label,i)=><label key={label}><span>{label}</span><input type="range" min={0} max={255} value={rgb[i]} onChange={e=>channel(i,Number(e.target.value))}/><output>{rgb[i]}</output></label>)}</div><p>{valid?"Escribe un código o mueve las barras: el color se aplica al instante.":"Escribe 3 o 6 dígitos de color, por ejemplo #D9A0AD."}</p></details></div>
}
