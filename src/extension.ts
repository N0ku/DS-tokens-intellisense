import * as vscode from 'vscode';
import { TokenIndex } from './tokenIndex.ts';
import { analyzeTokens, analyzeCss, canLintCss, extractCssDecls, type Finding } from './diagnostics.ts';
import { registerCompletion } from './providers/completion.ts';
import { registerHover } from './providers/hover.ts';
import { registerDefinition } from './providers/definition.ts';
import { registerColors, refreshCssColorDecorations, refreshTokenNameHighlights } from './providers/colors.ts';
import { registerSemanticTokens } from './providers/semanticTokens.ts';

const SOURCE = 'ds-tokens';
const DEFAULT_TOKENS_GLOB = '**/tokens/**/*.json';
/** Sortie de build : ni source de tokens (doublons générés), ni CSS à linter. */
const EXCLUDE = '{**/node_modules/**,**/build/**,**/dist/**}';

export async function activate(context: vscode.ExtensionContext) {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) return;
  // Type non-optionnel : reindexTokens() le capture dans une closure.
  const ws: vscode.WorkspaceFolder = folder;

  const readGlob = () =>
    vscode.workspace.getConfiguration('dsTokens').get<string>('tokensGlob', DEFAULT_TOKENS_GLOB);

  const index = new TokenIndex();
  const collection = vscode.languages.createDiagnosticCollection(SOURCE);
  context.subscriptions.push(collection);

  // Textes connus (fichiers pas forcément ouverts) : nécessaires pour convertir offset → Position.
  const tokenTexts = new Map<string, string>();
  const cssTexts = new Map<string, string>();

  const isGenerated = (fsPath: string) => /[\\/](?:node_modules|build|dist)[\\/]/.test(fsPath);
  // Réaffecté par reindexTokens() quand le réglage change.
  let tokenPattern = new vscode.RelativePattern(ws, readGlob());
  const tokenFilter: vscode.DocumentFilter = { language: 'json', pattern: tokenPattern };
  const cssFilter: vscode.DocumentFilter = { language: 'css', scheme: 'file' };

  const isTokenDoc = (doc: vscode.TextDocument) => vscode.languages.match({ pattern: tokenPattern }, doc) > 0;
  const isCssDoc = (doc: vscode.TextDocument) => doc.languageId === 'css' && !isGenerated(doc.uri.fsPath);

  // --- Diagnostics ---------------------------------------------------------
  function toRange(text: string, finding: Finding): vscode.Range {
    const pos = (offset: number) => {
      let line = 0;
      let last = 0;
      for (let i = 0; i < offset && i < text.length; i++) {
        if (text[i] === '\n') {
          line++;
          last = i + 1;
        }
      }
      return new vscode.Position(line, offset - last);
    };
    return new vscode.Range(pos(finding.span.offset), pos(finding.span.offset + finding.span.length));
  }

  function refreshDiagnostics() {
    const byFile = new Map<string, vscode.Diagnostic[]>();
    const push = (finding: Finding, text: string) => {
      const diag = new vscode.Diagnostic(
        toRange(text, finding),
        finding.message,
        finding.severity === 'error' ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning
      );
      diag.source = SOURCE;
      diag.code = finding.code;
      const list = byFile.get(finding.file) ?? [];
      list.push(diag);
      byFile.set(finding.file, list);
    };

    for (const finding of analyzeTokens(index)) {
      const text = tokenTexts.get(finding.file);
      if (text !== undefined) push(finding, text);
    }

    // Aucun token indexé = aucune vérité terrain : se taire plutôt que de déclarer
    // inexistante chaque var() du workspace.
    if (canLintCss(index.entries().length)) {
      const workspaceDecls = new Set<string>();
      for (const text of cssTexts.values()) for (const d of extractCssDecls(text)) workspaceDecls.add(d);
      const known = (name: string) => index.cssVars().has(name) || workspaceDecls.has(name);
      for (const [file, text] of cssTexts) {
        for (const finding of analyzeCss(file, text, known)) push(finding, text);
      }
    }

    collection.clear();
    for (const [file, diags] of byFile) collection.set(vscode.Uri.file(file), diags);
    refreshDecorations();
  }

  function refreshDecorations() {
    refreshCssColorDecorations(index, isCssDoc);
    const highlights = vscode.workspace.getConfiguration('dsTokens').get<boolean>('nameHighlights', true);
    refreshTokenNameHighlights(index, isTokenDoc, highlights);
  }

  function logIndexState(glob: string) {
    const count = index.entries().length;
    if (count === 0) {
      console.warn(
        `ds-tokens-intellisense : aucun fichier de tokens trouvé pour « ${glob} » —` +
          ' diagnostics CSS désactivés (voir le réglage dsTokens.tokensGlob).'
      );
    } else {
      console.log('ds-tokens-intellisense activé —', count, 'tokens indexés');
    }
  }

  // --- Indexation des tokens (rejouable au changement de glob) -------------
  async function onTokenFile(uri: vscode.Uri) {
    const text = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
    tokenTexts.set(uri.fsPath, text);
    index.indexFile(uri.fsPath, text);
    refreshDiagnostics();
  }

  let tokenWatcher: vscode.FileSystemWatcher | undefined;
  context.subscriptions.push({ dispose: () => tokenWatcher?.dispose() });

  async function reindexTokens(glob: string) {
    tokenWatcher?.dispose();
    for (const file of index.files()) index.removeFile(file);
    tokenTexts.clear();

    tokenPattern = new vscode.RelativePattern(ws, glob);
    for (const uri of await vscode.workspace.findFiles(tokenPattern, EXCLUDE)) {
      const text = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
      tokenTexts.set(uri.fsPath, text);
      index.indexFile(uri.fsPath, text);
    }

    tokenWatcher = vscode.workspace.createFileSystemWatcher(tokenPattern);
    tokenWatcher.onDidCreate(onTokenFile);
    tokenWatcher.onDidChange(onTokenFile);
    tokenWatcher.onDidDelete((uri) => {
      tokenTexts.delete(uri.fsPath);
      index.removeFile(uri.fsPath);
      refreshDiagnostics();
    });
  }

  await reindexTokens(readGlob());
  for (const uri of await vscode.workspace.findFiles('**/*.css', EXCLUDE)) {
    cssTexts.set(uri.fsPath, Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8'));
  }
  refreshDiagnostics();
  logIndexState(readGlob());

  // --- Watcher CSS (sauvegardes / créations / suppressions sur disque) -----
  const cssWatcher = vscode.workspace.createFileSystemWatcher('**/*.css');
  const onCssFile = async (uri: vscode.Uri) => {
    if (isGenerated(uri.fsPath)) return;
    cssTexts.set(uri.fsPath, Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8'));
    refreshDiagnostics();
  };
  cssWatcher.onDidCreate(onCssFile);
  cssWatcher.onDidChange(onCssFile);
  cssWatcher.onDidDelete((uri) => {
    cssTexts.delete(uri.fsPath);
    refreshDiagnostics();
  });
  context.subscriptions.push(cssWatcher);

  // --- Feedback en frappe (buffer non sauvegardé, débouncé) -----------------
  let debounce: ReturnType<typeof setTimeout> | undefined;
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e) => {
      const doc = e.document;
      const token = isTokenDoc(doc);
      if (!token && !isCssDoc(doc)) return;
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        const text = doc.getText();
        if (token) {
          tokenTexts.set(doc.uri.fsPath, text);
          index.indexFile(doc.uri.fsPath, text);
        } else {
          cssTexts.set(doc.uri.fsPath, text);
        }
        refreshDiagnostics();
      }, 300);
    })
  );

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => refreshDecorations()),
    vscode.workspace.onDidChangeConfiguration(async (e) => {
      if (!e.affectsConfiguration('dsTokens')) return;
      if (e.affectsConfiguration('dsTokens.tokensGlob')) {
        // Les diagnostics suivent le nouveau glob immédiatement. Les providers
        // IntelliSense, eux, ont capturé tokenFilter à l'enregistrement : ils
        // restent calés sur l'ancien motif jusqu'au rechargement de la fenêtre.
        const glob = readGlob();
        await reindexTokens(glob);
        refreshDiagnostics();
        logIndexState(glob);
        return;
      }
      refreshDecorations();
    })
  );

  // --- Providers IntelliSense ----------------------------------------------
  registerCompletion(context, index, tokenFilter, cssFilter);
  registerHover(context, index, tokenFilter, cssFilter);
  registerDefinition(context, index, tokenFilter, cssFilter);
  registerColors(context, index, tokenFilter);
  registerSemanticTokens(context, tokenFilter);
}

export function deactivate() {}
