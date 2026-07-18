import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "./providers";
import { Toaster } from "sonner";

export const metadata: Metadata = {
  title: "Macket — 用钱表达观点",
  description:
    "去中心化信心市场。任何人都可以创建 Yes/No 市场，用 USDT 表达你的观点，让市场决定信心指数。安全、不可篡改、1:1 USDT 背书。",
  keywords: ["prediction market", "confidence market", "USDT", "Ethereum", "DeFi", "Web3"],
  openGraph: {
    title: "Macket — 用钱表达观点",
    description: "去中心化信心市场。用 USDT 投票，让市场决定信心指数。",
    type: "website",
  },
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
    <html lang="zh-CN">
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
