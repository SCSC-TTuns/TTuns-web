// src/app/layout.tsx
import { Analytics } from "@vercel/analytics/next";
import MixpanelProvider from "./provider/MixpanelProvider";
import { ThemeProvider } from "@/components/theme-provider"

export const metadata = {
  title: "TTuns",
  description: "서울대학교 시간표 서비스",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="icon" href="/icon.png" sizes="any" />
        {/* 아이콘 어떻게 설정하더라 */}
      </head>
      <body>
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
import "./reset.css";
