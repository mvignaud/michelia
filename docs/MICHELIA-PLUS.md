# MichelIA+

L'abonnement facultatif de Michel : 3,99 € par mois ou 39 € par an (réglage `michelia_plus_prix`,
TTC en centimes). Michel gratuit reste gratuit. Fermé tant que `michelia_plus_actif` ne vaut pas `'true'`.

## Un seul droit, trois façons de payer

| Source | Paiement | Qui relance chaque échéance |
|---|---|---|
| `web` | Stancer, carte (3D Secure au premier paiement, puis carte enregistrée) ou prélèvement SEPA (mandat signé chez Stancer par code SMS) | Michel (Stancer n'a pas d'API d'abonnements) |
| `apple` | Abonnement auto-renouvelable App Store | Apple, suivi par RevenueCat |
| `google` | Abonnement auto-renouvelable Google Play | Google, suivi par RevenueCat |

Table `abonnements` (migration `20261030090000_michelia_plus.sql`) : une ligne par abonnement, un seul
vivant par compte (`actif`, `impaye` ou `resilie`). `michelia_plus(user)` dit si le compte a le droit
en ce moment (résilié : jusqu'à `fin_periode`). `mon_abonnement()` le montre à la personne connectée,
sans jeton ni e-mail. Chaque paiement est une ligne de `abonnement_echeances` (reçu, facture E-KO,
remboursements). Les mandats SEPA vont dans `mandats_sepa` et sont copiés dans E-KO.

Jamais de numéro de carte ni d'IBAN en base : seulement les jetons Stancer (`card_…`, `sepa_…`) et
les 4 derniers chiffres.

## Applis (RevenueCat)

Produits à créer dans App Store Connect et la Play Console, dans un même groupe d'abonnements :
`michelia_plus_mois` et `michelia_plus_an` (un chiffre au bout est toléré si une boutique impose de
recréer un produit). Dans RevenueCat : un « entitlement » `michelia_plus` qui contient les deux.

L'appli ouvre RevenueCat avec l'identifiant du compte Michel (`appUserID`) : c'est ce qui rattache
l'abonnement au bon compte. `revenuecat-webhook` traite les événements de ces produits :
`INITIAL_PURCHASE`, `RENEWAL`, `PRODUCT_CHANGE`, `UNCANCELLATION` → `actif` ; `CANCELLATION` →
`resilie` ; `BILLING_ISSUE` → `impaye` ; `EXPIRATION` → `expire`. Une échéance par paiement. Les
événements de bac à sable ne passent que si `comptoir_sandbox` vaut `'true'` (lignes marquées `essai`).

Une personne déjà abonnée sur le site qui s'abonne aussi dans l'appli : la boutique encaisse, mais
la ligne est refusée (un seul abonnement vivant) et l'erreur est dans les journaux. À rembourser
par la boutique.

## Site (Stancer), par carte

Page `/la-cotisation` (`/abonnement` et `/michelia-plus` y mènent), `app/src/Cotisation.web.tsx` :
réservée aux comptes Michel (pas aux visiteurs anonymes), même formulaire de carte que le comptoir,
case à cocher des conditions avec renonciation au délai de rétractation, résiliation en deux clics.
Fermé, `/la-cotisation?essai=1` montre quand même le formulaire, et la fonction ne l'accepte qu'avec une
clé de test Stancer ou pour un compte de la table `admins` (vrai essai avant l'ouverture).

Fonction `michelia-plus` :
- `{souscrire: "mois" | "an", carte, captcha}` : crée l'abonnement `en_attente`, puis le premier paiement
  par `POST /v1/checkout/` avec `card.tokenize: true` et 3D Secure (retour par la fonction, `?retour=3ds`).
  Mêmes garde-fous que le comptoir : Turnstile et `comptoir_reserver` (2 cartes au plus par essai).
- `{confirmer: paym_…}` : relit le paiement (`_shared/abonnement.ts`, `confirmerEcheance`), capture,
  passe l'abonnement `actif` et range le jeton `card_…` et les 4 derniers chiffres.
- `{resilier: true}` : `resilie`, le droit court jusqu'à `fin_periode`.

Un seul essai de souscription à la fois par compte (`abonnements_vivant_idx` couvre aussi `en_attente`
sur le site) : un double clic ou un second onglet reçoit 409. Un premier paiement refusé passe la ligne
`expire` (la personne peut réessayer tout de suite) ; un essai abandonné depuis 5 minutes, sans
paiement en cours, est effacé au suivant.

Fonction `michelia-plus-echeances` (pg_cron, à la 7e minute de chaque heure) : prélève les échéances
dues avec `card: "card_…"` (sans 3D Secure, paiement à l'initiative du marchand), relit celles restées
en cours, passe `expire` les résiliés arrivés au bout et nettoie les souscriptions jamais payées.
Elle n'accepte que le cron : en-tête `x-michel-cron`, secret `michelia_plus_cron` créé dans le coffre
(vault) par la migration et vérifié par `michelia_plus_cron_ok()`. Jamais deux prélèvements pour une
période : `unique_id` Stancer = `abo_<id>.<AAAAMMJJ début de période>.<échecs>` (Stancer refuse un
doublon par 409, rattaché à la période sans compter d'échec, avec une ALERTE dans les journaux) et
index unique `abonnement_echeances_periode_idx` (une échéance non refusée par période).
Échéance refusée : `impaye`, nouvel essai 3 jours plus tard, arrêt au 3e échec. Chaque échéance est
une ligne de `abonnement_echeances` avec son numéro de reçu (même série que les pourboires).

Quotas des abonnés dans `chat` : `daily_limit_plus` (400), `hourly_limit_plus` (60),
`daily_photo_limit_plus` (50), modifiables dans `app_config`.

## Site (Stancer), prélèvement SEPA

À venir : premier paiement sur la page Stancer (`methods_allowed: ["sepa"]`, mandat signé par code
SMS), puis prélèvements avec le mandat `sepa_…`, copie du mandat dans E-KO. Prérequis : l'identifiant
créancier SEPA (ICS) de GOLDEN PRINT, `FR98ZZZ8A3E64`, déclaré auprès de Stancer.

## Ouvrir

1. Coller `20261030100000_michelia_plus_carte.sql` (quotas, droit lu par `chat`, index anti-doublons, secret et cron des échéances).
2. Déployer `chat`, `michelia-plus` et `michelia-plus-echeances` depuis main.
3. Vrai essai par un administrateur sur `/la-cotisation?essai=1` (puis remboursement), puis `update app_config set value = 'true' where key = 'michelia_plus_actif';`
