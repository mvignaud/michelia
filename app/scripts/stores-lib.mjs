// Outils communs aux tâches qui parlent aux boutiques (boutiques.mjs, fiches.mjs) :
// requêtes HTTP, jetons App Store Connect et Google Play, mode essai / application.
// Les clés viennent des variables d'environnement (secrets GitHub) et ne sont jamais affichées.
import crypto from 'node:crypto';

export const APPLE_APP_ID = '6828365649';
export const PACKAGE = 'beer.michel.app';

export const dire = (...m) => console.log(...m);

// Lit les arguments communs et compte les erreurs. agir() n'exécute qu'avec --appliquer.
export function mode() {
  const args = process.argv.slice(2);
  const APPLIQUER = args.includes('--appliquer');
  const valeur = (nom) => (args.includes(nom) ? args[args.indexOf(nom) + 1] : undefined);
  const seulement = valeur('--seulement')?.split(',') ?? null;
  const etat = { erreurs: 0 };
  const agir = async (quoi, fn) => {
    if (!APPLIQUER) return dire(`  (essai) ${quoi}`);
    try {
      await fn();
      dire(`  ✓ ${quoi}`);
    } catch (e) {
      etat.erreurs++;
      dire(`  ✗ ${quoi} : ${e.message}`);
    }
  };
  // Lance chaque boutique demandée, puis sort en erreur s'il y a eu un problème.
  const lancer = async (boutiques) => {
    dire(APPLIQUER ? 'Mode : on applique.\n' : 'Mode : essai (rien ne change). Ajouter --appliquer pour de vrai.\n');
    for (const [nom, fn] of boutiques) {
      if (seulement && !seulement.includes(nom)) continue;
      try {
        await fn();
      } catch (e) {
        etat.erreurs++;
        dire(`✗ ${nom} : ${e.message}`);
      }
      dire('');
    }
    if (etat.erreurs) {
      dire(`${etat.erreurs} problème(s), voir ci-dessus.`);
      process.exit(1);
    }
    dire('Tout est en ordre.');
  };
  return { APPLIQUER, valeur, agir, lancer, etat };
}

// body : objet JSON ; form : formulaire ; raw : Buffer envoyé tel quel (avec type).
export async function http(url, { method = 'GET', token, body, form, raw, type } = {}) {
  const res = await fetch(url, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      ...(raw ? { 'Content-Type': type } : {}),
    },
    body: body ? JSON.stringify(body) : form ? new URLSearchParams(form) : raw,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // Page HTML (404, adresse inconnue…) : on garde le statut, pas la page.
    if (res.ok) throw new Error(`réponse illisible de ${new URL(url).pathname}`);
  }
  if (!res.ok) {
    const detail =
      data?.errors?.[0]?.detail ??
      data?.error?.message ??
      data?.message ??
      (data ? text.slice(0, 300) : `page HTML sur ${new URL(url).pathname}`);
    const err = new Error(`${res.status} ${detail}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

const b64url = (b) => Buffer.from(b).toString('base64url');
export function jwt(header, payload, key, alg) {
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signature =
    alg === 'ES256'
      ? crypto.sign('sha256', Buffer.from(input), { key, dsaEncoding: 'ieee-p1363' })
      : crypto.sign('RSA-SHA256', Buffer.from(input), key);
  return `${input}.${b64url(signature)}`;
}

// App Store Connect : renvoie api(path, opts), ou null si les clés manquent.
export async function appleApi() {
  let { ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_P8 } = process.env;
  if (!ASC_KEY_ID || !ASC_ISSUER_ID || !ASC_KEY_P8) return null;
  // ID de clé (10 caractères) et ID d'émetteur (UUID) se confondent facilement : on les remet dans l'ordre.
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (UUID.test(ASC_KEY_ID.trim()) && !UUID.test(ASC_ISSUER_ID.trim())) {
    [ASC_KEY_ID, ASC_ISSUER_ID] = [ASC_ISSUER_ID, ASC_KEY_ID];
    dire("  (ASC_KEY_ID et ASC_ISSUER_ID étaient inversés : remis dans l'ordre)");
  }
  // Apple refuse un jeton qui vit plus de 20 min : on garde de la marge (horloges).
  const now = Math.floor(Date.now() / 1000);
  // Clé d'équipe : iss = ID de l'émetteur. Clé individuelle : sub = 'user', sans iss.
  const signer = (individuelle) =>
    jwt(
      { alg: 'ES256', kid: ASC_KEY_ID.trim(), typ: 'JWT' },
      {
        ...(individuelle ? { sub: 'user' } : { iss: ASC_ISSUER_ID.trim() }),
        iat: now - 60,
        exp: now + 600,
        aud: 'appstoreconnect-v1',
      },
      ASC_KEY_P8,
      'ES256',
    );
  let token = signer(false);
  const api = (path, opts) => http(`https://api.appstoreconnect.apple.com${path}`, { token, ...opts });
  // Sur un refus, on décrit la forme des secrets (jamais leur valeur) pour trouver lequel cloche.
  const forme = () => {
    const id = ASC_KEY_ID.trim();
    const iss = ASC_ISSUER_ID.trim();
    dire(`  ASC_KEY_ID : ${/^[A-Z0-9]{10}$/.test(id) ? 'forme OK (10 caractères)' : `forme inattendue (${id.length} caractères, 10 attendus)`}`);
    dire(`  ASC_ISSUER_ID : ${UUID.test(iss) ? 'forme OK (identifiant 8-4-4-4-12)' : `forme inattendue (${iss.length} caractères) : attendu l'ID de l'émetteur, du type xxxxxxxx-xxxx-…`}`);
    dire(`  ASC_KEY_P8 : ${ASC_KEY_P8.includes('BEGIN PRIVATE KEY') ? 'en-tête OK' : 'en-tête BEGIN PRIVATE KEY absent'}`);
  };
  try {
    await api(`/v1/apps/${APPLE_APP_ID}?fields[apps]=bundleId`);
  } catch (e) {
    if (e.status !== 401) throw e;
    token = signer(true);
    try {
      await api(`/v1/apps/${APPLE_APP_ID}?fields[apps]=bundleId`);
      dire('  (clé individuelle : acceptée)');
    } catch (e2) {
      forme();
      dire("  Refusée en clé d'équipe comme en clé individuelle : le fichier .p8 ne correspond sans doute pas à ASC_KEY_ID, ou la clé est révoquée.");
      throw e2;
    }
  }
  return api;
}

// Google Play : renvoie un jeton d'accès, ou null si la clé manque.
export async function googleToken() {
  const raw = process.env.PLAY_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  const sa = JSON.parse(raw);
  const now = Math.floor(Date.now() / 1000);
  const assertion = jwt(
    { alg: 'RS256', typ: 'JWT' },
    {
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/androidpublisher',
      aud: sa.token_uri ?? 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    },
    sa.private_key,
    'RS256',
  );
  const { access_token } = await http(sa.token_uri ?? 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    form: { grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion },
  });
  return access_token;
}
