#!/usr/bin/env node
// Fiches des stores : pousse les textes de app/store/fiche.json (et les images Google Play) vers
// App Store Connect et la Play Console, et, avec --build, les notes de version de
// app/nouveautes/builds/<n>.md. Lancé par la tâche GitHub « Fiches des stores » (.github/workflows/fiches.yml).
// Sans --appliquer, il compare seulement et dit ce qui changerait.
//
//   node scripts/fiches.mjs [--appliquer] [--seulement apple,google] [--build 12] [--build-android 9]
// Les numéros EAS sont propres à chaque plateforme : --build-android donne le code de version Google
// quand il diffère du numéro des notes (par défaut, le même).
//
// Clés : mêmes variables que boutiques.mjs (ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_P8, PLAY_SERVICE_ACCOUNT_JSON).
// Captures : celles de app/store/apple (fiche.json > apple.captures) et app/store/google, faites par store/captures.mjs.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { APPLE_APP_ID, PACKAGE, appleApi, dire, envoyerFichierApple, googleToken, http, md5, mode } from './stores-lib.mjs';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const STORE = path.join(ICI, '..', 'store');
const FICHE = JSON.parse(fs.readFileSync(path.join(STORE, 'fiche.json'), 'utf8'));
const LANGUE = 'fr-FR';

const { APPLIQUER, valeur, agir, lancer } = mode();
const build = valeur('--build');
const buildAndroid = valeur('--build-android') ?? build;

// Notes de version préparées par notes-stores.mjs : le bloc de code sous chaque titre de boutique.
function notes(boutique) {
  if (!build) return undefined;
  const fichier = path.join(ICI, '..', 'nouveautes', 'builds', `${build}.md`);
  if (!fs.existsSync(fichier)) throw new Error(`notes du build ${build} introuvables (${path.relative(process.cwd(), fichier)})`);
  const md = fs.readFileSync(fichier, 'utf8');
  const titre = boutique === 'apple' ? '## App Store Connect' : '## Google Play';
  const bloc = md.slice(md.indexOf(titre)).match(/```text\n([\s\S]*?)\n```/)?.[1];
  if (!bloc) throw new Error(`pas de notes ${boutique} dans builds/${build}.md`);
  return bloc.replace(/<\/?fr-FR>\n?/g, '').trim();
}

// Champs dont la valeur voulue diffère de l'actuelle (les champs voulus vides sont ignorés).
const ecarts = (actuel, voulu) =>
  Object.fromEntries(Object.entries(voulu).filter(([k, v]) => v !== undefined && (actuel?.[k] ?? '') !== v));
// Les champs courts sont montrés avant → après, pour relire un essai sans ouvrir les consoles.
const noms = (o, actuel) =>
  Object.entries(o)
    .map(([k, v]) => (String(v).length <= 100 ? `${k} « ${actuel?.[k] ?? ''} » → « ${v} »` : k))
    .join(', ');

// ---------- App Store Connect ----------
// États où Apple laisse modifier la fiche d'une version.
const MODIFIABLE = ['PREPARE_FOR_SUBMISSION', 'DEVELOPER_REJECTED', 'REJECTED', 'METADATA_REJECTED', 'INVALID_BINARY'];

// Captures d'une version (une série par taille d'écran) : remplacées seulement si elles diffèrent du dossier.
async function capturesApple(api, loc, titre) {
  const sets = (await api(`/v1/appStoreVersionLocalizations/${loc.id}/appScreenshotSets?limit=50`)).data;
  for (const [affichage, fichiers] of Object.entries(FICHE.apple.captures ?? {})) {
    const chemins = fichiers.map((n) => path.join(STORE, 'apple', n));
    let set = sets.find((s) => s.attributes.screenshotDisplayType === affichage);
    const actuelles = set ? (await api(`/v1/appScreenshotSets/${set.id}/appScreenshots?limit=10`)).data : [];
    const pareil =
      actuelles.length === chemins.length &&
      chemins.every((c, i) => actuelles[i]?.attributes?.sourceFileChecksum === md5(fs.readFileSync(c)));
    if (pareil) {
      dire(`${titre} : captures ${affichage} à jour`);
      continue;
    }
    await agir(`${titre.slice(2)} : captures ${affichage} (${fichiers.length}, remplace ${actuelles.length})`, async () => {
      set ??= (
        await api('/v1/appScreenshotSets', {
          method: 'POST',
          body: {
            data: {
              type: 'appScreenshotSets',
              attributes: { screenshotDisplayType: affichage },
              relationships: { appStoreVersionLocalization: { data: { type: 'appStoreVersionLocalizations', id: loc.id } } },
            },
          },
        })
      ).data;
      for (const a of actuelles) await api(`/v1/appScreenshots/${a.id}`, { method: 'DELETE' });
      for (const c of chemins) await envoyerFichierApple(api, 'appScreenshots', { appScreenshotSet: { type: 'appScreenshotSets', id: set.id } }, c);
    });
  }
}

