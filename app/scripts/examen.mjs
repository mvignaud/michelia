#!/usr/bin/env node
// Examen des stores : met un build en ligne pour tout le monde.
//  - Apple : rattache le build à la version en préparation, vérifie ce qu'Apple exige (captures, contact
//    de vérification, classification, copyright), joint les pourboires et abonnements prêts, puis envoie
//    le tout à l'examen (publication automatique dès l'accord d'Apple).
//  - Google : recopie la version du build depuis sa piste de test vers la production (déploiement complet).
// Lancé par la tâche GitHub « Examen des stores » (.github/workflows/examen.yml). Sans --appliquer, il dit
// seulement ce qu'il ferait. Les textes et captures se mettent à jour avant, avec « Fiches des stores ».
//
//   node scripts/examen.mjs [--appliquer] [--seulement apple,google] --build 17 [--build-android 17]
import { APPLE_APP_ID, PACKAGE, appleApi, dire, googleToken, http, mode } from './stores-lib.mjs';

const { valeur, agir, lancer, etat } = mode();
const build = valeur('--build');
const buildAndroid = valeur('--build-android') ?? build;
const PISTE_GOOGLE = valeur('--piste-google') ?? 'production'; // production, ou alpha (test fermé)
if (!build) {
  dire('Il faut --build <numéro> (le build à publier, voir « État Expo »).');
  process.exit(1);
}
const LANGUE = 'fr-FR';
// États où la version peut encore être modifiée et envoyée (READY_FOR_REVIEW : déjà dans une soumission
// pas encore envoyée, par exemple après un envoi interrompu : on la reprend).
const MODIFIABLE = ['PREPARE_FOR_SUBMISSION', 'READY_FOR_REVIEW', 'DEVELOPER_REJECTED', 'REJECTED', 'METADATA_REJECTED', 'INVALID_BINARY'];

// Ce qui manque et que seul Mathieu peut faire : listé à la fin, et l'envoi Apple n'est pas tenté.
const manques = [];
const manque = (m) => {
  manques.push(m);
  dire(`  ⚠ ${m}`);
};

