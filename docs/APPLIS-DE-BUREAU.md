# Applis de bureau (Windows, Mac, Linux)

Michel sur l'ordinateur est un vrai logiciel construit avec [Tauri](https://tauri.app) (dossier `bureau/`) :
un cœur natif en Rust qui **embarque** les écrans de Michel (l'export web d'`app/`, le même code que
michel.beer/chat). Rien n'est chargé depuis le site au démarrage.

## Ce que fait la coquille native (`bureau/src-tauri/src/lib.rs`)

- Icône dans la barre des menus (Mac) ou la zone de notification (Windows, Linux) : « Parler à Michel », « michel.beer », « Quitter Michel ».
- Raccourci global **Ctrl+Maj+M** (Cmd+Maj+M sur Mac) : Michel apparaît, ou se range.
- Fermer la fenêtre range Michel dans la barre ; une seule appli ouverte à la fois ; taille et position gardées.
- Notification du système quand Michel répond et que la fenêtre n'est pas au premier plan.
- Liens `michelia://` : retour des connexions Google / Facebook (ouvertes dans le navigateur).
- Tout lien vers l'extérieur s'ouvre dans le navigateur. Le comptoir et la cotisation (carte bancaire, 3D Secure) se font sur michel.beer.
- Une fois par jour, regarde s'il existe une sortie `bureau-vX.Y.Z` plus récente et propose de la télécharger.

Côté écrans, `app/src/bureau.ts` détecte l'appli de bureau ; le captcha Turnstile tourne dans un cadre
de michel.beer/captcha (autorisé pour les origines Tauri dans `app/public/_headers`). Pas de Google Analytics
ni de push web dans l'appli de bureau.

## Construire et publier

GitHub > Actions > **Applis de bureau** > Run workflow, avec le numéro de version (`1.0.0`).

- « publier » décoché : installeurs à récupérer dans les fichiers de la tâche, pour essayer.
- « publier » coché : sortie GitHub `bureau-vX.Y.Z` avec `MichelIA-Windows.exe`/`.msi`, `MichelIA-Mac.dmg`
  (universel Intel + Apple Silicon), `MichelIA-Linux.AppImage`/`.deb`/`.rpm`. Notes facultatives : `bureau/notes/X.Y.Z.md`.

Les liens `michel.beer/telecharger/windows|mac|linux` (`app/public/_redirects`) mènent toujours à la dernière
sortie. La section « Sur le bureau » de l'accueil s'affiche quand `BUREAU_PUBLIE` vaut `true` dans
`app/scripts/accueil.mjs` : à passer après la première publication.

Les réglages publics (`EXPO_PUBLIC_*`) sont lus chez EAS (environnement production) avec `EXPO_TOKEN`.

## Signature Mac (à faire une fois, par Mathieu)

Jamais de certificat ni de mot de passe dans le chat ou le dépôt : uniquement dans les secrets GitHub
(Settings > Secrets and variables > Actions > New repository secret).

1. Trousseau d'accès, sur le Mac : certificat **Developer ID Application** > clic droit > Exporter > format `.p12`, avec un mot de passe.
2. Terminal : `base64 -i Certificats.p12 | pbcopy` (le contenu part dans le presse-papiers).
3. Secret `MAC_CERTIFICAT_P12` : coller. Secret `MAC_CERTIFICAT_MOT_DE_PASSE` : le mot de passe de l'export.
4. Supprimer le fichier `.p12` exporté.

La notarisation Apple utilise la clé App Store Connect déjà posée (`ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8`).
Sans certificat, le Mac est construit sans signature pour les essais, et la publication est refusée.

Windows n'est pas signé : SmartScreen affiche « Windows a protégé votre ordinateur » au premier lancement
(« Informations complémentaires » > « Exécuter quand même »), expliqué sur l'accueil.

## Développer

```sh
cd bureau && npm ci
npm run ecrans      # exporte les écrans d'app/ dans bureau/ecrans
npx tauri dev       # ou : npx tauri build
```

Linux : `libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev libxdo-dev`.