async function apple() {
  dire('Apple (App Store Connect)');
  const api = await appleApi();
  if (!api) return dire('  clés absentes, ignoré.');
  const f = FICHE.apple;

  // Nom, sous-titre, confidentialité : fiche « App Information » en préparation, s'il y en a une.
  const infos = (await api(`/v1/apps/${APPLE_APP_ID}/appInfos`)).data;
  const info = infos.find((i) => !['READY_FOR_DISTRIBUTION', 'READY_FOR_SALE'].includes(i.attributes.state ?? i.attributes.appStoreState));
  if (!info) dire('- nom et sous-titre : aucune fiche modifiable (ils changent avec la prochaine version)');
  else {
    const locs = (await api(`/v1/appInfos/${info.id}/appInfoLocalizations`)).data;
    const loc = locs.find((l) => l.attributes.locale === LANGUE);
    const diff = ecarts(loc?.attributes, { name: f.nom, subtitle: f.sous_titre, privacyPolicyUrl: f.url_confidentialite });
    if (!loc) dire(`- informations : pas de langue ${LANGUE} dans App Store Connect`);
    else if (!Object.keys(diff).length) dire('- informations (nom, sous-titre) : à jour');
    else
      await agir(`informations : ${noms(diff, loc.attributes)}`, () =>
        api(`/v1/appInfoLocalizations/${loc.id}`, {
          method: 'PATCH',
          body: { data: { type: 'appInfoLocalizations', id: loc.id, attributes: diff } },
        }),
      );
  }

  // Textes de version : description, mots-clés… sur la version en préparation ; texte promotionnel partout.
  const versions = (await api(`/v1/apps/${APPLE_APP_ID}/appStoreVersions?filter[platform]=IOS&limit=10`)).data;
  const whatsNew = notes('apple');
  for (const v of versions) {
    const etatV = v.attributes.appVersionState ?? v.attributes.appStoreState;
    const modifiable = MODIFIABLE.includes(etatV);
    const locs = (await api(`/v1/appStoreVersions/${v.id}/appStoreVersionLocalizations`)).data;
    const loc = locs.find((l) => l.attributes.locale === LANGUE);
    const titre = `- version ${v.attributes.versionString} (${etatV})`;
    if (!loc) {
      dire(`${titre} : pas de langue ${LANGUE}`);
      continue;
    }
    if (modifiable) await capturesApple(api, loc, titre);
    // La toute première version n'a pas de « Nouveautés » : Apple refuse le champ.
    const premiere = versions.length === 1;
    const voulu = modifiable
      ? {
          description: f.description,
          keywords: f.mots_cles,
          promotionalText: f.texte_promotionnel,
          supportUrl: f.url_assistance,
          marketingUrl: f.url_marketing,
          ...(whatsNew && !premiere ? { whatsNew } : {}),
        }
      : { promotionalText: f.texte_promotionnel };
    const diff = ecarts(loc.attributes, voulu);
    if (!Object.keys(diff).length) {
      dire(`${titre} : à jour${modifiable ? '' : ' (seul le texte promotionnel se modifie dans cet état)'}`);
      continue;
    }
    await agir(`${titre.slice(2)} : ${noms(diff, loc.attributes)}`, () =>
      api(`/v1/appStoreVersionLocalizations/${loc.id}`, {
        method: 'PATCH',
        body: { data: { type: 'appStoreVersionLocalizations', id: loc.id, attributes: diff } },
      }),
    );
  }
}

// ---------- Google Play ----------
const PISTES = ['internal', 'alpha', 'beta', 'production'];
const sha256 = (fichier) => crypto.createHash('sha256').update(fs.readFileSync(fichier)).digest('hex');