// ---------- Apple ----------
async function apple() {
  dire('Apple (App Store Connect)');
  const api = await appleApi();
  if (!api) return dire('  clés absentes, ignoré.');
  // Un réglage préalable qui échoue (build, version, notes) bloque l'envoi : sinon Apple publierait l'ancien build.
  const erreursAvant = etat.erreurs;

  // Le build : numéro EAS = CFBundleVersion, traité par Apple (VALID).
  const builds = (
    await api(`/v1/builds?filter[app]=${APPLE_APP_ID}&filter[version]=${build}&include=preReleaseVersion&limit=5`)
  );
  const b = builds.data.find((x) => x.attributes.processingState === 'VALID') ?? builds.data[0];
  if (!b) return manque(`build iOS ${build} introuvable chez Apple (pas encore envoyé ou en traitement)`);
  if (b.attributes.processingState !== 'VALID') return manque(`build iOS ${build} encore en traitement chez Apple (${b.attributes.processingState})`);
  const versionBuild = builds.included?.find((i) => i.type === 'preReleaseVersions')?.attributes?.version;
  dire(`- build ${build} : ${b.attributes.processingState}, version ${versionBuild}`);
  if (b.attributes.usesNonExemptEncryption == null)
    await agir('chiffrement : « aucun chiffrement non exempté »', () =>
      api(`/v1/builds/${b.id}`, { method: 'PATCH', body: { data: { type: 'builds', id: b.id, attributes: { usesNonExemptEncryption: false } } } }),
    );

  // La version à envoyer : celle en préparation (une seule à la fois chez Apple).
  const versions = (await api(`/v1/apps/${APPLE_APP_ID}/appStoreVersions?filter[platform]=IOS&limit=10`)).data;
  const etatDe = (v) => v.attributes.appVersionState ?? v.attributes.appStoreState;
  const enCours = versions.find((v) => ['WAITING_FOR_REVIEW', 'IN_REVIEW', 'PENDING_DEVELOPER_RELEASE', 'PROCESSING_FOR_DISTRIBUTION'].includes(etatDe(v)));
  if (enCours) return dire(`- version ${enCours.attributes.versionString} déjà ${etatDe(enCours)} : rien à envoyer.`);
  const v = versions.find((x) => MODIFIABLE.includes(etatDe(x)));
  if (!v) return manque(`aucune version en préparation dans App Store Connect (créer la version ${versionBuild})`);
  const titre = `version ${v.attributes.versionString} (${etatDe(v)})`;
  dire(`- ${titre}`);

  // Numéro de version et build attachés, copyright, publication dès l'accord.
  const attributs = {};
  if (versionBuild && v.attributes.versionString !== versionBuild) attributs.versionString = versionBuild;
  if (!v.attributes.copyright) attributs.copyright = `${new Date().getFullYear()} GOLDEN PRINT`;
  if (Object.keys(attributs).length)
    await agir(`version : ${Object.entries(attributs).map(([k, x]) => `${k} → ${x}`).join(', ')}`, () =>
      api(`/v1/appStoreVersions/${v.id}`, { method: 'PATCH', body: { data: { type: 'appStoreVersions', id: v.id, attributes: attributs } } }),
    );
  // Publication dès l'accord : souhaitée, pas bloquante. Apple refuse parfois de la changer par l'API
  // (409 « releaseType can not be modified ») ; elle se règle alors dans la console.
  if (v.attributes.releaseType !== 'AFTER_APPROVAL') {
    const avant = etat.erreurs;
    await agir(`publication dès l'accord (${v.attributes.releaseType} → AFTER_APPROVAL)`, () =>
      api(`/v1/appStoreVersions/${v.id}`, {
        method: 'PATCH',
        body: { data: { type: 'appStoreVersions', id: v.id, attributes: { releaseType: 'AFTER_APPROVAL' } } },
      }),
    );
    if (etat.erreurs > avant) {
      etat.erreurs = avant;
      dire(`  (publication laissée sur ${v.attributes.releaseType} : à régler dans App Store Connect si besoin)`);
    }
  }
  const actuel = (await api(`/v1/appStoreVersions/${v.id}/relationships/build`)).data;
  if (actuel?.id === b.id) dire(`  build ${build} déjà rattaché`);
  else
    await agir(`rattacher le build ${build}`, () =>
      api(`/v1/appStoreVersions/${v.id}/relationships/build`, { method: 'PATCH', body: { data: { type: 'builds', id: b.id } } }),
    );

  // Captures (posées par « Fiches des stores ») : il en faut pour l'iPhone 6,9" et l'iPad 13".
  const loc = (await api(`/v1/appStoreVersions/${v.id}/appStoreVersionLocalizations`)).data.find((l) => l.attributes.locale === LANGUE);
  if (!loc) manque(`pas de fiche ${LANGUE} sur la version`);
  else {
    if (!loc.attributes.description) manque('description vide : lancer « Fiches des stores » (appliquer)');
    const sets = (await api(`/v1/appStoreVersionLocalizations/${loc.id}/appScreenshotSets?include=appScreenshots&limit=50`));
    for (const type of ['APP_IPHONE_67', 'APP_IPAD_PRO_3GEN_129']) {
      const set = sets.data.find((s) => s.attributes.screenshotDisplayType === type);
      const n = set?.relationships?.appScreenshots?.data?.length ?? 0;
      if (n) dire(`  captures ${type} : ${n}`);
      else manque(`captures ${type} absentes : lancer « Fiches des stores » (appliquer)`);
    }
  }

  // Contact pour l'équipe de vérification (nom, e-mail, téléphone) : fiche de Mathieu, pas dans le dépôt.
  const detail = await api(`/v1/appStoreVersions/${v.id}/appStoreReviewDetail`).then((r) => r.data).catch((e) => (e.status === 404 ? null : Promise.reject(e)));
  const a = detail?.attributes ?? {};
  const contact = ['contactFirstName', 'contactLastName', 'contactEmail', 'contactPhone'].filter((k) => !a[k]);
  if (contact.length) manque(`contact de vérification incomplet (${contact.join(', ')}) : App Store Connect > version > « Informations pour la vérification de l'app »`);
  else dire(`  contact de vérification : ${a.contactFirstName} ${a.contactLastName}`);
  const NOTES =
    "MichelIA fonctionne sans compte : il suffit d'écrire une question en bas de l'écran. La connexion (Apple, Google, Facebook, e-mail, téléphone) sert seulement à retrouver ses conversations, et la suppression du compte se trouve dans Compte > Supprimer mon compte. Les réponses viennent d'un modèle d'IA (Anthropic Claude) qui joue un personnage humoristique du Sud-Ouest de la France. Les pourboires (« Un pourboire ? ») et l'abonnement MichelIA+ (lien « MichelIA+ » sous le chat) sont des achats intégrés Apple.";
  // Pas de compte de démo : l'appli marche sans compte.
  if (detail && (!a.notes || a.demoAccountRequired))
    await agir('notes pour la vérification (sans compte de démo)', () =>
      api(`/v1/appStoreReviewDetails/${detail.id}`, {
        method: 'PATCH',
        body: { data: { type: 'appStoreReviewDetails', id: detail.id, attributes: { notes: NOTES, demoAccountRequired: false } } },
      }),
    );

  // Classification par âge : le questionnaire doit avoir été rempli (fiche « Informations sur l'app »).
  const infos = (await api(`/v1/apps/${APPLE_APP_ID}/appInfos`)).data;
  const info = infos.find((i) => !['READY_FOR_DISTRIBUTION', 'READY_FOR_SALE'].includes(i.attributes.state ?? i.attributes.appStoreState)) ?? infos[0];
  const age = await api(`/v1/appInfos/${info.id}/ageRatingDeclaration`).then((r) => r.data?.attributes).catch(() => null);
  if (!age || Object.values(age).every((x) => x == null)) manque("classification par âge non remplie : App Store Connect > Informations sur l'app");
  else dire('  classification par âge : remplie');
  const cat = await api(`/v1/appInfos/${info.id}/primaryCategory`).then((r) => r.data).catch(() => null);
  if (!cat) manque("catégorie principale absente : App Store Connect > Informations sur l'app (Divertissement)");

  if (etat.erreurs > erreursAvant) return dire('  → envoi à l’examen Apple non tenté : un réglage de la version a échoué (voir ci-dessus).');

  // Achats intégrés prêts (pourboires, MichelIA+) : envoyés avec la version, sinon Apple les ignore.
  // Une lecture ratée n'est pas « aucun produit » : elle bloque l'envoi, pour ne pas publier sans eux.
  const lire = (p, vide) => api(p).catch((err) => (manque(`lecture des achats intégrés impossible (${err.message})`), vide));
  const iaps = (await lire(`/v1/apps/${APPLE_APP_ID}/inAppPurchasesV2?limit=50`, { data: [] })).data;
  const groupes = (await lire(`/v1/apps/${APPLE_APP_ID}/subscriptionGroups?include=subscriptions&limit=10`, { included: [] })).included ?? [];
  const produits = [
    ...iaps.map((p) => ({ type: 'inAppPurchaseSubmissions', rel: 'inAppPurchaseV2', relType: 'inAppPurchases', p })),
    ...groupes.filter((g) => g.type === 'subscriptions').map((p) => ({ type: 'subscriptionSubmissions', rel: 'subscription', relType: 'subscriptions', p })),
  ];
  for (const { type, rel, relType, p } of produits) {
    const nom = `${p.attributes.productId ?? p.attributes.name} (${p.attributes.state})`;
    if (p.attributes.state === 'READY_TO_SUBMIT')
      await agir(`joindre ${nom}`, () =>
        api(`/v1/${type}`, { method: 'POST', body: { data: { type, relationships: { [rel]: { data: { type: relType, id: p.id } } } } } }),
      );
    else if (p.attributes.state === 'MISSING_METADATA') manque(`produit ${nom} : il manque des informations (lancer « Boutiques »)`);
    else dire(`  produit ${nom}`);
  }

  if (manques.length) return dire('  → envoi à l’examen Apple non tenté : voir ce qui manque.');
  // Un produit qu'Apple refuse de joindre (409, ex. premiers achats intégrés : à cocher dans la console sur la
  // page de la version) : ne pas envoyer la version seule, l'écran MichelIA+ serait vide pour l'examinateur.
  if (etat.erreurs > erreursAvant)
    return dire('  → envoi à l’examen Apple non tenté : des achats intégrés n’ont pas pu être joints (voir ci-dessus).');

  // Envoi : une « soumission » ouverte (ou nouvelle), la version dedans, puis « soumettre ».
  await agir(`envoyer la version ${versionBuild ?? v.attributes.versionString} à l'examen Apple`, async () => {
    const ouvertes = (await api(`/v1/reviewSubmissions?filter[app]=${APPLE_APP_ID}&filter[platform]=IOS&filter[state]=READY_FOR_REVIEW`)).data;
    const sub =
      ouvertes[0] ??
      (
        await api('/v1/reviewSubmissions', {
          method: 'POST',
          body: { data: { type: 'reviewSubmissions', attributes: { platform: 'IOS' }, relationships: { app: { data: { type: 'apps', id: APPLE_APP_ID } } } } },
        })
      ).data;
    const items = (await api(`/v1/reviewSubmissions/${sub.id}/items?include=appStoreVersion`)).data;
    if (!items.some((i) => i.relationships?.appStoreVersion?.data?.id === v.id))
      await api('/v1/reviewSubmissionItems', {
        method: 'POST',
        body: {
          data: {
            type: 'reviewSubmissionItems',
            relationships: {
              reviewSubmission: { data: { type: 'reviewSubmissions', id: sub.id } },
              appStoreVersion: { data: { type: 'appStoreVersions', id: v.id } },
            },
          },
        },
      });
    await api(`/v1/reviewSubmissions/${sub.id}`, {
      method: 'PATCH',
      body: { data: { type: 'reviewSubmissions', id: sub.id, attributes: { submitted: true } } },
    });
  });
}

