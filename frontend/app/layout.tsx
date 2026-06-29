import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "灵改流",
  description: "灵改流：通用 AI 工作流平台"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
