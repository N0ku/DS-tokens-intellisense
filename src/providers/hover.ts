import * as vscode from 'vscode';
import type { TokenIndex } from '../tokenIndex.ts';

const JSON_ALIAS_RE = /\{[^{}]+\}/;
const CSS_VAR_RE = /--[A-Za-z0-9_-]+/;

/** Chaîne de résolution en markdown : `{a}` → `{b}` → **#hex** */
function chainMarkdown(index: TokenIndex, key: string, themes: string[]): vscode.MarkdownString | undefined {
  const md = new vscode.MarkdownString();
  let any = false;
  for (const theme of themes) {
    const r = index.resolve(key, theme);
    if (r.chain.length === 0) continue;
    any = true;
    const steps = r.chain.map((e) => '`{' + e.key + '}`');
    const label = themes.length > 1 ? `**${theme}** : ` : '';
    if (r.terminal !== null) {
      md.appendMarkdown(`${label}${steps.join(' → ')} → **${r.terminal}**\n\n`);
    } else if (r.cycleAt !== undefined) {
      md.appendMarkdown(`${label}${steps.join(' → ')} → ⚠️ cycle sur \`${r.cycleAt}\`\n\n`);
    } else {
      md.appendMarkdown(`${label}${steps.join(' → ')} → ⚠️ \`{${r.missing}}\` introuvable\n\n`);
    }
  }
  return any ? md : undefined;
}

export function registerHover(
  context: vscode.ExtensionContext,
  index: TokenIndex,
  tokenFilter: vscode.DocumentFilter,
  cssFilter: vscode.DocumentFilter
) {
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(tokenFilter, {
      provideHover(doc, pos) {
        const range = doc.getWordRangeAtPosition(pos, JSON_ALIAS_RE);
        if (!range) return undefined;
        const key = doc.getText(range).slice(1, -1).trim();
        const md = chainMarkdown(index, key, index.themesForFile(doc.uri.fsPath));
        return md ? new vscode.Hover(md, range) : undefined;
      },
    })
  );

  context.subscriptions.push(
    vscode.languages.registerHoverProvider(cssFilter, {
      provideHover(doc, pos) {
        const range = doc.getWordRangeAtPosition(pos, CSS_VAR_RE);
        if (!range) return undefined;
        const entries = index.cssVars().get(doc.getText(range));
        if (!entries?.length) return undefined;
        const md = chainMarkdown(index, entries[0].key, index.themeNames());
        return md ? new vscode.Hover(md, range) : undefined;
      },
    })
  );
}
