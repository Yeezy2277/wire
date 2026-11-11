import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Wire — feeds pipeline",
  description:
    "Event-driven feeds pipeline: Contentful webhooks → verified receiver → queue → idempotent worker → RSS, JSON Feed, Google News and partner feeds.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
