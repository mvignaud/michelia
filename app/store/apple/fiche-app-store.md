# Fiche App Store : MichelIA

À copier dans App Store Connect > MichelIA > Distribution > App iOS Version 1.0 (langue : Français).

## Captures d'écran (dans ce dossier)

- **iPhone avec Dynamic Island (écran moyen)** (1206 × 2622) : `iphone-1-accueil.png`, `iphone-2-garbure.png`, `iphone-3-voisin.png`, `iphone-4-inflation.png`
- **iPhone Duo** (2007 × 2853, facultatif) : `duo-1-accueil.png` … `duo-4-inflation.png`
- **iPad 13 pouces** (2064 × 2752) : `ipad-1-accueil.png` … `ipad-4-inflation.png` (obligatoires, l'appli tourne aussi sur iPad)

Glisse-les dans « Aperçus d'app et captures d'écran » (les captures Apple restent à la main). L'en-tête est facultatif, on peut laisser vide.

## Textes

Les textes de la fiche sont dans [`app/store/fiche.json`](../fiche.json). Ils se mettent en ligne tout seuls avec **GitHub > Actions > « Fiches des stores »** : lancer d'abord en essai, puis cocher « appliquer ».

**Copyright** (à la main, champ de la version) : 2026 LEMBARRY, à passer à GOLDEN PRINT quand le compte Apple aura changé d'entité.

## Informations générales de l'app

- **Catégorie principale** : Divertissement. **Secondaire** : Productivité.
- **URL de politique de confidentialité** : https://michel.beer/confidentialite.html
- **Prix** : gratuit. **Disponibilité** : tous les pays (ou seulement la France pour commencer).

## Classification par âge

Réponses suggérées au questionnaire :
- Références à l'alcool, au tabac ou aux drogues : **Rare / léger** (Michel parle de bière « avec modération »)
- Humour grossier ou vulgaire : **Rare / léger**
- Contenu généré par les utilisateurs / chat avec une IA : **Oui** (messages vers une IA, pas entre utilisateurs)
- Accès web non restreint : **Non**
- Tout le reste : **Aucun**

Apple calcule 16+. Choisir « Remplacer par une classification d'âge plus élevée » : **18+**, car les conditions d'utilisation réservent MichelIA aux 18 ans et plus.

## Confidentialité de l'app (« étiquettes nutritionnelles »)

« Collectez-vous des données ? » : **Oui**. Rien n'est utilisé pour le suivi publicitaire (pas de Google Analytics dans l'appli).

| Donnée | Usage | Liée à l'identité | Suivi |
|---|---|---|---|
| Adresse e-mail | Fonctionnalité de l'app | Oui | Non |
| Numéro de téléphone | Fonctionnalité de l'app | Oui | Non |
| Nom (prénom donné à Michel) | Fonctionnalité de l'app | Oui | Non |
| Autre contenu utilisateur (messages) | Fonctionnalité de l'app | Oui | Non |
| Identifiant utilisateur | Fonctionnalité de l'app | Oui | Non |

## Notes pour l'équipe de vérification Apple

> MichelIA fonctionne sans compte : il suffit d'écrire une question en bas de l'écran. La connexion (Apple, Google, Facebook, e-mail, téléphone) sert seulement à retrouver ses conversations, et la suppression du compte se trouve dans Compte > Supprimer mon compte. Les réponses viennent d'un modèle d'IA (Anthropic Claude) qui joue un personnage humoristique du Sud-Ouest de la France.

Pas besoin de compte de démo.
