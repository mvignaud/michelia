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

## Site (Stancer)

À venir : souscription par carte, prélèvement automatique des échéances, SEPA, changement de carte
ou d'IBAN et résiliation depuis l'espace. Prérequis SEPA : l'identifiant créancier SEPA (ICS) de
GOLDEN PRINT, `FR98ZZZ8A3E64`, déclaré auprès de Stancer.
