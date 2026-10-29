import type { PushState } from './push';
import { registerPush } from './pushRegister';
import { getAccessToken, supabase } from './supabase';

export type { PushState };

// Notifications du site : Web Push, avec la clé publique VAPID fournie au build.
// Sur iPhone, seulement une fois le site ajouté à l'écran d'accueil (iOS 16.4 et plus).
const VAPID_PUBLIC_KEY = process.env.EXPO_PUBLIC_VAPID_PUBLIC_KEY ?? '';

function supported() {
  return (
    !__DEV__ &&
    !!VAPID_PUBLIC_KEY &&
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

function keyBytes(base64url: string) {
  const base64 = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

export async function pushState(): Promise<PushState> {
  if (!supported()) return 'unsupported';
  if (Notification.permission === 'granted') return 'on';
  return Notification.permission === 'denied' ? 'off' : 'ask';
}

// daily : le dicton du jour sur cet appareil ; absent, le choix déjà fait reste.
async function subscribe(daily?: boolean) {
  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    const options = { userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC_KEY) };
    try {
      subscription = await registration.pushManager.subscribe(options);
    } catch {
      // Abonnement fait avec une ancienne clé : on le remplace.
      await (await registration.pushManager.getSubscription())?.unsubscribe();
      subscription = await registration.pushManager.subscribe(options);
    }
  }
  const { endpoint, keys } = subscription.toJSON();
  await registerPush({ p_platform: 'web', p_token: endpoint, p_keys: keys }, daily);
}

// À appeler directement depuis un clic : Safari refuse la demande sinon.
export async function enablePush(daily?: boolean): Promise<boolean> {
  if (!supported()) return false;
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return false;
  await getAccessToken();
  await subscribe(daily);
  return true;
}

export async function setDailyPush(daily: boolean) {
  await getAccessToken();
  await subscribe(daily);
}

export async function syncPush() {
  try {
    if ((await pushState()) !== 'on') return;
    const { data } = await supabase.auth.getSession();
    if (!data.session) return;
    await subscribe();
  } catch {
    // On réessaiera au prochain démarrage.
  }
}
