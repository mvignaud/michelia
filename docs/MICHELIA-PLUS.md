# MichelIA+

L'abonnement facultatif de Michel : 3,99 € par mois ou 39 € par an (réglage `michelia_plus_prix`,
TTC en centimes). Michel gratuit reste gratuit. Fermé tant que `michelia_plus_actif` ne vaut pas `'true'`.

## Un seul droit, trois façons de payer

| Source | Paiement | Qui relance chaque échéance |
|---|---|---|
| `web` | Stancer, carte (3D Secure au premier paiement, puis carte enregistrée) ou prélèvement SEPA (mandat signé chez Michel par code SMS) | Michel (Stancer n'a pas d'API d'abonnements) |
| `apple` | Abonnement auto-renouvelable App Store | Apple, suivi par RevenueCat |
| `google` | Abonnement auto-renouvelable Google Play | Google, suivi par RevenueCat |

Table `abonnements` (migration `20261030090000_michelia_plus.sql`) : une ligne par abonnement, un seul
vivant par compte (`actif`, `impaye` ou `resilie`). `michelia_plus(user)` dit si le compte a le droit
en ce moment (résilié : jusqu'à `fin_periode`). `mon_abonnement()` le montre à la personne connectée,
sans jeton ni e-mail. Chaque paiement est une ligne de `abonnement_echeances` (reçu, facture E-KO,
remboursements). Les mandats SEPA vont dans `mandats_sepa` et sont copiés dans E-KO.

Jamais de numéro de carte ni d'IBAN en base : seulement les jetons Stancer (`card_…`, `sepa_…`) et
les 4 derniers chiffres. Seule exception : le PDF du mandat SEPA signé (mention obligatoire de
l'IBAN), rangé dans le stockage privé `mandats` (lu par `service_role` seulement).

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
- `{reprendre: true}` : annule la résiliation tant que `fin_periode` n'est pas passée (carte avec
  `stancer_carte`, ou SEPA avec `stancer_sepa`), rien n'est prélevé tout de suite. Après la fin, il faut souscrire à nouveau.

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

Prérequis : l'identifiant créancier SEPA (ICS) de GOLDEN PRINT, `FR98ZZZ8A3E64`, déclaré auprès de
Stancer (fait). Migrations `20261030110000_michelia_plus_sepa.sql` (colonne `stancer_intent`) et
`20261030120000_mandat_chez_michel.sql` (table `mandats_sepa_codes`, colonne `mandats_sepa.preuve`,
stockage privé `mandats`). Secrets des Edge Functions : `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`,
`TWILIO_FROM` (service de messagerie `MG…`, expéditeur « Michel IA », ou numéro).

Le mandat se signe chez Michel (`_shared/mandat.ts`), plus sur la page Stancer :

- `{souscrire, moyen: "sepa", iban, titulaire, telephone, captcha}` : IBAN vérifié (clé modulo 97,
  zone SEPA), abonnement `en_attente` (`moyen = 'sepa'`), Turnstile et `comptoir_reserver` (genre
  `paiement`, un SMS = un essai). Michel envoie un code à 6 chiffres par SMS (Twilio) et range une
  ligne `mandats_sepa_codes` : empreintes salées du code et de l'IBAN, titulaire, téléphone masqué,
  10 minutes, 5 essais ; empreintes vidées à la signature, ligne effacée par le cron au bout d'un jour. Une signature en cours (code accepté depuis moins de 2 minutes) bloque un nouveau code (409), et le mandat n'est posé que si l'abonnement est encore `en_attente` sans `stancer_sepa` (sinon 410, rien n'est prélevé). Réponse `{etat: "code", telephone}` ; 400 avec `champ` si une saisie est fausse.
- `{signer: {code, iban, titulaire}}` : la page renvoie l'IBAN (jamais gardé entre les deux étapes
  côté serveur, seulement son empreinte). Code, IBAN et titulaire doivent correspondre (400 avec
  `essais_restants`, 410 si expiré). Michel fait le PDF du mandat (RUM `MICHEL-<id>-<hasard>`,
  créancier, débiteur, IBAN complet, signature : date, téléphone masqué, IP), crée le compte chez
  Stancer (`POST /v1/sepa/` avec `iban`, `name`, `mandate` = RUM, `date_mandate`), range le PDF
  dans `mandats/<user>/<RUM>.pdf` et `mandats_sepa` (avec `preuve` : méthode, téléphone masqué, IP,
  navigateur, SHA-256 du PDF), envoie le mandat par e-mail, puis lance le premier prélèvement
  (`premierPrelevementSepa` : `POST /v1/checkout/` avec `sepa`, `unique_id` `abo_<id>.<jour de la
  signature>.0` ; l'heure de signature est posée dans `abonnements.updated_at` avec `stancer_sepa`). Sans réponse nette (5xx, coupure), le cron le relance au bout de 10 minutes avec le
  même identifiant (`reprendrePremiersSepa`) : un 409 rattache le prélèvement déjà parti.
- Ancien parcours (page Stancer, `POST /v2/payment_intents/` avec `methods_allowed: ["sepa"]`,
  retour `/la-cotisation?retour=sepa`) : plus proposé, mais les retours en cours sont encore relus.
- Retour (ancien parcours) : la page garde le `pi_…` dans l'onglet (sessionStorage) et appelle `{confirmer: pi_…}`.
  `confirmerSepa` relit l'intent (capture s'il est `authorized`), puis le prélèvement `paym_…`
  (`/v1/checkout/`) ; parti (`processing`/`captured`, ou paiement `to_capture`…) : l'échéance passe
  `paye` avec `paiement_id = paym_…`, l'abonnement `actif` avec `stancer_sepa` et les 4 derniers
  caractères de l'IBAN, et le mandat (`/v1/sepa/sepa_…` : référence RUM, titulaire, date de
  signature) est rangé dans `mandats_sepa`. MichelIA+ est donné dès le départ du prélèvement.
