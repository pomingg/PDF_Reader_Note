import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PDF 閱讀筆記",
  description: "個人 PDF 閱讀、筆記與知識庫",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant">
      <body className="antialiased">{children}</body>
    </html>
  );
}
