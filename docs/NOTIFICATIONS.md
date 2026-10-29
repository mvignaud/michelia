# Notifications push

Michel peut envoyer un mot sur les iPhone, les téléphones Android et le site (navigateurs, et iPhone quand le site est ajouté à l'écran d'accueil).

## Comment ça marche

- **Applis** : à l'acceptation, l'appli reçoit un jeton Expo. Expo relaie ensuite vers Apple (APNs) et Google (Firebase).
- **Site** : le navigateur crée un abonnement Web Push, signé par nos clés VAPID. Le service worker (`public/sw.js`) affiche la notification.
- **Base** : un abonnement par appareil dans `push_subscriptions` (migration `20261029090000_push.sql`). L'appli l'enregistre par `register_push`, rien d'autre n'est lisible depuis l'appli.
- **Envoi** : fonction Supabase `push`.
  - Sans corps : envoie les annonces du back-office en attente (`broadcasts` avec `push` dans `channels` et `push_status = 'en_attente'`), puis met `push_status` à `envoye` ou `echec` et remplit `push_sent`.
  - Avec la clé service_role : envoi libre, `{ "title", "body", "url"?, "audience": "service" | "news" }` ou `{ ..., "user_ids": [...] }`.
  - Les abonnements morts (appli désinstallée, notifications coupées) sont supprimés au passage.
- **Audiences** : `service` = appareils des membres ; `news` = membres abonnés aux nouvelles, plus les visiteurs sans compte qui ont accepté les notifications ; `daily` = appareils qui ont demandé le dicton du jour.

L'appli propose les notifications sur l'écran d'accueil (« Je te fais signe ? »), dicton du jour compris. À ceux qui les avaient déjà acceptées, elle propose seulement le dicton (« Le dicton du jour ? »). « Non merci » ne la fait plus revenir. Les membres peuvent couper le dicton dans Compte.

## Le dicton du jour

Chaque matin, Michel envoie un dicton (ou, un jour sur trois environ, un coup de gueule) aux appareils qui l'ont demandé.

