# Le comptoir de Michel

Pourboires sur le web (michel.beer/comptoir), avec **Stripe Elements** ou **Stancer** (voir « Web avec Stancer ») (session Checkout en `ui_mode: elements`) : notre propre formulaire aux couleurs de Michel, seuls les champs de carte viennent de Stripe, sans redirection. Le code web est dans des fichiers `.web.tsx`.

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

## Web avec Stancer (prestataire français)

Le web peut passer de Stripe à **Stancer** (réglage `comptoir_prestataire` : `'stripe'` par défaut, ou `'stancer'`). Même page, mêmes paliers : notre formulaire (palier, e-mail, prénom) puis, au bouton « Passer à la caisse », les champs de carte Stancer dans une iframe (`https://payment.stancer.com/…`). Carte seule pour les pourboires ; le prélèvement SEPA est réservé au futur abonnement MichelIA+.

Comment ça tourne : `comptoir-paiement` crée un payment intent Stancer au prix du palier (lu côté serveur) et range palier, prénom et e-mail dans `comptoir_attente`. La page attend le message de fin de l'iframe et, en plus, redemande toutes les 4 secondes `{confirmer: pi_…}` : la fonction relit le paiement chez Stancer, le capture s'il est seulement autorisé, vérifie le montant et écrit la ligne `pourboires` (`paiement_id`, `prestataire = 'stancer'`, `email`). `stancer-webhook` fait la même chose quand Stancer prévient, au cas où le visiteur ferme l'onglet. Code commun : `supabase/functions/_shared/stancer.ts`.

1. **SQL** : lancer `supabase/migrations/20261030000000_comptoir_stancer.sql` (rejouable) dans le SQL Editor.
2. **Fonctions** : déployer `comptoir-paiement` et `stancer-webhook` (`verify_jwt = false` déjà dans `supabase/config.toml`).
3. **Secrets** (Supabase > Edge Functions > Secrets) : `STANCER_API_KEY`, la clé secrète `stest_…` pour les essais, `sprod_…` ensuite. Rien dans le dépôt ni dans le chat.
4. **Essai sans argent réel** : `update public.app_config set value = 'stancer' where key = 'comptoir_prestataire';` puis `update public.app_config set value = 'true' where key = 'comptoir_essai';`. La page `michel.beer/comptoir?essai=1` s'ouvre alors même comptoir fermé ; seuls les paiements faits avec une clé `stest_` passent, marqués `essai` (exclus de la note du mois et du carnet). Carte de test `4242 4242 4242 4242`, date future, CVC au choix ; `4000 0000 0000 3220` pour voir un refus 3D Secure. Ensuite : `comptoir_essai` à `'false'` et `delete from public.pourboires where essai;`.
5. **Webhook** : Stancer n'a pas de rubrique Webhooks dans son espace client. Lancer `supabase/migrations/20261030010000_stancer_webhook.sql` ; au premier paiement de chaque mode (test, puis réel), `comptoir-paiement` enregistre tout seul l'adresse `https://nuulykhqaeecqerfwdsn.supabase.co/functions/v1/stancer-webhook` par l'API (`POST /v2/webhooks/`) et range le secret de signature dans la table `stancer_webhook` (service_role seulement). Rien à copier. Pour recommencer : supprimer la ligne du mode dans cette table. Sans webhook, la confirmation par la page suffit tant que le visiteur reste jusqu'au merci.
6. **Passer en réel** : clé `sprod_…` dans `STANCER_API_KEY`, puis `comptoir_actif` à `'true'` comme pour Stripe. Pour revenir à Stripe : `comptoir_prestataire` à `'stripe'`.

**Client et commande dans l'espace Stancer** : à la création du payment intent, `comptoir-paiement` crée (ou retrouve, réponse 409) le client Stancer (`POST /v1/customers/` : e-mail, prénom et nom du compte Michel ou à défaut le prénom saisi, `external_id` = id Supabase) et passe le numéro de reçu (`prochain_numero_recu()`, série de la facturation E-KO, PR #79) en `order_id`, rangé aussi dans `comptoir_attente.numero_recu` puis `pourboires.numero_recu`. Les deux sont facultatifs : si Stancer les refuse, ou tant que la migration de la facturation n'est pas collée, le paiement part sans. La localisation affichée par Stancer n'est pas réglable par l'API des payment intents.