- Jamais signé : une nouvelle souscription du même compte après 15 minutes, ou le cron au bout d'un
  jour, relit l'intent et le compte refusé s'il est encore `require_…` (`abandonnerSepa`). Signé quand
  même ensuite (deux onglets) : ALERTE « à rembourser » dans les journaux.
- Échéances suivantes (cron) : `POST /v1/checkout/` avec `sepa: "sepa_…"`, même `unique_id`
  déterministe que la carte.
- Rejet après coup : pendant 15 jours (`RELECTURE_SEPA_JOURS`), le cron relit chaque prélèvement payé.
  `failed`, `refused` ou `disputed` : l'échéance passe `refuse`, `fin_periode` revient au début de
  la période, puis `impaye` avec nouvel essai dans 3 jours si le motif est `AM04` (provision
  insuffisante) ou `MS03`, sinon `expire`.
- Avis de prélèvement : le montant et la date anniversaire, affichés à la souscription (case à cocher)
  et sur la page de la cotisation, valent pré-notification (conditions, section MichelIA+).
- À faire : copie du mandat dans E-KO (fil des factures, à partir de `mandats_sepa` et du PDF) ; changer d'IBAN
  depuis l'espace compte.

## Changer de carte ou de compte

Sur `/la-cotisation`, « Changer de carte ou de compte » (abonnement du site en cours, impayé ou résilié).
Migration `20261105010000_changer_moyen.sql`.

- Carte : `{changer: {moyen: "carte", carte, captcha}}` crée un paiement v1 de 0,50 € avec `capture: false`,
  `tokenize: true` et 3D Secure (ligne `abonnement_changements`). Après le 3D Secure, `{confirmer_changement:
  paym_…}` demande l'autorisation (`PATCH status: "authorize"`), jamais la capture : rien n'est débité.
  Une fois `authorized`, l'abonnement passe sur le jeton `card_…`.
- Compte : `{changer: {moyen: "sepa", iban, titulaire, telephone, captcha}}` envoie le code SMS (ligne
  `mandats_sepa_codes` avec `changement = true`), puis `{signer: …}` signe le nouveau mandat comme à la
  souscription, sans prélèvement ; l'ancien mandat de l'abonnement reçoit `revoque_le`.
- Dans les deux cas : `moyen`, `stancer_carte` ou `stancer_sepa`, `derniers_chiffres` mis à jour ; un impayé
  est retenté au prochain passage du cron (`prochain_essai` vidé). Abonnement prélevé par E-KO :
  `eko_moyen_change_le` est posé, et le cron envoie le nouveau moyen à E-KO (`PUT
  /subscriptions/{code}/payment-method`, étape 4 bis de `synchroniserEko`).

## E-KO : contrat, factures et prélèvements

Depuis le 2/11/2026 (module Abonnements d'E-KO, réponse d'E-KO du 1/11 :
`/mnt/project-files/factures/reponse-eko-abonnements.md`), E-KO tient le contrat de chaque abonné du
site, facture chaque période et la prélève chez Stancer. Michel garde le premier paiement (3D Secure ou
mandat signé par SMS) et ses e-mails ; E-KO n'écrit jamais au client. Code : `_shared/abonnement-eko.ts`,
`_shared/eko.ts`, fonction `eko-webhook`. Migration `20261102010000_michelia_plus_eko.sql`.