- **Écriture** : fonction `dicton`, appelée par pg_cron chaque heure de 5 h à 9 h UTC. Elle n'agit qu'une fois par jour, à partir de `dicton_hour` (heure de Paris, 8 par défaut, 10 au plus). Claude écrit une phrase avec le prompt de Michel, en évitant les trente derniers dictons, puis la fonction `push` l'envoie à l'audience `daily`.
- **Coût** : un seul appel Claude par jour, quel que soit le nombre d'abonnés.
- **Historique** : table `daily_sayings` (texte, statut `envoye` / `echec`, nombre d'envois, jetons). En cas d'échec, nouvel essai à l'appel suivant, trois au plus ; le texte déjà écrit resert.
- **Réglages** (`app_config`) : `dicton_enabled` (`false` pour couper), `dicton_hour`, et `dicton_instruction` pour remplacer la consigne par défaut (`{kind}` et `{date}` y sont remplacés).

### Mise en place

1. Supabase > SQL Editor : coller et exécuter `supabase/migrations/20261029120000_dicton.sql`. Il active pg_cron et pg_net s'ils ne le sont pas, et planifie la tâche `dicton-du-jour` (visible dans Integrations > Cron).
2. Edge Functions > Deploy a new function > Via editor : nom `dicton`, coller `supabase/functions/dicton/index.ts`, **désactiver « Verify JWT »** (le cron l'appelle sans clé ; elle n'envoie de toute façon qu'une fois par jour).
3. Redéployer `push` (elle accepte maintenant l'audience `daily`).

Pour tester tout de suite (après `dicton_hour`), dans le SQL Editor :

```sql
select net.http_post(url := 'https://nuulykhqaeecqerfwdsn.supabase.co/functions/v1/dicton', body := '{}'::jsonb);
select * from daily_sayings order by day desc;
```

## Mise en place (une seule fois)

### 1. Base de données

Supabase > SQL Editor : coller et exécuter `supabase/migrations/20261029090000_push.sql` (après la migration du back-office `20261029080000`).

### 2. Clés du site (VAPID)

Sur le Mac, dans un terminal :

```sh
npx web-push generate-vapid-keys
```

- **Supabase > Edge Functions > Secrets** : `VAPID_PUBLIC_KEY` (Public Key), `VAPID_PRIVATE_KEY` (Private Key), `VAPID_SUBJECT` = `mailto:contact@michel.beer`.
- **Cloudflare Pages > michelia > Settings > Variables** : `EXPO_PUBLIC_VAPID_PUBLIC_KEY` = la Public Key, en type **Texte** (pas Secret), puis relancer un déploiement.
- **expo.dev > Environment variables** (preview et production) : la même `EXPO_PUBLIC_VAPID_PUBLIC_KEY`, inutile aux applis mais sans risque.

La clé privée ne va nulle part ailleurs que dans Supabase. Changer de clés oblige chaque navigateur à se réabonner (fait tout seul à la visite suivante, si l'autorisation est déjà donnée).

### 3. Fonction `push`

Supabase > Edge Functions > Deploy a new function > Via editor : nom `push`, coller `supabase/functions/push/index.ts`, garder « Verify JWT » activé.

### 4. iPhone (APNs)

Il faut le compte Apple Developer. Au premier `npx eas-cli build --platform ios` après ce changement, EAS demande :

- « Setup Push Notifications for your project? » : **Yes**
- « Generate a new Apple Push Notifications service key? » : **Yes**

EAS crée la clé chez Apple et la garde. Rien d'autre à faire. (Pour le faire à part : `npx eas-cli credentials` > iOS > production > Push Notifications.)

### 5. Android (Firebase)

1. [console.firebase.google.com](https://console.firebase.google.com) > **Ajouter un projet** « MichelIA » (Google Analytics inutile).
2. Dans le projet : **Ajouter une appli** > Android > nom du package `beer.michel.app` > **Enregistrer**, puis télécharger **google-services.json**. Il ne contient que des identifiants publics, mais il contient une clé d'API Google que GitHub signalerait : il ne va pas dans le dépôt public. Sur expo.dev > projet michel-ia > **Environment variables** > « Add variable » : nom `GOOGLE_SERVICES_JSON`, type **File** (fichier), environnements preview et production, puis déposer le fichier. `app/app.config.js` le récupère au build. Copie privée : `/mnt/project-files/michelia/google-services.json`.
3. **Paramètres du projet > Comptes de service > Générer une nouvelle clé privée** : un fichier JSON secret. **Ne jamais le committer.**
4. expo.dev > projet michel-ia > **Credentials** > Android > `beer.michel.app` > **FCM V1 service account key** > **Add a service account key** > envoyer ce JSON secret.

### 6. Reconstruire les applis

`expo-notifications` est un module natif : il faut de nouveaux builds (`npx eas-cli build --profile preview --platform all`). Le site, lui, est à jour dès le déploiement Cloudflare.

## Tester

Envoi libre à son propre compte (UUID visible dans Supabase > Authentication) :

```sh
curl -X POST https://nuulykhqaeecqerfwdsn.supabase.co/functions/v1/push \
  -H "Authorization: Bearer <clé service_role>" -H "Content-Type: application/json" \
  -d '{"title":"Adishatz !","body":"Michel teste ses notifications.","user_ids":["<ton uuid>"]}'
```

Réponse : `{"sent":1,"failed":0,"expired":0}`. Sur iPhone, le site doit être ouvert depuis l'icône de l'écran d'accueil pour proposer les notifications.

## Si EXPO_ACCESS_TOKEN

Seulement si « Enhanced security for push notifications » est activé sur expo.dev : créer un jeton d'accès Expo et le mettre dans les secrets Supabase sous `EXPO_ACCESS_TOKEN`.
