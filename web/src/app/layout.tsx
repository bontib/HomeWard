import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "HomeGuard",
  description: "See which known security problems affect the devices in your home.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
