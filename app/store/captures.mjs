#!/usr/bin/env node
// Captures des stores « à la Michel » : chaque écran brut de store/ecrans/ est posé dans un téléphone
// ou une tablette, sur fond crème, avec une phrase de Michel au-dessus.
// Sorties : apple/iphone69-*.png (1320 × 2868, iPhone 6,9"), apple/ipad13-*.png (2064 × 2752, iPad 13"),
// google/android-*.png (1080 × 1920). Ensuite : tâche GitHub « Fiches des stores » (les envoie aux deux stores).
//
//   node store/captures.mjs        (depuis app/ ; il faut Playwright et Chromium sur la machine)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

// Playwright n'est pas une dépendance de l'appli : on prend celui installé sur la machine (npm i -g playwright).
const { chromium } = createRequire(import.meta.url)('playwright');

const ICI = path.dirname(fileURLToPath(import.meta.url));
const ECRANS = path.join(ICI, 'ecrans');
const MICHEL = fs.readFileSync(path.join(ICI, '..', 'assets', 'brand', 'logo-symbole.svg'), 'utf8');

// Une phrase de Michel par écran : titre (gros) et sous-titre.
const SCENES = [
  { ecran: '1-accueil', titre: 'Pose ta question à Michel, pardi !', sous: 'L’IA du Gers, gratuite et sans pub' },
  { ecran: '2-garbure', titre: 'La garbure ? Il connaît, con.', sous: 'Recettes, astuces et bon sens de chez nous' },
  { ecran: '3-voisin', titre: 'Un mot pour le voisin ? Poli, mais franc du collier', sous: 'Lettres, messages, petits mots' },
  { ecran: '4-inflation', titre: 'Les trucs compliqués, avec des mots simples', sous: 'Il t’explique tout, sans chichis' },
  { ecran: '5-michelia-plus', titre: 'MichelIA+ : plus de causette avec Michel', sous: 'Et tu fais tourner la boutique', tablette: false, google: false },
];

const FORMATS = [
  { dossier: 'apple', prefixe: 'iphone69', l: 1320, h: 2868, appareil: 'telephone' },
  { dossier: 'apple', prefixe: 'ipad13', l: 2064, h: 2752, appareil: 'tablette' },
  { dossier: 'google', prefixe: 'android', l: 1080, h: 1920, appareil: 'telephone' },
];

function page({ l, h, appareil }, scene, image) {
  const tablette = appareil === 'tablette';
  // Zone du texte en haut, appareil dessous (il peut déborder un peu en bas, comme sur les vraies fiches).
  const haut = Math.round(h * (tablette ? 0.2 : 0.235));
  const largeurEcran = tablette ? Math.round(l * 0.74) : Math.round(l * 0.72);
  const bord = Math.round(largeurEcran * (tablette ? 0.025 : 0.035));
  const rayon = Math.round(largeurEcran * (tablette ? 0.04 : 0.12));
  const titre = Math.round(l * (tablette ? 0.05 : 0.075));
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;width:${l}px;height:${h}px;overflow:hidden}
    body{background:radial-gradient(120% 70% at 50% 0%,#FFF8EC 0%,#F6E7D2 60%,#EBD3B4 100%);font-family:Inter,sans-serif;position:relative}
    .texte{position:absolute;top:0;left:0;right:0;height:${haut}px;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:0 ${Math.round(l * 0.07)}px;box-sizing:border-box;text-align:center}
    .michel{width:${Math.round(titre * 1.9)}px;height:${Math.round(titre * 1.9)}px;border-radius:50%;background:#7A2E1B;border:${Math.round(titre * 0.08)}px solid #D9A441;margin-bottom:${Math.round(titre * 0.3)}px;overflow:hidden}
    .michel svg{width:100%;height:100%}
    h1{font-family:Caladea,'DejaVu Serif',serif;font-weight:700;color:#5A1F12;font-size:${titre}px;line-height:1.08;margin:0}
    p{color:#8A5A3C;font-size:${Math.round(titre * 0.48)}px;margin:${Math.round(titre * 0.3)}px 0 0;font-weight:500}
    .appareil{position:absolute;left:50%;top:${haut}px;transform:translateX(-50%);background:#2B2420;padding:${bord}px;border-radius:${rayon + bord}px;box-shadow:0 ${Math.round(l * 0.02)}px ${Math.round(l * 0.06)}px rgba(90,31,18,.35)}
    .appareil img{display:block;width:${largeurEcran}px;border-radius:${rayon}px}
  </style></head><body>
    <div class="texte"><div class="michel">${MICHEL}</div><h1>${scene.titre}</h1><p>${scene.sous}</p></div>
    <div class="appareil"><img src="data:image/png;base64,${image.toString('base64')}"></div>
  </body></html>`;
}

const navigateur = await chromium.launch();
for (const format of FORMATS) {
  const ctx = await navigateur.newContext({ viewport: { width: format.l, height: format.h }, deviceScaleFactor: 1 });
  const onglet = await ctx.newPage();
  for (const scene of SCENES) {
    if (format.appareil === 'tablette' && scene.tablette === false) continue;
    // L'écran MichelIA+ dit « Payé par ton compte Apple » : pas sur Google Play.
    if (format.dossier === 'google' && scene.google === false) continue;
    const source = path.join(ECRANS, `${format.appareil}-${scene.ecran}.png`);
    if (!fs.existsSync(source)) continue;
    await onglet.setContent(page(format, scene, fs.readFileSync(source)), { waitUntil: 'load' });
    const sortie = path.join(ICI, format.dossier, `${format.prefixe}-${scene.ecran}.png`);
    await onglet.screenshot({ path: sortie });
    console.log(path.relative(process.cwd(), sortie));
  }
  await ctx.close();
}
await navigateur.close();
