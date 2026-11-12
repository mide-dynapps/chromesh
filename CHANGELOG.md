# Historique des versions

Les versions suivent le champ `version` de `manifest.json`. La plus récente est
en haut.

Statut de test : aucune version n'a encore été validée dans un navigateur
au-delà des points cités. Chaque entrée dit ce qui a été vérifié.

## 0.5.0 — 12/11/2026

Suivi des bases d'essai Odoo Online, en option.

### Ajouté
- Option « Surveiller les bases d'essai Odoo Online », désactivée par défaut.
  À l'ouverture d'une base `*.odoo.com`, l'extension lit
  `/web/session/get_session_info` avec la session de l'utilisateur et range
  l'échéance d'une base d'essai (`expiration_reason` = `trial`) dans le popup,
  sous `Odoo Online`. Badge et notifications comme pour les branches staging.
- Critère « instance Odoo Online » : `db` égal au sous-domaine et clé
  `odoo_website_url` présente. Une production Odoo.sh sur `*.odoo.com` est
  écartée.
- Une base n'est relue qu'une fois par période de rafraîchissement.
- Exclusion d'une base : `Odoo Online::<base>`, URL de la base collée dans
  « Branches et bases ignorées » (convertie à l'enregistrement), ou bouton
  `⊘ base` du popup. `Odoo Online::*` exclut toutes les bases. Une base exclue
  n'est plus interrogée.
- 30 assertions de test (98 au total).

### Modifié
- Permissions : `scripting` et l'hôte optionnel `https://*.odoo.com/*`. L'accès
  n'est demandé qu'à l'activation de l'option et rendu à sa désactivation.
  Option coupée : aucun script injecté sur `*.odoo.com`, aucune requête.
- Le clic sur une notification d'une base Online ouvre la base.

### Vérifié
- `node tests/run.js` : 98 assertions passées. `node --check` sur `src/`.
- Le critère SaaS et le format de `expiration_date` reposent sur trois sondes
  de session faites à la main : une base Online 18.0, une base d'essai
  Online saas~19.3, une production Odoo.sh 18.0.
- Non vérifié : chargement dans Edge et Chrome, demande de permission,
  inscription du script, cas d'une base Online dupliquée.

## 0.4.0 — 04/11/2026

Revue de code complète : correction de trois défauts qui faussaient les
données affichées, et premiers tests automatisés.

### Corrigé
- Le cache ne retenait jamais la disparition d'une branche. Une branche
  supprimée sur Odoo.sh y restait, basculait en « expiré » au fil des jours et
  comptait indéfiniment dans le badge. Chaque collecte aligne maintenant le
  cache du projet sur ce que l'API renvoie (`store.pruneProject`).
- Deux contextes qui écrivaient en même temps — service worker et onglet, ou
  deux onglets — se perdaient des branches : `chrome.storage` n'offre pas de
  compare-and-swap. Toutes les écritures passent par une file.
- Un échec de collecte dans la page bloquait toute reprise pendant
  `refreshHours`, six heures par défaut : l'horodatage était posé avant
  l'appel. Il est désormais rendu en cas d'erreur (`store.releaseScan`).
- Deux onglets Odoo.sh ouverts lançaient deux balayages complets en parallèle.
  Un jeton partagé dans `chrome.storage.local` n'en autorise qu'un.
- Au-delà de 4 000 jours d'écart, le décompte de jours ouvrés s'arrêtait et
  renvoyait un total tronqué, donc un `J-xxxx` faux. Il renvoie `null`, et le
  niveau devient « inconnu ».
- Les réglages numériques n'étaient pas bornés : un champ vide valait `0`, et
  `warningDays` pouvait passer sous `criticalDays`, rendant le niveau orange
  inatteignable. Les valeurs sont bornées et les seuils réordonnés.
- Une liste d'exclusions dépassant les 8 192 octets de `chrome.storage.sync`
  échouait en silence. L'erreur est maintenant affichée dans les paramètres.
- Un `:` dans un nom de projet ou de branche cassait l'ouverture de la branche
  au clic sur une notification. Les deux segments sont encodés.
- Vue `/project` : décocher « Colorer les projets selon leur urgence » laissait
  la barre de filtre en place. Le réglage retire désormais tout ce que
  l'extension ajoute à cette vue.

### Ajouté
- Tests de la logique pure sous Node, sans dépendance : `node tests/run.js`.
  68 assertions sur les jours ouvrés, les niveaux d'urgence, le stockage et le
  filtre du popup. `chrome.storage` est simulé en mémoire.
- `ApiError` porte un `code` applicatif (`non-json`, `odoo-error`,
  `empty-projects`, `slug-not-found`) en plus du statut HTTP.

### Modifié
- Le service worker ne charge plus `parse.js`, le popup ne charge plus
  `parse.js` ni `api.js`, la page des paramètres ne charge plus que
  `settings.js` : ces fichiers n'y servaient pas.
- `README.md` réécrit.

### Vérifié
- `node tests/run.js` : 68 assertions, 0 échec.
- `node --check` sur tous les fichiers de `src/` et `tests/`.
- Non chargée dans Edge ni Chrome : la purge du cache, le jeton de balayage
  partagé et le clic sur notification n'ont pas été éprouvés dans le
  navigateur.

## 0.3.1 — 04/11/2026

### Ajouté
- Vue `/project` : barre de filtre au-dessus de la liste des projets. Trois
  boutons avec compteur — « Tous », « À surveiller » (attention, critique,
  expiré) et « Critiques » (critique, expiré). Le filtre masque la tuile en
  kanban et la ligne en liste. Il ne persiste pas : il repart à « Tous » au
  rechargement, comme celui du popup, et ne touche pas aux exclusions.

### Modifié
- Vue `/project` : plus de bandeau ni de pastille injectés. La tuile (kanban)
  ou la ligne (liste) prend seulement la couleur du niveau le plus urgent du
  projet, avec un liseré de 3 px ; le détail passe par l'infobulle. Affichage
  cohérent avec le reste de la page.
- Libellé du réglage correspondant : « Colorer les projets selon leur urgence
  dans la liste des projets ».

### Corrigé
- Un projet exclu après coup garde la couleur de la passe précédente jusqu'au
  rechargement de la page.

### Vérifié
- `node --check` sur tous les fichiers de `src/`.
- Fins de ligne inchangées (`git diff --stat`).
- Non chargée dans Edge ni Chrome : position de la barre de filtre, masquage
  des tuiles et rendu du liseré non contrôlés dans le navigateur.

## 0.3.0 — 03/11/2026

### Ajouté
- Popup : barre de filtre au-dessus de la liste. Recherche par sous-chaîne
  dans le projet ou la branche, sans tenir compte de la casse ni des accents.
  Boutons par niveau (Expiré, Critique, Attention, OK) avec leur compteur, qui
  masquent ou affichent le niveau.
- Le filtre repart à zéro à chaque ouverture du popup. `Échap` ou `✕` l'efface.
  Il ne touche pas aux exclusions (`ignored`).
- Pied du popup : nombre de branches masquées par le filtre.
- Paramètres : ligne en bas de page avec la version, le navigateur, le mode
  d'installation (« non empaquetée » en mode développeur) et l'ID de
  l'extension. `chrome.management.getSelf()` ne demande aucune permission.

### Vérifié
- `node --check` sur tous les fichiers de `src/`.
- Sous Node, `src/popup/filter.js` : casse, accents, recherche sur projet et
  branche, combinaison texte + niveau, comptes par niveau (12 assertions).
- Dans Chrome, le 03/11/2026, `popup.html` servi en `localhost` avec un
  `chrome.storage` simulé (6 branches fictives) : rendu de la barre, focus à
  l'ouverture, recherche « ETE » et « acme », bouton de niveau seul et combiné
  au texte, message « Aucune branche ne correspond », `Échap`, `✕`,
  `⊘ branche` avec filtre actif (filtre conservé), focus gardé sur un bouton
  de niveau après clic. Aucune erreur console.
- Même méthode pour `options.html` (`runtime` et `management` simulés) :
  pied affiché « Chromesh 0.3.0 · Chrome 156 · non empaquetée · ID … ».
- Non testé : popup et paramètres réels de l'extension (Chrome refuse les URL
  `chrome-extension://` aux outils d'automatisation), dont `Échap` qui ne
  doit pas fermer le popup quand un filtre est actif ; Edge.

## 0.2.4 — 03/11/2026

### Ajouté
- Réglage « Bandeau et pastille dans la liste des projets »
  (`showProjectBanner`, activé par défaut). La vue `/project` ne dépend plus de
  l'option du bandeau de branche : les deux affichages se règlent séparément.

### Modifié
- « Bandeau sur la page de la branche » (`showBanner`) ne pilote plus que la
  page d'une branche.

### Vérifié
- Syntaxe de tous les fichiers de `src/` par `node --check`.
- Diagnostic à l'origine du changement, dans Chrome le 03/11/2026 sur
  `/project` : content script injecté, 44 cartes repérées, 118 entrées en
  cache, noms concordants, `showBanner` à `false` — aucun bandeau posé.
- Non testé : l'extension n'a pas été rechargée depuis ce changement, ni dans
  Chrome ni dans Edge. La nouvelle case à cocher n'a pas été manipulée.

## 0.2.3 — 03/11/2026

### Corrigé
- Vue `/project` : rien ne s'affichait quand odoo.sh redirige vers
  `/project?debug=1`. Le motif `https://www.odoo.sh/project` du manifeste ne
  couvre pas la chaîne de requête, donc le content script n'était pas injecté.
  Les deux motifs sont remplacés par `https://www.odoo.sh/project*`.
- Page d'un projet : les boutons `⊘` et le compteur Staging manquaient au
  premier affichage. Un rendu demandé pendant la collecte était abandonné ;
  il est désormais reporté à la fin du rendu en cours.

### Vérifié
- Dans Chrome, le 03/11/2026, motif élargi chargé : 9 bandeaux posés sur
  `/project?debug=1` (8 orange, 1 rouge).
- Même jour, page `/project/demo-v19` : 0 bouton `⊘` et pas de compteur au
  chargement ; après une mutation DOM forcée, 2 boutons `⊘` et compteur à 1.
- Report du rendu chargé dans Chrome : sur `/project/demo-v19`, sans aucune
  intervention, 2 boutons `⊘` (visibles au survol) et compteur Staging à 1.
- Non testé : le clic dans le menu `⊘`, la vue liste de `/project`, Edge.

## 0.2.2 — 03/11/2026

### Ajouté
- Panneau des branches sur odoo.sh : un bouton `⊘` apparaît au survol de
  chaque branche staging. Son menu propose « Exclure la branche » ou « Exclure
  le projet ». Le projet est enregistré sous la forme `projet::*`.
- Popup : boutons `⊘ branche` et `⊘ projet` au survol d'une ligne. Le bas du
  popup indique le nombre d'exclusions.

### Modifié
- Le badge de la barre d'outils se recalcule dès que la liste d'exclusion
  change, sans attendre l'alarme horaire.
- Une branche exclue n'est plus repeinte à la fin d'une collecte.
- Le ZIP produit par `package.ps1` contient aussi `CHANGELOG.md`.

### Vérifié
- Syntaxe des scripts (`node --check`) et règles d'exclusion, sous Node.
- Non testé dans Edge ni dans Chrome.

## 0.2.1 — 03/11/2026

### Ajouté
- Vue `/project` en mode liste : pastille dans la cellule du nom du projet et
  liseré coloré sur la ligne, au niveau d'urgence de sa pire branche staging.

### Corrigé
- Le bandeau de la 0.2.0 ne visait que le rendu kanban. En liste, il était
  inséré dans un `tr` et rejeté hors du tableau.
- `/project/create` n'est plus compté comme un projet nommé `create`.

### Vérifié
- Non testé dans un navigateur.

## 0.2.0 — 03/11/2026

### Ajouté
- Un clic, ou Entrée / Espace, sur une pastille exclut la branche
  (`projet::branche`).
- Vue `/project` : bandeau en tête de chaque projet, au niveau d'urgence de sa
  pire branche staging. Le manifeste couvre désormais aussi l'URL
  `https://www.odoo.sh/project`.

### Vérifié
- Non testé dans un navigateur.

## 0.1.0 — 21/10/2026

Première version.

### Ajouté
- Pastille `J-n` / `AUJOURD'HUI` / `EXPIRÉ` sur chaque branche staging,
  compteur sur l'en-tête Staging, bandeau avec bouton `Rebuild` sur la page de
  la branche.
- Popup multi-projets trié par urgence, badge sur l'icône, notifications
  système.
- Échéance comptée en jours ouvrés, avec les jours fériés FR, BE ou LU au choix.
- Données lues dans l'API interne `/app/` d'Odoo.sh (`expiration_date`), pas
  dans le DOM.
- Exclusions dans les options : `projet::branche`, `projet::*` ou `projet`. Un
  projet exclu n'est plus interrogé.

### Vérifié
- Le 19/10/2026 dans Edge, sur un projet réel : chargement sans erreur,
  pastilles, bandeau `Rebuild`, popup rempli.
- Notifications et collecte directe par le service worker : non éprouvées.
