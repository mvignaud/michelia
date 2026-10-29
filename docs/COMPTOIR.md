# Le comptoir de Michel

Pourboires sur le web (michel.beer/comptoir), avec **Stripe Elements** (session Checkout en `ui_mode: elements`) : notre propre formulaire aux couleurs de Michel, seuls les champs de carte viennent de Stripe, sans redirection. Le code web est dans des fichiers `.web.tsx`.

Dans les applis iOS et Android, **jamais Stripe** (règle Apple 3.1.1) : achat intégré Apple / Google, géré par **RevenueCat** (`react-native-purchases`, fichier `app/src/Comptoir.tsx`, lien « Le comptoir » en bas du chat). Voir « Applis » plus bas. Les deux alimentent la même table `pourboires` (colonne `canal` : `web`, `ios`, `android`), donc la même note du mois et le même carnet.

## Mise en route

1. **SQL** : lancer `supabase/migrations/20261029140000_comptoir.sql` puis `20261029150000_comptoir_integre.sql` (rejouables). Ils créent la table `pourboires` et les réglages `comptoir_actif` (`'false'`), `comptoir_paliers`, `usd_eur`, `stripe_cle_publique` (`''`) et `stripe_tax` (`'false'`).
2. **Fonctions** : déployer `comptoir-paiement` (crée la session de paiement) et `stripe-webhook` (enregistre le pourboire). `verify_jwt = false` est déjà dans `supabase/config.toml`. Plus aucun Payment Link à créer.
3. **Supabase > Edge Functions > Secrets** :
   - `STRIPE_SECRET_KEY` : de préférence une clé restreinte `rk_live_…` (Stripe > Développeurs > Clés API > clé restreinte) avec la seule permission « Checkout Sessions : écriture ».
   - `STRIPE_WEBHOOK_SECRET` : le secret de signature `whsec_…` de l'étape 4.
   - Rien de tout ça dans le dépôt. `ALLOWED_ORIGINS` et `SITE_URL` sont déjà utilisés par les autres fonctions (`https://michel.beer`).
4. **Stripe > Développeurs > Webhooks** : endpoint `https://nuulykhqaeecqerfwdsn.supabase.co/functions/v1/stripe-webhook`, événements `checkout.session.completed` et `checkout.session.async_payment_succeeded` (le second pour les paiements différés, comme le prélèvement SEPA).
5. **Clé publiable** (`pk_live_…`, publique par nature) dans `app_config` :
   ```sql
   update public.app_config set value = 'pk_live_…' where key = 'stripe_cle_publique';
   ```
6. **Apple Pay / Google Pay** : Stripe > Paramètres > Moyens de paiement > Domaines des moyens de paiement, enregistrer `michel.beer`.
7. **Stripe Tax (facultatif)** : activer Stripe Tax et l'inscription TVA France dans Stripe avant de passer `stripe_tax` à `'true'` (`update public.app_config set value = 'true' where key = 'stripe_tax';`). Les prix des paliers sont alors traités comme TTC.
8. **Ouvrir** : `update public.app_config set value = 'true' where key = 'comptoir_actif';` (remettre `'false'` pour fermer : la page affiche « le comptoir ouvre bientôt » et le rappel dans le chat disparaît). Le comptoir reste fermé tant que `stripe_cle_publique` est vide.

Les noms et prix des paliers se changent dans `comptoir_paliers` (le prix est lu côté serveur, jamais envoyé par le navigateur).

## Applis (achat intégré)

1. **SQL** : lancer `supabase/migrations/20261029170000_comptoir_applis.sql` (rejouable) dans le SQL Editor.
2. **App Store Connect** > MichelIA > Monétisation > Achats intégrés : créer 4 achats **consommables**, identifiants `pourboire_cafe`, `pourboire_croustade`, `pourboire_garbure`, `pourboire_fete`, aux prix 1,99 / 2,99 / 4,99 / 9,99 € (France), nom et description en français, capture d'écran de l'écran du comptoir pour la revue. Signer le contrat « Applis payantes » (Accords, taxes et banque) si ce n'est pas fait, et s'inscrire au **Small Business Program** (commission 15 %).
3. **Google Play Console** > MichelIA > Monétiser > Produits intégrés : les 4 mêmes identifiants, produits ponctuels, mêmes prix. Il faut un compte marchand Google Payments (profil de paiement) relié à la console.
4. **RevenueCat** (gratuit jusqu'à 2 500 $/mois) : créer le projet MichelIA, ajouter l'appli iOS (identifiant `beer.michel.app`, clé In-App Purchase d'App Store Connect) et l'appli Android (`beer.michel.app`, compte de service Google), importer les 4 produits.
5. **Clés SDK publiques** (`appl_…` et `goog_…`, RevenueCat > Project settings > API keys), dans le SQL Editor :
   ```sql
   update public.app_config set value = 'appl_…' where key = 'revenuecat_cle_ios';
   update public.app_config set value = 'goog_…' where key = 'revenuecat_cle_android';
   ```
6. **Webhook** : déployer la fonction `revenuecat-webhook` (`verify_jwt = false` déjà dans `supabase/config.toml`). Inventer un long secret, le mettre dans **Supabase > Edge Functions > Secrets** sous `REVENUECAT_WEBHOOK_AUTH`, puis dans RevenueCat > Integrations > Webhooks : URL `https://nuulykhqaeecqerfwdsn.supabase.co/functions/v1/revenuecat-webhook`, en-tête Authorization `Bearer <le secret>`.
7. **Build** : nouveau build des applis (le module d'achat intégré est du code natif).
8. **Tester** avec un compte sandbox Apple / un testeur de licence Google : passer `comptoir_sandbox` à `'true'` pour que ces achats de test soient enregistrés, puis le remettre à `'false'` et supprimer les lignes de test.
9. **Ouvrir** : `update public.app_config set value = 'true' where key = 'comptoir_appli_actif';` Le lien « Le comptoir » n'apparaît que si le comptoir des applis est ouvert et que la clé de la boutique est remplie. Le comptoir web reste réglé à part (`comptoir_actif`).

Le produit d'un palier s'appelle toujours `pourboire_<id du palier>`. Le prix affiché dans l'appli est celui de la boutique ; le montant enregistré est le prix payé TTC (avant la commission d'Apple ou de Google).

## Tester

Avec les clés de **test** (`sk_test_`/`rk_test_` dans le secret, `pk_test_` dans `stripe_cle_publique`, et un webhook de test avec son propre `whsec_`), payer avec la carte `4242 4242 4242 4242` (date future, CVC et code postal au choix). Vérifier le merci à l'écran et une ligne dans `pourboires`. Repasser ensuite aux clés live. Pour voir le merci sans payer : `michel.beer/comptoir?merci=cafe`.

## Côté Michel

- Le rappel « Payer un café à Michel » apparaît dans le chat web, aux membres connectés, après le 20e message du mois, au plus une fois par semaine.
- Back-office > Tableau de bord : « Coût par utilisateur actif (30 j) » et « Pourboires du mois ».
- La jauge « la note du mois » compare le coût Claude du mois (converti avec `usd_eur`, à ajuster) aux pourboires reçus.
