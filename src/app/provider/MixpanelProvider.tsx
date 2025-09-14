'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { initMixpanel, isReady } from '@/lib/mixpanel/mixpanelClient';
import { trackUIEvent } from '@/lib/mixpanel/trackEvent';

export default function MixpanelProvider() {
  const pathname = usePathname();

  useEffect(() => {
    initMixpanel();
  }, []);

  useEffect(() => {
    const f = () => {
      if (isReady()) {
        trackUIEvent.pageView(pathname || '/', typeof document !== 'undefined' ? document.title : '');
      } else {
        setTimeout(f, 100);
      }
    };
    f();
  }, [pathname]);

  return null;
}
