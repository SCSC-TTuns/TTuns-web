import localFont from "next/font/local";
import { Analytics } from "@vercel/analytics/next";
import MixpanelProvider from "./provider/MixpanelProvider";
import { ThemeProvider } from "@/components/theme-provider";
import "./reset.css";
import "./globals.css";
import "./page.css";

const pretendard = localFont({
  src: "./fonts/PretendardVariable.ttf",
  display: "swap",
  variable: "--font-pretendard",
});

export const metadata = {
  title: "TTuns",
  description: "서울대학교 시간표 서비스",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="icon" href="/icon.png" sizes="any" />
      </head>
      <body className={pretendard.className}>
        <Analytics />
        <MixpanelProvider />
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
