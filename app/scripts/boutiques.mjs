#!/usr/bin/env node
// Produits des boutiques : crée ou met à jour les 4 pourboires du comptoir (achats consommables) et les
// 2 abonnements MichelIA+ (auto-renouvelables) sur l'App Store, Google Play et RevenueCat, à partir des
// listes PALIERS et ABONNEMENTS ci-dessous.
// Lancé par la tâche GitHub « Boutiques » (.github/workflows/boutiques.yml), avec les clés rangées dans
// les secrets du dépôt. Sans --appliquer, il ne fait que lire et dire ce qu'il ferait.
//
//   node scripts/boutiques.mjs [--appliquer] [--seulement apple,google,revenuecat]
//
// Variables d'environnement (seules les boutiques dont les clés sont présentes sont traitées) :
//   ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_P8      clé d'API App Store Connect (rôle App Manager)
//   PLAY_SERVICE_ACCOUNT_JSON                   compte de service Google Play (JSON complet)
//   REVENUECAT_API_KEY                          clé secrète RevenueCat API v2 (sk_…)
// Aucune clé n'est jamais affichée.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { APPLE_APP_ID, PACKAGE, appleApi, dire, googleToken, http, mode } from './stores-lib.mjs';

const DESCRIPTION = 'Un pourboire pour Michel, sans contrepartie.';
const NOTE_VERIFICATION =
  'Pourboire facultatif et sans contrepartie : il ne débloque aucune fonction. ' +
  "Écran : lien « Le comptoir » en bas du chat de l'appli.";

// Mêmes paliers que comptoir_paliers (app_config). Le café iOS a dû être recréé : pourboire_cafe2
// (Apple ne réutilise jamais un identifiant supprimé). L'appli et le webhook acceptent les deux noms.
const PALIERS = [
  { id: 'cafe', nom: 'Le café serré', prix: '1.99', apple: 'pourboire_cafe2' },
  { id: 'croustade', nom: 'La croustade', prix: '2.99' },
  { id: 'garbure', nom: 'La garbure', prix: '4.99' },
  { id: 'fete', nom: 'Le repas de fête', prix: '9.99' },
];
const produit = (p, boutique) => p[boutique] ?? `pourboire_${p.id}`;

// MichelIA+ (docs/MICHELIA-PLUS.md) : mêmes prix que michelia_plus_prix (app_config). Chez Google, chaque
// abonnement a un seul forfait de base (mois / an) ; RevenueCat le nomme michelia_plus_mois:mois.
const ABONNEMENTS = [
  { id: 'michelia_plus_mois', forfait: 'mois', nom: 'MichelIA+ au mois', prix: '3.99', apple: 'ONE_MONTH', google: 'P1M' },
  { id: 'michelia_plus_an', forfait: 'an', nom: "MichelIA+ à l'année", prix: '39.00', apple: 'ONE_YEAR', google: 'P1Y' },
];
const DESCRIPTION_ABO = 'Plus de messages et de photos par jour avec Michel.';
const NOTE_ABO =
  'Abonnement facultatif : Michel reste gratuit, MichelIA+ relève les plafonds de messages et de photos. ' +
  "Écran : lien « MichelIA+ » en bas du chat de l'appli (compte Michel nécessaire).";
const ENTITLEMENT = 'michelia_plus';
// Pays ouverts, comme les pourboires Google.
const PAYS = { FR: 'FRA', BE: 'BEL', LU: 'LUX' };
const memePrix = (a, b) => Math.abs(Number(a) - Number(b)) < 0.001;
// Prix au format Google (unités + nanos).
const euros = (prix) => {
  const [u, c = '0'] = String(prix).split('.');
  return { currencyCode: 'EUR', units: u, nanos: Number(c.padEnd(2, '0')) * 10_000_000 };
};

const { agir, lancer, etat } = mode();

