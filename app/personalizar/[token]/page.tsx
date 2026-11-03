export const metadata={robots:{index:false,follow:false}};
import BuyerEditor from "@/components/BuyerEditor";
export default async function EditorPage({params}:{params:Promise<{token:string}>}){const {token}=await params;return <BuyerEditor token={token}/>;}
