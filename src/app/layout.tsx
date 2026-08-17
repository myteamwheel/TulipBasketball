import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Orlando Oswalds Market Dashboard",
  description: "Dynasty Boys fantasy-football market dashboard",
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false, noimageindex: true },
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  colorScheme: "dark",
  themeColor: "#09090b",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full bg-neutral-950 antialiased`}><body className="min-h-full min-w-0 bg-neutral-950 text-neutral-100">{children}</body></html>;
}
