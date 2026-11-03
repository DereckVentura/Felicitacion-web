export const musicTracks=[
 {id:"rosa",title:"Rosa de papel",mood:"Romántica",detail:"Piano suave",color:"rose",notes:[261.63,329.63,392,523.25,440,392,329.63,293.66],tempo:700},
 {id:"olivo",title:"Jardín de olivo",mood:"Calma",detail:"Notas cálidas",color:"olive",notes:[261.63,329.63,392,329.63,293.66,349.23,440,349.23],tempo:850},
 {id:"noche",title:"Noche botánica",mood:"Calma",detail:"Destellos de noche",color:"night",notes:[220,261.63,329.63,392,329.63,261.63,246.94,293.66],tempo:900},
 {id:"aurora",title:"Luz de mañana",mood:"Alegre",detail:"Campanas delicadas",color:"gold",notes:[392,493.88,587.33,493.88,440,523.25,659.25,587.33],tempo:520},
 {id:"brisa",title:"Brisa de abril",mood:"Calma",detail:"Un instante de paz",color:"sage",notes:[293.66,369.99,440,554.37,440,369.99,329.63,277.18],tempo:1000},
 {id:"latido",title:"Cerquita de ti",mood:"Romántica",detail:"Una melodía para dos",color:"clay",notes:[329.63,392,493.88,440,392,329.63,293.66,392],tempo:760}
] as const;
export type MusicId=typeof musicTracks[number]["id"];
let activeStop:(()=>void)|null=null;
export function playMusic(id:string,onStop:()=>void,seconds=0):()=>void{
 activeStop?.();const track=musicTracks.find(t=>t.id===id);if(!track)throw Error("Esta melodía no está disponible.");
 const context=new AudioContext();let interval:ReturnType<typeof setInterval>|undefined,deadline:ReturnType<typeof setTimeout>|undefined,step=0,stopped=false;
 const stop=()=>{if(stopped)return;stopped=true;clearInterval(interval);clearTimeout(deadline);void context.close().catch(()=>{});if(activeStop===stop)activeStop=null;onStop()};
 activeStop=stop;
 const tick=()=>{if(stopped||context.state!=="running")return;const osc=context.createOscillator(),gain=context.createGain();osc.type="sine";osc.frequency.value=track.notes[step++%track.notes.length];gain.gain.setValueAtTime(0,context.currentTime);gain.gain.linearRampToValueAtTime(.065,context.currentTime+.04);gain.gain.exponentialRampToValueAtTime(.001,context.currentTime+1.5);osc.connect(gain);gain.connect(context.destination);osc.start();osc.stop(context.currentTime+1.6);osc.onended=()=>{osc.disconnect();gain.disconnect()}};
 void context.resume().then(()=>{if(!stopped){tick();interval=setInterval(tick,track.tempo);if(seconds)deadline=setTimeout(stop,seconds*1000)}}).catch(stop);
 return stop;
}
