// Captcha Cloudflare Turnstile pour la version web : invisible pour un humain
// la plupart du temps, il ne s'affiche que si Cloudflare a un doute.
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

// Sur le web, Turnstile s'affiche directement dans la page : rien à monter.
export function CaptchaHost() {
  return null;
}