// Capture pour la vérification d'Apple : sans elle, un produit reste « MISSING_METADATA » et n'est
// proposé nulle part, pas même sur TestFlight. Les abonnements prendront la capture de leur écran.
const CAPTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'store', 'apple');
const CAPTURE_COMPTOIR = path.join(CAPTURES, 'revue-comptoir.png');
const CAPTURE_ABO = fs.existsSync(path.join(CAPTURES, 'revue-michelia-plus.png'))
  ? path.join(CAPTURES, 'revue-michelia-plus.png')
  : CAPTURE_COMPTOIR;

// Envoi d'une capture par le protocole d'Apple : réservation, morceaux envoyés là où Apple le dit,
// puis validation avec la somme MD5 du fichier.
async function captureRevue(api, { lire, type, relation, relationType, id, fichier }) {
  let actuelle = null;
  try {
    actuelle = (await api(lire)).data;
  } catch (e) {
    if (e.status !== 404) throw e;
  }
  // Une capture déjà là est gardée si c'est le même fichier ; sinon (par exemple la capture du comptoir
  // posée en attendant celle de MichelIA+), elle est remplacée.
  const memeFichier = actuelle?.attributes?.fileName === path.basename(fichier);
  if (actuelle?.attributes?.assetDeliveryState?.state === 'COMPLETE' && memeFichier) return dire('  capture de vérification déjà là');
  await agir(`capture de vérification (${path.basename(fichier)})`, async () => {
    if (actuelle) await api(`/v1/${type}/${actuelle.id}`, { method: 'DELETE' });
    const octets = fs.readFileSync(fichier);
    const reserve = (
      await api(`/v1/${type}`, {
        method: 'POST',
        body: {
          data: {
            type,
            attributes: { fileName: path.basename(fichier), fileSize: octets.length },
            relationships: { [relation]: { data: { type: relationType, id } } },
          },
        },
      })
    ).data;
    for (const op of reserve.attributes.uploadOperations) {
      const res = await fetch(op.url, {
        method: op.method,
        headers: Object.fromEntries((op.requestHeaders ?? []).map((h) => [h.name, h.value])),
        body: octets.subarray(op.offset, op.offset + op.length),
      });
      if (!res.ok) throw new Error(`envoi de la capture refusé (${res.status})`);
    }
    await api(`/v1/${type}/${reserve.id}`, {
      method: 'PATCH',
      body: {
        data: {
          type,
          id: reserve.id,
          attributes: { uploaded: true, sourceFileChecksum: crypto.createHash('md5').update(octets).digest('hex') },
        },
      },
    });
  });
}

