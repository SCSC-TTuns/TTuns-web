'use client';

type MixpanelLike = {
  init?: (token: string, config?: Record<string, any>) => void;
  identify?: (id?: string) => void;
  reset?: () => void;
  track?: (name: string, props?: Record<string, any>) => void;
  people?: { set?: (props: Record<string, any>) => void; set_once?: (props: Record<string, any>) => void };
};

const TOKEN = process.env.NEXT_PUBLIC_MIXPANEL_TOKEN || '';
const API_HOST = process.env.NEXT_PUBLIC_MIXPANEL_API_HOST || 'https://api.mixpanel.com';
let isInitialized = false;
let cached: MixpanelLike | null = null;
let loading = false;

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
  cached = (w && w.mixpanel) ? (w.mixpanel as MixpanelLike) : {};
  return cached;
}

function loadCdn(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if ((window as any).mixpanel) return Promise.resolve();
  if (loading) {
    return new Promise((res) => {
      const i = setInterval(() => {
        if ((window as any).mixpanel) { clearInterval(i); res(); }
      }, 50);
    });
  }
  loading = true;
  return new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.mxpnl.com/libs/mixpanel-2-latest.min.js';
    s.async = true;
    s.onload = () => { loading = false; resolve(); };
    s.onerror = () => { loading = false; resolve(); };
    document.head.appendChild(s);
  });
}

export async function initMixpanel(): Promise<void> {
  if (isInitialized || !TOKEN) return;
  if (typeof window === 'undefined') return;
  await loadCdn();
  try {
    const mp = getMixpanel();
    if (mp.init) {
      mp.init(TOKEN, { api_host: API_HOST, track_pageview: false, persistence: 'localStorage' });
    }
    const anon = getAnonymousId();
    if (mp.identify) mp.identify(anon);
    isInitialized = true;
  } catch {
    isInitialized = false;
  }
}

export async function identify(id: string): Promise<void> {
  try {
    await initMixpanel();
    const mp = getMixpanel();
    if (mp.identify) mp.identify(id);
  } catch {}
}

export async function reset(): Promise<void> {
  try {
    const mp = getMixpanel();
    if (mp.reset) mp.reset();
    isInitialized = false;
  } catch {}
}

export async function track(name: string, props?: Record<string, any>): Promise<void> {
  try {
    await initMixpanel();
    const mp = getMixpanel();
    if (mp.track) mp.track(name, { timestamp: new Date().toISOString(), ...props });
  } catch {}
}

export function isReady(): boolean {
  return isInitialized;
}

export default { initMixpanel, track, identify, reset, isReady };