async function google() {
  dire('Google Play');
  const token = await googleToken();
  if (!token) return dire('  clé absente, ignoré.');
  const f = FICHE.google;

  // « Sécurité des données » : le CSV de la Play Console (exporté puis rempli), envoyé tel quel. Google n'offre
  // pas de lecture : on le renvoie à chaque application (sans effet s'il n'a pas changé).
  const csv = path.join(ICI, '..', 'store', 'google', 'securite-donnees.csv');
  if (fs.existsSync(csv))
    await agir('sécurité des données (store/google/securite-donnees.csv)', () =>
      http(`https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE}/dataSafety`, {
        method: 'POST',
        token,
        body: { safetyLabels: fs.readFileSync(csv, 'utf8') },
      }),
    );

  const base = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE}/edits`;
  const upload = `https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/${PACKAGE}/edits`;
  const api = (p, opts) => http(`${base}${p}`, { token, ...opts });

  // Tout passe par une « modification » (edit) : validée à la fin si on applique, abandonnée sinon.
  const edit = (await api('', { method: 'POST', body: {} })).id;
  const e = `/${edit}`;
  let changements = 0;
  const changer = async (quoi, fn) => {
    changements++;
    await agir(quoi, fn);
  };

  try {
    // Textes de la fiche.
    let listing = null;
    try {
      listing = await api(`${e}/listings/${LANGUE}`);
    } catch (err) {
      if (err.status !== 404) throw err;
    }
    const diff = ecarts(listing, { title: f.nom, shortDescription: f.description_courte, fullDescription: f.description });
    if (!Object.keys(diff).length) dire('- textes de la fiche : à jour');
    else
      await changer(`textes de la fiche : ${noms(diff, listing)}`, () =>
        api(`${e}/listings/${LANGUE}`, {
          method: 'PUT',
          body: { language: LANGUE, title: f.nom, shortDescription: f.description_courte, fullDescription: f.description },
        }),
      );

    // Coordonnées.
    const details = await api(`${e}/details`);
    const diffD = ecarts(details, { contactEmail: f.email, contactWebsite: f.site, defaultLanguage: LANGUE });
    if (!Object.keys(diffD).length) dire('- coordonnées : à jour');
    else await changer(`coordonnées : ${noms(diffD, details)}`, () => api(`${e}/details`, { method: 'PATCH', body: diffD }));

    // Images : remplacées seulement si elles diffèrent de celles du dossier store/google.
    for (const [type, fichiers] of Object.entries(f.images)) {
      const chemins = fichiers.map((n) => path.join(STORE, 'google', n));
      const actuelles = (await api(`${e}/listings/${LANGUE}/${type}`))?.images ?? [];
      const pareil =
        actuelles.length === chemins.length && chemins.every((c, i) => actuelles[i]?.sha256 === sha256(c));
      if (pareil) {
        dire(`- images ${type} : à jour`);
        continue;
      }
      await changer(`images ${type} : ${fichiers.length} fichier(s)`, async () => {
        if (actuelles.length) await api(`${e}/listings/${LANGUE}/${type}`, { method: 'DELETE' });
        for (const c of chemins)
          await http(`${upload}${e}/listings/${LANGUE}/${type}?uploadType=media`, {
            method: 'POST',
            token,
            raw: fs.readFileSync(c),
            type: 'image/png',
          });
      });
    }

    // Notes de version : sur la piste qui porte ce build (code de version = numéro de build).
    const texte = notes('google');
    if (texte) {
      let trouve = false;
      for (const piste of PISTES) {
        const track = await api(`${e}/tracks/${piste}`).catch((err) => (err.status === 404 ? null : Promise.reject(err)));
        const release = track?.releases?.find((r) => r.versionCodes?.includes(String(buildAndroid)));
        if (!release) continue;
        trouve = true;
        const actuel = release.releaseNotes?.find((n) => n.language === LANGUE)?.text;
        if (actuel === texte) {
          dire(`- notes du build ${buildAndroid} (${piste}) : à jour`);
          continue;
        }
        release.releaseNotes = [...(release.releaseNotes ?? []).filter((n) => n.language !== LANGUE), { language: LANGUE, text: texte }];
        await changer(`notes du build ${buildAndroid} (${piste})`, () => api(`${e}/tracks/${piste}`, { method: 'PUT', body: track }));
      }
      if (!trouve) dire(`- notes : build ${buildAndroid} absent des pistes Google (pas encore envoyé ?)`);
    }

    if (APPLIQUER && changements) {
      // Une appli déjà publiée peut exiger que l'envoi en examen soit fait à la main dans la console.
      await http(`${base}${e}:commit`, { method: 'POST', token }).catch((err) =>
        /changesNotSentForReview/.test(err.message)
          ? http(`${base}${e}:commit?changesNotSentForReview=true`, { method: 'POST', token }).then(() =>
              dire('  (modifications enregistrées : à envoyer en examen dans la Play Console, « Vue d’ensemble des publications »)'),
            )
          : Promise.reject(err),
      );
      dire('  ✓ modification validée sur Google Play');
      return;
    }
  } catch (err) {
    await api(e, { method: 'DELETE' }).catch(() => {});
    throw err;
  }
  await api(e, { method: 'DELETE' }).catch(() => {});
  if (!changements) dire('  rien à changer');
}

await lancer([
  ['apple', apple],
  ['google', google],
]);
