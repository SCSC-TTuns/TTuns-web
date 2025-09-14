import Script from 'next/script';
import MixpanelProvider from '@/app/provider/MixpanelProvider';

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Script src="https://cdn.mxpnl.com/libs/mixpanel-2-latest.min.js" strategy="afterInteractive" />
      <MixpanelProvider />
      {children}
    </>
  );
}