### Formulaire de carte maison (« full API »)

Depuis le 30/10/2026, la carte se saisit dans notre propre formulaire (numéro, MM/AA, code au dos), aux couleurs de Michel. Le navigateur l'envoie à `comptoir-paiement` (`{payer: pi_…, carte}`), qui crée la carte chez Stancer (`POST /v2/cards/`), l'attache au payment intent (`PATCH /v2/payment_intents/…`) puis répond : payé, refusé, ou `authentification` avec l'adresse de la page 3D Secure de la banque, affichée en iframe. La confirmation se fait ensuite comme avant.

- **Jamais gardée** : la carte n'est écrite nulle part (ni table, ni journal ; les messages d'erreur de Stancer sont journalisés sans chiffres). La page vide le code au dos après chaque envoi et la carte entière au passage en 3D Secure.
- **Turnstile obligatoire en réel** : poser le secret `TURNSTILE_SECRET_KEY` (la clé secrète Turnstile, la même que dans Supabase > Authentication > Attack Protection) dans Supabase > Edge Functions > Secrets. Sans lui, avec une clé `sprod_`, toutes les cartes sont refusées.
- **Pas de mesure d'audience sur /comptoir** : Google Analytics ne démarre jamais sur cette page, et la page se recharge si on y arrive avec GA déjà lancé.
- **Anti-robots** : il faut une session Supabase (compte anonyme créé avec le captcha Turnstile) et chaque envoi compte un essai dans `comptoir_tentatives` : 5 par visiteur et 60 en tout par heure. Migration `20261030020000_comptoir_tentatives.sql`.
- **PCI DSS** : Stancer n'exige pas de certification sous 10 000 transactions, mais GOLDEN PRINT reste tenue aux règles PCI DSS : questionnaire d'auto-évaluation annuel (le SAQ D, puisque les cartes passent par notre serveur). Ne jamais ajouter de `console.log` du corps de la requête dans `comptoir-paiement`.

## Applis (achat intégré)

1. **SQL** : lancer `supabase/migrations/20261029170000_comptoir_applis.sql` (rejouable) dans le SQL Editor.
2. **App Store Connect** > MichelIA > Monétisation > Achats intégrés : créer 4 achats **consommables**, identifiants `pourboire_cafe2` (le premier `pourboire_cafe` a été supprimé ; le code accepte les deux), `pourboire_croustade`, `pourboire_garbure`, `pourboire_fete`, aux prix 1,99 / 2,99 / 4,99 / 9,99 € (France), nom et description en français, capture d'écran de l'écran du comptoir pour la revue. Signer le contrat « Applis payantes » (Accords, taxes et banque) si ce n'est pas fait, et s'inscrire au **Small Business Program** (commission 15 %).
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

Les étapes 2 à 4 (produits) peuvent se faire toutes seules : **GitHub > Actions > « Boutiques »**, d'abord en essai, puis en cochant « appliquer ». Les secrets nécessaires sont listés dans `docs/PUBLIER-UNE-VERSION.md`.

Le produit d'un palier s'appelle toujours `pourboire_<id du palier>`. Le prix affiché dans l'appli est celui de la boutique ; le montant enregistré est le prix payé TTC (avant la commission d'Apple ou de Google).

## Tester

Avec les clés de **test** (`sk_test_`/`rk_test_` dans le secret, `pk_test_` dans `stripe_cle_publique`, et un webhook de test avec son propre `whsec_`), payer avec la carte `4242 4242 4242 4242` (date future, CVC et code postal au choix). Vérifier le merci à l'écran et une ligne dans `pourboires`. Repasser ensuite aux clés live. Pour voir le merci sans payer : `michel.beer/comptoir?merci=cafe`.

## Côté Michel

- Le rappel « Payer un café à Michel » apparaît dans le chat web, aux membres connectés, après le 20e message du mois, au plus une fois par semaine.
- Back-office > Tableau de bord : « Coût par utilisateur actif (30 j) » et « Pourboires du mois ».
- La jauge « la note du mois » compare le coût Claude du mois (converti avec `usd_eur`, à ajuster) aux pourboires reçus.
