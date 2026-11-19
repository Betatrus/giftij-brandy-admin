import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const playfair = localFont({
  src: [
    { path: "./fonts/playfair-600.ttf", weight: "600" },
    { path: "./fonts/playfair-700.ttf", weight: "700" },
  ],
  variable: "--font-display",
  display: "swap",
});
const jost = localFont({
  src: [
    { path: "./fonts/jost-400.ttf", weight: "400" },
    { path: "./fonts/jost-500.ttf", weight: "500" },
  ],
  variable: "--font-body",
  display: "swap",
});
const cormorant = localFont({ src: "./fonts/cormorant-italic-400.ttf", weight: "400", style: "italic", variable: "--font-accent", display: "swap" });

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
