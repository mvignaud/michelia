// Génère la page https://michel.beer/ca-mijote (et /roadmap, redirigée) à partir de app/ca-mijote.md.
// Lancé après « expo export » par npm run build:web : node scripts/ca-mijote.mjs [dossier de sortie, dist par défaut]
// Vérification seule : node scripts/ca-mijote.mjs --verifier
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dateLongue, enLigne, PIED, TETE, versHtml } from './nouveautes-lib.mjs';

const FICHIER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'ca-mijote.md');
// Les trois casseroles, dans l'ordre de la page, avec leur étiquette.
const CASSEROLES = {
  'Au feu': { classe: 'type-nouveau', etiquette: 'En cours' },
  'Sur la planche': { classe: 'type-corrige', etiquette: 'Prévu' },
  'Au frais': { classe: 'type-attente', etiquette: 'Plus tard' },
};

function lire() {
  const brut = fs.readFileSync(FICHIER, 'utf8').replace(/\r\n/g, '\n');
  const m = brut.match(/^---\nmaj: (\d{4}-\d{2}-\d{2})\n---\n([\s\S]*)$/);
  if (!m) throw new Error('ca-mijote.md : en-tête « ---\\nmaj: AAAA-MM-JJ\\n--- » attendu');
  const corps = m[2].replace(/<!--[\s\S]*?-->/g, '');
  const sections = corps.split(/^## /m).slice(1).map((bloc) => {
    const [titre, ...reste] = bloc.split('\n');
    const lignes = reste.join('\n').trim().split('\n');
    const plats = lignes.filter((l) => l.startsWith('- ')).map((l) => {
      const p = l.match(/^- \*\*(.+?)\*\* ?: (.+)$/);
      if (!p) throw new Error(`ca-mijote.md : plat illisible « ${l} » (attendu « - **Titre** : texte »)`);
      return { titre: p[1], texte: p[2][0].toUpperCase() + p[2].slice(1) };
    });
    const intro = lignes.filter((l) => !l.startsWith('- ')).join('\n').trim();
    return { titre: titre.trim(), intro, plats };
  });
  const noms = sections.map((s) => s.titre);
  if (noms.join('|') !== Object.keys(CASSEROLES).join('|'))
    throw new Error(`ca-mijote.md : sections attendues, dans l'ordre : ${Object.keys(CASSEROLES).join(', ')}`);
  return { maj: m[1], sections };
}

function page({ maj, sections }) {
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ça mijote · MichelIA</title>
<meta name="description" content="Ce qui mijote chez Michel, le papi du Gers coincé dans la machine : ce qu'on prépare pour le site et les applis MichelIA.">
<link rel="stylesheet" href="/legal.css">
<style>.etiquettes .type-attente { background: #8a9bb0; color: #fff; } .vide { color: var(--gris); font-style: italic; }</style>
</head>
<body>
${TETE}
<main>
<h1>Ça mijote chez Michel</h1>
<p class="maj">Dernière mise à jour : ${dateLongue(maj)}</p>
<p class="michel">« Ici c'est ma cuisine. Ce qui est au feu, ce qui attend sur la planche, et ce que j'ai mis au frais pour plus tard. Une idée de recette ? Écris-la dans le <a href="/cahier-de-doleances">cahier de doléances</a>. Et ce qui est déjà servi, c'est dans le <a href="/confit-de-canard">carnet des nouveautés</a>. »</p>
${sections
  .map((s) => {
    const c = CASSEROLES[s.titre];
    const plats = s.plats.length
      ? s.plats
          .map(
            (p) => `<section class="nouveaute">
<p class="etiquettes"><span class="type ${c.classe}">${c.etiquette}</span></p>
<h2>${enLigne(p.titre)}</h2>
<p>${enLigne(p.texte)}</p>
</section>`,
          )
          .join('\n')
      : '<p class="vide">Rien dans cette casserole pour l\'instant.</p>';
    return `<h3 class="jour">${enLigne(s.titre)}</h3>\n${s.intro ? versHtml(s.intro) + '\n' : ''}${plats}`;
  })
  .join('\n')}
</main>
${PIED}
</body>
</html>
`;
}

const donnees = lire();
const arg = process.argv[2];
if (arg === '--verifier') {
  page(donnees);
  console.log(`Ça mijote : ${donnees.sections.map((s) => `${s.plats.length} ${s.titre.toLowerCase()}`).join(', ')}.`);
} else {
  const sortie = path.resolve(arg ?? 'dist');
  if (!fs.existsSync(sortie)) throw new Error(`Dossier de sortie absent : ${sortie} (lancer expo export d'abord)`);
  fs.writeFileSync(path.join(sortie, 'ca-mijote.html'), page(donnees));
  console.log(`Ça mijote → ${path.join(sortie, 'ca-mijote.html')}`);
}
