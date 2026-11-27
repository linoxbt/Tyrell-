import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "@xyflow/react/dist/style.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tyrell: memory provenance and guarded payments for AI agents, on QIE",
  description:
    "Tyrell signs, anchors and traces everything your AI agent reads. When a source is poisoned, the vault refuses the payment, you see the blast radius, and one quarantine restores a clean state from QIE alone.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
