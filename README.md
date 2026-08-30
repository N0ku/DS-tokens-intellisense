# DS Tokens IntelliSense

Extension VS Code pour les design tokens au format [DTCG](https://design-tokens.github.io/community-group/format/) organisés en couches (core / semantic / component), tels que consommés par Style Dictionary. Elle attrape dans l'éditeur les erreurs que le build ne signale qu'à la fin — et sans fichier ni ligne.

## Fonctionnalités

Dans les fichiers de tokens (`tokens/**/*.json`, configurable) :

- **Diagnostics** :
  - référence introuvable `{color.content.on-surface}` → erreur (avec suggestion si un nom proche existe) ;
  - référence résolue dans un seul thème (light mais pas dark) → warning ;
  - référence circulaire → erreur avec la boucle affichée ;
  - couleur invalide (`#18ZZZZ`) → erreur, hex court (`#1855`) → warning ;
  - alias vers un token d'un autre `$type` → warning.
- **Autocomplétion** des clés de tokens en tapant `{` dans un `$value`, filtrée par `$type`, avec pastilles couleur.
- **Hover** : chaîne de résolution complète par thème (`{color.action.primary}` → `{color.blue.600}` → **#185FA5**).
- **Go to definition** (F12 / Cmd+clic) sur un alias — les deux thèmes proposés pour la couche sémantique.
- **Pastilles couleur** natives sur les tokens `$type: color` (le picker ne détruit pas les alias).
- **Highlight** du nom des tokens couleur avec leur couleur résolue (désactivable).
- **Coloration sémantique** DTCG : groupes, noms de tokens, `$value`/`$type`, alias — chacun sa teinte.

Dans les fichiers CSS (hors `build/`) :

- `var(--space-999)` inconnue des tokens et des custom properties locales → warning ;
- autocomplétion des `var(--…)` dérivées des tokens ;
- hover et F12 depuis une `var(--…)` vers la définition JSON du token ;
- pastille couleur décorative sur les `var(--color-…)`.

Le modèle de résolution reflète le build multi-thèmes de Style Dictionary : core + component sont partagés, chaque fichier `tokens/semantic/<thème>.tokens.json` forme un ensemble par thème. Light et dark définissant les mêmes chemins est normal, pas une erreur.

## Réglages

- `dsTokens.tokensGlob` (défaut `tokens/**/*.json`) : où trouver les fichiers de tokens.
- `dsTokens.nameHighlights` (défaut `true`) : surligner le nom des tokens couleur avec leur couleur.

## Développement

```bash
npm install
npm run build      # bundle esbuild → dist/extension.js
npm test           # tests du résolveur, pur Node (node --test)
```

F5 dans VS Code → fenêtre « Extension Development Host » ouverte sur le workspace [example/](example/), qui contient un jeu de tokens de démonstration.

## Release

La publication sur le Marketplace est automatisée ([publish.yml](.github/workflows/publish.yml)) via une identité managée Azure et OIDC fédéré — **aucun PAT, aucun secret qui expire**. Pour publier :

```bash
npm version minor          # bump package.json + tag vX.Y.Z
git push && git push --tags
```

Le workflow vérifie que le tag correspond à la version, rejoue typecheck/tests/build, package le `.vsix` et publie. La mise en place initiale de l'identité (une seule fois) est décrite dans [bootstrap-identity.yml](.github/workflows/bootstrap-identity.yml).
