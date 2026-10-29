import { useEffect, useState } from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { colors } from './theme';

// Sur iOS et Android, le captcha Turnstile tourne dans une petite page de michel.beer
// (le domaine déclaré chez Cloudflare), affichée dans une vue web seulement si Cloudflare a un doute.
const SITE_KEY = process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY ?? '';
const PAGE = `https://michel.beer/captcha?k=${encodeURIComponent(SITE_KEY)}`;

type Pending = { resolve: (token: string) => void; reject: (error: Error) => void };

let request: ((pending: Pending) => void) | null = null;

export async function getCaptchaToken(): Promise<string | undefined> {
  if (!SITE_KEY || !request) return undefined;
  const ask = request;
  return new Promise<string>((resolve, reject) => ask({ resolve, reject }));
}

// À placer une fois dans l'écran principal : c'est lui qui affiche la vérification.
export function CaptchaHost() {
  const [pending, setPending] = useState<Pending | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    request = (next) => setPending(next);
    return () => {
      request = null;
    };
  }, []);

  function finish(token?: string) {
    if (!pending) return;
    if (token) pending.resolve(token);
    else pending.reject(new Error('Vérification anti-robot échouée, réessaie.'));
    setPending(null);
    setVisible(false);
  }

  function onMessage(event: WebViewMessageEvent) {
    const data = event.nativeEvent.data;
    if (data.startsWith('token:')) finish(data.slice('token:'.length));
    else if (data === 'show') setVisible(true);
    else finish();
  }

  if (!pending) return null;
  return (
    <Modal transparent animationType="fade" onRequestClose={() => finish()}>
      <View style={[styles.backdrop, !visible && styles.hidden]}>
        <View style={styles.card}>
          <WebView
            source={{ uri: PAGE }}
            onMessage={onMessage}
            onError={() => finish()}
            style={styles.web}
            originWhitelist={['https://*']}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(43, 36, 32, 0.35)',
  },
  hidden: { opacity: 0 },
  card: { width: 320, height: 90, borderRadius: 12, overflow: 'hidden', backgroundColor: colors.surface },
  web: { flex: 1, backgroundColor: colors.surface },
});
