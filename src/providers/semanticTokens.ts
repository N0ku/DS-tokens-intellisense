import * as vscode from 'vscode';
import { parseTree, type Node } from 'jsonc-parser';

// Catégories syntaxiques propres au DTCG. Chaque id est mappé dans package.json
// (semanticTokenScopes) vers un scope TextMate connu → couleur distincte dans tout thème.
export const legend = new vscode.SemanticTokensLegend(
  ['dsGroup', 'dsToken', 'dsValueKey', 'dsTypeKey', 'dsAlias'],
  []
);

export function registerSemanticTokens(context: vscode.ExtensionContext, tokenFilter: vscode.DocumentFilter) {
  context.subscriptions.push(
    vscode.languages.registerDocumentSemanticTokensProvider(
      tokenFilter,
      {
        provideDocumentSemanticTokens(doc) {
          const builder = new vscode.SemanticTokensBuilder(legend);
          const root = parseTree(doc.getText(), undefined, { allowTrailingComma: true });
          if (!root) return builder.build();

          const push = (offset: number, length: number, type: string) => {
            const pos = doc.positionAt(offset);
            builder.push(pos.line, pos.character, length, legend.tokenTypes.indexOf(type), 0);
          };

          const walk = (node: Node): void => {
            if (node.type !== 'object' || !node.children) return;
            for (const prop of node.children) {
              if (prop.type !== 'property' || !prop.children || prop.children.length < 2) continue;
              const [keyNode, valueNode] = prop.children;
              const key = String(keyNode.value);
              // keyNode inclut les guillemets → +1 / -2 pour ne colorer que le nom
              if (key === '$value') {
                push(keyNode.offset + 1, keyNode.length - 2, 'dsValueKey');
                if (valueNode.type === 'string') {
                  const v = String(valueNode.value ?? '');
                  for (const m of v.matchAll(/\{[^{}]+\}/g)) {
                    push(valueNode.offset + 1 + m.index, m[0].length, 'dsAlias');
                  }
                }
              } else if (key.startsWith('$')) {
                // $type, $description, …
                push(keyNode.offset + 1, keyNode.length - 2, 'dsTypeKey');
              } else if (valueNode.type === 'object') {
                const isToken = valueNode.children?.some(
                  (p) => p.type === 'property' && p.children && String(p.children[0].value) === '$value'
                );
                push(keyNode.offset + 1, keyNode.length - 2, isToken ? 'dsToken' : 'dsGroup');
                walk(valueNode);
              }
            }
          };

          walk(root);
          return builder.build();
        },
      },
      legend
    )
  );
}