// ---------- App Store Connect ----------
async function apple() {
  dire('Apple (App Store Connect)');
  const api = await appleApi();
  if (!api) return dire('  clés absentes, ignoré.');

  const existants = (await api(`/v1/apps/${APPLE_APP_ID}/inAppPurchasesV2?limit=200`)).data;
  for (const p of PALIERS) {
    const productId = produit(p, 'apple');
    let iap = existants.find((x) => x.attributes.productId === productId);
    // L'état dit si Apple le vend déjà (en test : « READY_TO_SUBMIT » au moins, pas « MISSING_METADATA »).
    dire(`- ${productId}${iap ? ` (${iap.attributes.state})` : ''}`);
    if (!iap) {
      await agir('créer l’achat consommable', async () => {
        iap = (
          await api('/v2/inAppPurchases', {
            method: 'POST',
            body: {
              data: {
                type: 'inAppPurchases',
                attributes: { name: p.nom, productId, inAppPurchaseType: 'CONSUMABLE', reviewNote: NOTE_VERIFICATION },
                relationships: { app: { data: { type: 'apps', id: APPLE_APP_ID } } },
              },
            },
          })
        ).data;
      });
      if (!iap) continue;
    } else {
      if (iap.attributes.inAppPurchaseType !== 'CONSUMABLE') {
        etat.erreurs++;
        dire(`  ✗ type ${iap.attributes.inAppPurchaseType} : il faut un consommable (à recréer sous un autre identifiant)`);
      }
      if (iap.attributes.reviewNote !== NOTE_VERIFICATION) {
        await agir('note pour la vérification', () =>
          api(`/v2/inAppPurchases/${iap.id}`, {
            method: 'PATCH',
            body: { data: { type: 'inAppPurchases', id: iap.id, attributes: { reviewNote: NOTE_VERIFICATION } } },
          }),
        );
      }
    }

    // Nom et description en français.
    const locs = (await api(`/v2/inAppPurchases/${iap.id}/inAppPurchaseLocalizations`)).data;
    const fr = locs.find((l) => l.attributes.locale === 'fr-FR');
    if (!fr) {
      await agir('localisation fr-FR', () =>
        api('/v1/inAppPurchaseLocalizations', {
          method: 'POST',
          body: {
            data: {
              type: 'inAppPurchaseLocalizations',
              attributes: { locale: 'fr-FR', name: p.nom, description: DESCRIPTION },
              relationships: { inAppPurchaseV2: { data: { type: 'inAppPurchases', id: iap.id } } },
            },
          },
        }),
      );
    } else if (fr.attributes.name !== p.nom || fr.attributes.description !== DESCRIPTION) {
      await agir('mise à jour de la localisation fr-FR', () =>
        api(`/v1/inAppPurchaseLocalizations/${fr.id}`, {
          method: 'PATCH',
          body: { data: { type: 'inAppPurchaseLocalizations', id: fr.id, attributes: { name: p.nom, description: DESCRIPTION } } },
        }),
      );
    }

    await captureRevue(api, {
      lire: `/v2/inAppPurchases/${iap.id}/appStoreReviewScreenshot`,
      type: 'inAppPurchaseAppStoreReviewScreenshots',
      relation: 'inAppPurchaseV2',
      relationType: 'inAppPurchases',
      id: iap.id,
      fichier: CAPTURE_COMPTOIR,
    });

    // Prix : posé seulement s'il n'y en a pas encore (base France, Apple calcule les autres pays).
    let schedule = null;
    try {
      schedule = (await api(`/v2/inAppPurchases/${iap.id}/iapPriceSchedule`)).data;
    } catch (e) {
      if (e.status !== 404) throw e;
    }
    if (schedule) {
      dire('  prix déjà posé');
      continue;
    }
    const points = (await api(`/v2/inAppPurchases/${iap.id}/pricePoints?filter[territory]=FRA&limit=8000`)).data;
    const point = points.find((x) => x.attributes.customerPrice === p.prix);
    if (!point) {
      etat.erreurs++;
      dire(`  ✗ pas de palier de prix Apple à ${p.prix} € en France`);
      continue;
    }
    await agir(`prix ${p.prix} € (base France)`, () =>
      api('/v1/inAppPurchasePriceSchedules', {
        method: 'POST',
        body: {
          data: {
            type: 'inAppPurchasePriceSchedules',
            relationships: {
              inAppPurchase: { data: { type: 'inAppPurchases', id: iap.id } },
              baseTerritory: { data: { type: 'territories', id: 'FRA' } },
              manualPrices: { data: [{ type: 'inAppPurchasePrices', id: '${prix}' }] },
            },
          },
          included: [
            {
              type: 'inAppPurchasePrices',
              id: '${prix}',
              attributes: { startDate: null },
              relationships: { inAppPurchasePricePoint: { data: { type: 'inAppPurchasePricePoints', id: point.id } } },
            },
          ],
        },
      }),
    );
  }

  await appleAbonnements(api);
}

