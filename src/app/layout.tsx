// src/app/layout.tsx
import { Analytics } from "@vercel/analytics/next";
import MixpanelProvider from "./provider/MixpanelProvider";

export const metadata = {
  title: "TTuns",
  description: "서울대학교 시간표 서비스",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Analytics />
        <MixpanelProvider />
        {children}
      </body>
    </html>
  );
}
import "./reset.css";
