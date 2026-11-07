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
| `reseaux_mentions` | (absent = oui) | `false` coupe les réponses aux mentions Instagram (fonction `reseaux-webhook`). |
| `reseaux_consigne_mention` | (aucune) | Remplace la consigne des mentions (`{ou}` y devient « un commentaire… » ou « la légende… »). |
| `reseaux_messages` | (absent = oui) | `false` coupe les réponses aux messages privés Messenger et Instagram (fonction `reseaux-webhook`). |
| `reseaux_messages_max_jour` | `20` | Réponses au plus à une même personne en messages privés, en 24 heures. |
| `reseaux_messages_pause_heures` | `24` | Durée pendant laquelle Michel se tait dans une conversation après une réponse de Mathieu à la main, ou après lui avoir passé la main. |
| `reseaux_consigne_message` | (aucune) | Remplace la consigne des messages privés (`{reseau}` y devient Messenger ou Instagram). |
| `reseaux_conservation_jours` | `90` | Durée de conservation du journal `reponses_reseaux` (annoncée dans la page de confidentialité). |

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

## Les mentions sur Instagram (fonction `reseaux-webhook`)

Quand quelqu'un écrit @michel.beer.32 dans un commentaire ou dans la légende d'une publication d'**un autre compte**, Meta prévient la fonction `reseaux-webhook`, qui fait répondre Michel au même endroit (`POST /{compte}/mentions`). Mêmes garde-fous que pour les commentaires, avec une consigne plus discrète : Michel est invité, il ne fait pas de réclame. Une mention n'arrive qu'une fois : si Claude ou Meta flanchent, elle reste en `echec` dans le journal.

Meta ne prévient d'une mention que par webhook, et seulement pour une appli **en ligne** dont l'autorisation `instagram_manage_comments` a passé l'**examen de l'appli**. Commenter chez les autres sans être tagué reste impossible, et c'est voulu.

### Mise en route (Mathieu)

1. **Secrets Supabase** (Edge Functions → Secrets) :
   - `META_APP_SECRET` : la clé secrète de l'appli (developers.facebook.com → l'appli → Paramètres de l'app → Général → Clé secrète → Afficher).
   - `META_WEBHOOK_VERIFY_TOKEN` : une phrase au hasard, inventée pour l'occasion (elle ne sert qu'à l'étape 2).
2. **Webhook** : dans l'appli, cas d'utilisation Instagram → **Configurer les webhooks** (ou produit Webhooks → Instagram) :
   - URL de rappel : `https://nuulykhqaeecqerfwdsn.supabase.co/functions/v1/reseaux-webhook`
   - Vérifier le token : la même phrase que `META_WEBHOOK_VERIFY_TOKEN`
   - Vérifier et enregistrer, puis **S'abonner** au champ `mentions`.
3. **Relier l'appli à la page** : dans l'explorateur de l'API Graph, avec le jeton de la page, `POST me/subscribed_apps` avec le paramètre `subscribed_fields=feed`. La réponse doit être `{"success": true}`.
4. **Examen de l'appli** (Révision de l'app → Demandes d'autorisations) : demander l'accès avancé à `instagram_manage_comments`, `instagram_manage_messages` et `pages_messaging` (et `instagram_basic`, `pages_read_engagement`, `pages_show_list` si demandé), avec les textes ci-dessous et une courte vidéo.
5. Une fois accepté : passer l'appli **En ligne** (interrupteur en haut de la page de l'appli). URL de confidentialité : `https://michel.beer/confidentialite.html` ; instructions de suppression des données : `https://michel.beer/confidentialite.html#droits`.

### Textes pour l'examen (à coller, en anglais)

**instagram_manage_comments**

> Michel IA (michel.beer) is a free French chatbot with the persona of a grumpy but kind old man from the Gers region. Our Instagram business account @michel.beer.32 uses this permission to (1) read comments left on our own posts and reply to them, and (2) receive webhook notifications when another user @mentions @michel.beer.32 in a caption or comment, and reply once to that mention via the /mentions endpoint. Replies are written by our assistant with strict rules: one short, friendly reply per comment, no links or promotion, a per-user daily cap, silence on insults, spam or politics, and hand-off to a human for account, payment or personal issues. We never comment where we are not mentioned. Comment data is kept 90 days and can be deleted on request (contact@michel.beer).

**instagram_manage_messages**

> Michel IA (michel.beer) is a free French chatbot with the persona of a grumpy but kind old man from the Gers region. Our Instagram business account @michel.beer.32 uses this permission to receive the direct messages people send to it (messages webhook) and reply automatically, only within the 24-hour standard messaging window, with the RESPONSE messaging type. Replies are written by our assistant: short, no promotion, a per-user daily cap, several messages sent in a row get a single reply, silence on insults or spam, and hand-off to a human (our team answers in the Meta Business Suite inbox) for account, payment or personal issues. As soon as our team replies manually in a conversation, the assistant stops answering in it for 24 hours. We never send the first message. Message data is kept 90 days and can be deleted on request (contact@michel.beer).