// Abonnements auto-renouvelables : un groupe « MichelIA+ », deux abonnements au même niveau (on passe
// de l'un à l'autre), prix et disponibilité en France, Belgique et Luxembourg.
async function appleAbonnements(api) {
  const groupes = (await api(`/v1/apps/${APPLE_APP_ID}/subscriptionGroups?limit=50`)).data;
  let groupe = groupes.find((g) => g.attributes.referenceName === 'MichelIA+');
  dire(`- groupe d'abonnements MichelIA+${groupe ? '' : ' (nouveau)'}`);
  if (!groupe) {
    await agir('créer le groupe', async () => {
      groupe = (
        await api('/v1/subscriptionGroups', {
          method: 'POST',
          body: {
            data: {
              type: 'subscriptionGroups',
              attributes: { referenceName: 'MichelIA+' },
              relationships: { app: { data: { type: 'apps', id: APPLE_APP_ID } } },
            },
          },
        })
      ).data;
    });
    if (!groupe) return;
  }
  const locsGroupe = groupe.id ? (await api(`/v1/subscriptionGroups/${groupe.id}/subscriptionGroupLocalizations`)).data : [];
  if (!locsGroupe.some((l) => l.attributes.locale === 'fr-FR')) {
    await agir('nom du groupe en fr-FR', () =>
      api('/v1/subscriptionGroupLocalizations', {
        method: 'POST',
        body: {
          data: {
            type: 'subscriptionGroupLocalizations',
            attributes: { locale: 'fr-FR', name: 'MichelIA+' },
            relationships: { subscriptionGroup: { data: { type: 'subscriptionGroups', id: groupe.id } } },
          },
        },
      }),
    );
  }

  const existants = (await api(`/v1/subscriptionGroups/${groupe.id}/subscriptions?limit=50`)).data;
  for (const a of ABONNEMENTS) {
    let sub = existants.find((x) => x.attributes.productId === a.id);
    dire(`- ${a.id}${sub ? ` (${sub.attributes.state})` : ' (nouveau)'}`);
    if (!sub) {
      await agir('créer l’abonnement', async () => {
        sub = (
          await api('/v1/subscriptions', {
            method: 'POST',
            body: {
              data: {
                type: 'subscriptions',
                attributes: {
                  name: a.nom,
                  productId: a.id,
                  subscriptionPeriod: a.apple,
                  familySharable: false,
                  groupLevel: 1,
                  reviewNote: NOTE_ABO,
                },
                relationships: { group: { data: { type: 'subscriptionGroups', id: groupe.id } } },
              },
            },
          })
        ).data;
      });
      if (!sub) continue;
    } else if (sub.attributes.reviewNote !== NOTE_ABO) {
      await agir('note pour la vérification', () =>
        api(`/v1/subscriptions/${sub.id}`, {
          method: 'PATCH',
          body: { data: { type: 'subscriptions', id: sub.id, attributes: { reviewNote: NOTE_ABO } } },
        }),
      );
    }

    const locs = (await api(`/v1/subscriptions/${sub.id}/subscriptionLocalizations`)).data;
    const fr = locs.find((l) => l.attributes.locale === 'fr-FR');
    if (!fr)
      await agir('localisation fr-FR', () =>
        api('/v1/subscriptionLocalizations', {
          method: 'POST',
          body: {
            data: {
              type: 'subscriptionLocalizations',
              attributes: { locale: 'fr-FR', name: a.nom, description: DESCRIPTION_ABO },
              relationships: { subscription: { data: { type: 'subscriptions', id: sub.id } } },
            },
          },
        }),
      );
    else if (fr.attributes.name !== a.nom || fr.attributes.description !== DESCRIPTION_ABO)
      await agir('mise à jour de la localisation fr-FR', () =>
        api(`/v1/subscriptionLocalizations/${fr.id}`, {
          method: 'PATCH',
          body: { data: { type: 'subscriptionLocalizations', id: fr.id, attributes: { name: a.nom, description: DESCRIPTION_ABO } } },
        }),
      );

    await captureRevue(api, {
      lire: `/v1/subscriptions/${sub.id}/appStoreReviewScreenshot`,
      type: 'subscriptionAppStoreReviewScreenshots',
      relation: 'subscription',
      relationType: 'subscriptions',
      id: sub.id,
      fichier: CAPTURE_ABO,
    });

    // Disponibilité : posée une fois.
    let dispo = null;
    try {
      dispo = (await api(`/v1/subscriptions/${sub.id}/subscriptionAvailability`)).data;
    } catch (e) {
      if (e.status !== 404) throw e;
    }
    if (!dispo)
      await agir(`disponible en ${Object.keys(PAYS).join(', ')}`, () =>
        api('/v1/subscriptionAvailabilities', {
          method: 'POST',
          body: {
            data: {
              type: 'subscriptionAvailabilities',
              attributes: { availableInNewTerritories: false },
              relationships: {
                subscription: { data: { type: 'subscriptions', id: sub.id } },
                availableTerritories: { data: Object.values(PAYS).map((id) => ({ type: 'territories', id })) },
              },
            },
          },
        }),
      );

    // Prix : le palier français, et ses équivalents belge et luxembourgeois ; seulement là où il n'y en a pas.
    const prix = await api(`/v1/subscriptions/${sub.id}/prices?include=territory&limit=200`);
    const deja = new Set((prix.data ?? []).map((x) => x.relationships?.territory?.data?.id).filter(Boolean));
    const manquants = Object.values(PAYS).filter((t) => !deja.has(t));
    if (!manquants.length) {
      dire('  prix déjà posés');
      continue;
    }
    const points = (await api(`/v1/subscriptions/${sub.id}/pricePoints?filter[territory]=FRA&limit=8000`)).data;
    const point = points.find((x) => memePrix(x.attributes.customerPrice, a.prix));
    if (!point) {
      etat.erreurs++;
      dire(`  ✗ pas de palier de prix Apple à ${a.prix} € en France`);
      continue;
    }
    const equivalents = (
      await api(`/v1/subscriptionPricePoints/${point.id}/equalizations?filter[territory]=BEL,LUX&include=territory&limit=50`)
    ).data;
    const parPays = { FRA: point.id, ...Object.fromEntries(equivalents.map((x) => [x.relationships?.territory?.data?.id, x.id])) };
    for (const t of manquants) {
      if (!parPays[t]) {
        etat.erreurs++;
        dire(`  ✗ pas d'équivalent de prix pour ${t}`);
        continue;
      }
      await agir(`prix ${a.prix} € (${t})`, () =>
        api('/v1/subscriptionPrices', {
          method: 'POST',
          body: {
            data: {
              type: 'subscriptionPrices',
              attributes: { startDate: null, preserveCurrentPrice: false },
              relationships: {
                subscription: { data: { type: 'subscriptions', id: sub.id } },
                subscriptionPricePoint: { data: { type: 'subscriptionPricePoints', id: parPays[t] } },
                territory: { data: { type: 'territories', id: t } },
              },
            },
          },
        }),
      );
    }
  }
}

