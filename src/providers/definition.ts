import * as vscode from 'vscode';
import type { Span, TokenEntry, TokenIndex } from '../tokenIndex.ts';

const JSON_ALIAS_RE = /\{[^{}]+\}/;
const CSS_VAR_RE = /--[A-Za-z0-9_-]+/;

async function toLocations(entries: TokenEntry[]): Promise<vscode.Location[]> {
  const locations: vscode.Location[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const id = entry.file + ':' + entry.nameSpan.offset;
    if (seen.has(id)) continue;
    seen.add(id);
    const doc = await vscode.workspace.openTextDocument(entry.file);
    const spanRange = (s: Span) => new vscode.Range(doc.positionAt(s.offset), doc.positionAt(s.offset + s.length));
    locations.push(new vscode.Location(doc.uri, spanRange(entry.nameSpan)));
  }
  return locations;
}

export function registerDefinition(
  context: vscode.ExtensionContext,
  index: TokenIndex,
  tokenFilter: vscode.DocumentFilter,
  cssFilter: vscode.DocumentFilter
) {
  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider(tokenFilter, {
      async provideDefinition(doc, pos) {
        const range = doc.getWordRangeAtPosition(pos, JSON_ALIAS_RE);
        if (!range) return undefined;
        const key = doc.getText(range).slice(1, -1).trim();
        const targets: TokenEntry[] = [];
        for (const theme of index.themesForFile(doc.uri.fsPath)) {
          const entry = index.themeSet(theme).get(key);
          if (entry) targets.push(entry);
        }
        return targets.length ? toLocations(targets) : undefined;
      },
    })
  );

  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider(cssFilter, {
      async provideDefinition(doc, pos) {
        const range = doc.getWordRangeAtPosition(pos, CSS_VAR_RE);
        if (!range) return undefined;
        const entries = index.cssVars().get(doc.getText(range));
        return entries?.length ? toLocations(entries) : undefined;
      },
    })
  );
}
