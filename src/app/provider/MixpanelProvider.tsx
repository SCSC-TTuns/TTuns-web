// app/providers/MixpanelProvider.tsx
'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { initMixpanel, isReady } from '@/lib/mixpanel/mixpanelClient';
import { trackUIEvent } from '@/lib/mixpanel/trackEvent';

export default function MixpanelProvider() {
  const pathname = usePathname();

  // Initialize Mixpanel on component mount
  useEffect(() => {
    initMixpanel();
  }, []);

  // Track page views when pathname changes
  useEffect(() => {
    // Wait for Mixpanel to be ready before tracking
    const trackPageView = () => {
      if (isReady()) {
        trackUIEvent.pageView(pathname, document.title);
      } else {
        // Retry after a short delay if not ready
        setTimeout(trackPageView, 100);
      }
    };

    trackPageView();
  }, [pathname]);

  return null;
}