- Interrupteur `michelia_plus_eko_actif` (`false` par défaut) et date `michelia_plus_eko_depuis` : seuls
  les abonnements pris à partir de cette date partent dans E-KO. Codes des plans dans
  `michelia_plus_eko_plans` (`{"mois": "PLAN-MICHELIA-MOIS", "an": "PLAN-MICHELIA-AN"}`).
- Toutes les heures (`michelia-plus-echeances` → `synchroniserEko`) :
  1. abonné payé pas encore dans E-KO : tiers particulier nominatif sans e-mail (`POST /tiers`), puis
     `POST /subscriptions` avec `bill_now`, la carte (`stancer_card`, `card_…` + `cust_…`) ou le mandat
     (`stancer_sepa`, `sepa_…`), e-mails au client et résiliation automatique coupés. Code `SUB-…` dans
     `abonnements.eko_abonnement`, première facture sur la première échéance (`eko_facture`, `eko_facture_id`) ;
     Première facture pas rattachée (réponse incomplète, écriture ratée) : relue dans les périodes de
     l'abonnement (`GET /subscriptions/{code}/billing-cycles`) aux passages suivants ;
  2. le premier paiement (`paym_…`) est enregistré sur cette facture (`POST /payments`, `card_online`) ;
  3. résiliation demandée par l'abonné : `/cancel` avec `at_period_end` (`eko_resilie_le`) ; déjà
     arrivé au bout chez Michel (`expire`) sans résiliation transmise : `/cancel` immédiat ;
  4. reprise avant la fin de période : `PATCH auto_renew: true`, vérifié par une relecture.
  4 ter. code promo arrivé au bout (voir « Codes promo ») : `PATCH unit_price_override_ht: null`, puis
     `prix_cents` reprend le prix normal chez Michel.
  5. compte supprimé (la cascade emporte l'abonnement) : un déclencheur garde avant la suppression le code
     E-KO dans `eko_resiliations`, puis `/cancel` immédiat (`transmise_le`), retenté à chaque passage.
  Un refus sur le fond (422) ou 5 essais ratés : `abonnements.eko_erreur`, ALERTE dans les journaux ;
  vider `eko_erreur` (et `eko_tentatives`) pour relancer. Sans `eko_abonnement`, Michel continue de prélever
  lui-même, comme avant.
- Un abonnement avec `eko_abonnement` n'est plus prélevé par Michel (ni relu pour les rejets SEPA).
- Webhooks (`eko-webhook`, signature `X-Subscriptions-Signature` vérifiée avec `EKO_WEBHOOK_SECRET`) :
  gardés dans `eko_evenements` (un par `X-Subscriptions-Delivery-Id`), acquittés, puis traités ; ratés
  ou arrivés trop tôt, repris par le cron (5 essais, puis ALERTE).
  - `cycle.billed` : nouvelle échéance en cours (`paiement_id = eko:<cycle>`, `eko_cycle`, facture) ;
    la première période est rattachée à l'échéance du premier paiement.
  - `cycle.paid` : échéance payée (`payer_echeance`), MichelIA+ prolongé jusqu'à la fin de la période.
  - `cycle.failed` : abonnement `impaye` ; un prélèvement SEPA rejeté après coup (`payment_rejected`,
    survenu après le paiement) rouvre l'échéance et ramène `fin_periode` au début de la période ; l'échec
    d'un essai précédent livré en retard est ignoré ; l'heure du rejet est gardée (`eko_rejete_le`) et un
    `cycle.paid` plus ancien, livré après, est ignoré. E-KO retente à J+3, J+7 et J+14.
  - `dunning.exhausted` (J+21) : résiliation immédiate chez E-KO, abonnement `expire`.
  - `subscription.cancel_scheduled` / `subscription.cancelled` : `resilie` / `expire` (ou `resilie`
    jusqu'à la fin de la période payée).
- Côté E-KO : plans `PLAN-MICHELIA-MOIS` (3,99 € TTC) et `PLAN-MICHELIA-AN` (39 € TTC), TVA 20 %,
  compte 706000, « e-mails au client » et « résilier en fin de relances » décochés ; jeton avec
  `tiers.create`, `subscriptions.view/create/update/cancel`, `subscription-plans.view` ; endpoint webhook
  `https://nuulykhqaeecqerfwdsn.supabase.co/functions/v1/eko-webhook` sur `cycle.billed`, `cycle.paid`,
  `cycle.failed`, `dunning.exhausted`, `subscription.cancel_scheduled`, `subscription.cancelled`.
- Pas encore : reçus Michel des échéances suivantes et e-mails d'impayé (les webhooks en donnent la
  matière), frais de rejet (clause à ajouter aux conditions avant de les activer), avoir E-KO sur le
  remboursement d'une échéance.

## Codes promo

Sur le site seulement (les applis suivent les prix d'Apple et de Google). Migration
`20261107010000_codes_promo.sql`.

- Créés dans le back-office, onglet « Codes promo » (administrateurs) : code (3 à 30 lettres, chiffres,
  tirets), remise de 1 à 100 %, formule visée (mois, an ou les deux), nombre d'échéances remisées (vide :
  tant que dure l'abonnement), compte réservé (par son e-mail), nombre d'utilisations, date de fin, note.
  Un code se modifie (bouton « Modifier », `admin_code_promo_modifier`, migration
  `20261107020000_codes_promo_modifier.sql`), se coupe et se réactive ; les abonnés qui l'ont déjà
  gardent la remise obtenue (copiée sur l'abonnement). Table `codes_promo`,
  RPC `admin_codes_promo`, `admin_code_promo_creer`, `admin_code_promo_actif` (journal `admin_audit`).
- Page `/la-cotisation` : « J'ai un code promo », ou lien tout prêt `michel.beer/la-cotisation?code=GERS-20`.
  `code_promo_verifier` (membres) rend les prix remisés ; le code part avec `{souscrire, …, code_promo}`.
- Reprise d'une cotisation résiliée (`{reprendre: true, code_promo}`) : `code_promo_reprise` (migration
  `20261107030000_codes_promo_reprise.sql`) pose le code avant la reprise (refusé : rien ne repart),
  pour les prochaines échéances (`remise_periodes` = échéances déjà payées + celles du code), une seule
  remise par abonnement (`cumul`), pas de code à 100 % (`offert` : E-KO ne prend pas de cycle à 0 €).
  Déjà chez E-KO : `PATCH unit_price_override_ht` au prix remisé ; pas encore : l'étape 1 le pose juste
  après la souscription E-KO (échec : ALERTE dans les journaux, à corriger dans E-KO).
- `michelia-plus` crée l'abonnement en attente puis appelle `code_promo_appliquer` (rôle service, sous
  verrou) : places comptées, une fois par compte, formule, dates. L'abonnement garde `prix_cents` = prix
  remisé, `prix_plein_cents` = prix normal, `remise_pct`, `remise_periodes`, `code_promo_id`. Refusé :
  l'abonnement en attente est supprimé, rien n'est prélevé, la page dit pourquoi.
- 100 % (offert) : rien n'est prélevé ; chaque période offerte est une échéance à 0 € (`offert:abo_…`),
  payée tout de suite (`echeanceOfferte`), sans alerte de renouvellement.
  - Pour un nombre d'échéances : la carte est seulement vérifiée (autorisation de 0,50 € avec 3D Secure,
    jamais encaissée, levée aussitôt) ou le mandat SEPA signé sans prélèvement ; ils servent ensuite au
    prix normal. E-KO ne prend l'abonnement qu'au premier vrai paiement (les échéances à 0 € restent chez
    Michel).
  - Pour toujours : ni carte ni mandat (`{souscrire, moyen: "offert", code_promo, captcha}`), abonnement
    sans moyen, renouvelé à 0 € par `michelia-plus-echeances`.