**pages_messaging**

> Same service on Messenger: our Facebook Page (Michel IA) uses this permission to receive the messages people send to the Page (messages and message_echoes webhooks) and reply automatically within the 24-hour standard messaging window, with the RESPONSE messaging type. Same rules as on Instagram: short replies, per-user daily cap, silence on insults or spam, hand-off to a human for account, payment or personal issues, the assistant steps back for 24 hours when our team replies manually, and we never send the first message.

**instagram_basic**

> Used to read our own Instagram business account id and username, so we can recognise our own comments and never reply to ourselves.

**pages_read_engagement / pages_show_list**

> Used to read the Facebook Page linked to our Instagram business account and the comments on the Page's own posts, so our assistant can reply to them.

### La vidéo de démonstration (1 à 2 minutes)

1. Montrer la page Facebook et le compte Instagram @michel.beer.32.
2. Depuis un autre compte Instagram (un compte perso), publier un commentaire avec @michel.beer.32 sous une de ses publications.
3. Attendre la réponse de Michel (quelques secondes), la montrer sous le commentaire.
4. Montrer un commentaire sous une publication de Michel et sa réponse (fonction `reseaux`).
5. Depuis le compte Instagram perso, envoyer un message privé à @michel.beer.32 (« Salut Michel, il fait beau dans le Gers ? ») et montrer la réponse qui arrive.
6. Depuis un compte Facebook perso, envoyer un message à la page de Michel sur Messenger et montrer la réponse.
7. Montrer la boîte de réception Meta Business Suite : écrire une réponse à la main dans une conversation, puis renvoyer un message depuis le compte perso et montrer que Michel ne répond plus (un humain a pris le relais).
8. Ouvrir michel.beer/confidentialite.html et montrer les paragraphes sur les commentaires et les messages privés.

Pendant l'examen, l'appli est encore en développement : pour que le webhook reçoive la mention et les messages de la vidéo, ajoute le compte perso comme **testeur Instagram** de l'appli (Rôles de l'app → Testeurs Instagram), et accepte l'invitation dans les réglages Instagram de ce compte. Pour Messenger, le compte Facebook perso doit avoir un rôle sur l'appli (Rôles de l'app → Rôles → Testeur).

## Les messages privés sur Messenger et Instagram (fonction `reseaux-webhook`)

Quand quelqu'un écrit à Michel en privé, sur Messenger (page Facebook) ou en DM Instagram, Meta prévient la fonction `reseaux-webhook`, qui fait répondre Michel dans la conversation (`POST me/messages`, type `RESPONSE`).

- Michel ne répond que dans les **24 heures** qui suivent le message (règle de Meta). Il n'écrit jamais le premier.
- Il voit ce qui s'est dit dans la conversation sur les 24 dernières heures. Des messages envoyés coup sur coup reçoivent une seule réponse (il attend 8 secondes).
- Au plus 20 réponses par personne et par jour (`reseaux_messages_max_jour`).
- Silence devant les insultes et le spam ; pour un paiement, un compte, un bug, etc., il ne répond pas et envoie l'alerte « Un message … pour toi » à contact@michel.beer.
- **Dès que Mathieu répond à la main** dans une conversation (boîte de réception Meta Business Suite ou appli Instagram), ou quand Michel lui a passé la main, Michel se tait dans cette conversation pendant 24 heures (`reseaux_messages_pause_heures`).
- Les photos, vocaux et autocollants sans texte restent sans réponse.

Tout est noté dans `public.reponses_reseaux` : `commentaire_id` commence par `dm:` (les réponses de Mathieu à la main par `dm:mathieu:`), `auteur_id` vaut `dm:` suivi de l'identifiant de la personne chez Meta.

### Mise en route (Mathieu, en plus des mentions)

1. **Autorisations** : dans l'explorateur de l'API Graph, refaire le jeton de la page (étape « Le jeton ») en ajoutant `pages_messaging` et `instagram_manage_messages`, puis remplacer le secret `META_PAGE_TOKEN`.
2. **Instagram** : dans l'appli Instagram, Paramètres → Messages et réponses aux stories → Outils connectés → activer **Autoriser l'accès aux messages**.
3. **Webhooks** :
   - produit Instagram : s'abonner aussi au champ `messages` ;
   - produit Page (Messenger → Paramètres de l'API Messenger, ou Webhooks → Page) : même URL de rappel et même phrase de vérification que pour Instagram, puis s'abonner à `messages` et `message_echoes`.
4. **Relier l'appli à la page** : `POST me/subscribed_apps` avec `subscribed_fields=feed,messages,message_echoes`.
5. **Réponses automatiques de Meta** : dans Meta Business Suite → Boîte de réception → Automatisations, couper la « Réponse instantanée » et les « Absences » : Meta les envoie au nom de la page, et Michel les prendrait pour une réponse de Mathieu.
6. **Examen** : demander `pages_messaging` et `instagram_manage_messages` dans la même demande que `instagram_manage_comments` (textes et vidéo ci-dessus).
