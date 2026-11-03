# Chromesh — instructions pour Claude

Extension Chrome / Edge (Manifest V3) qui affiche l'échéance de suppression des
builds staging Odoo.sh, comptée en jours ouvrés. Le fonctionnement est décrit
dans `README.md`. L'état des sondes API et les décisions prises sont dans
`CONTEXT.md` : les lire avant de modifier la collecte.

## Dépôt public : aucune donnée client ni interne

Le dépôt `yale-dynapps/chromesh` est public, comme les ZIP des releases, qui
contiennent `README.md` et `CHANGELOG.md`. Tout ce qui est poussé est publié,
historique compris : le supprimer ensuite ne le retire pas.

Ne jamais écrire, dans le code, la doc, les commits, les PR ni les releases :

- un nom réel de client, ou de projet, branche, dépôt ou base Odoo.sh ;
- un payload de l'API `/app/` copié tel quel (`id`, `owner`,
  `technical_name`, `hosting_user_id`, `access_token`, cookies) ;
- un lien interne (SharePoint, Teams, Odoo Dynapps, portail), une adresse
  e-mail, un numéro de téléphone ;
- la volumétrie du portefeuille (nombre de projets, de branches, d'entrées en
  cache) ;
- un secret : token, clé, mot de passe.

Seule exception : l'URL de l'artefact de la page vitrine, plus bas.

Pour illustrer, n'utiliser que le jeu d'exemples existant : owner `Acme`,
`project_name` `demo-v19`, `technical_name` `acme-demo-v19-123456`, libellé
`DEMO_V19`, branche `Develop`. Dans les sections « Vérifié » du
`CHANGELOG.md`, écrire `demo-v19` ou « sur un projet réel », jamais le vrai
nom. Captures d'écran et GIF : masquer les noms de projets et de branches.

Avant chaque commit, relire `git diff --cached` et lancer :

```sh
git diff --cached -U0 | grep -n -i -E 'sharepoint|teams\.microsoft|@[a-z0-9-]+\.(fr|com|be|lu)\b|/project/[a-z0-9_-]+' | grep -v demo-v19
```

Toute ligne remontée doit être justifiée ou anonymisée.

Si une donnée a déjà été poussée : la signaler à l'utilisateur, l'anonymiser
dans un nouveau commit, et lister ce qui reste exposé (historique, ZIP
publiés). Révoquer le lien ou le secret concerné. Ne pas réécrire l'historique
(`git filter-repo`, force-push) sans son accord explicite.

## Architecture à respecter

- Pas d'étape de build. Ce sont des scripts classiques qui partagent le
  namespace global `CHROMESH` (`workdays`, `parse`, `urgency`, `store`, `api`).
  Le service worker les charge par `importScripts`.
- Un nouveau fichier de `src/common/` doit être ajouté à trois endroits :
  `manifest.json` (`content_scripts`), `importScripts` dans
  `src/background/service-worker.js`, et les `<script>` de `popup.html` et
  `options.html`.
- Classes CSS et éléments injectés : préfixe `csh-`, pour cohabiter avec Odoo
  Toolbox. Le `MutationObserver` du content script ignore les nœuds dont la
  classe contient `csh-` : un élément injecté sans ce préfixe relance le rendu
  en boucle.
- La donnée vient de l'API `/app/` d'Odoo.sh (`expiration_date`), jamais du
  DOM. Le DOM sert seulement à savoir où accrocher les pastilles.
- Les éléments posés dans le `<li>` d'une branche se trouvent dans un lien :
  leur gestionnaire de clic appelle `preventDefault()` et `stopPropagation()`,
  sinon Odoo.sh ouvre la branche.

## Exclusions

- Une seule liste : `ignored` dans `chrome.storage.sync` (« Branches ignorées »
  dans les options). `projet::branche` exclut une branche. `projet::*` ou
  `projet` exclut le projet entier, qui n'est alors plus collecté.
- Pour ajouter une exclusion, passer par `store.addIgnored(rule)`, qui
  ignore les doublons. Pour en tester une : `store.isIgnored(key, ignored)` et
  `store.isProjectIgnored(project, ignored)`.
- Pas de second réglage parallèle (du type `ignoredProjects`).

## Fichiers et versions

- Conserver les fins de ligne de chaque fichier. Le dépôt est mixte : la
  plupart des fichiers sont en LF, mais `manifest.json`, `package.ps1`,
  `src/options/options.js` et `src/popup/popup.html` sont en CRLF. Python sous
  Windows écrit en CRLF par défaut : contrôler `git diff --stat` après chaque
  modification par script.
- La version est le champ `version` de `manifest.json`. Le changer à chaque
  livraison : `package.ps1` en tire le nom de `dist/chromesh-<version>.zip`.
- Avant de choisir un numéro : `git fetch origin --tags`, puis prendre la
  version qui suit celle de `origin/main` et le dernier tag. Les versions
  publiées portent un tag au nom nu (`0.2.1`, sans `v`).
- Chaque changement de version ajoute une entrée en tête de `CHANGELOG.md` :
  date, sections Ajouté / Modifié / Corrigé, et ce qui a été vérifié.
- Ne pas committer `dist/`.
- Tout bump de version impose de mettre à jour la page vitrine
  `docs/chromesh-extension.html` (version, lien de téléchargement, date, section
  Nouveautés) et de republier l'artefact qui la sert :
  https://claude.ai/code/artifact/56245592-8891-452e-8aa5-bf6666ee706d
  Republier avec l'outil Artifact en passant cette URL, pour garder le même lien.

## Edge et Chrome

- Un seul code pour les deux navigateurs. N'utiliser que l'espace `chrome.*`
  (Edge l'expose aussi) et des API Manifest V3 disponibles dans les deux. Pas
  de `browser.*`, pas d'API propre à un seul navigateur.
- Toute modification doit être chargée dans les deux : `edge://extensions` et
  `chrome://extensions`, en mode développeur, « Charger l'extension non
  empaquetée ».
- Le même ZIP (`.\package.ps1`) sert aux deux stores : Microsoft Edge Add-ons
  (Partner Center) et Chrome Web Store (Developer Dashboard). `manifest.json`
  doit être à la racine de l'archive, ce que fait déjà `package.ps1`.
- Pour une soumission dans un store :
  - la `version` doit être strictement supérieure à celle déjà publiée ;
  - pas de code chargé à distance : tout le JavaScript est dans `src/` ;
  - garder les permissions au minimum (`storage`, `alarms`, `notifications`,
    hôte `https://www.odoo.sh/*`). Toute permission ajoutée doit être
    justifiée dans la fiche du store et retarde la revue ;
  - icône 128 px obligatoire (`icons/icon128.png`).
- Aujourd'hui, l'extension n'est publiée sur aucun store : elle est
  distribuée en ZIP à charger en mode développeur (voir `README.md`).

## Vérification

- Hors navigateur, contrôler la syntaxe avec
  `for f in $(find src -name "*.js"); do node --check "$f"; done`.
- On teste la logique pure (`workdays`, `urgency`, `store`) sous Node en
  simulant `chrome.storage` par un objet.
- Rien ne remplace un chargement dans Edge (`edge://extensions`, extension non
  empaquetée). Le dire explicitement dans le message de commit quand ce
  chargement n'a pas été fait.
- Ne pas interroger odoo.sh ni l'API `/app/` sans accord préalable de
  l'utilisateur, même en lecture seule.
