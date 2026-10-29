# Applis iOS et Android

Les applis sont construites avec EAS (Expo Application Services) depuis le dossier `app/`, à partir du même code que le site.

## Ce qu'il faut une seule fois

1. **Comptes**
   - Un compte Expo (gratuit) sur expo.dev.
   - Un compte Apple Developer (99 $ par an).
   - Un compte Google Play Console (25 $ une fois).
2. **Projet EAS** : dans `app/`, lancer `npx eas-cli login`, puis `npx eas-cli init`. Cette commande ajoute l'identifiant du projet dans `app.json`.
3. **Variables EAS** : dans expo.dev > projet > Environment variables, pour les environnements `preview` et `production`, créer ces trois variables de type « Plain text ». Ce sont des valeurs publiques, les mêmes que sur Cloudflare Pages :
   - `EXPO_PUBLIC_SUPABASE_URL`
   - `EXPO_PUBLIC_SUPABASE_ANON_KEY`
   - `EXPO_PUBLIC_TURNSTILE_SITE_KEY`
4. **Supabase > Authentication > URL Configuration** : ajouter `michelia://auth` aux Redirect URLs. C'est l'adresse de retour de Google et Facebook dans l'appli.
5. **Connexion avec Apple**. Apple l'impose sur l'App Store dès qu'on propose Google ou Facebook.
   - Apple Developer > Identifiers : l'App ID `beer.michel.app`, avec « Sign in with Apple » coché. `eas build` peut le créer lui-même.
   - Supabase > Authentication > Providers > Apple : activer, puis mettre `beer.michel.app` dans « Client IDs ». Pour l'appli seule, ni clé ni secret ne sont nécessaires.

## Captcha dans les applis

L'appli ouvre `https://michel.beer/captcha` dans une petite vue web, et la page lui renvoie le jeton Turnstile. La vue reste invisible, sauf si Cloudflare demande une action. Aucun réglage n'est à faire : le domaine michel.beer est déjà déclaré dans le widget Turnstile.

## Construire et tester

```sh
cd app
npx eas-cli build --profile preview --platform android   # fichier .apk à installer sur un téléphone Android
npx eas-cli build --profile preview --platform ios       # iPhone déclarés dans le compte Apple
```

## Publier

```sh
npx eas-cli build --profile production --platform all
npx eas-cli submit --platform ios       # envoie vers App Store Connect / TestFlight
npx eas-cli submit --platform android   # envoie vers la Play Console
```

## À remplir dans les stores

- **Fiche** : nom MichelIA, sous-titre, description, captures d'écran, icône (déjà dans `app/assets`).
- **Confidentialité** : URL `https://michel.beer/confidentialite`. Données à déclarer :
  - e-mail, prénom, nom et âge, pour les comptes ;
  - contenu des messages, envoyé à l'IA et non lié à l'identité dans le cache ;
  - aucun pistage publicitaire.
- **Âge** : 18+, comme dans les conditions d'utilisation.
- **Suppression de compte** : possible dans l'appli (Compte > Supprimer mon compte), ce que les deux stores exigent.
- **Apple** : préciser dans les notes de revue que c'est une IA qui joue un personnage, et donner un compte de test.
