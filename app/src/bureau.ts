// L'appli de bureau (Windows, Mac, Linux : dossier bureau/, Tauri) embarque l'export web de ce code.
// Ici, ce qui change quand les écrans tournent dans l'appli plutôt que sur michel.beer :
// les liens partent dans le navigateur, Michel prévient quand il répond, et il signale une nouvelle version.
// Aucune dépendance : on parle directement au cœur Tauri (commandes de bureau/src-tauri/src/lib.rs).

type Tauri = { invoke: <T>(commande: string, args?: Record<string, unknown>) => Promise<T> };

const tauri = (): Tauri | undefined =>
  typeof window === 'undefined' ? undefined : (window as unknown as { __TAURI_INTERNALS__?: Tauri }).__TAURI_INTERNALS__;

export const bureau = !!tauri();

// Le site, pour tout ce qui ne vit pas dans l'appli (pages légales, comptoir, causettes partagées…).
export const SITE_PUBLIC = 'https://michel.beer';

const appeler = <T = void>(commande: string, args?: Record<string, unknown>) =>
  tauri()?.invoke<T>(commande, args) ?? Promise.reject(new Error('Pas dans l’appli de bureau'));

// Un lien relatif (« /conditions.html »), ou déjà résolu sur l'adresse de l'appli par react-native-web
// (tauri://localhost/conditions.html), vise michel.beer, pas les fichiers de l'appli.
export function ouvrirDehors(url: string) {
  const lien = new URL(url, SITE_PUBLIC + '/');
  const interne = lien.origin === window.location.origin || lien.protocol === 'tauri:';
  const absolu = interne ? SITE_PUBLIC + lien.pathname + lien.search + lien.hash : lien.toString();
  return appeler('ouvrir_dehors', { url: absolu }).catch(() => undefined);
}

export function notifier(texte: string) {
  if (!bureau || !texte.trim()) return;
  appeler('notifier', { titre: 'Michel a répondu', texte: texte.replace(/[*_#`>]/g, '').trim() }).catch(() => undefined);
}

// Les versions de bureau sont publiées sur GitHub avec l'étiquette bureau-vX.Y.Z.
const RELEASES = 'https://api.github.com/repos/mvignaud/michelia/releases?per_page=10';

const plusRecente = (a: string, b: string) => {
  const [x, y] = [a, b].map((v) => v.split('.').map((n) => parseInt(n, 10) || 0));
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return false;
};

async function verifierVersion() {
  const actuelle = await appeler<string>('version');
  const reponse = await fetch(RELEASES, { headers: { Accept: 'application/vnd.github+json' } });
  if (!reponse.ok) return;
  const sorties = (await reponse.json()) as { tag_name: string; html_url: string; draft: boolean; prerelease: boolean }[];
  const derniere = sorties.find((s) => !s.draft && !s.prerelease && s.tag_name.startsWith('bureau-v'));
  const version = derniere?.tag_name.slice('bureau-v'.length);
  if (derniere && version && plusRecente(version, actuelle)) {
    await appeler('proposer_maj', { version, page: derniere.html_url });
  }
}

// Une fois au démarrage : les fenêtres et liens « _blank » partent dans le navigateur, et on regarde
// s'il y a une nouvelle version (une fois par jour au plus).
export function demarrerBureau() {
  if (!bureau) return;
  window.open = ((url?: string | URL) => {
    if (url) ouvrirDehors(String(url));
    return null;
  }) as typeof window.open;
  try {
    const jour = new Date().toISOString().slice(0, 10);
    if (localStorage.getItem('michel-maj') === jour) return;
    localStorage.setItem('michel-maj', jour);
  } catch {
    // Pas de stockage : on vérifie quand même.
  }
  verifierVersion().catch(() => undefined);
}

// Retour d'une connexion Google / Facebook ouverte dans le navigateur : l'appli reçoit michelia://auth…
// (événement « michel-lien » envoyé par le cœur Tauri).
export function attendreLien(debut: string, delaiMs = 5 * 60_000): Promise<string | null> {
  return new Promise((resolve) => {
    const fin = (url: string | null) => {
      window.removeEventListener('michel-lien', ecoute);
      clearTimeout(minuteur);
      resolve(url);
    };
    const ecoute = (e: Event) => {
      const url = (e as CustomEvent<string>).detail;
      if (typeof url === 'string' && url.startsWith(debut)) fin(url);
    };
    const minuteur = setTimeout(() => fin(null), delaiMs);
    window.addEventListener('michel-lien', ecoute);
  });
}
