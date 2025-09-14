'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { initMixpanel, isReady, track } from '@/lib/mixpanel/mixpanelClient';

export default function MixpanelProvider() {
  const pathname = usePathname();

  useEffect(() => {
    initMixpanel();
  }, []);

  useEffect(() => {
    const f = () => {
      if (isReady()) track('page_viewed', { path: pathname || '/', title: document.title || '' });
      else setTimeout(f, 120);
    };
    f();
  }, [pathname]);

  return null;
}
