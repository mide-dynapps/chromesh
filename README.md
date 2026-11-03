# Chromesh

Extension Chrome / Edge (Manifest V3) qui rend lisible l'échéance de suppression
des builds **staging** sur Odoo.sh, en **jours ouvrés**.

## Le problème

Odoo.sh annonce la fin de vie d'un build staging par une phrase perdue dans
l'historique de la branche :

> This staging build will be deleted on 18 October 2026.

Trois défauts : la phrase n'existe que sur la page de la branche, la date est en
jours calendaires, et personne ne travaille le week-end. Une suppression annoncée
un lundi doit être traitée le vendredi précédent.

## Source de données

L'extension ne lit pas cette phrase. Elle interroge l'API interne d'Odoo.sh, qui
expose la date brute :

Toutes les routes répondent en **POST**, corps `{"jsonrpc": "2.0", "method":
"call", "params": {}}`, et s'authentifient par le **cookie de session**. Un GET
renvoie `400`. Relevé le 19/10/2026 ; rien de tout cela n'est documenté par
Odoo, donc tout peut changer sans préavis.

| Route | Contenu | Utilisée |
|---|---|---|
| `/app/projects` | `{hosting_user_id, repos: [{id, name, project_name, technical_name, owner, odoo_branch, project_url, url, subscription_validity, production_build_id}]}` | oui — point d'entrée, donne nom et slug de chaque projet |
| `/app/project/<project_name>/get_info` | `repos, active_repo, notifications, user, public, mappings, access_token, config, changelogs` | non — `active_repo.technical_name` donnait le slug, mais `/app/projects` le porte déjà |
| `/app/project/<slug>/branches` | `[{id, name, stage, slug, last_build_id, last_build_status, …}]` | oui — `stage` vaut `production`, `staging` ou `development` |
| `/app/branch/<id>/builds` | `[{branch_info, builds: [{…, expiration_date}]}]` | oui — c'est la source de la date |
| `/app/branch/<id>/history` | `{num_trackings, trackings: [{…, expiration_date}]}` | non — même donnée, par un autre chemin |

`expiration_date` vaut `"2026-10-18"` : jour de suppression, en ISO. Présent sur
chaque build et sur chaque tracking. Le wording de la phrase affichée par Odoo
peut changer sans rien casser, puisqu'elle n'est pas lue.

`get_info` est volontairement écarté : sa réponse contient un champ
`access_token`, qu'il n'y a aucune raison de faire transiter pour obtenir un
slug déjà connu.

Deux routes essayées qui n'existent pas, notées pour éviter de les retenter :
`/app/get_projects` renvoie `404`, `/web/dataset/call_kw` renvoie `500`.

Le cookie de session n'accompagne pas les requêtes du service worker : c'est
pourquoi la collecte se fait depuis le content script, dans le contexte de la
page.

`project_name` (`demo-v19`) sert dans les URL et les routes ; `technical_name`
(`acme-demo-v19-123456`) est le slug du dépôt attendu par `/branches`.
Le libellé `name` (`DEMO_V19`) ne résout nulle part.

Coût : une requête `/app/projects`, puis une `branches` par projet et une
`builds` par branche staging.

## Ce que fait l'extension

| Où | Quoi |
|---|---|
| Liste des branches (panneau gauche) | Pastille `J-3` / `AUJOURD'HUI` / `EXPIRÉ` sur chaque branche staging, verte, orange, rouge ou grise. Bouton `⊘` au survol : exclure la branche ou tout le projet (`projet::*`) |
| En-tête du bloc Staging | Compteur des branches critiques et expirées |
| Page de la branche | Bandeau avec l'échéance réelle et un bouton `Rebuild` qui déclenche celui d'Odoo.sh |
| Liste des projets (`/project`) | Bandeau sur la carte en kanban, pastille dans la cellule du nom en vue liste, au niveau de la pire branche staging du projet |
| Phrase d'origine | Surlignée dans l'historique |
| Icône de la barre d'outils | Badge rouge = nombre de branches critiques ou expirées |
| Popup | Tableau de bord multi-projets, trié par urgence. Boutons `⊘ branche` / `⊘ projet` au survol d'une ligne |
| Notification système | Une par branche et par jour, pas avant l'heure configurée |

## Modèle de calcul

