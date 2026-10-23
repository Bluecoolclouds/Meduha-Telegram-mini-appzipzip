import { useEffect, useState } from 'react';

type Signals = {
  pageActive: boolean;
  reducedMotion: boolean;
  saveData?: boolean;
  effectiveType?: string;
  hardwareConcurrency?: number;
};

export function playbackPolicy(signals: Signals) {
  return {
    pageActive: signals.pageActive,
    canAutoplay: signals.pageActive && !signals.reducedMotion && !signals.saveData
      && signals.effectiveType !== '2g' && signals.effectiveType !== 'slow-2g',
    previewLimit: signals.hardwareConcurrency && signals.hardwareConcurrency <= 4 ? 1 : 2,
  };
}

type Connection = {
  saveData?: boolean; effectiveType?: string;
  addEventListener?: (event: string, listener: () => void) => void;
  removeEventListener?: (event: string, listener: () => void) => void;
};
type TelegramActivity = {
  isActive?: boolean;
  onEvent?: (event: string, listener: () => void) => void;
  offEvent?: (event: string, listener: () => void) => void;
};

export function usePlaybackPolicy() {
  const read = () => {
    const connection = (navigator as Navigator & { connection?: Connection }).connection;
    const tg = (window as Window & { Telegram?: { WebApp?: TelegramActivity } }).Telegram?.WebApp;
    return playbackPolicy({
      pageActive: !document.hidden && tg?.isActive !== false,
      reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      saveData: connection?.saveData, effectiveType: connection?.effectiveType,
      hardwareConcurrency: navigator.hardwareConcurrency,
    });
  };
  const [policy, setPolicy] = useState(read);
  useEffect(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const connection = (navigator as Navigator & { connection?: Connection }).connection;
    const tg = (window as Window & { Telegram?: { WebApp?: TelegramActivity } }).Telegram?.WebApp;
    const update = () => setPolicy(read());
    const inactive = () => setPolicy(previous => ({ ...previous, pageActive: false, canAutoplay: false }));
    document.addEventListener('visibilitychange', update);
    window.addEventListener('pagehide', inactive);
    window.addEventListener('pageshow', update);
    motion.addEventListener('change', update);
    connection?.addEventListener?.('change', update);
    // Older Telegram clients have no activity API; document visibility still works.
    if (typeof tg?.isActive === 'boolean') {
      tg.onEvent?.('activated', update);
      tg.onEvent?.('deactivated', inactive);
    }
    update();
    return () => {
      document.removeEventListener('visibilitychange', update);
      window.removeEventListener('pagehide', inactive);
      window.removeEventListener('pageshow', update);
      motion.removeEventListener('change', update);
      connection?.removeEventListener?.('change', update);
      tg?.offEvent?.('activated', update);
      tg?.offEvent?.('deactivated', inactive);
    };
  }, []);
  return policy;
}
