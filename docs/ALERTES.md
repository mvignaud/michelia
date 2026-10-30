# Les alertes de Mathieu

Michel prévient Mathieu par e-mail (à `contact@michel.beer`) de tout ce qui compte, aux couleurs de ses courriers :

| Genre | Quand |
| --- | --- |
| `doleance` | Idée, bug ou râlerie déposé dans le cahier de doléances. Si la personne a laissé un e-mail, répondre à l'alerte lui répond directement. |
| `note_basse` | Une réponse de Michel notée 1 ou 2 étoiles (avec la question et la réponse). |
| `inscription` / `depart` | Un vrai compte créé (jamais les sessions anonymes) / un compte supprimé. |
| `pourboire` / `remboursement` | Un pourboire payé (site ou applis) / un remboursement constaté chez Stancer. |
| `abonnement`, `renouvellement`, `impaye`, `reprise`, `resiliation`, `fin_abonnement` | La vie d'un abonnement MichelIA+, par le site (Stancer) comme par les applis (RevenueCat). |

Les paiements d'essai ne déclenchent rien.

## Comment ça marche

1. Des triggers (migration `supabase/migrations/20261030160000_alertes.sql`) déposent une ligne dans `public.alertes`. Ils ne font jamais échouer l'écriture qu'ils observent.
2. Toutes les 5 minutes, pg_cron (`alertes-mathieu`) appelle la fonction Edge `alertes`, qui réserve les alertes en attente et les envoie par Postal. Plus de 8 d'un coup : un seul récapitulatif. Cinq essais au plus par alerte (colonne `erreur`).
3. Les alertes envoyées sont effacées au bout de 90 jours.

Les modèles d'e-mail sont dans `supabase/functions/_shared/alertes.ts`.

## Réglages (`app_config`)

| Clé | Défaut | Effet |
| --- | --- | --- |
| `alertes_actives` | `true` | `false` coupe tout (rien n'est même déposé). |
| `alertes_destinataire` | `contact@michel.beer` | L'adresse qui reçoit les alertes. |
| `alertes_muettes` | `[]` | Liste JSON des genres à taire, par exemple `["renouvellement", "inscription"]`. |
