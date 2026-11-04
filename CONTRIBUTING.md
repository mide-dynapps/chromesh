# Contribuer à Chromesh

Le fonctionnement de l'extension est décrit dans `README.md`.

## Mettre en place

1. Cloner le dépôt. Il n'y a pas d'étape de build ni de dépendance.
2. `edge://extensions` et `chrome://extensions` : activer le mode
   développeur, puis « Charger l'extension non empaquetée » sur le dossier
   du dépôt.
3. Après chaque modification, cliquer « Recharger » sur la carte de
   l'extension, dans les deux navigateurs.

## Vérifier

```sh
node tests/run.js                              # logique pure, sans navigateur
for f in $(find src -name "*.js"); do node --check "$f"; done
```

Les tests ne couvrent ni l'injection dans les pages, ni le service worker, ni
les notifications. Recharger l'extension dans Edge **et** dans Chrome reste
obligatoire avant de proposer un changement.

## Proposer un changement

1. Créer une branche depuis `main` : `feat/…`, `fix/…`, `docs/…`.
2. Messages de commit au format `type(portée): résumé`.
3. Lancer `node tests/run.js`, et ajouter un test quand le changement touche
   `workdays`, `urgency`, `settings` ou le filtre du popup.
4. Ouvrir une PR vers `main` sur `yale-dynapps/chromesh`. La description dit
   ce qui a été vérifié, et ce qui ne l'a pas été.

## Livrer une version

1. Changer `version` dans `manifest.json`.
2. Ajouter l'entrée correspondante en tête de `CHANGELOG.md`.
3. Au merge sur `main`, `.github/workflows/release.yml` construit le ZIP par
   `package.ps1`, crée le tag et publie la release avec les notes du
   `CHANGELOG.md`.
