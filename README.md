# DS Tokens IntelliSense

[![CI](https://github.com/N0ku/DS-tokens-intellisense/actions/workflows/ci.yml/badge.svg)](https://github.com/N0ku/DS-tokens-intellisense/actions/workflows/ci.yml)
[![Marketplace](https://marketplace.visualstudio.com/items?itemName=n0ku.ds-tokens-intellisense)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

IntelliSense pour les design tokens au format [DTCG](https://design-tokens.github.io/community-group/format/) organisés en couches (core, semantic, component), tels que consommés par [Style Dictionary](https://styledictionary.com). L'extension attrape dans l'éditeur les erreurs que le build ne signale qu'à la fin, sans fichier ni ligne : référence morte, couleur invalide, cycle.

## Diagnostics

Dans les fichiers de tokens (`tokens/**/*.json`, configurable) :

| Problème | Sévérité |
|---|---|
| Référence introuvable `{color.content.on-surface}` (avec suggestion si un nom proche existe) | Erreur |
| Référence résolue dans un seul thème (light mais pas dark) | Warning |
| Référence circulaire (la boucle est affichée dans le message) | Erreur |
| Couleur invalide (`#18ZZZZ`) | Erreur |
| Hex court (`#1855`), valide en CSS mais hors spec DTCG | Warning |
| Alias vers un token d'un autre `$type` | Warning |

Dans les fichiers CSS (hors `build/`) : toute `var(--space-999)` qui ne correspond ni à un token ni à une custom property déclarée est signalée.

Les diagnostics se mettent à jour pendant la frappe, sans attendre la sauvegarde.

## IntelliSense

- **Autocomplétion** des clés de tokens en tapant `{` dans un `$value`, filtrée par `$type`, avec pastilles couleur. Idem dans le CSS pour les `var(--...)` dérivées des tokens.
- **Hover** : chaîne de résolution complète par thème, par exemple `{color.action.primary}` vers `{color.blue.600}` vers `#185FA5`.
- **Go to definition** (F12, Cmd+clic) depuis un alias JSON ou une `var(--...)` CSS vers la définition du token. Les deux thèmes sont proposés pour la couche sémantique.
- **Pastilles couleur** natives sur les tokens `$type: color` (le picker ne détruit pas les alias), et décoratives sur les `var(--color-...)` en CSS.
- **Highlight** du nom des tokens couleur avec leur couleur résolue, texte en noir ou blanc selon la luminance (désactivable).
- **Coloration sémantique** de la structure DTCG : groupes, noms de tokens, clés `$value` et `$type`, alias, chacun sa teinte.

## Modèle de résolution multi-thèmes

Le modèle reflète un build Style Dictionary multi-thèmes : les couches core et component sont partagées, chaque fichier `tokens/semantic/<theme>.tokens.json` forme un ensemble de résolution par thème. Que light et dark définissent les mêmes chemins est donc normal, pas une erreur ; en revanche un token défini dans un seul thème déclenche un warning sur ses usages.

## Réglages

| Réglage | Défaut | Rôle |
|---|---|---|
| `dsTokens.tokensGlob` | `tokens/**/*.json` | Où trouver les fichiers de tokens |
| `dsTokens.nameHighlights` | `true` | Surligner le nom des tokens couleur avec leur couleur |

## Développement

```bash
npm install
npm run build      # bundle esbuild vers dist/extension.js
npm test           # tests du résolveur, pur Node (node --test)
```

F5 dans VS Code ouvre une fenêtre Extension Development Host sur le workspace [example/](example/), qui contient un jeu de tokens de démonstration.

## Release

La publication sur le Marketplace est automatisée ([publish.yml](.github/workflows/publish.yml)) via une identité managée Azure et OIDC fédéré, sans PAT ni secret qui expire :

```bash
npm version minor          # bump package.json + tag vX.Y.Z
git push && git push --tags
```

## Licence

[MIT](LICENSE)
