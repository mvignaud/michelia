// Génère la page https://michel.beer/ca-mijote (et /roadmap, redirigée) à partir de app/ca-mijote.md.
// Lancé après « expo export » par npm run build:web : node scripts/ca-mijote.mjs [dossier de sortie, dist par défaut]
// Vérification seule : node scripts/ca-mijote.mjs --verifier
// « Tout juste servi » reprend toute seule les dernières entrées de app/nouveautes/ : la page bouge à chaque nouveauté.
import fs from 'node:fs';
import path from 'node:path';
import { CASSEROLES, CSS_VERSION, dateLongue, enLigne, lireCaMijote, lireNouveautes, metaPage, PIED, TETE, TYPES, versHtml } from './nouveautes-lib.mjs';

// Les dernières nouveautés reprises en bas de page, sous « Tout juste servi ».
const SERVIS = 5;

function page({ maj, sections }, servis) {
  // La date affichée suit aussi le carnet : une nouveauté servie, c'est la cuisine qui a bougé.
  const derniere = [maj, ...servis.map((e) => e.date)].sort().pop();
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ça mijote · MichelIA</title>
${metaPage({ chemin: '/ca-mijote', titre: "Ça mijote chez Michel : ce qu'on prépare pour MichelIA", description: "Ce qui mijote chez Michel, le papi du Gers coincé dans la machine : ce qu'on prépare pour le site et les applis MichelIA." })}
<link rel="stylesheet" href="/legal.css?v=${CSS_VERSION}">
<style>.etiquettes .type-attente { background: #8a9bb0; color: #fff; } .vide { color: var(--gris); font-style: italic; }</style>
</head>
<body>
${TETE}
<main>
<h1>Ça mijote chez Michel</h1>
<p class="maj">Dernière mise à jour : ${dateLongue(derniere)}</p>
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
<h3 class="jour">Tout juste servi</h3>
<p>Sorti de la cuisine, c'est dans ton assiette. Le détail est dans le <a href="/confit-de-canard">carnet des nouveautés</a>.</p>
${servis
  .map(
    (e) => `<section class="nouveaute">
<p class="etiquettes"><span class="type type-${e.type}">${TYPES[e.type]}</span></p>
<h2>${enLigne(e.titre)}</h2>
<p>${dateLongue(e.date)}</p>
</section>`,
  )
  .join('\n')}
</main>
${PIED}
</body>
</html>
`;
}

const donnees = lireCaMijote();
const servis = lireNouveautes().slice(0, SERVIS);
const arg = process.argv[2];
if (arg === '--verifier') {
  page(donnees, servis);
  console.log(`Ça mijote : ${donnees.sections.map((s) => `${s.plats.length} ${s.titre.toLowerCase()}`).join(', ')}.`);
} else {
  const sortie = path.resolve(arg ?? 'dist');
  if (!fs.existsSync(sortie)) throw new Error(`Dossier de sortie absent : ${sortie} (lancer expo export d'abord)`);
  fs.writeFileSync(path.join(sortie, 'ca-mijote.html'), page(donnees, servis));
  console.log(`Ça mijote → ${path.join(sortie, 'ca-mijote.html')}`);
}
