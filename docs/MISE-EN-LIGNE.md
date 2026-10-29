# Mettre MichelIA en ligne (version web)

Compter une heure la première fois. Aucune clé secrète ne va dans ce dépôt : elles vivent dans Supabase.

## 1. Supabase (comptes, quotas, fonction IA)

1. Créer un projet sur [supabase.com](https://supabase.com), région Europe (Paris ou Francfort).
2. **Authentication > Sign In / Providers** : activer **Anonymous sign-ins**. Chaque visiteur reçoit un compte invisible qui porte son quota du jour.
3. **SQL Editor** : coller et exécuter, dans l'ordre, les fichiers de `supabase/migrations/`. À refaire pour chaque nouveau fichier ajouté plus tard (ils sont rejouables sans risque).
4. Toujours dans le SQL Editor, ajouter le prompt de Michel (il n'est pas dans le dépôt public) :

   ```sql
   insert into public.app_config (key, value) values ('system_prompt', $michel$
   ... coller ici le prompt, à partir de « Tu es Michel » ...
   $michel$)
   on conflict (key) do update set value = excluded.value, updated_at = now();
   ```

   Pour modifier Michel plus tard : relancer la même requête, ou éditer la ligne dans **Table Editor > app_config**. Effet immédiat, sans redéployer.

5. Réglages dans la même table : `daily_limit` (messages gratuits par jour et par visiteur, 30 par défaut), `global_daily_limit` (plafond pour tout le site, 5 000), `model` (`claude-haiku-5-5`), `max_output_tokens` (2048). Cache des questions d'ouverture : `cache_enabled` (`true` / `false`), `cache_threshold` (proximité minimale entre deux questions, 0,94) et `cache_variants` (nombre de réponses à avoir en réserve avant d'en resservir une, 3).

## 2. Clé Anthropic

1. Sur [platform.claude.com](https://platform.claude.com) : créer une clé API, acheter du crédit et **fixer un plafond de dépense mensuel**.
2. Dans Supabase, **Edge Functions > Secrets** : ajouter `ANTHROPIC_API_KEY` avec la clé.
3. Ajouter aussi `ALLOWED_ORIGINS` = `https://michel.beer,http://localhost:8081` (sites autorisés à appeler Michel).

## 3. Déployer la fonction

**Avec l'intégration GitHub de Supabase** (Project Settings > Integrations > GitHub, dossier de travail `.`, branche `main`) : chaque fusion sur `main` applique les migrations et déploie la fonction. Rien d'autre à faire.

**Sinon, depuis un terminal**, à la racine du dépôt :

```bash
npx supabase login
npx supabase functions deploy chat --project-ref <ref-du-projet>
```

La référence du projet est dans l'adresse du tableau de bord Supabase.

## 4. Site web sur Cloudflare Pages

1. [dash.cloudflare.com](https://dash.cloudflare.com) > **Workers & Pages > Créer > Pages > Connecter à Git**, choisir `mvignaud/michelia`.
2. Réglages de build :
   - Répertoire racine : `app`
   - Commande : `npm run build:web`
   - Dossier de sortie : `dist`
   - Variables (type **Texte**, pas « Secret », sinon elles arrivent vides au build) : `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` (Supabase > Project Settings > API Keys, clé « publishable ») et `EXPO_PUBLIC_TURNSTILE_SITE_KEY` (voir Anti-robots). Ces valeurs sont publiques par nature.
3. **Domaines personnalisés** : ajouter `michel.beer`. Cloudflare indique l'enregistrement DNS à créer chez le registraire (ou transférer la zone DNS chez Cloudflare, plus simple).

Chaque fusion sur `main` republie le site automatiquement.

## Comptes (e-mail, Google, Facebook)

Exécuter d'abord la migration `20261029050000_comptes.sql` (profils, suppression de compte), puis `20261029060000_quotas_horaires.sql` (sans compte 5 par heure et 20 par jour, avec compte 30 et 200 ; réglables dans `app_config`).

1. **Authentication > URL Configuration** : Site URL `https://michel.beer` ; Redirect URLs `https://michel.beer/**`, `https://michelia.pages.dev/**`, `http://localhost:8081/**`.
2. **Authentication > Sign In / Providers > Email** : activé, « Confirm email » activé.
3. **Google** : sur [console.cloud.google.com](https://console.cloud.google.com), créer un projet, configurer l'écran de consentement OAuth (nom MichelIA, liens vers les pages légales), puis **Identifiants > Créer un ID client OAuth > Application Web**. Origine autorisée `https://michel.beer` ; URI de redirection : l'adresse « Callback URL » affichée par Supabase dans le fournisseur Google (`https://<ref>.supabase.co/auth/v1/callback`). Coller l'ID et le secret client dans Supabase > Providers > Google.
4. **Facebook** : sur [developers.facebook.com](https://developers.facebook.com), créer une app de type « Consommateur », ajouter « Facebook Login », renseigner la même Callback URL Supabase dans « URI de redirection OAuth valides », l'URL de la politique de confidentialité et celle de suppression des données (`https://michel.beer/confidentialite.html`). Coller l'ID et la clé secrète de l'app dans Supabase > Providers > Facebook, puis passer l'app en mode « Live ».

Les secrets Google et Facebook restent dans Supabase, jamais dans ce dépôt.

## E-mails (Postal)

Les e-mails de compte partent par le serveur Postal, avec les modèles de `supabase/templates/`.

1. Dans Postal, ajouter le domaine `michel.beer` et créer un identifiant SMTP.
2. Dans Cloudflare (DNS de michel.beer), ajouter les enregistrements donnés par Postal : DKIM, return-path et SPF. Il ne doit rester qu'un seul enregistrement SPF : ajouter l'`include` de Postal à celui de la messagerie OVH.
3. Dans Supabase, Authentication > Emails > SMTP Settings : hôte, port, identifiant et mot de passe Postal, expéditeur `noreply@michel.beer`, nom `Michel (MichelIA)`. Le mot de passe se saisit seulement là.
4. Dans Authentication > Emails > Templates, coller chaque modèle avec son objet :

   | Modèle Supabase | Fichier | Objet |
   | --- | --- | --- |
   | Confirm signup | `confirmation.html` | Active ton compte MichelIA |
   | Reset password | `recovery.html` | Ton nouveau mot de passe MichelIA |
   | Change email address | `email_change.html` | Confirme ta nouvelle adresse MichelIA |

Le portrait des e-mails est servi par le site (`app/public/email/michel.png`).

## Connexion par SMS (Twilio)

1. Supabase > Authentication > Sign In / Providers > Phone : activer, fournisseur Twilio, puis saisir l'Account SID, l'Auth Token (seulement là) et le Message Service SID.
2. Texte du SMS : `Boudu, ton code MichelIA : {{ .Code }}. Le donne à personne, même pas au cousin Jeannot.`
3. Twilio > Messaging > Settings > Geo permissions : n'autoriser que la France (et les pays voulus), contre la fraude au « SMS pumping ».
4. Le captcha Turnstile protège déjà l'envoi des codes. Rate Limits : garder un plafond bas de SMS par heure.

## Relier plusieurs connexions

Dans « Mon compte », chacun peut relier Google, Facebook, Apple, un e-mail ou un numéro au même compte. Pour que ça marche, il faut activer « Allow manual linking » dans Supabase > Authentication > Sign In / Providers (section « User Signups »). Pour les numéros hors de France, il faut aussi autoriser les pays voulus dans Twilio (Geo permissions).

## 5. Tester en local

```bash
cd app
cp .env.example .env   # remplir les deux valeurs
npm install
npm run web
```

## Anti-robots

Trois protections se cumulent :

1. **Quota par visiteur** : `daily_limit` messages par jour et par compte anonyme (30 par défaut).
2. **Plafond global** : `global_daily_limit` messages par jour pour tout le site (5 000 par défaut, soit environ 2,50 $ de Claude Haiku). Même avec des milliers de faux comptes, la dépense du jour reste bornée. À relever quand l'audience grandit.
3. **Captcha Cloudflare Turnstile** à la création du compte anonyme (version web) :
   - Cloudflare > **Turnstile** > Add site : noms d'hôte `michel.beer` et `michelia.pages.dev` (+ `localhost` pour les tests), mode **Managed**. Un nom d'hôte absent donne l'erreur 110200.
   - Copier la **clé de site** dans la variable `EXPO_PUBLIC_TURNSTILE_SITE_KEY` de Cloudflare Pages.
   - Copier la **clé secrète** dans Supabase > Authentication > **Attack Protection** > Enable Captcha protection > Turnstile.
   - Attention : une fois le captcha activé dans Supabase, les applis iOS et Android ne pourront plus créer de compte tant qu'elles n'auront pas leur propre vérification (prévu pour la sortie sur les stores).

Dans Supabase > Authentication > **Rate Limits**, baisser aussi « Anonymous sign-ins » (par adresse IP et par heure) à 10 ou 20.

Et côté Anthropic : fixer une limite mensuelle (Settings > Limits) et laisser le rechargement automatique désactivé.

## Avant d'ouvrir au public

- Vérifier les trois protections ci-dessus.
- Pages légales : `app/public/` (mentions légales, confidentialité, conditions). Les durées de conservation annoncées reposent sur la migration `20261029020000_purge.sql`.
- Créer l'adresse `contact@michel.beer` (Cloudflare > Email > Routage des e-mails, gratuit), citée dans les pages légales.

## Appli web installable (PWA)

Le site s'installe sur l'écran d'accueil (Android, iPhone, ordinateur) et s'ouvre même sans réseau.

- `app/public/index.html` : modèle de page (méta PWA, écrans de démarrage iOS, aperçus de partage).
- `app/public/manifest.webmanifest`, `app/public/sw.js` (service worker), `app/public/hors-ligne.html`.
- Icônes et écrans de démarrage : `python3 assets/brand/pwa.py` depuis `app/` après un changement de logo.
- `app/public/_headers` : Cloudflare ne garde jamais `sw.js` en cache, sinon les mises à jour traînent.
- Après une grosse refonte du cache, changer `VERSION` dans `sw.js` pour vider l'ancien.

## Back-office

Statistiques, membres et leurs usages, export des comptes et annonces. Il s'ouvre dans l'appli : **Compte > Back-office**, visible seulement pour les administrateurs.

1. **SQL Editor** : exécuter `supabase/migrations/20261029080000_back_office.sql` **avant** de fusionner le code de l'appli (rejouable sans risque).
2. Se déclarer administrateur, avec l'e-mail de son compte MichelIA :

   ```sql
   insert into public.admins (user_id)
   select id from auth.users where email = 'ton-adresse@exemple.fr'
   on conflict do nothing;
   ```

   Pour retirer quelqu'un : `delete from public.admins where user_id = '…';`.
3. **Edge Functions > Deploy a new function** : nom `annonces`, coller `supabase/functions/annonces/index.ts`, puis dans ses réglages **décocher « Enforce JWT verification »** (le désabonnement en un clic des messageries arrive sans connexion ; le droit d'administrateur est vérifié dans la fonction).
4. **Postal** (serveur de michel.beer) : **Credentials > Add** de type **API**, puis dans Supabase **Edge Functions > Secrets** :
   - `POSTAL_API_URL` : adresse de l'interface Postal (celle où l'on se connecte, sans `/api`) ;
   - `POSTAL_API_KEY` : la clé de l'identifiant API ;
   - `UNSUBSCRIBE_SECRET` : une longue chaîne au hasard (`openssl rand -hex 32`), qui signe les liens de désabonnement. Ne plus la changer ensuite, sinon les anciens liens ne marchent plus ;
   - facultatif : `MAIL_FROM` (par défaut `Michel (MichelIA) <noreply@michel.beer>`) et `SITE_URL` (par défaut `https://michel.beer`).

Ce que fait chaque onglet :

- **Tableau de bord** : membres, visiteurs sans compte, questions et visiteurs actifs (jour, 7 et 30 jours), inscriptions, moyens de connexion, âges, cache. Les compteurs de questions ne remontent qu'à 90 jours (purge annoncée dans la politique de confidentialité).
- **Membres** : recherche (e-mail, numéro, nom), tri par inscription, activité, dernier passage ou coût, visiteurs anonymes en option (pour repérer un robot). Un clic sur un membre montre son détail, ses questions et son coût Claude par jour. **Exporter** télécharge un CSV (séparateur `;`, ouvrable dans Excel) ; chaque export est noté dans `admin_audit`.
  - **Relier un autre compte…** : pour une personne inscrite deux fois (Facebook et Google, par exemple). Ouvrir la fiche du compte à garder, chercher l'autre, confirmer. Le compte gardé récupère les connexions Google, Facebook et Apple de l'autre, son usage, ses appareils et la conversation la plus récente ; l'autre compte est supprimé. Un compte n'a qu'un e-mail : celui de l'autre compte (avec son mot de passe) et son numéro ne suivent que si le compte gardé n'en a pas.
  - **Supprimer le compte…** : efface le compte et tout ce qui s'y rattache. On ne peut ni supprimer ni faire disparaître son propre compte. Liaisons et suppressions sont notées dans `admin_audit`.
- **Annonce** : e-mail et/ou notification.
  - « Nouvelles » : seulement les membres qui ont coché « Recevoir les nouvelles de Michel » (à l'inscription ou dans Compte). Chaque e-mail porte un lien de désabonnement et l'en-tête de désabonnement en un clic (Gmail, Apple Mail).
  - « Information de service » : tous les membres, réservé aux messages sur le service lui-même (conditions, panne, fermeture), jamais de promotion.
  - Toujours faire **M'envoyer un test** avant. `{prenom}` est remplacé par le prénom du membre.
  - Les e-mails partent en tâche de fond (8 à la fois) ; l'historique montre l'avancement. Une fonction Edge s'arrête au bout de quelques minutes (quelques milliers d'e-mails) : si un envoi est coupé ou en partie en échec, le lien **Reprendre l'envoi des e-mails** apparaît et ne sert que ceux qui ne l'ont pas encore reçu (`broadcast_deliveries`). La même annonce ne peut pas repartir deux fois dans les dix minutes.
  - Garder **« Confirm email » activé** dans Supabase : seules les adresses confirmées reçoivent les annonces, sinon n'importe qui pourrait abonner l'adresse d'un autre.
  - Notifications : l'annonce est enregistrée dans `broadcasts` avec `push_status = 'en_attente'` et la fonction `push` est réveillée ; c'est elle qui les envoie.

### Coût Claude (indicatif)

`supabase/migrations/20261029100000_couts_claude.sql` (SQL Editor) ajoute les jetons consommés par jour, par compte et au total, et `supabase/functions/chat/index.ts` doit être redéployée pour les enregistrer. Le coût n'est mesuré qu'à partir de ce redéploiement. Il est calculé avec les prix de `app_config` en dollars par million de jetons (`price_input_mtok`, `price_output_mtok`, `price_cache_read_mtok`, `price_cache_write_mtok`, réglés pour Claude Haiku 5.5) : les changer si le modèle ou les tarifs changent, tout est recalculé. Les réponses servies depuis le cache ne coûtent rien et ne comptent pas. La facture qui fait foi reste celle de la console Claude.

`supabase/migrations/20261029110000_comptes_admin.sql` (SQL Editor) ajoute la liaison et la suppression de comptes.
