# Mettre MichelIA en ligne (version web)

Compter une heure la première fois. Aucune clé secrète ne va dans ce dépôt : elles vivent dans Supabase.

## 1. Supabase (comptes, quotas, fonction IA)

1. Créer un projet sur [supabase.com](https://supabase.com), région Europe (Paris ou Francfort).
2. **Authentication > Sign In / Providers** : activer **Anonymous sign-ins**. Chaque visiteur reçoit un compte invisible qui porte son quota du jour.
3. **SQL Editor** : coller et exécuter `supabase/migrations/20261029000000_init.sql`.
4. Toujours dans le SQL Editor, ajouter le prompt de Michel (il n'est pas dans le dépôt public) :

   ```sql
   insert into public.app_config (key, value) values ('system_prompt', $michel$
   ... coller ici le prompt, à partir de « Tu es Michel » ...
   $michel$)
   on conflict (key) do update set value = excluded.value, updated_at = now();
   ```

   Pour modifier Michel plus tard : relancer la même requête, ou éditer la ligne dans **Table Editor > app_config**. Effet immédiat, sans redéployer.

5. Réglages dans la même table : `daily_limit` (messages gratuits par jour, 30 par défaut), `model` (`claude-haiku-5-5`), `max_output_tokens` (1024).

## 2. Clé Anthropic

1. Sur [platform.claude.com](https://platform.claude.com) : créer une clé API, acheter du crédit et **fixer un plafond de dépense mensuel**.
2. Dans Supabase, **Edge Functions > Secrets** : ajouter `ANTHROPIC_API_KEY` avec la clé.
3. Ajouter aussi `ALLOWED_ORIGINS` = `https://michel.beer,http://localhost:8081` (sites autorisés à appeler Michel).

## 3. Déployer la fonction

Depuis un terminal, à la racine du dépôt :

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
   - Variables : `EXPO_PUBLIC_SUPABASE_URL` et `EXPO_PUBLIC_SUPABASE_ANON_KEY` (Supabase > Project Settings > API). Ces deux valeurs sont publiques par nature.
3. **Domaines personnalisés** : ajouter `michel.beer`. Cloudflare indique l'enregistrement DNS à créer chez le registraire (ou transférer la zone DNS chez Cloudflare, plus simple).

Chaque fusion sur `main` republie le site automatiquement.

## 5. Tester en local

```bash
cd app
cp .env.example .env   # remplir les deux valeurs
npm install
npm run web
```

## Avant d'ouvrir au public

- Activer le captcha Cloudflare Turnstile sur la connexion anonyme (Supabase > Authentication > Attack Protection) pour bloquer les robots.
- Vérifier le plafond de dépense Anthropic.
- Ajouter mentions légales et politique de confidentialité.
