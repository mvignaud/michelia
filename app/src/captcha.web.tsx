// Captcha Cloudflare Turnstile pour la version web : invisible pour un humain
// la plupart du temps, il ne s'affiche que si Cloudflare a un doute.
import { bureau, SITE_PUBLIC } from './bureau';

const SITE_KEY = process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY ?? '';
const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

type Turnstile = {
  render: (el: HTMLElement, options: Record<string, unknown>) => string;
  remove: (widgetId: string) => void;
};

let scriptLoading: Promise<Turnstile> | null = null;

function loadTurnstile(): Promise<Turnstile> {
  scriptLoading ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_URL;
    script.async = true;
    script.onload = () => resolve((window as unknown as { turnstile: Turnstile }).turnstile);
    script.onerror = () => {
      scriptLoading = null;
      reject(new Error('Captcha indisponible, recharge la page.'));
    };
    document.head.appendChild(script);
  });
  return scriptLoading;
}

export async function getCaptchaToken(): Promise<string | undefined> {
  if (!SITE_KEY) return undefined;
  if (bureau) return captchaBureau();
  const turnstile = await loadTurnstile();

  const container = document.createElement('div');
  Object.assign(container.style, {
    position: 'fixed',
    bottom: '96px',
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: '1000',
  });
  document.body.appendChild(container);

  try {
    return await new Promise<string>((resolve, reject) => {
      turnstile.render(container, {
        sitekey: SITE_KEY,
        appearance: 'interaction-only',
        language: 'fr',
        callback: resolve,
        'error-callback': () => reject(new Error('Vérification anti-robot échouée, réessaie.')),
        'expired-callback': () => reject(new Error('Vérification expirée, réessaie.')),
      });
    });
  } finally {
    container.remove();
  }
}

// Appli de bureau : Cloudflare n'accepte le captcha que sur michel.beer. Comme dans les applis iOS et
// Android, il tourne dans la petite page michel.beer/captcha, ici dans un cadre, qui nous renvoie le jeton.
// Le cadre reste invisible tant que Cloudflare ne demande pas de cocher la case.
const TIMEOUT_MS = 30_000;

function captchaBureau(): Promise<string> {
  const frame = document.createElement('iframe');
  frame.src = `${SITE_PUBLIC}/captcha?k=${encodeURIComponent(SITE_KEY)}`;
  frame.title = 'Vérification anti-robot';
  Object.assign(frame.style, {
    position: 'fixed',
    bottom: '96px',
    left: '50%',
    transform: 'translateX(-50%)',
    width: '320px',
    height: '80px',
    border: '0',
    borderRadius: '12px',
    background: '#fff',
    zIndex: '1000',
    opacity: '0',
    pointerEvents: 'none',
  });
  return new Promise<string>((resolve, reject) => {
    let timer = setTimeout(() => finish(), TIMEOUT_MS);
    function finish(token?: string) {
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      frame.remove();
      if (token) resolve(token);
      else reject(new Error('Vérification anti-robot échouée, réessaie.'));
    }
    function onMessage(event: MessageEvent) {
      if (event.origin !== SITE_PUBLIC || event.source !== frame.contentWindow || typeof event.data !== 'string') return;
      if (event.data.startsWith('token:')) finish(event.data.slice('token:'.length));
      else if (event.data === 'show') {
        // Une vraie case à cocher : on la montre et on laisse le temps.
        clearTimeout(timer);
        timer = setTimeout(() => finish(), 5 * TIMEOUT_MS);
        Object.assign(frame.style, { opacity: '1', pointerEvents: 'auto', boxShadow: '0 4px 16px rgba(0,0,0,.2)' });
      } else finish();
    }
    window.addEventListener('message', onMessage);
    frame.onerror = () => finish();
    document.body.appendChild(frame);
  });
}

// Sur le web, Turnstile s'affiche directement dans la page : rien à monter.
export function CaptchaHost() {
  return null;
}
