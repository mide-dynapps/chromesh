# Historique des versions

Les versions suivent le champ `version` de `manifest.json`. La plus récente est
en haut.

Statut de test : aucune version n'a encore été validée dans un navigateur
au-delà des points cités. Chaque entrée dit ce qui a été vérifié.

## 0.3.0 — 03/11/2026

### Ajouté
- Popup : barre de filtre au-dessus de la liste. Recherche par sous-chaîne
  dans le projet ou la branche, sans tenir compte de la casse ni des accents.
  Boutons par niveau (Expiré, Critique, Attention, OK) avec leur compteur, qui
  masquent ou affichent le niveau.
- Le filtre repart à zéro à chaque ouverture du popup. `Échap` ou `✕` l'efface.
  Il ne touche pas aux exclusions (`ignored`).
- Pied du popup : nombre de branches masquées par le filtre.

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
- Non testé : popup réel de l'extension (Chrome refuse les URL
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
- Même jour, page `/project/moduleis` : 0 bouton `⊘` et pas de compteur au
  chargement ; après une mutation DOM forcée, 2 boutons `⊘` et compteur à 1.
- Report du rendu chargé dans Chrome : sur `/project/moduleis`, sans aucune
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
