// Modèle central des design tokens.
// IMPORTANT : ce module n'importe JAMAIS 'vscode' — il reste testable en pur Node.
import { parseTree, findNodeAtLocation, type Node } from 'jsonc-parser';

export interface Span {
  offset: number;
  length: number;
}

export interface TokenEntry {
  /** Chemin du token, ex. ['color', 'action', 'primary'] */
  path: string[];
  /** Clé pointée, ex. 'color.action.primary' */
  key: string;
  /** Nom de la custom property générée, ex. '--color-action-primary' */
  cssVar: string;
  /** $value brut : '#185FA5' ou '{color.blue.600}' */
  value: string;
  /** $type déclaré ('color', 'dimension', …) */
  type: string | undefined;
  /** Chemin absolu du fichier de définition */
  file: string;
  /** Position de la clé du token (cible du go-to-definition) */
  nameSpan: Span;
  /** Position de la string $value (cible des squiggles) */
  valueSpan: Span;
  /** 'core' | 'component' | 'semantic:<theme>' */
  layer: string;
}

export interface ResolveResult {
  /** Chaîne d'entrées suivies, dans l'ordre */
  chain: TokenEntry[];
  /** Valeur littérale finale, ou null si cassé / cycle */
  terminal: string | null;
  /** Clé introuvable, si la résolution a échoué */
  missing?: string;
  /** Clé sur laquelle un cycle a été détecté */
  cycleAt?: string;
}

/** Alias DTCG {a.b.c} — global, réutiliser avec .matchAll */
export const ALIAS_RE = /\{([^{}]+)\}/g;
/** Un $value qui est exactement un alias */
export const FULL_ALIAS_RE = /^\{([^{}]+)\}$/;

// Le nom du thème est le nom du fichier, suffixe conventionnel .tokens.json accepté
const SEMANTIC_LAYER_RE = /tokens[\\/]semantic[\\/]([^\\/]+?)(?:\.tokens)?\.json$/;

export function inferLayer(file: string): string {
  const m = SEMANTIC_LAYER_RE.exec(file);
  if (m) return `semantic:${m[1]}`;
  if (/tokens[\\/]component[\\/]/.test(file)) return 'component';
  return 'core';
}

/** Extrait les tokens d'un fichier DTCG (un nœud objet portant $value = un token). */
export function parseTokensFile(file: string, text: string): TokenEntry[] {
  const entries: TokenEntry[] = [];
  const root = parseTree(text, undefined, { allowTrailingComma: true });
  if (!root || root.type !== 'object') return entries;
  const layer = inferLayer(file);

  const walk = (node: Node, path: string[]): void => {
    if (node.type !== 'object' || !node.children) return;
    for (const prop of node.children) {
      if (prop.type !== 'property' || !prop.children || prop.children.length < 2) continue;
      const [keyNode, valueNode] = prop.children;
      const key = String(keyNode.value);
      if (key.startsWith('$')) continue;
      if (valueNode.type !== 'object') continue;

      const valueProp = findNodeAtLocation(valueNode, ['$value']);
      if (valueProp !== undefined) {
        const typeNode = findNodeAtLocation(valueNode, ['$type']);
        const p = [...path, key];
        entries.push({
          path: p,
          key: p.join('.'),
          cssVar: '--' + p.join('-'),
          value: String(valueProp.value ?? ''),
          type: typeNode ? String(typeNode.value) : undefined,
          file,
          nameSpan: { offset: keyNode.offset, length: keyNode.length },
          valueSpan: { offset: valueProp.offset, length: valueProp.length },
          layer,
        });
      } else {
        walk(valueNode, [...path, key]);
      }
    }
  };

  walk(root, []);
  return entries;
}

export class TokenIndex {
  private byFile = new Map<string, TokenEntry[]>();
  private cache: {
    themes: Map<string, Map<string, TokenEntry>>;
    cssVars: Map<string, TokenEntry[]>;
  } | null = null;

  indexFile(file: string, text: string): void {
    this.byFile.set(file, parseTokensFile(file, text));
    this.cache = null;
  }

  removeFile(file: string): void {
    this.byFile.delete(file);
    this.cache = null;
  }

  files(): string[] {
    return [...this.byFile.keys()];
  }

  entries(): TokenEntry[] {
    return [...this.byFile.values()].flat();
  }

  /** Noms de thèmes, 'light' d'abord si présent ; ['default'] s'il n'y a aucune couche sémantique. */
  themeNames(): string[] {
    const names = [...this.buildCache().themes.keys()];
    return names.length ? names : ['default'];
  }

  /** L'ensemble résolvable pour un thème : core + component + sémantique de CE thème (miroir de build.js). */
  themeSet(theme: string): Map<string, TokenEntry> {
    return this.buildCache().themes.get(theme) ?? this.sharedSet();
  }

  /** Thèmes contre lesquels valider une référence écrite dans ce fichier. */
  themesForFile(file: string): string[] {
    const layer = inferLayer(file);
    const m = /^semantic:(.+)$/.exec(layer);
    if (m) return [m[1]];
    return this.themeNames();
  }

  /** Reverse map custom property CSS → définitions (une par thème pour la couche sémantique). */
  cssVars(): Map<string, TokenEntry[]> {
    return this.buildCache().cssVars;
  }

  entryAt(file: string, key: string): TokenEntry | undefined {
    return this.byFile.get(file)?.find((e) => e.key === key);
  }

  /** Suit les alias jusqu'à une valeur littérale, avec détection de cycle. */
  resolve(key: string, theme: string): ResolveResult {
    const set = this.themeSet(theme);
    const chain: TokenEntry[] = [];
    const visited = new Set<string>();
    let current = key;
    for (;;) {
      if (visited.has(current)) return { chain, terminal: null, cycleAt: current };
      visited.add(current);
      const entry = set.get(current);
      if (!entry) return { chain, terminal: null, missing: current };
      chain.push(entry);
      const m = FULL_ALIAS_RE.exec(entry.value.trim());
      if (!m) return { chain, terminal: entry.value };
      current = m[1].trim();
    }
  }

  private sharedSet(): Map<string, TokenEntry> {
    const shared = new Map<string, TokenEntry>();
    for (const entries of this.byFile.values()) {
      for (const e of entries) {
        if (!e.layer.startsWith('semantic:')) shared.set(e.key, e);
      }
    }
    return shared;
  }

  private buildCache() {
    if (this.cache) return this.cache;

    const shared = this.sharedSet();
    const semantic = new Map<string, TokenEntry[]>();
    for (const entries of this.byFile.values()) {
      for (const e of entries) {
        const m = /^semantic:(.+)$/.exec(e.layer);
        if (m) {
          const list = semantic.get(m[1]) ?? [];
          list.push(e);
          semantic.set(m[1], list);
        }
      }
    }

    // 'light' d'abord pour des résolutions déterministes côté hover/couleurs
    const themeOrder = [...semantic.keys()].sort((a, b) =>
      a === 'light' ? -1 : b === 'light' ? 1 : a.localeCompare(b)
    );

    const themes = new Map<string, Map<string, TokenEntry>>();
    for (const theme of themeOrder) {
      const set = new Map(shared);
      for (const e of semantic.get(theme)!) set.set(e.key, e);
      themes.set(theme, set);
    }

    const cssVars = new Map<string, TokenEntry[]>();
    for (const entries of this.byFile.values()) {
      for (const e of entries) {
        const list = cssVars.get(e.cssVar) ?? [];
        list.push(e);
        cssVars.set(e.cssVar, list);
      }
    }

    this.cache = { themes, cssVars };
    return this.cache;
  }
}
