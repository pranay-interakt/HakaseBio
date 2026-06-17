import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
  weight: ["400", "500", "600", "700"]
});

// Use Inter for display too — keep typography monolithic and serious.
const display = Inter({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
  weight: ["500", "600", "700"]
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
  weight: ["400", "500"]
});

export const metadata: Metadata = {
  title: "Hakase — Purpose-built intelligence for life sciences",
  description:
    "Hakase is the operating system for drug development. One self-improving engine, five modules, predict-then-confirm at every layer — from discovery to dossier.",
  metadataBase: new URL("https://hakase.ai"),
  openGraph: {
    title: "Hakase — Purpose-built intelligence for life sciences",
    description: "Hakase is the operating system for drug development.",
    type: "website"
  }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${display.variable} ${mono.variable}`}>
      <body className="bg-white text-ink-900">
        <Navbar />
        <main className="relative min-h-screen">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
