# DS Tokens IntelliSense

[![CI](https://github.com/N0ku/DS-tokens-intellisense/actions/workflows/ci.yml/badge.svg)](https://github.com/N0ku/DS-tokens-intellisense/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

IntelliSense for [DTCG](https://design-tokens.github.io/community-group/format/) design tokens organized in layers (core, semantic, component), as consumed by [Style Dictionary](https://styledictionary.com). The extension catches errors in the editor that the build only reports at the end, without a file or line number: broken references, invalid colors, and cycles.

![Diagnostics: missing reference with a suggestion, incompatible type](assets/screenshots/diagnostics.png)

## Diagnostics

In token files (`**/tokens/**/*.json`, configurable):

| Issue | Severity |
| --- | --- |
| Missing reference `{color.content.on-surface}` (with a suggestion when a similar name exists) | Error |
| Reference resolved in only one theme (light but not dark) | Warning |
| Circular reference (the cycle is shown in the message) | Error |
| Invalid color (`#18ZZZZ`) | Error |
| Short hex (`#1855`), valid in CSS but outside the DTCG spec | Warning |
| Alias to a token with a different `$type` | Warning |

In CSS files (excluding `build/` and `dist/`): every `var(--space-999)` that matches neither a token nor a declared custom property is reported. If no token file has been indexed, the extension has no source of truth, so these CSS diagnostics are disabled instead of reporting every `var()` as missing.

Diagnostics update while you type, without waiting for a save.

![CSS warning for a var() that does not match any token](assets/screenshots/css.png)

## IntelliSense

![Token autocomplete with color swatches](assets/screenshots/completion.png)

![Hover: resolution chain by theme](assets/screenshots/hover.png)

- **Autocomplete** for token keys when typing `{` in a `$value`, filtered by `$type`, with color swatches. The same applies in CSS for token-derived `var(--...)` values.
- **Hover**: full resolution chain by theme, for example `{color.action.primary}` to `{color.blue.600}` to `#185FA5`.
- **Go to Definition** (F12, Cmd+click) from a JSON alias or CSS `var(--...)` to the token definition. Both themes are offered for the semantic layer.
- Native **color swatches** on `$type: color` tokens (the picker does not destroy aliases), plus decorative swatches on CSS `var(--color-...)` values.
- **Highlighting** of color token names using their resolved color, with black or white text based on luminance (can be disabled).
- **Semantic highlighting** for the DTCG structure: groups, token names, `$value` and `$type` keys, and aliases, each with its own color.

![Color token name highlighting and semantic highlighting](assets/screenshots/highlights.png)

## Modèle de résolution multi-thèmes

The model reflects a multi-theme Style Dictionary build: core and component layers are shared, and each `tokens/semantic/<theme>.tokens.json` file forms a theme-specific resolution set. It is therefore normal, not an error, for light and dark to define the same paths; however, a token defined in only one theme triggers a warning on its usages.

## Réglages

| Setting | Default | Purpose |
| --- | --- | --- |
| `dsTokens.tokensGlob` | `**/tokens/**/*.json` | Where to find token files |
| `dsTokens.nameHighlights` | `true` | Highlight color token names with their color |

## License

[MIT](LICENSE)
