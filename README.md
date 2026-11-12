# Chromesh

Extension Chrome / Edge (Manifest V3) qui rend lisible l'échéance de suppression
des builds **staging** sur Odoo.sh, comptée en **jours ouvrés**.

- [Le problème](#le-problème)
- [Ce que fait l'extension](#ce-que-fait-lextension)
- [Modèle de calcul](#modèle-de-calcul)
- [Installation](#installation)
- [Réglages](#réglages)
- [Architecture](#architecture)
- [Source de données](#source-de-données)
- [Développement](#développement)
- [Limites connues](#limites-connues)

## Le problème

Odoo.sh annonce la fin de vie d'un build staging par une phrase perdue dans
l'historique de la branche :

> This staging build will be deleted on 18 October 2026.

Trois défauts : la phrase n'existe que sur la page de cette branche, la date est
en jours calendaires, et personne ne travaille le week-end. Une suppression
annoncée un lundi doit être traitée le vendredi précédent.

Chromesh ne lit pas cette phrase. Il interroge l'API interne d'Odoo.sh,
récupère la date brute et la recompte en jours ouvrés, puis l'affiche là où tu
travailles déjà.

## Ce que fait l'extension

| Où | Quoi |
|---|---|
| Liste des branches (panneau gauche) | Pastille `J-3` / `AUJOURD'HUI` / `EXPIRÉ` sur chaque branche staging. Bouton `⊘` au survol : exclure la branche ou tout le projet |
| En-tête du bloc Staging | Compteur des branches critiques et expirées |
| Page de la branche | Bandeau avec l'échéance réelle et un bouton `Rebuild` qui déclenche celui d'Odoo.sh |
| Liste des projets (`/project`) | La tuile (kanban) ou la ligne (liste) prend la couleur du niveau le plus urgent du projet, détail en infobulle. Barre de filtre : Tous / À surveiller / Critiques |
| Phrase d'origine | Surlignée dans l'historique |
| Icône de la barre d'outils | Badge rouge = nombre de branches critiques ou expirées |
| Popup | Tableau de bord multi-projets trié par urgence. Filtre par texte et par niveau. Boutons `⊘ branche` / `⊘ projet` |
| Notification système | Une par branche et par jour, pas avant l'heure configurée |
| Bases d'essai Odoo Online (option) | Échéance lue à l'ouverture de la base, affichée dans le popup sous `Odoo Online`, avec badge et notification |

## Modèle de calcul

```
deletionDate  date annoncée par Odoo.sh
lastSafeDay   deletionDate - 1 jour, ramené au jour ouvré précédent
workdaysLeft  jours ouvrés dans l'intervalle (aujourd'hui, lastSafeDay]
                0  -> dernier jour utile, c'est aujourd'hui
               < 0 -> trop tard
```

Week-ends toujours exclus. Jours fériés FR, BE ou LU au choix — Pâques est
calculée, aucun appel réseau. Quand l'échéance a été reculée par un week-end ou
un férié, le message le dit explicitement.

Exemple, suppression annoncée le dimanche 18/10/2026 :

| Jour | Affichage | Pourquoi |
|---|---|---|
| mar. 13/10 | `J-3` orange | trois jours ouvrés avant le dernier moment utile |
| jeu. 15/10 | `J-1` rouge | demain, dernière chance |
| ven. 16/10 | `AUJOURD'HUI` rouge | dernier jour ouvré avant la suppression du week-end |
| sam. 17/10 | `EXPIRÉ` gris | trop tard |

Au-delà de cinq jours ouvrés, la pastille est verte.

## Installation

L'extension n'est publiée sur aucun store : elle se charge depuis un dossier, en
mode développeur.

1. Télécharger le ZIP depuis la [page des releases](https://github.com/yale-dynapps/chromesh/releases)
   et le décompresser dans un dossier **permanent**. Le navigateur recharge
   l'extension depuis ce dossier à chaque démarrage ; le supprimer la
   désinstalle.
2. Ouvrir `edge://extensions` ou `chrome://extensions`, activer le mode
   développeur.
3. « Charger l'extension non empaquetée » → sélectionner le dossier décompressé,
   celui qui contient `manifest.json`. Ne pas entrer dans `src`.
4. Ouvrir un projet sur `https://www.odoo.sh/project/...`.

Un `.zip` ne s'installe pas par glisser-déposer : le mode développeur attend un
dossier. Le navigateur affichera « Désactiver les extensions en mode
développeur » à chaque démarrage — c'est le régime normal d'une extension non
publiée, pas une erreur.

**Mise à jour** : décompresser la nouvelle archive par-dessus le dossier
existant, puis cliquer ↻ sur la carte de l'extension. Réglages et exclusions
sont conservés.

## Réglages

Clic droit sur l'icône → Options.

| Réglage | Défaut | Effet |
|---|---|---|
| Jours fériés | France | FR, BE, LU ou aucun |
| Exclure les jours fériés | oui | Les samedis et dimanches le sont toujours |
| Critique (rouge) | 2 j ouvrés | Borné à 0–30 |
| Avertissement (orange) | 5 j ouvrés | Borné à 0–60, jamais sous le seuil critique |
| Notification système | oui | Une par branche et par jour |
| Pas avant | 9 h | Borné à 0–23 |
| Pastilles, bandeau, couleur des projets | oui | Trois réglages d'affichage indépendants |
| Balayer tous les projets | oui | À couper si le portefeuille est large |
| Rafraîchir toutes les | 6 h | Borné à 1–72 |
| Surveiller les bases d'essai Odoo Online | non | Voir « Odoo Online » plus bas. Demande l'accès à `*.odoo.com` à l'activation |
| Branches ignorées | vide | Une règle par ligne |

### Exclusions

Une seule liste, dans `chrome.storage.sync` :

| Règle | Effet |
|---|---|
| `projet::branche` | exclut cette branche |
| `projet::*` | exclut le projet entier, qui n'est même plus interrogé |
| `projet` | identique à `projet::*` |
| `Odoo Online::base` | exclut une base Odoo Online |

La casse est ignorée. Les boutons `⊘` de la page et du popup écrivent dans cette
même liste ; le retrait se fait depuis les options.

## Architecture

```
manifest.json
src/common/workdays.js   jours ouvrés, fériés, Pâques
src/common/urgency.js    date -> niveau d'urgence + libellés
src/common/settings.js   chrome.storage (sync = réglages, local = cache)
src/common/api.js        client de l'API /app/ d'Odoo.sh
src/common/parse.js      repérage des branches dans le DOM, pour l'injection
src/common/online.js     bases Odoo Online : critère SaaS, entrée de cache
src/content/             injection dans les pages odoo.sh ; online.js pour *.odoo.com
src/background/          alarme horaire, badge, notifications
src/popup/ src/options/
tests/                   tests de la logique pure, sous Node
```

Pas d'étape de build : ce sont des scripts classiques qui partagent le namespace
global `CHROMESH`, chargés par `importScripts` côté service worker et par des
balises `<script>` ailleurs. Chaque contexte ne charge que ce dont il se sert :
le worker se passe de `parse.js`, le popup de `parse.js`, `api.js` et
`online.js`, les options de tout sauf `settings.js` et `online.js`. Le script
`src/content/online.js` n'est pas déclaré dans `manifest.json` : le worker
l'inscrit par `chrome.scripting.registerContentScripts`, seulement quand
l'option Odoo Online est active.

### Décisions structurantes

- **Le DOM n'est pas sur le chemin critique.** La donnée vient de l'API ; le DOM
  sert seulement à savoir où accrocher les pastilles. Un changement de markup
  côté Odoo fait disparaître l'affichage, pas la donnée.
- **Collecte en deux voies.** Le service worker tente l'API directement ; si le
  cookie de session n'accompagne pas la requête (`SameSite`), il délègue à un
  onglet odoo.sh ouvert via `chrome.tabs.sendMessage`. Sans onglet, le popup
  affiche « données figées » plutôt que de mentir.
- **Un seul balayage à la fois.** Un jeton dans `chrome.storage.local`
  (`claimScan` / `releaseScan`) empêche deux onglets, ou un onglet et le worker,
  de balayer le portefeuille en parallèle. Le jeton est rendu en cas d'échec,
  pour ne pas bloquer la reprise.
- **Écritures sérialisées.** `chrome.storage` n'a pas de compare-and-swap :
  toutes les écritures de `settings.js` passent par une file, sans quoi deux
  collectes concurrentes se perdraient des branches.
- **Le cache suit les suppressions.** Chaque collecte purge du cache les
  branches que l'API ne renvoie plus, sinon elles basculeraient en « expiré »
  et pollueraient le badge indéfiniment.
- **Préfixe `csh-`** sur toutes les classes et tous les éléments injectés, pour
  cohabiter avec Odoo Toolbox. Le `MutationObserver` ignore ces nœuds, sans quoi
  l'injection se relancerait en boucle.

## Source de données

Toutes les routes répondent en **POST**, corps `{"jsonrpc": "2.0", "method":
"call", "params": {}}`, authentification par le **cookie de session**. Un GET
renvoie `400`. Relevé le 19/10/2026 ; rien n'est documenté par Odoo, donc tout
peut changer sans préavis.

| Route | Contenu | Utilisée |
|---|---|---|
| `/app/projects` | `{hosting_user_id, repos: [{id, name, project_name, technical_name, owner, …}]}` | oui — point d'entrée, donne nom et slug de chaque projet |
| `/app/project/<project_name>/get_info` | `repos, active_repo, notifications, user, access_token, …` | non — le slug est déjà dans `/app/projects`, et la réponse contient un `access_token` qu'il n'y a aucune raison de faire transiter |
| `/app/project/<slug>/branches` | `[{id, name, stage, slug, last_build_id, last_build_status, …}]` | oui — `stage` vaut `production`, `staging` ou `development` |
| `/app/branch/<id>/builds` | `[{branch_info, builds: [{…, expiration_date}]}]` | oui — source de la date |
| `/app/branch/<id>/history` | `{num_trackings, trackings: [{…, expiration_date}]}` | non — même donnée, autre chemin |

`expiration_date` vaut `"2026-10-18"` : jour de suppression, en ISO. Le wording
de la phrase affichée par Odoo peut changer sans rien casser, puisqu'elle n'est
pas lue.

Trois noms cohabitent et ne sont pas interchangeables : `project_name`
(`demo-v19`) sert dans les URL et les routes, `technical_name`
(`acme-demo-v19-123456`) est le slug du dépôt attendu par `/branches`, et le
libellé `name` (`DEMO_V19`) ne résout nulle part.

Coût d'un balayage : une requête `/app/projects`, puis une `branches` par projet
et une `builds` par branche staging.

Deux routes essayées qui n'existent pas, notées pour éviter de les retenter :
`/app/get_projects` renvoie `404`, `/web/dataset/call_kw` renvoie `500`.

## Odoo Online

Option désactivée par défaut. Une fois active, chaque base `*.odoo.com` ouverte
dans le navigateur passe ces contrôles, du moins coûteux au plus coûteux :

1. réglage actif (sinon le script n'est même pas injecté) ;
2. hôte `<base>.odoo.com`, hors `www.odoo.com`, `*.dev.odoo.com` et pages de
   connexion ;
3. pas de lecture de cet hôte depuis moins de `refreshHours` ;
4. `POST /web/session/get_session_info`, avec la session de l'utilisateur ;
5. instance Odoo Online : `db` égal au sous-domaine **et** clé
   `odoo_website_url` présente. Une production Odoo.sh servie sur
   `<projet>.odoo.com` échoue aux deux ;
6. `expiration_reason` vaut `trial` et `expiration_date` est présent (il ne
   l'est que pour un administrateur) ;
7. base absente des exclusions.

Une base qui passe tout est écrite en cache sous `Odoo Online::<base>`. Une base
Online qui ne passe plus l'étape 6 (abonnement souscrit) en sort.
`server_version` ne sert pas : Odoo Online 18.0 et Odoo.sh 18.0 renvoient tous
deux `18.0+e`. `expiration_date` arrive au format `YYYY-MM-DD HH:MM:SS` ; seul
le jour est gardé.

## Développement

```sh
node tests/run.js                              # logique pure, 91 assertions
for f in $(find src -name "*.js"); do node --check "$f"; done
```

Les tests couvrent `workdays`, `urgency`, `settings` et le filtre du popup, avec
un `chrome.storage` simulé en mémoire. Ils ne couvrent ni l'injection dans les
pages, ni le service worker, ni les notifications : **seul un chargement dans
Edge et Chrome les vérifie.**

Charger la version de travail : `edge://extensions` et `chrome://extensions`,
mode développeur, « Charger l'extension non empaquetée » sur la racine du dépôt.
Recharger avec ↻ après chaque modification.

### Produire le ZIP

```powershell
.\package.ps1
```

Écrit `dist/chromesh-<version>.zip` à partir de `manifest.json`, `README.md`,
`CHANGELOG.md`, `src/` et `icons/`. La version vient du manifeste. En pratique,
`.github/workflows/release.yml` s'en charge : tout push sur `main` qui modifie
`manifest.json` construit le ZIP, pose le tag et publie la release.

Le détail du flux de contribution est dans [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Limites connues

- **Les notifications système n'ont jamais été déclenchées en conditions
  réelles.** Le chemin est écrit et relu, pas éprouvé.
- **La collecte directe depuis le service worker est probablement bloquée** par
  `SameSite` sur le cookie de session. Le repli par onglet existe, il n'a pas
  été observé en fonctionnement.
- **Une requête `builds` par branche staging.** Le balayage d'un large
  portefeuille est proportionnellement long. `/app/project/<slug>/branches`
  porte peut-être déjà l'`expiration_date` ; non vérifié, cela supprimerait la
  boucle.
- **La file d'écriture ne protège qu'un contexte.** Entre le worker et un
  onglet, c'est le jeton de balayage qui sérialise les collectes ; une écriture
  isolée simultanée reste théoriquement possible.
- **Odoo Online : seules les bases déjà ouvertes sont connues.** Une base
  d'essai jamais ouverte depuis le navigateur n'apparaît pas. Une base servie
  sur un domaine propre au client n'est pas suivie.
- **Rien n'est publié sur les stores.** Distribution par ZIP, en mode
  développeur.
