import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Ramo · Recuerdos que florecen",
  description: "Tarjetas con QR y felicitaciones digitales para floristerías y tiendas de regalos.",
  icons: { icon: "/favicon.svg" },
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="es"><body>{children}</body></html>;
}
