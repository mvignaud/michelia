# Le comptoir de Michel

Pourboires **sur le web uniquement** (michel.beer/comptoir), avec **Stripe Embedded Checkout** : le formulaire de paiement s'affiche dans la page, sans redirection vers Stripe. Rien dans les applis iOS et Android (règle Apple 3.1.1) : le code du comptoir est dans des fichiers `.web.tsx`, les applis n'en contiennent rien.

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

## Tester

Avec les clés de **test** (`sk_test_`/`rk_test_` dans le secret, `pk_test_` dans `stripe_cle_publique`, et un webhook de test avec son propre `whsec_`), payer avec la carte `4242 4242 4242 4242` (date future, CVC et code postal au choix). Vérifier le merci à l'écran et une ligne dans `pourboires`. Repasser ensuite aux clés live. Pour voir le merci sans payer : `michel.beer/comptoir?merci=cafe`.

## Côté Michel

- Le rappel « Payer un café à Michel » apparaît dans le chat web, aux membres connectés, après le 20e message du mois, au plus une fois par semaine.
- Back-office > Tableau de bord : « Coût par utilisateur actif (30 j) » et « Pourboires du mois ».
- La jauge « la note du mois » compare le coût Claude du mois (converti avec `usd_eur`, à ajuster) aux pourboires reçus.
