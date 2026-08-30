import * as vscode from 'vscode';
import { TokenIndex } from './tokenIndex.ts';
import { analyzeTokens, analyzeCss, extractCssDecls, type Finding } from './diagnostics.ts';
import { registerCompletion } from './providers/completion.ts';
import { registerHover } from './providers/hover.ts';
import { registerDefinition } from './providers/definition.ts';
import { registerColors, refreshCssColorDecorations, refreshTokenNameHighlights } from './providers/colors.ts';
import { registerSemanticTokens } from './providers/semanticTokens.ts';

const SOURCE = 'ds-tokens';

export async function activate(context: vscode.ExtensionContext) {
  const ws = vscode.workspace.workspaceFolders?.[0];
  if (!ws) return;

  const tokensGlob = vscode.workspace.getConfiguration('dsTokens').get<string>('tokensGlob', 'tokens/**/*.json');
  const index = new TokenIndex();
  const collection = vscode.languages.createDiagnosticCollection(SOURCE);
  context.subscriptions.push(collection);

  // Textes connus (fichiers pas forcément ouverts) : nécessaires pour convertir offset → Position.
  const tokenTexts = new Map<string, string>();
  const cssTexts = new Map<string, string>();

  const isBuildCss = (fsPath: string) => /[\\/]build[\\/]/.test(fsPath) || /[\\/]node_modules[\\/]/.test(fsPath);
  const tokenPattern = new vscode.RelativePattern(ws, tokensGlob);
  const tokenFilter: vscode.DocumentFilter = { language: 'json', pattern: tokenPattern };
  const cssFilter: vscode.DocumentFilter = { language: 'css', scheme: 'file' };

  const isTokenDoc = (doc: vscode.TextDocument) => vscode.languages.match({ pattern: tokenPattern }, doc) > 0;
  const isCssDoc = (doc: vscode.TextDocument) => doc.languageId === 'css' && !isBuildCss(doc.uri.fsPath);

  // --- Indexation initiale -------------------------------------------------
  for (const uri of await vscode.workspace.findFiles(tokenPattern, '**/node_modules/**')) {
    const text = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
    tokenTexts.set(uri.fsPath, text);
    index.indexFile(uri.fsPath, text);
  }
  for (const uri of await vscode.workspace.findFiles('**/*.css', '{**/node_modules/**,**/build/**}')) {
    cssTexts.set(uri.fsPath, Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8'));
  }

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

    const workspaceDecls = new Set<string>();
    for (const text of cssTexts.values()) for (const d of extractCssDecls(text)) workspaceDecls.add(d);
    const known = (name: string) => index.cssVars().has(name) || workspaceDecls.has(name);
    for (const [file, text] of cssTexts) {
      for (const finding of analyzeCss(file, text, known)) push(finding, text);
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

  refreshDiagnostics();

  // --- Watchers (sauvegardes / créations / suppressions sur disque) --------
  const tokenWatcher = vscode.workspace.createFileSystemWatcher(tokenPattern);
  const onTokenFile = async (uri: vscode.Uri) => {
    const text = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
    tokenTexts.set(uri.fsPath, text);
    index.indexFile(uri.fsPath, text);
    refreshDiagnostics();
  };
  tokenWatcher.onDidCreate(onTokenFile);
  tokenWatcher.onDidChange(onTokenFile);
  tokenWatcher.onDidDelete((uri) => {
    tokenTexts.delete(uri.fsPath);
    index.removeFile(uri.fsPath);
    refreshDiagnostics();
  });
  context.subscriptions.push(tokenWatcher);

  const cssWatcher = vscode.workspace.createFileSystemWatcher('**/*.css');
  const onCssFile = async (uri: vscode.Uri) => {
    if (isBuildCss(uri.fsPath)) return;
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
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('dsTokens')) refreshDecorations();
    })
  );

  // --- Providers IntelliSense ----------------------------------------------
  registerCompletion(context, index, tokenFilter, cssFilter);
  registerHover(context, index, tokenFilter, cssFilter);
  registerDefinition(context, index, tokenFilter, cssFilter);
  registerColors(context, index, tokenFilter);
  registerSemanticTokens(context, tokenFilter);

  console.log('ds-tokens-intellisense activé —', index.entries().length, 'tokens indexés');
}

export function deactivate() {}
