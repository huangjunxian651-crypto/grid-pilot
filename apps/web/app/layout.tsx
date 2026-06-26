import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Space_Grotesk, IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/shell/providers";
import { isValidLang, HTML_LANG, getTextDir } from "@/lib/i18n-shared";
import type { Lang } from "@/lib/i18n-shared";

const displayFont = Space_Grotesk({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

const sansFont = IBM_Plex_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const monoFont = IBM_Plex_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "GridPilot — 动态网格交易",
  description: "多交易所永续合约动态网格交易平台，支持 Binance / Gate.io / OKX",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const langCookie = cookieStore.get("gp.lang")?.value;
  const initialLang: Lang = isValidLang(langCookie ?? "") ? (langCookie as Lang) : "zh";

  const htmlLang = HTML_LANG[initialLang];
  const dir = getTextDir(initialLang);

  return (
    <html lang={htmlLang} dir={dir} className={`${displayFont.variable} ${sansFont.variable} ${monoFont.variable}`}>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('gp-theme');if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t);}}catch(e){}`,
          }}
        />
      </head>
      <body style={{ height: "100vh", overflow: "hidden" }}>
        <Providers initialLang={initialLang}>{children}</Providers>
      </body>
    </html>
  );
}
