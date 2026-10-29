import { useEffect, useRef, useState } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { colors } from './theme';

// Sur iOS et Android, le captcha Turnstile tourne dans une petite page de michel.beer
// (le domaine déclaré chez Cloudflare), affichée dans une petite carte le temps de la vérification.
// La carte reste visible : sur iOS, une vue web transparente peut être mise en pause et ne jamais répondre.
const SITE_KEY = process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY ?? '';
const PAGE = `https://michel.beer/captcha?k=${encodeURIComponent(SITE_KEY)}`;

// Au-delà, on abandonne plutôt que de laisser Michel chercher ses lunettes pour toujours.
const TIMEOUT_MS = 30_000;

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
  const [challenge, setChallenge] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    request = (next) => setPending(next);
    return () => {
      request = null;
    };
  }, []);

  // Le délai ne court que tant que Cloudflare ne demande rien : une vraie case à cocher laisse le temps.
  useEffect(() => {
    if (!pending || challenge) return;
    timer.current = setTimeout(() => finish(), TIMEOUT_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [pending, challenge]);

  function finish(token?: string) {
    if (!pending) return;
    if (token) pending.resolve(token);
    else pending.reject(new Error('Vérification anti-robot échouée, réessaie.'));
    setPending(null);
    setChallenge(false);
  }

  function onMessage(event: WebViewMessageEvent) {
    const data = event.nativeEvent.data;
    if (data.startsWith('token:')) finish(data.slice('token:'.length));
    else if (data === 'show') setChallenge(true);
    else finish();
  }

  if (!pending) return null;
  return (
    <Modal transparent animationType="fade" onRequestClose={() => finish()}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.caption}>
            {challenge ? 'Coche la case, que je sache que t’es pas un robot.' : 'Michel vérifie que t’es pas un robot…'}
          </Text>
          <View style={styles.frame}>
            <WebView
              source={{ uri: PAGE }}
              onMessage={onMessage}
              onError={() => finish()}
              onHttpError={() => finish()}
              style={styles.web}
              // Turnstile charge ses cadres internes en about:blank : une liste « https://* » les bloquait.
              // On laisse tout passer dans les cadres, mais la page elle-même ne quitte pas michel.beer.
              originWhitelist={['*']}
              onShouldStartLoadWithRequest={(r) => !r.isTopFrame || r.url.startsWith('https://michel.beer/')}
            />
          </View>
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
  card: { width: 320, borderRadius: 12, overflow: 'hidden', backgroundColor: colors.surface, paddingTop: 14 },
  caption: { color: colors.secondary, fontSize: 15, textAlign: 'center', paddingHorizontal: 16 },
  frame: { height: 80 },
  web: { flex: 1, backgroundColor: colors.surface },
});
