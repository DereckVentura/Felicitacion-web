export type SalePlan={id:string;name:string;kind:'credits'|'unlimited';credits:number|null;priceCents:number|null;currency:string;durationDays:number|null};
export function estimateExtra(plan:SalePlan,quantity:number,surcharge:number){
 if(!Number.isInteger(quantity)||quantity<0||quantity>1000||!Number.isFinite(surcharge)||surcharge<0||surcharge>100)throw Error('Revisa las cantidades.');
 if(plan.currency!=='USD'||plan.priceCents===null)return null;
 const units=quantity===0?0:plan.kind==='credits'?Math.ceil(quantity/(plan.credits||1)):plan.durationDays===null?1:Math.ceil(30/plan.durationDays);
 const revenueCents=Math.round(surcharge*100)*quantity,costCents=units*plan.priceCents;
 return {units,revenueCents,costCents,marginCents:revenueCents-costCents,leftover:plan.kind==='credits'?units*(plan.credits||0)-quantity:0};
}
