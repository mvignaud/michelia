# Nouveautés de Michel

Chaque évolution visible par les gens ajoute **un fichier** ici, dans la même PR que le code. Ces fichiers font la page publique [michel.beer/confit-de-canard](https://michel.beer/confit-de-canard) (générée par `npm run build:web`) et les notes des stores (`npm run notes-stores -- <build>`).

Un fichier par évolution, jamais un gros fichier commun : les PR menées en parallèle ne se marchent pas dessus.

## Nom du fichier

`AAAA-MM-JJ-sujet-court.md`, à la date de la fusion prévue. Exemple : `2026-10-30-meteo.md`.

## Contenu

```markdown
---
date: 2026-10-30
titre: Michel connaît la météo
type: nouveau
plateformes: web, ios, android
pr: 35
store: Michel te dit le temps qu'il va faire
---
Avant je regardais le ciel au-dessus de Lectoure, maintenant je sais le temps qu'il fait partout. Demande-moi, con.
```

| Clé | Obligatoire | Valeurs |
| --- | --- | --- |
| `date` | oui | `AAAA-MM-JJ` |
| `titre` | oui | Titre court, dans la bouche de Michel ou neutre |
| `type` | oui | `nouveau`, `mieux` ou `corrige` |
| `plateformes` | oui | `web`, `ios`, `android` (séparées par des virgules). Une évolution de la fonction `chat` ou de la base profite à tout le monde : mettre les trois |
| `pr` | non | Numéro(s) de PR, à ajouter une fois la PR ouverte. Sert aussi à l'ordre des entrées d'un même jour |
| `store` | non | La ligne pour les notes des stores, à toi (tutoiement), 80 caractères au plus. Par défaut : le titre |
| `sans_build` | non | `oui` quand ça marche dans les applis sans nouveau build (fonction Edge, `app_config`, base). La page dit alors tout de suite « dans les applis » ; la ligne ira quand même dans les notes du prochain build |
| `build` | **non, jamais à la main** | Ajouté par `npm run notes-stores` quand l'évolution part dans un build |

Le texte sous l'en-tête, c'est **Michel qui parle** : il tutoie, il râle un peu, 100 % Sud-Ouest (aucun mot marseillais), le « con » de ponctuation est permis, jamais de jus de fruit, et pour la bière seulement la Burosse, avec modération. Deux ou trois phrases suffisent. Markdown permis : paragraphes, listes `- `, `**gras**`, `*italique*`, `[lien](https://…)`.

Pas d'entrée pour ce qui ne se voit pas (réglages EAS, fiches des stores, back-office, refactorisation).

## Vérifier

```sh
cd app
npm run nouveautes:verifier
```

Une entrée mal formée fait échouer le build du site : l'erreur dit quel fichier et quelle clé.
