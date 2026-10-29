# Le comptoir de Michel

Pourboires **sur le web uniquement** (michel.beer/comptoir), par Stripe Payment Links. Rien dans les applis iOS et Android (règle Apple 3.1.1) : le code du comptoir est dans des fichiers `.web.tsx`, les applis n'en contiennent rien.

## Mise en route

1. **SQL** : lancer `supabase/migrations/20261029140000_comptoir.sql` (rejouable). Il crée la table `pourboires` et les réglages `comptoir_actif` (`'false'`), `comptoir_paliers` et `usd_eur`.
2. **Fonction** : déployer `stripe-webhook` (`supabase functions deploy stripe-webhook`). `verify_jwt = false` est déjà dans `supabase/config.toml`.
3. **Stripe > Payment Links**, un lien par palier, en euros, prix TTC :
   - Le café serré : 1,99 €, La croustade : 2,99 €, La garbure : 4,99 €, Le repas de fête : 9,99 €. Ces montants doivent être **exactement** ceux de `comptoir_paliers` : le webhook reconnaît le palier au montant.
   - Ajouter un **champ personnalisé** : type texte, facultatif, clé `prenom`, libellé « Ton prénom pour le carnet des copains (facultatif) ».
   - Après le paiement : « Ne pas afficher la page de confirmation », rediriger vers `https://michel.beer/comptoir?merci=<id>`, avec `<id>` = `cafe`, `croustade`, `garbure` ou `fete` selon le lien.
4. **Stripe > Développeurs > Webhooks** : ajouter l'endpoint `https://nuulykhqaeecqerfwdsn.supabase.co/functions/v1/stripe-webhook`, événement `checkout.session.completed`. Copier le « secret de signature » (`whsec_…`).
5. **Supabase > Edge Functions > Secrets** : ajouter `STRIPE_WEBHOOK_SECRET` avec ce secret. Ne jamais le mettre dans le dépôt.
6. **Renseigner les liens** dans `app_config` (SQL editor), en gardant le reste du JSON :
   ```sql
   update public.app_config
   set value = (
     select jsonb_agg(case p ->> 'id'
       when 'cafe' then jsonb_set(p, '{url}', '"https://buy.stripe.com/…"')
       when 'croustade' then jsonb_set(p, '{url}', '"https://buy.stripe.com/…"')
       when 'garbure' then jsonb_set(p, '{url}', '"https://buy.stripe.com/…"')
       when 'fete' then jsonb_set(p, '{url}', '"https://buy.stripe.com/…"')
     end)::text
     from jsonb_array_elements(value::jsonb) p
   )
   where key = 'comptoir_paliers';
   ```
   Un palier sans `url` reste caché sur la page.
7. **Ouvrir** : `update public.app_config set value = 'true' where key = 'comptoir_actif';` (remettre `'false'` pour fermer : la page affiche « le comptoir ouvre bientôt » et le rappel dans le chat disparaît).

## Tester

Passer Stripe en mode test, faire un paiement avec la carte `4242 4242 4242 4242`, puis vérifier une ligne dans `pourboires` et le merci à l'écran. Pour voir le merci sans payer : `michel.beer/comptoir?merci=cafe`.

## Côté Michel

- Le rappel « Payer un café à Michel » apparaît dans le chat web, aux membres connectés, après le 20e message du mois, au plus une fois par semaine.
- Back-office > Tableau de bord : « Coût par utilisateur actif (30 j) » et « Pourboires du mois ».
- La jauge « la note du mois » compare le coût Claude du mois (converti avec `usd_eur`, à ajuster) aux pourboires reçus.
