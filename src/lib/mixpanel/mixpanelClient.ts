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

let ready = false;
let loading = false;

function getAnon(): string {
  if (typeof window === 'undefined') return 'server';
  const k = 'mp_anon_id';
  try {
    const v = localStorage.getItem(k);
    if (v) return v;
    const id = crypto?.randomUUID?.() || String(Math.random()).slice(2) + Date.now().toString(36);
    localStorage.setItem(k, id);
    return id;
  } catch {
    return 'anon';
  }
}

function ensureScript(): Promise<void> {
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
  return new Promise((res) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.mxpnl.com/libs/mixpanel-2-latest.min.js';
    s.async = true;
    s.onload = () => { loading = false; res(); };
    s.onerror = () => { loading = false; res(); };
    document.head.appendChild(s);
  });
}

export async function initMixpanel(): Promise<void> {
  if (ready || !TOKEN) return;
  if (typeof window === 'undefined') return;
  await ensureScript();
  const mp = (window as any).mixpanel as MixpanelLike | undefined;
  if (!mp?.init) return;
  mp.init(TOKEN, { api_host: API_HOST, track_pageview: false, persistence: 'localStorage' });
  mp.identify?.(getAnon());
  ready = true;
}

export function isReady(): boolean {
  return ready;
}

export async function track(name: string, props?: Record<string, any>): Promise<void> {
  await initMixpanel();
  const mp = (window as any).mixpanel as MixpanelLike | undefined;
  mp?.track?.(name, { timestamp: new Date().toISOString(), ...props });
}

export async function identify(id: string): Promise<void> {
  await initMixpanel();
  const mp = (window as any).mixpanel as MixpanelLike | undefined;
  mp?.identify?.(id);
}

export async function reset(): Promise<void> {
  const mp = (window as any).mixpanel as MixpanelLike | undefined;
  mp?.reset?.();
  ready = false;
}

export default { initMixpanel, isReady, track, identify, reset };
