// Génère https://michel.beer/sitemap.xml, le plan du site envoyé à Google (Search Console) et Bing.
// Lancé après « expo export » par npm run build:web : node scripts/plan-du-site.mjs [dossier de sortie, dist par défaut]
// Vérification seule : node scripts/plan-du-site.mjs --verifier
// Seules les pages publiques à trouver dans les moteurs y sont. Restent dehors, avec un « noindex »
// (public/_headers ou la page elle-même) : les causettes partagées, le comptoir, la cotisation, le
// cahier de doléances (des écrans du chat, sans rien à lire), la vérification anti-robots et la page hors ligne.
import fs from 'node:fs';
import path from 'node:path';
import { lireCaMijote, lireNouveautes, MOIS, SITE } from './nouveautes-lib.mjs';

// « Dernière mise à jour : 30 octobre 2026 » d'une page légale, en AAAA-MM-JJ (rien si absente).
function majPageLegale(fichier) {
  const html = fs.readFileSync(new URL(`../public/${fichier}`, import.meta.url), 'utf8');
  const m = html.match(/Dernière mise à jour : (1er|\d{1,2}) (\p{L}+) (\d{4})/u);
  const mois = m ? MOIS.indexOf(m[2]) + 1 : 0;
  if (!mois) return undefined;
  const jour = m[1] === '1er' ? 1 : Number(m[1]);
  return `${m[3]}-${String(mois).padStart(2, '0')}-${String(jour).padStart(2, '0')}`;
}

function plan() {
  const derniere = lireNouveautes()[0]?.date;
  const { maj } = lireCaMijote();
  // L'accueil et « Ça mijote » reprennent les dernières nouveautés : ils bougent avec le carnet.
  const cuisine = [maj, derniere].filter(Boolean).sort().pop();
  const pages = [
    { chemin: '/', maj: cuisine },
    { chemin: '/chat' },
    { chemin: '/ca-mijote', maj: cuisine },
    { chemin: '/confit-de-canard', maj: derniere },
    { chemin: '/mentions-legales', maj: majPageLegale('mentions-legales.html') },
    { chemin: '/confidentialite', maj: majPageLegale('confidentialite.html') },
    { chemin: '/conditions', maj: majPageLegale('conditions.html') },
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages
  .map((p) => `<url><loc>${SITE}${p.chemin}</loc>${p.maj ? `<lastmod>${p.maj}</lastmod>` : ''}</url>`)
  .join('\n')}
</urlset>
`;
}

const xml = plan();
const arg = process.argv[2];
if (arg === '--verifier') {
  console.log(`Plan du site : ${xml.match(/<url>/g).length} pages.`);
} else {
  const sortie = path.resolve(arg ?? 'dist');
  if (!fs.existsSync(sortie)) throw new Error(`Dossier de sortie absent : ${sortie} (lancer expo export d'abord)`);
  fs.writeFileSync(path.join(sortie, 'sitemap.xml'), xml);
  console.log(`Plan du site → ${path.join(sortie, 'sitemap.xml')}`);
}
