"use client";
import {useEffect,useRef,type ReactNode} from 'react';
export default function SampleGiftModal({children,onClose}:{children:ReactNode;onClose:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>{const previous=document.activeElement as HTMLElement|null;const prior=document.body.style.overflow;document.body.style.overflow='hidden';dialog.current?.showModal();return()=>{document.body.style.overflow=prior;previous?.focus()}},[]);
 return <dialog ref={dialog} className="sample-gift-modal" onCancel={e=>{e.preventDefault();onClose()}} aria-labelledby="sample-dialog-title"><header><h2 id="sample-dialog-title">Vista del destinatario · muestra</h2><button type="button" onClick={onClose} autoFocus aria-label="Cerrar muestra">Cerrar ×</button></header><div className="sample-gift-body">{children}</div></dialog>
}
