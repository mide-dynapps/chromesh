# État de la session — 19/10/2026

Reprise après redémarrage de Claude Code. Tout le code est écrit ; rien n'a
encore tourné dans un navigateur.

## Acquis (vérifiés par sondes console sur www.odoo.sh)

Odoo.sh est une SPA Owl. Les pages `/project/...` ne contiennent **aucune**
donnée en HTML : un `fetch` du même chemin renvoie le squelette. Tout passe par
une API interne, en **POST**, enveloppe JSON-RPC, `params: {}` :

| Route | Retour |
|---|---|
| `/app/projects` | `{hosting_user_id, repos: [...]}` — **relevé le 19/10** |
| `/app/project/<project_name>/get_info` | clés `repos, active_repo, notifications, user, public, mappings, access_token, config, changelogs` |
| `/app/project/<slug>/branches` | tableau : `id, name, stage, slug, last_build_id, last_build_status, …` |
| `/app/branch/<id>/builds` | `[{branch_info, builds: [...]}]` |
| `/app/branch/<id>/history` | `{num_trackings, trackings: [...]}` |

Le champ clé est **`expiration_date`**, présent sur chaque build et sur chaque
tracking, au format ISO : `"2026-10-18"`. C'est le jour de suppression du build.

Un GET sur ces routes renvoie `400`. `/app/get_projects` renvoie `404`,
`/web/dataset/call_kw` renvoie `500` : ces deux-là n'existent pas.

## Les deux inférences sont levées (19/10, sondes console)

**1. `/app/projects`** renvoie un objet, pas un tableau. Chaque entrée de
`repos` porte déjà tout le nécessaire :

```json
{"id": 123456, "name": "demo", "owner": "Acme", "odoo_branch": "18.0",
 "project_name": "demo", "technical_name": "acme-demo-123456",
 "project_url": "https://www.odoo.sh/project/demo",
 "subscription_validity": "valid", "url": "https://github.com/Acme/demo.git",
 "production_build_id": [...]}
```

Conséquence : **`get_info` n'est plus appelé**. Le slug vient de `/app/projects`.

**2. Le slug est `technical_name`**, confirmé sur `get_info().active_repo` :
`"technical_name": "acme-demo-v19-123456"` pour le projet
`"project_name": "demo-v19"`, `"name": "DEMO_V19"`.

Piège : `name` est le libellé affiché (`DEMO_V19`), il ne résout pas dans les
URL ni dans `get_info`. C'est `project_name` (`demo-v19`) qui sert.

Corrections appliquées le 19/10 :

- `api.listProjects` lit la clé `repos`, et lève si la liste est vide au lieu de
  rendre un tableau vide en silence.
- `api.normalizeProject` prend `project_name` avant `name`.
- `api.findSlug` cherche `technical_name` en premier.
- `service-worker.refresh` et `content.scanAllProjects` passent `project.slug` à
  `collectProject`.

## Prochaine étape : premier chargement dans Edge

1. `edge://extensions` → mode développeur → charger non empaqueté → ce dossier.
   Vérifier l'absence d'erreur rouge sur la carte.
2. Ouvrir `https://www.odoo.sh/project/demo-v19/branches/Develop`.
3. Attendu : pastille `EXPIRÉ` grise barrée sur `Develop`, compteur sur
   l'en-tête Staging, bandeau gris en haut de la zone History avec bouton
   `Rebuild`.
4. Popup : branches staging de tous les projets, triées par urgence.

Où regarder en cas de panne : console de la page (lignes `[chromesh]`),
console du service worker depuis `edge://extensions`, et la dernière ligne du
popup (erreur ou « données figées »).

Pannes anticipées, par ordre de probabilité :

- `slug du dépôt introuvable` → inférence 2 fausse.
- Collecte OK mais aucune pastille → l'accroche DOM rate, pas la donnée.
- Service worker muet → `importScripts` ou `chrome.tabs.query` sans permission.

## Accès navigateur

Claude n'a **aucun** outil `claude-in-chrome` actif dans la session du 19/10.
Si l'extension Claude in Chrome a été installée depuis, les connecteurs MCP ne
s'enregistrent qu'au démarrage : vérifier après relance.

## Décisions prises, à ne pas re-litiger

- Pas d'étape de build. Scripts classiques, namespace global `CHROMESH`,
  `importScripts` côté service worker.
- `lastSafeDay = expiration_date − 1 jour`, ramené au jour ouvré précédent.
  `workdaysLeft = 0` veut dire « dernier jour utile, c'est aujourd'hui ».
- Le service worker tente l'API, puis délègue à un onglet odoo.sh ouvert
  (`chrome.tabs.sendMessage`), puis affiche « données figées ».
- Préfixes `csh-` partout, pour cohabiter avec Odoo Toolbox, déjà installée.
- Le DOM ne sert qu'à accrocher les pastilles, plus à porter la donnée.
