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
