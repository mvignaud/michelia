#!/usr/bin/env node
// Produits du comptoir dans les boutiques : crée ou met à jour les 4 pourboires (achats consommables)
// sur l'App Store, Google Play et RevenueCat, à partir de la liste PALIERS ci-dessous.
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

const { agir, lancer, etat } = mode();

// ---------- App Store Connect ----------
async function apple() {
  dire('Apple (App Store Connect)');
  const api = await appleApi();
  if (!api) return dire('  clés absentes, ignoré.');

  const existants = (await api(`/v1/apps/${APPLE_APP_ID}/inAppPurchasesV2?limit=200`)).data;
  for (const p of PALIERS) {
    const productId = produit(p, 'apple');
    let iap = existants.find((x) => x.attributes.productId === productId);
    dire(`- ${productId}`);
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
  const euros = (prix) => {
    const [u, c = '0'] = String(prix).split('.');
    return { currencyCode: 'EUR', units: u, nanos: Number(c.padEnd(2, '0')) * 10_000_000 };
  };
  // Pays de la zone euro où Michel a du sens ; les autres pays ne sont pas ouverts
  // (pas de newRegionsConfig : Google refuse un produit neuf « NO_LONGER_AVAILABLE » ailleurs).
  const PAYS = ['FR', 'BE', 'LU'];
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
              regionalPricingAndAvailabilityConfigs: PAYS.map((regionCode) => ({
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
  }
}

await lancer([
  ['apple', apple],
  ['google', google],
  ['revenuecat', revenuecat],
]);
