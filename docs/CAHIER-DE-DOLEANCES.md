# Le cahier de doléances et « Ça mijote »

Deux pages publiques, reliées en bas de l'écran du site et des applis :

| Page | Adresse | Adresses sérieuses | Source |
| --- | --- | --- | --- |
| Le cahier de doléances (« Améliore Michel ») | [michel.beer/cahier-de-doleances](https://michel.beer/cahier-de-doleances) | `/idees`, `/ameliore-michel` | `app/src/Doleances.tsx` + table `doleances` |
| Ça mijote (la feuille de route) | [michel.beer/ca-mijote](https://michel.beer/ca-mijote) | `/roadmap` | `app/ca-mijote.md`, générée par `npm run build:web` |

## Le cahier de doléances

- Page web seulement (les applis l'ouvrent dans le navigateur, rien de natif à builder).
- Le visiteur reçoit le même compte anonyme que pour le chat, derrière le captcha Turnstile. Le dépôt passe par la fonction `deposer_doleance(texte, categorie, contact)` (migration `20261029180000_doleances.sql`), qui refuse ce qui est trop court ou trop long, les doublons, et applique les quotas de `app_config` : `doleances_par_jour` (3 par visiteur et par 24 h) et `doleances_global_jour` (200 pour tout le monde par 24 h).
- Personne ne peut lire la table depuis l'appli, sauf les comptes de `admins`. Les doléances de plus de deux ans sont effacées au passage.
- Catégories : `idee`, `bug`, `autre`. Statuts : `nouvelle` → `retenue` (mise dans Ça mijote) → `servie` (sortie, entrée dans `app/nouveautes/`), ou `refusee` / `doublon`. Colonne `note` pour un mot interne.

## Le tri : un relevé chaque matin dans le projet

Une tâche planifiée de Claude se réveille chaque matin dans le chat du projet MICHEL IA, lit les doléances des dernières 24 heures (lecture seule par le connecteur Supabase) et y poste un relevé : les nouvelles demandes regroupées, les doublons, et pour chacune une proposition (à faire tout de suite, à mettre sur la planche, au frais, ou non). Mathieu répond dans le chat ; Claude met alors à jour `app/ca-mijote.md` dans une PR.

Requête du relevé :

```sql
select id, created_at at time zone 'Europe/Paris' as le, categorie, texte, contact is not null as a_contact
from public.doleances
where created_at > now() - interval '1 day'
order by created_at;
```

Changer un statut (à coller dans le SQL Editor de Supabase, jamais par le connecteur) :

```sql
update public.doleances set statut = 'retenue', note = 'Ça mijote : sur la planche' where id = 12;
```

## Ça mijote

`app/ca-mijote.md` : trois casseroles, dans cet ordre, « Au feu » (en cours), « Sur la planche » (prévu), « Au frais » (plus tard). Un plat par ligne, `- **Titre** : deux phrases de Michel`. Le mode d'emploi complet est en commentaire en haut du fichier. Rien d'interne : la page est publique.

Vérifier avant de pousser :

```sh
cd app
npm run nouveautes:verifier
```

Quand un plat est servi, on le retire de Ça mijote et son entrée va dans `app/nouveautes/` (carnet des nouveautés).
