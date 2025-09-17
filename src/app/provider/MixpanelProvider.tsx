// src/app/provider/MixpanelProvider.tsx
'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { initMixpanel, track } from '@/lib/mixpanel/mixpanelClient';

export default function MixpanelProvider() {
  const pathname = usePathname();

  // 앱이 로드될 때 한 번만 Mixpanel을 초기화합니다.
  useEffect(() => {
    initMixpanel();
  }, []);

  // 경로가 바뀔 때마다 페이지뷰 이벤트를 추적합니다.
  useEffect(() => {
    // isReady 체크 없이 바로 track을 호출합니다.
    track('page_viewed', { path: pathname || '/', title: document.title || '' });
  }, [pathname]);

  return null;
}