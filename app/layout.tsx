import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "./providers";
import { Toaster } from "sonner";

export const metadata: Metadata = {
  title: "Pulse — Back Your Views",
  description:
    "Decentralized confidence market. Anyone can create a Yes/No view, stake USDT to express conviction, and let the market determine the confidence index. Secure, immutable, 1:1 USDT-backed.",
  keywords: ["prediction market", "confidence market", "USDT", "Ethereum", "DeFi", "Web3", "Pulse", "Viewstake"],
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-zinc-950 text-zinc-50 antialiased">
        <Providers>
          {children}
          <Toaster
            position="top-center"
            toastOptions={{
              style: {
                background: "#27272a",
                border: "1px solid #3f3f46",
                color: "#fafafa",
              },
            }}
          />
        </Providers>
      </body>
    </html>
  );
}
