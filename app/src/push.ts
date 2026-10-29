import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Linking, Platform } from 'react-native';
import { registerPush } from './pushRegister';
import { getAccessToken, supabase } from './supabase';

// Notifications des applis : jeton Expo, qu'Expo relaie vers Apple et Google.
export type PushState = 'unsupported' | 'ask' | 'on' | 'off';

// Appli ouverte : la notification s'affiche quand même, sans son.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

// Une notification touchée qui porte un lien l'ouvre.
Notifications.addNotificationResponseReceivedListener((response) => {
  const url = response.notification.request.content.data?.url;
  if (typeof url === 'string' && url.startsWith('https://')) Linking.openURL(url).catch(() => undefined);
});

export async function pushState(): Promise<PushState> {
  const permission = await Notifications.getPermissionsAsync();
  if (permission.granted) return 'on';
  return permission.canAskAgain ? 'ask' : 'off';
}

// Android 13 et plus : le canal doit exister avant la demande d'autorisation.
async function ensureChannel() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('default', {
    name: 'Nouvelles de Michel',
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

// daily : le dicton du jour sur cet appareil ; absent, le choix déjà fait reste.
async function saveToken(daily?: boolean) {
  await ensureChannel();
  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
  await registerPush({ p_platform: Platform.OS, p_token: token }, daily);
}

// Après un geste du visiteur : demande l'autorisation, puis enregistre l'appareil.
export async function enablePush(daily?: boolean): Promise<boolean> {
  await ensureChannel();
  const permission = await Notifications.requestPermissionsAsync();
  if (!permission.granted) return false;
  await getAccessToken();
  await saveToken(daily);
  return true;
}

// Notifications déjà autorisées : le dicton du jour, oui ou non.
export async function setDailyPush(daily: boolean) {
  await getAccessToken();
  await saveToken(daily);
}

// Au démarrage et à chaque changement de compte : le jeton peut changer, et l'appareil suit le compte.
export async function syncPush() {
  try {
    if ((await pushState()) !== 'on') return;
    const { data } = await supabase.auth.getSession();
    if (!data.session) return;
    await saveToken();
  } catch {
    // Simulateur, pas de réseau : on réessaiera au prochain démarrage.
  }
}
