"use client";

type MP = {
  track?: (name: string, props?: Record<string, any>) => void;
  identify?: (id?: string) => void;
  reset?: () => void;
} & { __ttuns_ready?: boolean };

function mp(): MP | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as any).mixpanel as MP | undefined;
}

export function isReady(): boolean {
  const m = mp();
  return !!(m && m.__ttuns_ready);
}

export async function initMixpanel(): Promise<void> {}

export async function track(name: string, props?: Record<string, any>): Promise<void> {
  const trySend = () => {
    const m = mp();
    if (m && m.__ttuns_ready && m.track)
      m.track(name, { timestamp: new Date().toISOString(), ...props });
    else setTimeout(trySend, 120);
  };
  trySend();
}

export async function identify(id: string): Promise<void> {
  const m = mp();
  if (m && m.__ttuns_ready && m.identify) m.identify(id);
}

export async function reset(): Promise<void> {
  const m = mp();
  if (m && m.reset) m.reset();
}

export default { isReady, initMixpanel, track, identify, reset };
