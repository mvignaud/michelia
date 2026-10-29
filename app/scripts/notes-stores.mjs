// Prépare une version des applis : notes « Nouveautés » pour l'App Store et Google Play + checklist de build.
//   node scripts/notes-stores.mjs <build> [<version>] [--essai]   ex. : 8 1.0.1
// Prend les nouveautés qui touchent les applis (ios / android) et pas encore livrées (sans « build: »),
// écrit app/nouveautes/builds/<build>.md et inscrit « build: <build> » dans chacune. --essai : affiche sans rien écrire.
import fs from 'node:fs';
import path from 'node:path';
import { DOSSIER, lireNouveautes, TYPES } from './nouveautes-lib.mjs';

const MAX_GOOGLE = 500; // Play Console : 500 caractères par langue
const MAX_APPLE = 4000; // App Store Connect : « Nouveautés de cette version »

const build = Number(process.argv[2]);
const essai = process.argv.includes('--essai');
// Version visible dans les stores (expo.version de app.json) : EAS n'incrémente que le numéro de build.
const version = process.argv.slice(3).find((a) => a !== '--essai');
if (version && !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`Version « ${version} » : format 1.0.1 attendu.`);
  process.exit(1);
}
if (!Number.isInteger(build) || build < 1) {
  console.error('Usage : node scripts/notes-stores.mjs <numéro du prochain build> [<version, ex. 1.0.1>] [--essai]');
  process.exit(1);
}
const fichierBuild = path.join(DOSSIER, 'builds', `${build}.md`);
if (fs.existsSync(fichierBuild)) {
  console.error(`${path.relative(process.cwd(), fichierBuild)} existe déjà : build ${build} déjà préparé.`);
  process.exit(1);
}

// Dans les notes : le nouveau d'abord, puis le mieux, puis les corrections ; à type égal, le plus ancien d'abord.
const RANG = Object.keys(TYPES);
const aLivrer = lireNouveautes()
  .filter((e) => e.appli && !e.build)
  .reverse()
  .sort((a, b) => RANG.indexOf(a.type) - RANG.indexOf(b.type));
if (!aLivrer.length) {
  console.error("Rien de neuf pour les applis depuis le dernier build : pas de notes à préparer.");
  process.exit(1);
}

const INTRO = 'Du neuf chez Michel :';
const FIN = "Et toujours : râler un peu, aider beaucoup.";
const autres = (n) => `• Et ${n} autre${n > 1 ? 's' : ''} petite${n > 1 ? 's' : ''} chose${n > 1 ? 's' : ''}.`;
// Toutes les puces si ça tient, sinon les premières puis « et N autres petites choses ».
function notes(max) {
  const puces = aLivrer.map((e) => `• ${e.store}`);
  const texte = (lignes) => [INTRO, ...lignes, '', FIN].join('\n');
  for (let n = puces.length; n > 0; n--) {
    const lignes = n === puces.length ? puces : [...puces.slice(0, n), autres(puces.length - n)];
    if (texte(lignes).length <= max) return texte(lignes);
  }
  return texte([autres(puces.length)]);
}
const apple = notes(MAX_APPLE);
const google = notes(MAX_GOOGLE);

const contenu = `# Build ${build}

Préparé le ${new Date().toISOString().slice(0, 10)} avec \`node scripts/notes-stores.mjs ${build}${version ? ` ${version}` : ''}\`.${version ? ` Version des stores : **${version}** (déjà inscrite dans \`app/app.json\`).` : ''}

## Ce qu'il contient

${aLivrer.map((e) => `- ${e.titre}${e.prs.length ? ` (${e.prs.map((n) => `#${n}`).join(', ')})` : ''}`).join('\n')}

## App Store Connect : « Nouveautés de cette version » (${apple.length}/${MAX_APPLE} car.)

\`\`\`text
${apple}
\`\`\`

## Google Play : « Notes de version » (${google.length}/${MAX_GOOGLE} car.)

\`\`\`text
<fr-FR>
${google}
</fr-FR>
\`\`\`

## Checklist

Le détail de chaque étape est dans [docs/PUBLIER-UNE-VERSION.md](../../../docs/PUBLIER-UNE-VERSION.md).

- [ ] Cette PR fusionnée (les nouveautés affichent alors « depuis le build ${build} »)
- [ ] Sur le Mac, dans \`app/\` : \`git pull\` puis \`npx eas-cli build --platform all --profile production --auto-submit\`
- [ ] Vérifier sur expo.dev que les deux builds portent bien le numéro ${build} (sinon, renommer ce fichier et corriger les \`build:\`)
- [ ] iOS : build ${build} reçu sur TestFlight, testé sur un iPhone
- [ ] Android : build ${build} reçu en tests internes, testé sur un téléphone
- [ ] App Store Connect : nouvelle version, coller les notes Apple, choisir le build ${build}, « Ajouter pour vérification »
- [ ] Play Console : promouvoir le build ${build} sur la piste voulue, coller les notes Google
`;

if (essai) {
  console.log(contenu);
  process.exit(0);
}
fs.mkdirSync(path.dirname(fichierBuild), { recursive: true });
fs.writeFileSync(fichierBuild, contenu);
if (version) {
  const appJson = path.join(DOSSIER, '..', 'app.json');
  const config = JSON.parse(fs.readFileSync(appJson, 'utf8'));
  config.expo.version = version;
  fs.writeFileSync(appJson, JSON.stringify(config, null, 2) + '\n');
}
for (const e of aLivrer) {
  const brut = fs.readFileSync(e.fichier, 'utf8');
  fs.writeFileSync(e.fichier, brut.replace(/^(---\r?\n[\s\S]*?)(\r?\n---)/, `$1\nbuild: ${build}$2`));
}
console.log(`Build ${build} : ${aLivrer.length} nouveauté(s) → ${path.relative(process.cwd(), fichierBuild)}`);
