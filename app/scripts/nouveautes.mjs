// Génère la page https://michel.beer/nouveautes à partir de app/nouveautes/*.md.
// Lancé après « expo export » par npm run build:web : node scripts/nouveautes.mjs [dossier de sortie, dist par défaut]
// Sans dossier de sortie existant (vérification seule) : node scripts/nouveautes.mjs --verifier
import fs from 'node:fs';
import path from 'node:path';
import { lireNouveautes, PLATEFORMES, TYPES } from './nouveautes-lib.mjs';

const echapper = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Un Markdown réduit : paragraphes, listes « - », **gras**, *italique*, [lien](https://…).
function enLigne(s) {
  return echapper(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|\/[^\s)]*)\)/g, '<a href="$2">$1</a>');
}
function versHtml(md) {
  return md
    .split(/\n{2,}/)
    .map((bloc) => {
      const lignes = bloc.split('\n');
      if (lignes.every((l) => /^- /.test(l)))
        return `<ul>${lignes.map((l) => `<li>${enLigne(l.slice(2))}</li>`).join('')}</ul>`;
      return `<p>${enLigne(lignes.join(' '))}</p>`;
    })
    .join('\n');
}

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const dateLongue = (iso) => {
  const [a, m, j] = iso.split('-').map(Number);
  return `${j === 1 ? '1er' : j} ${MOIS[m - 1]} ${a}`;
};

function disponibilite(e) {
  if (!e.appli) return 'Sur le site';
  const site = e.plateformes.includes('web');
  if (e.sansBuild) return site ? 'Sur le site et dans les applis' : 'Dans les applis';
  if (e.build) return `Dans les applis depuis le build ${e.build}${site ? ', et sur le site' : ''}`;
  return `Bientôt dans les applis${site ? ', déjà sur le site' : ''}`;
}

function carte(e) {
  const prs = e.prs
    .map((n) => `<a href="https://github.com/mvignaud/michelia/pull/${n}">#${n}</a>`)
    .join(', ');
  return `<section class="nouveaute">
<p class="etiquettes"><span class="type type-${e.type}">${TYPES[e.type]}</span>${e.plateformes
    .map((p) => `<span class="plateforme">${PLATEFORMES[p]}</span>`)
    .join('')}</p>
<h2>${enLigne(e.titre)}</h2>
${versHtml(e.corps)}
<p class="dispo">${disponibilite(e)}${prs ? ` · ${prs}` : ''}</p>
</section>`;
}

function page(entrees) {
  const parJour = [];
  for (const e of entrees) {
    const dernier = parJour[parJour.length - 1];
    if (dernier?.date === e.date) dernier.entrees.push(e);
    else parJour.push({ date: e.date, entrees: [e] });
  }
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Nouveautés · MichelIA</title>
<meta name="description" content="Ce qui change chez Michel, le papi du Gers coincé dans la machine : nouveautés du site et des applis MichelIA.">
<link rel="stylesheet" href="/legal.css">
</head>
<body>
<header><div><span class="logo">MichelIA</span><a href="/">Parler à Michel</a></div></header>
<main>
<h1>Les nouveautés de Michel</h1>
<p class="maj">Dernière mise à jour : ${entrees.length ? dateLongue(entrees[0].date) : '—'}</p>
<p class="michel">« On m'a demandé de tenir le carnet de ce qui change chez moi. Comme si j'avais que ça à faire, con. Bon, c'est noté là, le plus récent en haut. »</p>
${parJour
  .map((j) => `<h3 class="jour">${dateLongue(j.date)}</h3>\n${j.entrees.map(carte).join('\n')}`)
  .join('\n')}
</main>
<footer><a href="/nouveautes">Nouveautés</a> · <a href="/mentions-legales.html">Mentions légales</a> · <a href="/confidentialite.html">Confidentialité</a> · <a href="/conditions.html">Conditions d'utilisation</a> · <a href="https://github.com/mvignaud/michelia">Code source</a></footer>
</body>
</html>
`;
}

const entrees = lireNouveautes();
const arg = process.argv[2];
if (arg === '--verifier') {
  page(entrees);
  console.log(`Nouveautés : ${entrees.length} entrées valides.`);
} else {
  const sortie = path.resolve(arg ?? 'dist');
  if (!fs.existsSync(sortie)) throw new Error(`Dossier de sortie absent : ${sortie} (lancer expo export d'abord)`);
  fs.writeFileSync(path.join(sortie, 'nouveautes.html'), page(entrees));
  // Même contenu en JSON, pour un futur écran « Quoi de neuf » dans l'appli.
  const json = entrees.map(({ fichier, nom, corps, ...e }) => ({ ...e, texte: corps }));
  fs.writeFileSync(path.join(sortie, 'nouveautes.json'), JSON.stringify(json, null, 1));
  console.log(`Nouveautés : ${entrees.length} entrées → ${path.join(sortie, 'nouveautes.html')}`);
}
