// src/lib/mixpanel/mixpanelClient.ts
"use client";

import mixpanel, { Mixpanel } from "mixpanel-browser";
import { getAnonymousId } from "@/lib/utils/anonymousId";

// 1. initMixpanel 함수를 실제로 구현합니다.
export function initMixpanel(): void {
  const token = process.env.NEXT_PUBLIC_MIXPANEL_TOKEN;
  // 이미 초기화되었거나 토큰이 없으면 실행하지 않습니다.
  if (mixpanel.__loaded || !token) {
    return;
  }

  try {
    mixpanel.init(token, {
      debug: process.env.NODE_ENV === "development",
      track_pageview: false, // 페이지뷰는 Provider에서 수동으로 관리합니다.
      persistence: "localStorage",
    });

    const anonId = getAnonymousId();
    if (anonId) {
      mixpanel.identify(anonId);
    }
  } catch (error) {
    console.error("Mixpanel initialization failed:", error);
  }
}

// 2. track 함수를 매우 단순하게 수정합니다.
export function track(name: string, props?: Record<string, any>): void {
  // 라이브러리가 알아서 큐에 담고 전송하므로, 그냥 호출하기만 하면 됩니다.
  mixpanel.track(name, { timestamp: new Date().toISOString(), ...props });
}

// identify와 reset은 그대로 둡니다.
export function identify(id: string): void {
  mixpanel.identify(id);
}

export function reset(): void {
  mixpanel.reset();
}