import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MTG Deck Viewer",
  description: "Interactive Magic: The Gathering deck viewer. Hover to inspect cards.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
