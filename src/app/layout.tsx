import type { Metadata } from "next";
import { IBM_Plex_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";

// Self-hosted at build time by next/font: no layout shift, no request to Google at runtime.
const sans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["300", "400", "600", "700"], variable: "--font-sans", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "600", "800"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  title: "Wire — feeds pipeline",
  description:
    "Event-driven feeds pipeline: Contentful webhooks → verified receiver → queue → idempotent worker → RSS, JSON Feed, Google News and partner feeds.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>
        <a className="skip" href="#main">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