```
deletionDate  date annoncée par Odoo.sh
lastSafeDay   deletionDate - 1 jour, ramené au jour ouvré précédent
workdaysLeft  jours ouvrés dans l'intervalle (aujourd'hui, lastSafeDay]
                0  -> dernier jour utile, c'est aujourd'hui
               < 0 -> trop tard
```

Week-ends toujours exclus. Jours fériés FR, BE ou LU au choix (Pâques calculée,
pas d'appel réseau). Quand l'échéance a été reculée par un week-end ou un férié,
le message le dit explicitement.

Exemple réel, suppression annoncée le dimanche 18/10/2026 :

| Jour | Affichage |
|---|---|
| mar. 13/10 | `J-3` orange |
| jeu. 15/10 | `J-1` rouge |
| ven. 16/10 | `AUJOURD'HUI` rouge |
| sam. 17/10 | `EXPIRÉ` |

## Installation

À partir du ZIP distribué :

1. Décompresser l'archive dans un dossier **permanent** — l'extension est
   rechargée depuis ce dossier à chaque démarrage du navigateur ; le supprimer
   la désinstalle.
2. `edge://extensions` (ou `chrome://extensions`), activer le mode développeur.
3. « Charger l'extension non empaquetée » → sélectionner le dossier décompressé,
   celui qui contient `manifest.json`.
4. Ouvrir un projet sur `https://www.odoo.sh/project/...`.

Un `.zip` ne s'installe pas par glisser-déposer : le mode développeur attend un
dossier. Le navigateur affichera « Cette extension n'est pas répertoriée dans le
Microsoft Edge Add-ons Store » à chaque démarrage — c'est le régime normal d'une
extension non publiée, pas une erreur.

### Produire le ZIP

```powershell
.\package.ps1
```

Écrit `dist/chromesh-<version>.zip` à partir de `manifest.json`, `README.md`, `CHANGELOG.md`,
`src/` et `icons/`. La version vient du champ `version` du manifeste.

## Architecture

```
manifest.json
src/common/workdays.js   jours ouvrés, fériés, Pâques
src/common/api.js        client de l'API /app/ d'Odoo.sh
src/common/parse.js      repérage des branches dans le DOM, pour l'injection
src/common/urgency.js    date -> niveau d'urgence + libellés
src/common/settings.js   chrome.storage (sync = réglages, local = cache)
src/content/             injection dans les pages odoo.sh
src/background/          alarme horaire, badge, notifications
src/popup/ src/options/
```

Pas d'étape de build : scripts classiques partageant le namespace global
`CHROMESH`, importés par `importScripts` côté service worker.

## Contraintes assumées

- **Collecte en deux voies.** Le service worker tente l'API directement ; si le
  cookie de session n'accompagne pas la requête (`SameSite`), il délègue à un
  onglet odoo.sh ouvert via `chrome.tabs.sendMessage`. Sans onglet ouvert, le
  popup affiche « données figées » plutôt que de mentir.
- **Le DOM n'est plus sur le chemin critique.** Il sert uniquement à savoir où
  accrocher les pastilles. Un changement de markup fait disparaître l'affichage,
  pas la donnée.
- Les préfixes CSS et DOM sont `csh-`, pour cohabiter avec Odoo Toolbox.

## Non vérifié

- Les notifications système : le chemin est écrit mais n'a pas été déclenché.
- La collecte directe depuis le service worker : probablement bloquée par
  `SameSite`. Le repli par onglet est écrit mais pas éprouvé.

## Testé

Dans Edge, le 19/10/2026, sur le projet `demo-v19` : chargement sans erreur,
pastilles sur les branches staging, bandeau `Rebuild`, popup rempli.

Hors navigateur, avec un faux réseau calqué sur les payloads relevés :

- `workdays` : Pâques 2026 au 5 avril, Ascension au 14 mai, lundi de Pentecôte
  au 25 mai.
- `urgency.evaluate` : les trois scénarios de recul week-end / férié du tableau
  ci-dessus.
- `api.collectProject` : filtre les branches staging, retient le build désigné
  par `last_build_id` et non le dernier de la liste, remonte
  `expiration_date=2026-10-18`, et tient en 5 requêtes pour un projet à deux
  branches staging.
- `api.findSlug` : accepte une chaîne, un objet imbriqué, refuse `demo-v19`.
