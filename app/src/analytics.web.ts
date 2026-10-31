// Mesure d'audience Google Analytics, chargée seulement après un « J'accepte ».
// Jamais dans l'appli de bureau : pas de bandeau cookies, rien ne part chez Google.
import { bureau } from './bureau';

const GA_ID = process.env.EXPO_PUBLIC_GA_ID || 'G-M7P69D4TCG';

export const ANALYTICS_ENABLED = !!GA_ID && !bureau;

type Gtag = (...args: unknown[]) => void;
let started = false;

// Jamais sur /comptoir ni /la-cotisation : aucun script tiers ne doit tourner à côté des champs de carte (PCI DSS 6.4.3).
export const pageSansMesure = () => /^\/(comptoir|la-cotisation)/.test(location.pathname);

export function startAnalytics() {
  if (started || !GA_ID || pageSansMesure()) return;
  started = true;
  const w = window as unknown as { dataLayer: unknown[]; gtag: Gtag };
  w.dataLayer = w.dataLayer || [];
  // gtag attend l'objet « arguments » lui-même, pas un tableau.
  w.gtag = function gtag() {
    // eslint-disable-next-line prefer-rest-params
    w.dataLayer.push(arguments);
  };
  w.gtag('js', new Date());
  // Adresse sans le jeton de désabonnement des e-mails, au cas où gtag partirait avant qu'App.tsx l'efface.
  const page = new URL(location.href);
  page.searchParams.delete('desabonnement');
  w.gtag('config', GA_ID, { page_location: page.href });
  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
  document.head.appendChild(script);
}

// Retire les cookies _ga déjà posés quand on retire son accord.
export function clearAnalyticsCookies() {
  const host = location.hostname;
  const domains = ['', host, `.${host}`, `.${host.split('.').slice(-2).join('.')}`];
  for (const cookie of document.cookie.split(';')) {
    const name = cookie.split('=')[0].trim();
    if (!name.startsWith('_ga')) continue;
    for (const domain of domains) {
      document.cookie = `${name}=; Max-Age=0; path=/${domain ? `; domain=${domain}` : ''}`;
    }
  }
}
