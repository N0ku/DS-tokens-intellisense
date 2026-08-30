import * as vscode from 'vscode';
import { getLocation } from 'jsonc-parser';
import { FULL_ALIAS_RE, type TokenEntry, type TokenIndex } from '../tokenIndex.ts';

/** Résumé des valeurs résolues d'une clé, par thème : « light: #185FA5 · dark: #378ADD » */
function resolvedSummary(index: TokenIndex, key: string, themes: string[]): string {
  const parts: string[] = [];
  for (const theme of themes) {
    const r = index.resolve(key, theme);
    if (r.terminal !== null) parts.push(themes.length > 1 ? `${theme}: ${r.terminal}` : r.terminal);
  }
  return parts.join(' · ');
}

function firstColor(index: TokenIndex, key: string, themes: string[]): string | undefined {
  for (const theme of themes) {
    const r = index.resolve(key, theme);
    const last = r.chain[r.chain.length - 1];
    if (r.terminal !== null && last?.type === 'color') return r.terminal;
  }
  return undefined;
}

export function registerCompletion(
  context: vscode.ExtensionContext,
  index: TokenIndex,
  tokenFilter: vscode.DocumentFilter,
  cssFilter: vscode.DocumentFilter
) {
  // --- JSON : complétion dans "$value": "{…" --------------------------------
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      tokenFilter,
      {
        provideCompletionItems(doc, pos) {
          const text = doc.getText();
          const offset = doc.offsetAt(pos);
          const loc = getLocation(text, offset);
          if (loc.isAtPropertyKey || loc.path[loc.path.length - 1] !== '$value') return undefined;
          const stringNode = loc.previousNode;
          if (!stringNode || stringNode.type !== 'string') return undefined;

          // Position de l'alias en cours de frappe : depuis la dernière '{' avant le curseur
          const inString = text.slice(stringNode.offset + 1, offset);
          const braceAt = inString.lastIndexOf('{');
          if (braceAt === -1) return undefined;
          const replaceRange = new vscode.Range(
            doc.positionAt(stringNode.offset + 1 + braceAt + 1),
            pos
          );

          // $type attendu = celui du token en cours d'édition
          const tokenKey = loc.path.slice(0, -1).join('.');
          const selfEntry = index.entryAt(doc.uri.fsPath, tokenKey);
          const expectedType = selfEntry?.type;

          const themes = index.themesForFile(doc.uri.fsPath);
          const candidates = new Map<string, TokenEntry>();
          for (const theme of themes) {
            for (const [key, entry] of index.themeSet(theme)) {
              if (key !== tokenKey && !candidates.has(key)) candidates.set(key, entry);
            }
          }

          const closeBrace = text[offset] === '}' ? '' : '}';
          const items: vscode.CompletionItem[] = [];
          for (const [key, entry] of candidates) {
            if (expectedType && entry.type && entry.type !== expectedType) continue;
            const isColor = entry.type === 'color';
            const item = new vscode.CompletionItem(
              key,
              isColor ? vscode.CompletionItemKind.Color : vscode.CompletionItemKind.Value
            );
            item.insertText = key + closeBrace;
            item.range = replaceRange;
            item.detail = resolvedSummary(index, key, themes);
            if (isColor) {
              // Pour le kind Color, VS Code affiche la pastille depuis une documentation hex
              const hex = firstColor(index, key, themes);
              if (hex) item.documentation = hex;
            }
            item.sortText = entry.layer.startsWith('semantic:') ? '1' + key : '2' + key;
            items.push(item);
          }
          return items;
        },
      },
      '{',
      '.'
    )
  );

  // --- CSS : complétion dans var(-- ---------------------------------------
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      cssFilter,
      {
        provideCompletionItems(doc, pos) {
          const prefix = doc.lineAt(pos.line).text.slice(0, pos.character);
          const m = /var\(\s*(--[A-Za-z0-9_-]*)$/.exec(prefix);
          if (!m) return undefined;
          const replaceRange = new vscode.Range(pos.line, pos.character - m[1].length, pos.line, pos.character);

          const items: vscode.CompletionItem[] = [];
          for (const [cssVar, entries] of index.cssVars()) {
            const isColor = entries.some((e) => e.type === 'color');
            const item = new vscode.CompletionItem(
              cssVar,
              isColor ? vscode.CompletionItemKind.Color : vscode.CompletionItemKind.Variable
            );
            item.range = replaceRange;
            const themes = index.themeNames();
            item.detail = resolvedSummary(index, entries[0].key, themes);
            if (isColor) {
              const hex = firstColor(index, entries[0].key, themes);
              if (hex) item.documentation = hex;
            }
            items.push(item);
          }
          return items;
        },
      },
      '-',
      '('
    )
  );
}
