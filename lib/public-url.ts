/** Set this to an HTTPS origin only after that domain serves the same RAMO routes. */
export const PUBLIC_QR_BASE_URL = '';
export function publicQRUrl(path:string,origin:string):string{
 const base=PUBLIC_QR_BASE_URL||origin,u=new URL(base);if(u.protocol!=='https:'&&!(u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname)))throw Error('El dominio del QR debe usar HTTPS.');return new URL(path,u.origin).href;
}
