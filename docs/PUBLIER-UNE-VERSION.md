# Publier une version des applis

Le site se met à jour tout seul à chaque fusion (Cloudflare Pages), page [michel.beer/confit-de-canard](https://michel.beer/confit-de-canard) comprise. Les applis, elles, demandent un nouveau build : pas d'`expo-updates`, chaque correctif d'appli passe par EAS puis par les stores.

## 1. Préparer les notes (Claude ou à la main)

Depuis `app/`, avec le numéro du **prochain** build (le dernier sur expo.dev + 1, le profil `production` s'incrémente tout seul) :

```sh
npm run notes-stores -- 8 1.0.1 --essai   # pour voir
npm run notes-stores -- 8 1.0.1           # pour de vrai
```

Le second nombre est la **version visible dans les stores** : EAS n'incrémente que le numéro de build, et Apple refuse une nouvelle version 1.0.1 construite avec un binaire resté en 1.0.0. Le script l'inscrit dans `expo.version` de `app/app.json`. À donner pour toute sortie publique après la 1.0 ; on peut l'omettre pour un simple build de test.

Le script prend les [nouveautés](../app/nouveautes/LISEZMOI.md) qui touchent iOS ou Android et pas encore livrées, puis :

- inscrit la version dans `app/app.json` ;
- écrit `app/nouveautes/builds/8.md` : contenu du build, notes App Store (4 000 car. max), notes Google Play (500 car. max, déjà dans les balises `<fr-FR>`), checklist ;
- inscrit `build: 8` dans chaque nouveauté concernée (la page publique affiche alors « Dans les applis depuis le build 8 »).

Relire les notes, retoucher si besoin, puis PR et fusion.

## 2. Construire et envoyer (sur le Mac)

```sh
cd app
git pull
npx eas-cli build --platform all --profile production --auto-submit
```

Ou sans le Mac : **GitHub > Actions > « Publier les applis » > Run workflow** (choisir la plateforme et, pour Android, la piste). La tâche lance le build EAS et l'envoie aux deux stores toute seule. Elle a besoin des secrets du dépôt listés plus bas.

Ne pas utiliser `eas submit --latest` : il peut prendre un build `preview`.

Vérifier sur expo.dev que les deux builds portent bien le numéro prévu. Sinon, renommer `builds/<n>.md` et corriger les `build:` des nouveautés.

## 3. Coller les notes et soumettre

Les notes peuvent partir toutes seules : **GitHub > Actions > « Fiches des stores »**, avec le numéro de build (essai d'abord, puis « appliquer »). La même tâche remet aussi à jour les textes des fiches (`app/store/fiche.json`) et les images Google. Il reste à choisir le build et à l'envoyer en vérification dans chaque console :

- **App Store Connect** > MichelIA > nouvelle version (+ en haut à gauche, le même numéro de version que celui passé au script, par ex. 1.0.1) > « Nouveautés de cette version » : coller les notes Apple. Choisir le build, puis « Ajouter pour vérification ».
- **Play Console** > MichelIA > Tests ou Production > Créer une version > choisir le build envoyé par EAS > « Notes de version » : coller le bloc Google, balises `<fr-FR>` comprises.

Cocher la checklist du fichier `builds/<n>.md` au fil de l'eau.

## Secrets GitHub des tâches automatiques

À ranger dans **GitHub > Settings > Secrets and variables > Actions** (jamais dans le dépôt ni dans le chat) :

- `EXPO_TOKEN` : expo.dev > Account settings > Access tokens.
- `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8` : App Store Connect > Utilisateurs et accès > Intégrations > Clés d'API (rôle Admin ou App Manager). `ASC_KEY_P8` = le contenu complet du fichier `.p8`.
- `PLAY_SERVICE_ACCOUNT_JSON` : le fichier JSON d'un compte de service Google Cloud invité dans la Play Console (droits « Gérer les versions » et « Gérer les produits intégrés »).
- `REVENUECAT_API_KEY` : RevenueCat > Project settings > API keys > clé secrète v2 (`sk_…`), droits lecture/écriture sur les produits.

La tâche **« Fiches des stores »** (`app/scripts/fiches.mjs`) met en ligne les textes de `app/store/fiche.json`, les images Google et les notes d'un build.

La tâche **« Boutiques »** crée ou met à jour les produits du comptoir chez Apple, Google et RevenueCat (`app/scripts/boutiques.mjs`). La lancer d'abord sans cocher « appliquer » : elle affiche seulement ce qu'elle ferait.

## Rappels

- Ce qui se règle dans `app_config` (prompt, quotas, modèle) ou dans les fonctions Edge ne demande **pas** de build : c'est en ligne dès que c'est collé ou redéployé dans Supabase. Ces nouveautés portent `sans_build: oui` : la page les annonce tout de suite dans les applis, et elles figurent quand même dans les notes du build suivant, pour que les stores en parlent.
- Jamais de clé ni de prompt dans ces fichiers : le dépôt est public.
