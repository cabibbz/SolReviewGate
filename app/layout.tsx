import type { Metadata, Viewport } from "next";
import "./globals.css";

const publicUrl = process.env.SOL_PUBLIC_URL
  || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000");

export const metadata: Metadata = {
  metadataBase: new URL(publicUrl),
  title: "Sol Gate",
  description: "Phone approved independent Codex review for Claude Code decisions",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/favicon.png", apple: "/appleicon.png" },
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Sol Gate" },
  openGraph: {
    title: "Sol Gate",
    description: "Phone approved independent Codex review for Claude Code decisions",
    images: ["/logo.webp"],
  },
};

export const viewport: Viewport = {
  themeColor: "#f4f5f2",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
