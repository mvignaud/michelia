# Publier une version des applis

Le site se met à jour tout seul à chaque fusion (Cloudflare Pages), page [michel.beer/nouveautes](https://michel.beer/nouveautes) comprise. Les applis, elles, demandent un nouveau build : pas d'`expo-updates`, chaque correctif d'appli passe par EAS puis par les stores.

## 1. Préparer les notes (Claude ou à la main)

Depuis `app/`, avec le numéro du **prochain** build (le dernier sur expo.dev + 1, le profil `production` s'incrémente tout seul) :

```sh
npm run notes-stores -- 8 --essai   # pour voir
npm run notes-stores -- 8           # pour de vrai
```

Le script prend les [nouveautés](../app/nouveautes/LISEZMOI.md) qui touchent iOS ou Android et pas encore livrées, puis :

- écrit `app/nouveautes/builds/8.md` : contenu du build, notes App Store (4 000 car. max), notes Google Play (500 car. max, déjà dans les balises `<fr-FR>`), checklist ;
- inscrit `build: 8` dans chaque nouveauté concernée (la page publique affiche alors « Dans les applis depuis le build 8 »).

Relire les notes, retoucher si besoin, puis PR et fusion.

## 2. Construire et envoyer (sur le Mac)

```sh
cd app
git pull
npx eas-cli build --platform all --profile production --auto-submit
```

Ne pas utiliser `eas submit --latest` : il peut prendre un build `preview`.

Vérifier sur expo.dev que les deux builds portent bien le numéro prévu. Sinon, renommer `builds/<n>.md` et corriger les `build:` des nouveautés.

## 3. Coller les notes et soumettre

- **App Store Connect** > MichelIA > nouvelle version (+ en haut à gauche, numéro de version suivant, par ex. 1.0.1) > « Nouveautés de cette version » : coller les notes Apple. Choisir le build, puis « Ajouter pour vérification ».
- **Play Console** > MichelIA > Tests ou Production > Créer une version > choisir le build envoyé par EAS > « Notes de version » : coller le bloc Google, balises `<fr-FR>` comprises.

Cocher la checklist du fichier `builds/<n>.md` au fil de l'eau.

## Rappels

- Ce qui se règle dans `app_config` (prompt, quotas, modèle) ou dans les fonctions Edge ne demande **pas** de build : c'est en ligne dès que c'est collé ou redéployé dans Supabase. Ces nouveautés portent `sans_build: oui` : la page les annonce tout de suite dans les applis, et elles figurent quand même dans les notes du build suivant, pour que les stores en parlent.
- Jamais de clé ni de prompt dans ces fichiers : le dépôt est public.