// ---------- Google Play ----------
async function google() {
  dire('Google Play');
  const token = await googleToken();
  if (!token) return dire('  clé absente, ignoré.');
  // API « produits ponctuels » (l'ancienne inappproducts est fermée aux nouvelles applis).
  const base = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE}/onetimeproducts`;
  const api = (path, opts) => http(`${base}${path}`, { token, ...opts });
  // Sert aussi de vérification des droits, même en essai.
  // Attention à la casse : liste et mise en vente sous « oneTimeProducts », création sous « onetimeproducts ».
  const liste = base.replace('onetimeproducts', 'oneTimeProducts');
  const existants = (await http(`${liste}?pageSize=100`, { token }))?.oneTimeProducts ?? [];
  // Pays de la zone euro où Michel a du sens ; les autres pays ne sont pas ouverts
  // (pas de newRegionsConfig : Google refuse un produit neuf « NO_LONGER_AVAILABLE » ailleurs).
  const OPTION = 'achat';

  for (const p of PALIERS) {
    const sku = produit(p, 'google');
    const deja = existants.find((x) => x.productId === sku);
    dire(`- ${sku}${deja ? '' : ' (nouveau)'}`);
    await agir(`${deja ? 'mise à jour' : 'création'} à ${p.prix} €`, () =>
      api(`/${sku}?allowMissing=true&regionsVersion.version=2022/02&updateMask=listings,purchaseOptions`, {
        method: 'PATCH',
        body: {
          packageName: PACKAGE,
          productId: sku,
          listings: [{ languageCode: 'fr-FR', title: p.nom, description: DESCRIPTION }],
          purchaseOptions: [
            {
              purchaseOptionId: OPTION,
              buyOption: { legacyCompatible: true, multiQuantityEnabled: false },
              regionalPricingAndAvailabilityConfigs: Object.keys(PAYS).map((regionCode) => ({
                regionCode,
                price: euros(p.prix),
                availability: 'AVAILABLE',
              })),
            },
          ],
        },
      }),
    );
    const actif = deja?.purchaseOptions?.find((o) => o.purchaseOptionId === OPTION)?.state === 'ACTIVE';
    if (actif) dire('  déjà en vente');
    else
      await agir('mise en vente', () =>
        http(`${liste}/${sku}/purchaseOptions:batchUpdateStates`, {
          method: 'POST',
          token,
          body: { requests: [{ activatePurchaseOptionRequest: { packageName: PACKAGE, productId: sku, purchaseOptionId: OPTION } }] },
        }),
      );
  }

  await googleAbonnements(token);
}

// Abonnements : un produit par formule, avec un seul forfait de base renouvelé automatiquement.
// Une fois créés, leurs prix ne sont plus touchés ici (un changement de prix se fait dans la console,
// Google prévient les abonnés).
async function googleAbonnements(token) {
  const base = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE}/subscriptions`;
  const existants = (await http(`${base}?pageSize=100`, { token }))?.subscriptions ?? [];
  for (const a of ABONNEMENTS) {
    const deja = existants.find((x) => x.productId === a.id);
    const listings = [{ languageCode: 'fr-FR', title: a.nom, description: DESCRIPTION_ABO, benefits: ['Plus de messages par jour', 'Plus de photos par jour'] }];
    dire(`- ${a.id}${deja ? '' : ' (nouveau)'}`);
    if (!deja)
      await agir(`création à ${a.prix} € (${a.google})`, () =>
        http(`${base}?productId=${a.id}&regionsVersion.version=2022/02`, {
          method: 'POST',
          token,
          body: {
            packageName: PACKAGE,
            productId: a.id,
            listings,
            basePlans: [
              {
                basePlanId: a.forfait,
                autoRenewingBasePlanType: { billingPeriodDuration: a.google, legacyCompatible: true },
                regionalConfigs: Object.keys(PAYS).map((regionCode) => ({
                  regionCode,
                  newSubscriberAvailability: true,
                  price: euros(a.prix),
                })),
              },
            ],
          },
        }),
      );
    else if (JSON.stringify(deja.listings?.find((l) => l.languageCode === 'fr-FR')) !== JSON.stringify(listings[0]))
      await agir('textes', () =>
        http(`${base}/${a.id}?updateMask=listings&regionsVersion.version=2022/02`, {
          method: 'PATCH',
          token,
          body: { packageName: PACKAGE, productId: a.id, listings },
        }),
      );
    const actif = deja?.basePlans?.find((b) => b.basePlanId === a.forfait)?.state === 'ACTIVE';
    if (actif) dire('  forfait déjà en vente');
    else
      await agir(`mise en vente du forfait ${a.forfait}`, () =>
        http(`${base}/${a.id}/basePlans/${a.forfait}:activate`, {
          method: 'POST',
          token,
          body: { packageName: PACKAGE, productId: a.id, basePlanId: a.forfait },
        }),
      );
  }
}

