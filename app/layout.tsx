import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const playfair = localFont({ src: "./fonts/playfair-display-latin.woff2", weight: "400 900", variable: "--font-display", display: "swap" });
const jost = localFont({ src: "./fonts/jost-latin.woff2", weight: "300 700", variable: "--font-body", display: "swap" });
const cormorant = localFont({ src: "./fonts/cormorant-garamond-italic-latin.woff2", weight: "400", style: "italic", variable: "--font-accent", display: "swap" });

export const metadata: Metadata = {
  title: "Giftij Brandy — Admin Portal",
  description: "Operational dashboard for Giftij Brandy",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${playfair.variable} ${jost.variable} ${cormorant.variable}`}>
      <body className="font-body bg-milk text-ink">{children}</body>
    </html>
  );
}
