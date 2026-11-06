# Michel répond aux commentaires Facebook et Instagram

Toutes les 10 minutes, la fonction Edge `reseaux` lit les commentaires récents sous les publications de la page Facebook de Michel et de son compte Instagram, fait écrire une réponse par Michel (même prompt que le chat, `app_config.system_prompt`) et la publie. Metricool ne sait pas le faire : il programme des publications mais ne touche pas aux commentaires. La fonction passe donc directement par l'API Graph de Meta, sans webhook (donc sans examen de l'appli par Meta).

## Ce que fait Michel, et ce qu'il ne fait pas

- Il répond une fois à chaque commentaire **de premier niveau** des 72 dernières heures (`reseaux_fenetre_heures`). Il ne répond pas aux réponses, pour éviter les conversations sans fin.
- Au plus 10 réponses par passage (`reseaux_max_passage`) et 3 par personne et par jour (`reseaux_max_auteur_jour`). Le reste attend le passage suivant.
- Si la page a déjà répondu à la main, il ne s'en mêle pas.
- Il se tait devant les insultes, la haine, le spam, la politique et les simples tags d'amis (`statut = 'silence'`).
- Pour ce qui demande un humain (paiement, abonnement, compte, bug, presse, partenariat, données personnelles, quelqu'un qui va mal), il ne répond pas et envoie une alerte `reseaux` à contact@michel.beer (`statut = 'mathieu'`).
- Si Meta refuse le jeton, une alerte `reseaux` part (une par jour au plus) et rien n'est publié.

Tout est noté dans la table `public.reponses_reseaux` : le commentaire, la réponse publiée ou la raison du silence.

## Réglages (`app_config`)

| Clé | Défaut | Rôle |
| --- | --- | --- |
| `reseaux_reponses_actif` | `true` | `false` coupe tout, tout de suite. |
| `reseaux_facebook`, `reseaux_instagram` | `true` | `false` coupe un réseau. |
| `reseaux_fenetre_heures` | `72` | Âge maximal d'un commentaire auquel Michel répond. |
| `reseaux_max_passage` | `10` | Réponses au plus par passage de 10 minutes. |
| `reseaux_max_auteur_jour` | `3` | Réponses au plus à une même personne en 24 heures. |
| `reseaux_consigne` | (aucune) | Remplace la consigne écrite dans la fonction (`{reseau}` y devient Facebook ou Instagram). |
| `reseaux_graph_version` | `v24.0` | Version de l'API Graph. Meta garde une version au moins deux ans. |

## Mise en route (à faire une fois, par Mathieu)

### 1. L'appli Meta

1. Sur [developers.facebook.com/apps](https://developers.facebook.com/apps), **Créer une app**. Nom : « Michel réponses ». Cas d'utilisation : **Gérer tout sur votre Page** (et, s'il est proposé, **Gérer les messages et le contenu sur Instagram**). Rattacher le portefeuille business de Michel s'il le demande.
2. Dans les paramètres de base de l'appli, renseigner la politique de confidentialité : `https://michel.beer/confidentialite.html`.
3. Le compte Instagram michel.beer.32 doit être un compte professionnel relié à la page Facebook (c'est déjà le cas pour Metricool).

### 2. Le jeton

1. Ouvrir l'[explorateur de l'API Graph](https://developers.facebook.com/tools/explorer/), choisir l'appli « Michel réponses ».
2. **Jeton d'accès utilisateur**, ajouter ces autorisations : `pages_show_list`, `pages_read_engagement`, `pages_read_user_content`, `pages_manage_engagement`, `instagram_basic`, `instagram_manage_comments`, `business_management`. Cliquer **Generate Access Token**, choisir la page de Michel et son compte Instagram, valider.
3. Copier ce jeton dans le [débogueur de jeton](https://developers.facebook.com/tools/debug/accesstoken/), cliquer **Étendre le jeton d'accès** : on obtient un jeton utilisateur de 60 jours.
4. Revenir dans l'explorateur, coller ce jeton long, et lancer `GET me/accounts`. Dans la ligne de la page de Michel, le champ `access_token` est le **jeton de la page**. Passé au débogueur, il doit dire « Expire : jamais ».
5. Dans Supabase, **Edge Functions → Secrets**, ajouter `META_PAGE_TOKEN` avec ce jeton de page. Ne jamais le coller dans une conversation ni dans le dépôt.
6. Facultatif : si « Exiger la clé secrète de l'appli » est coché chez Meta, ajouter aussi `META_APP_SECRET` (Paramètres → Général → Clé secrète).

Le jeton de page meurt si Mathieu change son mot de passe Facebook, retire l'appli ou perd son rôle sur la page. L'alerte « Michel ne lit plus les commentaires » le signale ; il suffit alors de refaire l'étape 2.

### 3. La base et la fonction

1. Coller `supabase/migrations/20261106010000_reponses_reseaux.sql` dans le SQL Editor (table, alerte `reseaux`, réglages, passage toutes les 10 minutes).
2. Déployer la fonction `reseaux` (sans vérification du JWT, voir `supabase/config.toml`).

### 4. Vérifier

Laisser un commentaire de test sous une publication, attendre 10 minutes, puis regarder `public.reponses_reseaux`. Si les commentaires des autres n'arrivent pas alors que les tiens oui, passer l'appli Meta en mode **En ligne** (Live) en haut de sa page.
