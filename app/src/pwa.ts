// Installation sur l'écran d'accueil : seulement pour le site web, les applis sont déjà installées.
export type InstallState = { mode: 'none' | 'prompt' | 'ios'; install: () => Promise<void> };

export function registerServiceWorker() {}
export function isOffline() {
  return false;
}
export function useInstall(): InstallState {
  return { mode: 'none', install: async () => undefined };
}
