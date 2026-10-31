# Extension Chrome « Michel IA »

Michel dans le panneau latéral de Chrome (et des navigateurs Chromium : Edge, Brave, Opera). Code dans `extension/`, sans dépendance ni étape de construction.

## Ce qu'elle fait

- **Vraie interface de chat**, embarquée dans l'extension (pas un cadre du site) : réponses en flux, mise en forme légère, prénom retenu, dernière causette gardée sur l'ordinateur (`chrome.storage.local`), bouton « Nouvelle ».
- **Clic droit sur un texte** > « Demander à Michel » : ouvre le panneau avec le texte prêt à envoyer.
- **Compte** (bouton ⋯) : invité par défaut (compte anonyme, quota des visiteurs, comme le site) ; connexion par e-mail et mot de passe pour retrouver son quota de membre ou MichelIA+. Les autres moyens (Google, SMS, inscription, mot de passe oublié) renvoient vers michel.beer.

## Comment elle parle à Michel

Même protocole que l'appli (`app/src/chat.ts`), en appels HTTP directs (`extension/michel.js`) :

1. Réglages publics lus sur `https://michel.beer/appli.json` (adresse Supabase, clé publique, clé de site Turnstile), écrit à chaque déploiement du site par `app/scripts/appli-json.mjs` à partir des variables `EXPO_PUBLIC_*` de Cloudflare Pages. Rien à reconstruire si une clé publique change ; aucune clé dans le dépôt.
2. Captcha : la page `michel.beer/captcha` (celle des applis) s'affiche dans un petit cadre du panneau et renvoie son jeton par `postMessage`, uniquement vers une page `chrome-extension://`. `_headers` retire `frame-ancestors` sur cette seule page.
3. Session Supabase (`/auth/v1/signup` anonyme, `/auth/v1/token`) puis fonction `chat`. Pas de photo ni de mode thématique dans cette première version.

Permissions : `sidePanel`, `storage`, `contextMenus`, et accès à `michel.beer` et au projet Supabase seulement.

## Essayer sans le Web Store

1. GitHub > Actions > « Extension Chrome » > dernier run > *Artifacts* > `michel-extension-chrome` (ou prendre le dossier `extension/` du dépôt).
2. Dézipper, puis dans Chrome : `chrome://extensions` > « Mode développeur » > « Charger l'extension non empaquetée » > choisir le dossier.
3. Cliquer sur l'icône de Michel (épingler l'extension via la pièce de puzzle).

⚠ Il faut que le site ait été redéployé après la PR qui ajoute `appli.json`, sinon Michel « trouve pas le chemin du comptoir ».

## Publier sur le Chrome Web Store (à faire par Mathieu)

1. Compte développeur : https://chrome.google.com/webstore/devconsole (5 $ une fois), au nom de GOLDEN PRINT, avec l'e-mail de contact de Michel.
2. « Nouvel élément » > déposer le `.zip` du run « Extension Chrome ».
3. Fiche : nom « Michel IA », catégorie *Productivité*, langue français, icône 128 px (`extension/icones/icone-128.png`), au moins une capture 1280×800, politique de confidentialité `https://michel.beer/confidentialite`.
4. Onglet « Confidentialité » : objectif unique « discuter avec l'assistant Michel » ; justifier chaque permission (`sidePanel` : afficher le chat ; `storage` : garder la causette et la session ; `contextMenus` : « Demander à Michel » ; hôtes : parler au serveur de Michel) ; données collectées : contenu saisi par l'utilisateur, envoyé au serveur de Michel pour répondre ; pas de code distant.
5. Envoyer à l'examen (quelques jours en général).

Une fois l'identifiant de l'extension connu (donné par le Web Store) : restreindre `app/public/captcha.html` à `chrome-extension://<cet identifiant>` au lieu de toute page d'extension.

À chaque nouvelle version : augmenter `version` dans `extension/manifest.json`, fusionner, puis déposer le nouveau `.zip`.
