import { useEffect, useState } from 'react';
import type { InstallState } from './pwa';

export type { InstallState };

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

// L'événement d'installation peut arriver avant que l'appli soit montée : on le garde de côté.
let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    notify();
  });
}

export function registerServiceWorker() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  // En développement le cache servirait de vieux fichiers : seulement sur le site publié.
  if (__DEV__) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
}

export function isOffline() {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

function standalone() {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

// Safari sur iPhone ou iPad (les iPad récents se déclarent comme un Mac tactile).
// Les autres navigateurs iOS savent aussi ajouter à l'écran d'accueil depuis leur menu Partager.
function ios() {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

export function useInstall(): InstallState {
  const [, refresh] = useState(0);
  useEffect(() => {
    const listener = () => refresh((n) => n + 1);
    listeners.add(listener);
    return () => void listeners.delete(listener);
  }, []);

  const mode = standalone() ? 'none' : deferred ? 'prompt' : ios() ? 'ios' : 'none';
  return {
    mode,
    install: async () => {
      if (!deferred) return;
      const event = deferred;
      await event.prompt();
      await event.userChoice.catch(() => undefined);
      deferred = null;
      notify();
    },
  };
}