- Une utilisation (`codes_promo_utilisations`) compte tant que l'abonnement vit, ou s'il a payé au moins
  une échéance ; une souscription abandonnée ou refusée rend la place.
- Prix remisé (`prix_remise`) : arrondi vers le bas à un multiple de 6 centimes, pour que le hors taxes
  (TVA 20 %) tombe juste au centime chez E-KO et que sa facture égale le paiement Stancer ; jamais sous
  0,54 €. Ex. 3,99 € -20 % = 3,18 € ; 39 € -20 % = 31,20 €.
- Échéances : une fois payées `remise_periodes` échéances, `michelia-plus-echeances` remet le prix normal
  avant de prélever (`finirRemise` : `prix_cents` = prix normal, `prix_plein_cents` vidé). Chez E-KO, la
  souscription part avec `unit_price_override_ht` (prix remisé hors taxes) et l'étape 4 ter le retire.
- SMS et mandat SEPA annoncent « 3,18 € par mois les 3 premiers mois, puis 3,99 € » ; « Ta cotisation »
  montre la remise et les échéances remisées qui restent (`mon_abonnement`).
- Comptabilité : la facture E-KO et le paiement Stancer portent le prix remisé (TVA 20 % sur ce prix).
  Les pourboires ne prennent pas de code (un pourboire remisé n'a pas de sens).
