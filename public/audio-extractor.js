/* Local video soundtrack extraction. Never connects a microphone or outputs sound. */
class RamoAudioExtractor extends AudioWorkletProcessor {
 constructor(){super();this.active=false;this.port.onmessage=e=>{this.active=e.data==='start'}}
 process(inputs,outputs){
  for(const channel of outputs[0]||[])channel.fill(0);
  const channels=inputs[0];if(!this.active||!channels?.length)return true;
  const mono=new Float32Array(channels[0].length);
  for(const channel of channels)for(let i=0;i<mono.length;i++)mono[i]+=channel[i]/channels.length;
  this.port.postMessage(mono.buffer,[mono.buffer]);return true;
 }
}
registerProcessor('ramo-audio-extractor',RamoAudioExtractor);