// ---------- Google ----------
async function google() {
  dire('Google Play');
  const token = await googleToken();
  if (!token) return dire('  clé absente, ignoré.');
  const base = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE}/edits`;
  const api = (p, opts) => http(`${base}${p}`, { token, ...opts });
  const e = `/${(await api('', { method: 'POST', body: {} })).id}`;
  try {
    const cible = PISTE_GOOGLE;
    const nomPiste = cible === 'production' ? 'production' : `test fermé (${cible})`;
    const actuelle = await api(`${e}/tracks/${cible}`).catch((err) => (err.status === 404 ? { track: cible, releases: [] } : Promise.reject(err)));
    if (actuelle.releases?.some((r) => r.status === 'completed' && r.versionCodes?.includes(String(buildAndroid)))) {
      dire(`- build ${buildAndroid} déjà en ${nomPiste}`);
      return;
    }
    // La version du build sur une piste de test (avec ses notes), recopiée telle quelle.
    let source = null;
    for (const piste of ['internal', 'alpha', 'beta'].filter((x) => x !== cible)) {
      const t = await api(`${e}/tracks/${piste}`).catch(() => null);
      const r = t?.releases?.find((x) => x.versionCodes?.includes(String(buildAndroid)));
      if (r) {
        source = { piste, r };
        break;
      }
    }
    if (!source) return manque(`build Android ${buildAndroid} absent des pistes de test Google`);
    dire(`- build ${buildAndroid} trouvé en ${source.piste} (« ${source.r.name ?? ''} »)`);
    const release = (status) => ({ name: source.r.name, versionCodes: source.r.versionCodes, releaseNotes: source.r.releaseNotes, status });
    const poser = (status) => api(`${e}/tracks/${cible}`, { method: 'PUT', body: { track: cible, releases: [release(status)] } });
    await agir(`${nomPiste} : build ${buildAndroid}, déploiement complet`, async () => {
      // Appli jamais publiée (« draft app ») : Google n'accepte qu'un brouillon, que Mathieu lance dans la console.
      const brouillon = await poser('completed').then(
        () => false,
        (err) => (/draft app/i.test(err.message) ? poser('draft').then(() => true) : Promise.reject(err)),
      );
      // Selon l'état du compte, Google veut que l'envoi en examen se fasse dans la console.
      await http(`${base}${e}:commit`, { method: 'POST', token }).catch((err) =>
        /changesNotSentForReview/.test(err.message)
          ? http(`${base}${e}:commit?changesNotSentForReview=true`, { method: 'POST', token }).then(() =>
              manque(`Google : version enregistrée en ${nomPiste}, à envoyer en examen dans la Play Console (« Vue d’ensemble des publications »)`),
            )
          : Promise.reject(err),
      );
      if (brouillon)
        manque(`Google : appli encore en brouillon, version ${nomPiste} posée en brouillon : la lancer dans la Play Console (« Examiner la version » puis « Lancer le déploiement »)`);
    });
  } finally {
    // Sans application (ou après une erreur), la modification est abandonnée ; après un commit, elle n'existe plus.
    await api(e, { method: 'DELETE' }).catch(() => {});
  }
}

await lancer([
  ['apple', apple],
  ['google', google],
]);
// lancer() sort déjà en erreur s'il y a eu un échec ; on rappelle ici ce que Mathieu doit faire.
if (manques.length) {
  dire(`\nÀ faire à la main (${manques.length}) :`);
  for (const m of manques) dire(`- ${m}`);
  if (!etat.erreurs) process.exit(2);
}
