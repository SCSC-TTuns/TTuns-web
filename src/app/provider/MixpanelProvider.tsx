'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { isReady, track } from '@/lib/mixpanel/mixpanelClient';

export default function MixpanelProvider() {
  const pathname = usePathname();

  useEffect(() => {
    const tick = () => {
      if (isReady()) track('page_viewed', { path: pathname || '/', title: document.title || '' });
      else setTimeout(tick, 150);
    };
    tick();
  }, [pathname]);

  return null;
}
