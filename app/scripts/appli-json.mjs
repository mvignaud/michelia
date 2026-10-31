// Écrit dist/appli.json : les réglages publics dont l'extension Chrome (extension/) et les applis de bureau
// ont besoin pour parler à Michel sans être reconstruites : adresse Supabase, clé publique (« publishable »)
// et clé de site Turnstile. Ce sont les mêmes valeurs publiques que celles du site (variables EXPO_PUBLIC_*
// de Cloudflare Pages) ; jamais de clé secrète ici.
// Lancé par npm run build:web : node scripts/appli-json.mjs [dossier de sortie, dist par défaut]
import fs from 'node:fs';
import path from 'node:path';

const sortie = process.argv[2] ?? 'dist';
const reglages = {
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? '',
  supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
  turnstileSiteKey: process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY ?? '',
};

// Une clé secrète (service_role) n'a rien à faire dans une page publique : on refuse de l'écrire.
if (/^sb_secret_/.test(reglages.supabaseAnonKey) || /"role"\s*:\s*"service_role"/.test(jeton(reglages.supabaseAnonKey))) {
  console.error('appli.json : EXPO_PUBLIC_SUPABASE_ANON_KEY ressemble à une clé secrète, rien n’est écrit.');
  process.exit(1);
}
if (!reglages.supabaseUrl || !reglages.supabaseAnonKey) {
  console.warn('appli.json : variables EXPO_PUBLIC_SUPABASE_* absentes, fichier non écrit (l’extension ne marchera pas).');
  process.exit(0);
}
fs.mkdirSync(sortie, { recursive: true });
fs.writeFileSync(path.join(sortie, 'appli.json'), `${JSON.stringify(reglages, null, 2)}\n`);
console.log('appli.json écrit.');

// Charge utile d'un JWT (ancien format de clé), ou chaîne vide.
function jeton(cle) {
  try {
    return Buffer.from(cle.split('.')[1] ?? '', 'base64url').toString();
  } catch {
    return '';
  }
}
