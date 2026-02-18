import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RF Telemetry Dashboard",
  description: "RF Home Telemetry Monitoring System",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-background antialiased">{children}</body>
    </html>
  );
}
