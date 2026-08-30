import * as vscode from 'vscode';
import { CSS_VAR_USE_RE } from '../diagnostics.ts';
import type { TokenIndex } from '../tokenIndex.ts';

function hexToColor(hex: string): vscode.Color | undefined {
  const m = /^#([0-9a-fA-F]{6})([0-9a-fA-F]{2})?$/.exec(hex.trim());
  if (!m) return undefined;
  const n = parseInt(m[1], 16);
  const alpha = m[2] !== undefined ? parseInt(m[2], 16) / 255 : 1;
  return new vscode.Color(((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255, alpha);
}

function colorToHex(color: vscode.Color): string {
  const b = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0').toUpperCase();
  const base = `#${b(color.red)}${b(color.green)}${b(color.blue)}`;
  return color.alpha < 1 ? base + b(color.alpha) : base;
}

/** Valeur couleur résolue d'une entrée, dans le premier thème applicable ('light' d'abord). */
function resolvedHex(index: TokenIndex, key: string, themes: string[]): string | undefined {
  for (const theme of themes) {
    const r = index.resolve(key, theme);
    if (r.terminal !== null && r.chain[r.chain.length - 1]?.type === 'color') return r.terminal;
  }
  return undefined;
}

export function registerColors(
  context: vscode.ExtensionContext,
  index: TokenIndex,
  tokenFilter: vscode.DocumentFilter
) {
  // JSON : swatches natifs. Picker éditable sur les hex littéraux ;
  // sur les alias, la pastille montre la couleur résolue mais le picker ne détruit pas l'alias.
  context.subscriptions.push(
    vscode.languages.registerColorProvider(tokenFilter, {
      provideDocumentColors(doc) {
        const colors: vscode.ColorInformation[] = [];
        for (const entry of index.entries()) {
          if (entry.file !== doc.uri.fsPath || entry.type !== 'color') continue;
          const inner = new vscode.Range(
            doc.positionAt(entry.valueSpan.offset + 1),
            doc.positionAt(entry.valueSpan.offset + entry.valueSpan.length - 1)
          );
          const hex = entry.value.includes('{')
            ? resolvedHex(index, entry.key, index.themesForFile(doc.uri.fsPath))
            : entry.value;
          const color = hex !== undefined ? hexToColor(hex) : undefined;
          if (color) colors.push(new vscode.ColorInformation(inner, color));
        }
        return colors;
      },
      provideColorPresentations(color, ctx) {
        const current = ctx.document.getText(ctx.range);
        // Alias : ne pas remplacer la référence par un hex
        if (current.startsWith('{')) return [new vscode.ColorPresentation(current)];
        return [new vscode.ColorPresentation(colorToHex(color))];
      },
    })
  );
}

// CSS : pas de ColorProvider (conflit avec celui du langage CSS natif) —
// une décoration « pastille » par occurrence de var(--…-couleur).
const swatchDecoration = vscode.window.createTextEditorDecorationType({
  before: {
    contentText: ' ',
    width: '0.75em',
    height: '0.75em',
    margin: '0 0.25em 0 0',
    border: '1px solid rgba(128,128,128,0.6)',
  },
});

export function refreshCssColorDecorations(index: TokenIndex, isCssDoc: (doc: vscode.TextDocument) => boolean) {
  for (const editor of vscode.window.visibleTextEditors) {
    if (!isCssDoc(editor.document)) continue;
    const text = editor.document.getText();
    const options: vscode.DecorationOptions[] = [];
    for (const m of text.matchAll(CSS_VAR_USE_RE)) {
      const entries = index.cssVars().get(m[1]);
      if (!entries?.length) continue;
      const hex = resolvedHex(index, entries[0].key, index.themeNames());
      if (hex === undefined) continue;
      const start = m.index + m[0].indexOf(m[1]);
      options.push({
        range: new vscode.Range(
          editor.document.positionAt(start),
          editor.document.positionAt(start + m[1].length)
        ),
        renderOptions: { before: { backgroundColor: hex } },
      });
    }
    editor.setDecorations(swatchDecoration, options);
  }
}

// --- Highlight du nom des tokens couleur ------------------------------------
// L'API ne permet pas un backgroundColor par instance (seuls before/after le sont),
// donc : un TextEditorDecorationType par couleur distincte, mis en cache.
const nameHighlightTypes = new Map<string, vscode.TextEditorDecorationType>();

function contrastText(hex: string): string {
  const m = /^#([0-9a-fA-F]{6})/.exec(hex);
  if (!m) return '#000000';
  const n = parseInt(m[1], 16);
  const lum = (0.299 * ((n >> 16) & 0xff) + 0.587 * ((n >> 8) & 0xff) + 0.114 * (n & 0xff)) / 255;
  return lum > 0.55 ? '#000000' : '#ffffff';
}

export function refreshTokenNameHighlights(
  index: TokenIndex,
  isTokenDoc: (doc: vscode.TextDocument) => boolean,
  enabled: boolean
) {
  for (const editor of vscode.window.visibleTextEditors) {
    if (!isTokenDoc(editor.document)) continue;

    const byColor = new Map<string, vscode.Range[]>();
    if (enabled) {
      for (const entry of index.entries()) {
        if (entry.file !== editor.document.uri.fsPath || entry.type !== 'color') continue;
        const hex = entry.value.includes('{')
          ? resolvedHex(index, entry.key, index.themesForFile(entry.file))
          : hexToColor(entry.value) !== undefined
            ? entry.value
            : undefined;
        if (hex === undefined) continue;
        // nameSpan inclut les guillemets → on surligne juste le nom
        const range = new vscode.Range(
          editor.document.positionAt(entry.nameSpan.offset + 1),
          editor.document.positionAt(entry.nameSpan.offset + entry.nameSpan.length - 1)
        );
        const list = byColor.get(hex) ?? [];
        list.push(range);
        byColor.set(hex, list);
      }
    }

    for (const hex of byColor.keys()) {
      if (!nameHighlightTypes.has(hex)) {
        nameHighlightTypes.set(
          hex,
          vscode.window.createTextEditorDecorationType({
            backgroundColor: hex,
            color: contrastText(hex),
            borderRadius: '3px',
          })
        );
      }
    }
    // Poser les ranges de chaque couleur, et vider les types devenus inutilisés
    for (const [hex, type] of nameHighlightTypes) {
      editor.setDecorations(type, byColor.get(hex) ?? []);
    }
  }
}
