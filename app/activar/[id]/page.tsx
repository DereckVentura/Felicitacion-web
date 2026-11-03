import ActivationCard from '@/components/ActivationCard';
export const metadata={robots:{index:false,follow:false}};
export default async function Page({params}:{params:Promise<{id:string}>}){const {id}=await params;return <ActivationCard id={id} demo={id.startsWith('muestra-')}/>}
