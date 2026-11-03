import PrintStudio from "@/components/PrintStudio";
export const dynamic = "force-dynamic";
export default async function PrintCardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PrintStudio cardId={id}/>;
}
