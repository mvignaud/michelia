// Lecture des nouveautés de Michel : un fichier Markdown par évolution dans app/nouveautes/.
// Aucune dépendance : un en-tête « clé: valeur » entre deux lignes ---, puis le texte de Michel.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DOSSIER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'nouveautes');
export const TYPES = { nouveau: 'Nouveau', mieux: 'En mieux', corrige: 'Corrigé' };
export const PLATEFORMES = { web: 'Site', ios: 'iPhone', android: 'Android' };

// Découpe « ---\nclé: valeur\n---\ncorps ». Lève une erreur claire si le fichier est mal formé.
function lire(fichier) {
  const brut = fs.readFileSync(fichier, 'utf8').replace(/\r\n/g, '\n');
  const m = brut.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) throw new Error(`${fichier} : en-tête --- manquant`);
  const meta = {};
  for (const ligne of m[1].split('\n')) {
    if (!ligne.trim()) continue;
    const i = ligne.indexOf(':');
    if (i < 1) throw new Error(`${fichier} : ligne d'en-tête illisible « ${ligne} »`);
    meta[ligne.slice(0, i).trim()] = ligne.slice(i + 1).trim();
  }
  return { meta, corps: m[2].trim() };
}

export function lireNouveautes() {
  const fichiers = fs
    .readdirSync(DOSSIER)
    .filter((f) => f.endsWith('.md') && f !== 'LISEZMOI.md')
    .map((f) => path.join(DOSSIER, f));
  const entrees = fichiers.map((fichier) => {
    const { meta, corps } = lire(fichier);
    const nom = path.basename(fichier);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(meta.date ?? '')) throw new Error(`${nom} : date AAAA-MM-JJ attendue`);
    if (!meta.titre) throw new Error(`${nom} : titre manquant`);
    if (!TYPES[meta.type]) throw new Error(`${nom} : type parmi ${Object.keys(TYPES).join(', ')}`);
    const plateformes = (meta.plateformes ?? '').split(/[\s,]+/).filter(Boolean);
    if (!plateformes.length || plateformes.some((p) => !PLATEFORMES[p]))
      throw new Error(`${nom} : plateformes parmi ${Object.keys(PLATEFORMES).join(', ')}`);
    if (!corps) throw new Error(`${nom} : le mot de Michel est vide`);
    const prs = (meta.pr ?? '').split(/[\s,#]+/).filter(Boolean).map(Number);
    if (prs.some((n) => !Number.isInteger(n) || n < 1)) throw new Error(`${nom} : pr = numéros de PR`);
    const build = meta.build ? Number(meta.build) : undefined;
    if (meta.build && !Number.isInteger(build)) throw new Error(`${nom} : build = un numéro`);
    if (meta.sans_build && meta.sans_build !== 'oui') throw new Error(`${nom} : sans_build = oui ou rien`);
    return {
      fichier,
      nom,
      date: meta.date,
      titre: meta.titre,
      type: meta.type,
      plateformes,
      appli: plateformes.includes('ios') || plateformes.includes('android'),
      prs,
      build,
      sansBuild: meta.sans_build === 'oui',
      store: meta.store || meta.titre,
      corps,
    };
  });
  // Les plus récentes d'abord ; à date égale, la plus grande PR d'abord (sans PR : tout en haut).
  const derniere = (e) => (e.prs.length ? Math.max(...e.prs) : Infinity);
  return entrees.sort((a, b) => b.date.localeCompare(a.date) || derniere(b) - derniere(a) || b.nom.localeCompare(a.nom));
}

// Rendu HTML partagé par les pages générées (nouveautés, « Ça mijote »).

// La feuille de style change avec les pages : son empreinte dans l'adresse évite qu'un navigateur
// ou le service worker serve l'ancienne version, sans les étiquettes.
export const CSS_VERSION = crypto
  .createHash('sha256')
  .update(fs.readFileSync(new URL('../public/legal.css', import.meta.url)))
  .digest('hex')
  .slice(0, 8);
export const echapper = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Un Markdown réduit : paragraphes, listes « - », **gras**, *italique*, [lien](https://…).
export function enLigne(s) {
  return echapper(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|\/[^\s)]*)\)/g, '<a href="$2">$1</a>');
}
export function versHtml(md) {
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
export const dateLongue = (iso) => {
  const [a, m, j] = iso.split('-').map(Number);
  return `${j === 1 ? '1er' : j} ${MOIS[m - 1]} ${a}`;
};


// En-tête commun aux pages générées : le logo MichelIA, comme sur les pages légales.
export const TETE = `<header><div><a class="logo" href="/"><img src="/logo.svg" alt="MichelIA" width="118" height="40"></a><a href="/">Parler à Michel</a></div></header>`;

// Pied de page commun aux pages générées.
export const PIED = `<footer><a href="/confit-de-canard">Nouveautés</a> · <a href="/ca-mijote">Ça mijote</a> · <a href="/cahier-de-doleances">Améliore Michel</a> · <a href="/mentions-legales.html">Mentions légales</a> · <a href="/confidentialite.html">Confidentialité</a> · <a href="/conditions.html">Conditions d'utilisation</a> · <a href="https://github.com/mvignaud/michelia">Code source</a></footer>`;
