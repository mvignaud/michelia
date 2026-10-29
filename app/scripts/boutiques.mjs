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
import crypto from 'node:crypto';

const APPLE_APP_ID = '6828365649';
const PACKAGE = 'beer.michel.app';
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

const args = process.argv.slice(2);
const APPLIQUER = args.includes('--appliquer');
const seulement = args.includes('--seulement') ? args[args.indexOf('--seulement') + 1].split(',') : null;
const veut = (b) => !seulement || seulement.includes(b);

let erreurs = 0;
const dire = (...m) => console.log(...m);
const agir = async (quoi, fn) => {
  if (!APPLIQUER) return dire(`  (essai) ${quoi}`);
  try {
    await fn();
    dire(`  ✓ ${quoi}`);
  } catch (e) {
    erreurs++;
    dire(`  ✗ ${quoi} : ${e.message}`);
  }
};

async function http(url, { method = 'GET', token, body, form } = {}) {
  const res = await fetch(url, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    body: body ? JSON.stringify(body) : form ? new URLSearchParams(form) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // Page HTML (404, adresse inconnue…) : on garde le statut, pas la page.
    if (res.ok) throw new Error(`réponse illisible de ${new URL(url).pathname}`);
  }
  if (!res.ok) {
    const detail = data?.errors?.[0]?.detail ?? data?.error?.message ?? data?.message ?? (data ? text.slice(0, 300) : `page HTML sur ${new URL(url).pathname}`);
    const err = new Error(`${res.status} ${detail}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

const b64url = (b) => Buffer.from(b).toString('base64url');
function jwt(header, payload, key, alg) {
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signature =
    alg === 'ES256'
      ? crypto.sign('sha256', Buffer.from(input), { key, dsaEncoding: 'ieee-p1363' })
      : crypto.sign('RSA-SHA256', Buffer.from(input), key);
  return `${input}.${b64url(signature)}`;
}

// ---------- App Store Connect ----------
async function apple() {
  let { ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_P8 } = process.env;
  if (!ASC_KEY_ID || !ASC_ISSUER_ID || !ASC_KEY_P8) return dire('Apple : clés absentes, ignoré.');
  // ID de clé (10 caractères) et ID d'émetteur (UUID) se confondent facilement : on les remet dans l'ordre.
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (UUID.test(ASC_KEY_ID.trim()) && !UUID.test(ASC_ISSUER_ID.trim())) {
    [ASC_KEY_ID, ASC_ISSUER_ID] = [ASC_ISSUER_ID, ASC_KEY_ID];
    dire('  (ASC_KEY_ID et ASC_ISSUER_ID étaient inversés : remis dans l\'ordre)');
  }
  dire('Apple (App Store Connect)');
  // Apple refuse un jeton qui vit plus de 20 min : on garde de la marge (horloges, espaces collés en trop).
  const now = Math.floor(Date.now() / 1000);
  // Clé d'équipe : iss = ID de l'émetteur. Clé individuelle : sub = 'user', sans iss.
  const signer = (individuelle) =>
    jwt(
      { alg: 'ES256', kid: ASC_KEY_ID.trim(), typ: 'JWT' },
      {
        ...(individuelle ? { sub: 'user' } : { iss: ASC_ISSUER_ID.trim() }),
        iat: now - 60,
        exp: now + 600,
        aud: 'appstoreconnect-v1',
      },
      ASC_KEY_P8,
      'ES256',
    );
  let token = signer(false);
  const api = (path, opts) => http(`https://api.appstoreconnect.apple.com${path}`, { token, ...opts });
  // Sur un refus, on décrit la forme des secrets (jamais leur valeur) pour trouver lequel cloche.
  const forme = () => {
    const id = ASC_KEY_ID.trim();
    const iss = ASC_ISSUER_ID.trim();
    dire(`  ASC_KEY_ID : ${/^[A-Z0-9]{10}$/.test(id) ? 'forme OK (10 caractères)' : `forme inattendue (${id.length} caractères, 10 attendus)`}`);
    dire(`  ASC_ISSUER_ID : ${UUID.test(iss) ? 'forme OK (identifiant 8-4-4-4-12)' : `forme inattendue (${iss.length} caractères) : attendu l'ID de l'émetteur, du type xxxxxxxx-xxxx-…`}`);
    dire(`  ASC_KEY_P8 : ${ASC_KEY_P8.includes('BEGIN PRIVATE KEY') ? 'en-tête OK' : 'en-tête BEGIN PRIVATE KEY absent'}`);
  };
  try {
    await api(`/v1/apps/${APPLE_APP_ID}?fields[apps]=bundleId`);
  } catch (e) {
    if (e.status !== 401) throw e;
    token = signer(true);
    try {
      await api(`/v1/apps/${APPLE_APP_ID}?fields[apps]=bundleId`);
      dire('  (clé individuelle : acceptée)');
    } catch (e2) {
      forme();
      dire('  Refusée en clé d\'équipe comme en clé individuelle : le fichier .p8 ne correspond sans doute pas à ASC_KEY_ID, ou la clé est révoquée.');
      throw e2;
    }
  }

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
        erreurs++;
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
      erreurs++;
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
  const raw = process.env.PLAY_SERVICE_ACCOUNT_JSON;
  if (!raw) return dire('Google : clé absente, ignoré.');
  dire('Google Play');
  const sa = JSON.parse(raw);
  const now = Math.floor(Date.now() / 1000);
  const assertion = jwt(
    { alg: 'RS256', typ: 'JWT' },
    {
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/androidpublisher',
      aud: sa.token_uri ?? 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    },
    sa.private_key,
    'RS256',
  );
  const { access_token: token } = await http(sa.token_uri ?? 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    form: { grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion },
  });
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
  const dollars = (prix) => ({ ...euros(prix), currencyCode: 'USD' });
  // Pays de la zone euro où Michel a du sens ; les autres pays ne sont pas ouverts.
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
              newRegionsConfig: { eurPrice: euros(p.prix), usdPrice: dollars(p.prix), availability: 'NO_LONGER_AVAILABLE' },
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
  if (!token) return dire('RevenueCat : clé absente, ignoré.');
  dire('RevenueCat');
  const api = (path, opts) => http(`https://api.revenuecat.com/v2${path}`, { token, ...opts });
  const projects = (await api('/projects')).items;
  const project = process.env.REVENUECAT_PROJECT_ID ?? projects?.[0]?.id;
  if (!project) throw new Error('aucun projet RevenueCat');
  const apps = (await api(`/projects/${project}/apps?limit=20`)).items;
  for (const [type, boutique] of [
    ['app_store', 'apple'],
    ['play_store', 'google'],
  ]) {
    const app = apps.find((a) => a.type === type);
    if (!app) {
      dire(`- appli ${type} absente du projet : à ajouter dans RevenueCat`);
      continue;
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

dire(APPLIQUER ? 'Mode : on applique.\n' : 'Mode : essai (rien ne change). Ajouter --appliquer pour de vrai.\n');
for (const [nom, fn] of [
  ['apple', apple],
  ['google', google],
  ['revenuecat', revenuecat],
]) {
  if (!veut(nom)) continue;
  try {
    await fn();
  } catch (e) {
    erreurs++;
    dire(`✗ ${nom} : ${e.message}`);
  }
  dire('');
}
if (erreurs) {
  dire(`${erreurs} problème(s), voir ci-dessus.`);
  process.exit(1);
}
dire('Tout est en ordre.');
