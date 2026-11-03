import { Invitation } from "@/components/Invitation";
export default async function InvitationPage({params}:{params:Promise<{token:string}>}){const {token}=await params;return <Invitation token={token}/>;}
