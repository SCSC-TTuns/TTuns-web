'use client';

type MixpanelLike = {
  init?: (token: string, config?: Record<string, any>) => void;
  identify?: (id?: string) => void;
  reset?: () => void;
  track?: (name: string, props?: Record<string, any>) => void;
  people?: { set?: (props: Record<string, any>) => void; set_once?: (props: Record<string, any>) => void };
};

const TOKEN = process.env.NEXT_PUBLIC_MIXPANEL_TOKEN || '';

let isInitialized = false;
let cached: MixpanelLike | null = null;

function getAnonymousId(): string {
  if (typeof window === 'undefined') return 'server';
  const k = 'mp_anon_id';
  try {
    const v = window.localStorage.getItem(k);
    if (v) return v;
    const id = crypto?.randomUUID?.() || String(Math.random()).slice(2) + Date.now().toString(36);
    window.localStorage.setItem(k, id);
    return id;
  } catch {
    return 'anon';
  }
}

function getMixpanel(): MixpanelLike {
  if (cached) return cached;
  if (typeof window === 'undefined') return (cached = {});
  const w = window as any;
  if (w && w.mixpanel) {
    cached = w.mixpanel as MixpanelLike;
  } else {
    cached = {};
  }
  return cached;
}

export function initMixpanel(): void {
  if (isInitialized || !TOKEN) return;
  if (typeof window === 'undefined') return;
  try {
    const mp = getMixpanel();
    if (mp.init) {
      mp.init(TOKEN, { api_host: 'https://api.mixpanel.com', track_pageview: false, persistence: 'localStorage' });
    }
    const anon = getAnonymousId();
    if (mp.identify) mp.identify(anon);
    isInitialized = true;
  } catch {
    isInitialized = false;
  }
}

export function identify(id: string): void {
  try {
    const mp = getMixpanel();
    if (mp.identify) mp.identify(id);
  } catch {}
}

export function reset(): void {
  try {
    const mp = getMixpanel();
    if (mp.reset) mp.reset();
    isInitialized = false;
  } catch {}
}

export function track(name: string, props?: Record<string, any>): void {
  try {
    if (!isInitialized) initMixpanel();
    const mp = getMixpanel();
    if (mp.track) mp.track(name, { timestamp: new Date().toISOString(), ...props });
  } catch {}
}

export function isReady(): boolean {
  return isInitialized;
}

export default { initMixpanel, track, identify, reset, isReady };
