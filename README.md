# michelia
IA 100% Open-Source Made In Gers

MichelIA, c'est Michel : un vieux Gersois coincé dans un ordinateur, qui râle beaucoup, a un avis sur tout et répond quand même à tes questions. Le personnage est joué par Claude (Anthropic).

## Contenu du dépôt

| Dossier | Rôle |
| --- | --- |
| `app/` | L'appli Expo (React Native) : site web, iOS et Android depuis le même code |
| `supabase/migrations/` | Base de données : configuration et quota de messages par jour |
| `supabase/functions/chat/` | Fonction serveur : vérifie le quota, appelle Claude, renvoie la réponse en flux |
| `app/nouveautes/` | Les nouveautés de Michel, une par fichier : page [michel.beer/confit-de-canard](https://michel.beer/confit-de-canard) et notes des stores ([mode d'emploi](app/nouveautes/LISEZMOI.md)) |
| `docs/MISE-EN-LIGNE.md` | Guide pas à pas pour publier la version web |
| `docs/PUBLIER-UNE-VERSION.md` | Préparer les notes des stores et sortir un nouveau build des applis |

## Principes

- **Aucune clé secrète dans le dépôt.** La clé Anthropic vit dans les secrets Supabase ; l'appli ne contient que l'URL et la clé publique Supabase.
- **Le prompt de Michel n'est pas versionné** : il est stocké dans la table `app_config` et se modifie sans redéployer.
- **Quota quotidien** par visiteur (compte anonyme Supabase), réglable dans `app_config`.
- **Transparence** : l'appli dit clairement que Michel est une IA.

## Développer

```bash
cd app
cp .env.example .env
npm install
npm run web        # ou : npx expo start pour iOS / Android
npm run typecheck
```

## Licence

GPL-3.0, voir `LICENSE`.
