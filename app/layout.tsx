import type { Metadata } from "next";
import { THEME_SCRIPT } from "@/components/ThemeSwitcher";
import "./globals.css";

export const metadata: Metadata = {
  title: "PDF 閱讀筆記",
  description: "個人 PDF 閱讀、筆記與知識庫",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
