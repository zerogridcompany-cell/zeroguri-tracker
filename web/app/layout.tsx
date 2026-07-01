import type { Metadata, Viewport } from "next";
import { Playfair_Display, Shippori_Mincho } from "next/font/google";
import "./globals.css";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";

const playfair = Playfair_Display({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-playfair",
  display: "swap",
});
const mincho = Shippori_Mincho({
  weight: ["400", "500", "600"],
  subsets: ["latin"],
  variable: "--font-mincho",
  display: "swap",
  preload: false,
});

export const metadata: Metadata = {
  title: "ZeroGuri Tracker",
  description: "再生数トラッキング ダッシュボード",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "ZeroGuri",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  themeColor: "#044f5a",
};

// FOUC 回避: localStorage のテーマを paint 前に適用
const themeInit =
  "(function(){try{var t=localStorage.getItem('zg-theme');if(t)document.documentElement.dataset.theme=t;}catch(e){}})();";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" data-theme="default" className={`${playfair.variable} ${mincho.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body className="min-h-screen font-serif">
        {children}
        <ThemeSwitcher />
      </body>
    </html>
  );
}
