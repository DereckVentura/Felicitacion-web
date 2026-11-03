import { PublicGiftLoader } from "@/components/GiftView";
export const dynamic = "force-dynamic";
export const metadata = { title: "Un regalo para ti | Ramo", robots: { index: false, follow: false } };
export default async function PublicGiftPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PublicGiftLoader id={id}/>;
}