// ---------- RevenueCat ----------
async function revenuecat() {
  const token = process.env.REVENUECAT_API_KEY;
  dire('RevenueCat');
  if (!token) return dire('  clé absente, ignoré.');
  const api = (path, opts) => http(`https://api.revenuecat.com/v2${path}`, { token, ...opts });
  const projects = (await api('/projects')).items;
  const project = process.env.REVENUECAT_PROJECT_ID ?? projects?.[0]?.id;
  if (!project) throw new Error('aucun projet RevenueCat');
  const apps = (await api(`/projects/${project}/apps?limit=20`)).items;
  const abonnementsRc = [];
  for (const [type, boutique, store] of [
    ['app_store', 'apple', { bundle_id: PACKAGE }],
    ['play_store', 'google', { package_name: PACKAGE }],
  ]) {
    let app = apps.find((a) => a.type === type);
    if (!app) {
      dire(`- appli ${type} (nouvelle)`);
      await agir('ajouter l’appli au projet', async () => {
        app = await api(`/projects/${project}/apps`, {
          method: 'POST',
          body: { name: `Michel IA (${boutique === 'apple' ? 'iOS' : 'Android'})`, type, [type]: store },
        });
      });
      if (!app) continue;
    }
    const existants = (await api(`/projects/${project}/products?app_id=${app.id}&limit=100`)).items;
    for (const p of PALIERS) {
      const id = produit(p, boutique);
      if (existants.some((x) => x.store_identifier === id)) {
        dire(`- ${type} ${id} : déjà là`);
        continue;
      }
      dire(`- ${type} ${id}`);
      await agir('créer le produit consommable', () =>
        api(`/projects/${project}/products`, {
          method: 'POST',
          body: { store_identifier: id, app_id: app.id, type: 'consumable', display_name: p.nom },
        }),
      );
    }
    for (const a of ABONNEMENTS) {
      const id = boutique === 'google' ? `${a.id}:${a.forfait}` : a.id;
      let prod = existants.find((x) => x.store_identifier === id);
      if (prod) dire(`- ${type} ${id} : déjà là`);
      else {
        dire(`- ${type} ${id}`);
        await agir('créer le produit abonnement', async () => {
          prod = await api(`/projects/${project}/products`, {
            method: 'POST',
            body: { store_identifier: id, app_id: app.id, type: 'subscription', display_name: a.nom },
          });
        });
      }
      if (prod) abonnementsRc.push(prod.id);
    }
  }

  // L'« entitlement » michelia_plus regroupe les 4 produits d'abonnement (2 formules × 2 boutiques).
  const droits = (await api(`/projects/${project}/entitlements?limit=50`)).items ?? [];
  let droit = droits.find((d) => d.lookup_key === ENTITLEMENT);
  dire(`- entitlement ${ENTITLEMENT}${droit ? '' : ' (nouveau)'}`);
  if (!droit)
    await agir('créer l’entitlement', async () => {
      droit = await api(`/projects/${project}/entitlements`, {
        method: 'POST',
        body: { lookup_key: ENTITLEMENT, display_name: 'MichelIA+' },
      });
    });
  if (!droit) return;
  const rattaches = new Set(((await api(`/projects/${project}/entitlements/${droit.id}/products?limit=50`)).items ?? []).map((x) => x.id));
  const aRattacher = abonnementsRc.filter((id) => !rattaches.has(id));
  if (!aRattacher.length) dire('  produits déjà rattachés');
  else
    await agir(`rattacher ${aRattacher.length} produit(s)`, () =>
      api(`/projects/${project}/entitlements/${droit.id}/actions/attach_products`, {
        method: 'POST',
        body: { product_ids: aRattacher },
      }),
    );
}

await lancer([
  ['apple', apple],
  ['google', google],
  ['revenuecat', revenuecat],
]);
