// Règles d'analyse — module sans dépendance à 'vscode', testable en pur Node.
// extension.ts convertit les Finding (offsets) en vscode.Diagnostic (Ranges).
import { ALIAS_RE, FULL_ALIAS_RE, type Span, type TokenEntry, type TokenIndex } from './tokenIndex.ts';

export interface Finding {
  file: string;
  span: Span;
  severity: 'error' | 'warning';
  message: string;
  code: string;
}

const HEX_LONG_RE = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/;
const HEX_SHORT_RE = /^#[0-9a-fA-F]{3,4}$/;

/** Span d'un alias {x.y.z} à l'intérieur de la string $value (le +1 saute le guillemet ouvrant). */
function aliasSpan(entry: TokenEntry, matchIndex: number, matchLength: number): Span {
  return { offset: entry.valueSpan.offset + 1 + matchIndex, length: matchLength };
}

/** Distance de Levenshtein bornée, pour les suggestions « vouliez-vous dire… ». */
function levenshtein(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 3) return 99;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

function suggest(ref: string, candidates: Iterable<string>): string | undefined {
  let best: string | undefined;
  let bestDist = 4; // seuil : distance <= 3
  for (const c of candidates) {
    const d = levenshtein(ref, c);
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return best;
}

export function analyzeTokens(index: TokenIndex): Finding[] {
  const findings: Finding[] = [];

  for (const entry of index.entries()) {
    const { value } = entry;

    // Règle 2 : littéral de couleur invalide (attrape #1855)
    if (entry.type === 'color' && !value.includes('{')) {
      if (HEX_SHORT_RE.test(value)) {
        findings.push({
          file: entry.file,
          span: entry.valueSpan,
          severity: 'warning',
          code: 'short-hex',
          message: `Hex court « ${value} » : valide en CSS mais hors spec DTCG, préférez la forme 6 ou 8 caractères.`,
        });
      } else if (!HEX_LONG_RE.test(value)) {
        findings.push({
          file: entry.file,
          span: entry.valueSpan,
          severity: 'error',
          code: 'invalid-color',
          message: `Couleur invalide : « ${value} ». Attendu : #RRGGBB ou #RRGGBBAA.`,
        });
      }
    }

    // Règles 1, 3, 4 : références
    const themes = index.themesForFile(entry.file);
    const isFullAlias = FULL_ALIAS_RE.test(value.trim());

    for (const m of value.matchAll(ALIAS_RE)) {
      const ref = m[1].trim();
      const span = aliasSpan(entry, m.index, m[0].length);
      const ok: string[] = [];
      const missing: string[] = [];
      let cycleMessage: string | undefined;
      let terminalEntry: TokenEntry | undefined;

      for (const theme of themes) {
        const r = index.resolve(ref, theme);
        if (r.cycleAt !== undefined) {
          const loop = [...r.chain.map((e) => e.key), r.cycleAt].join(' → ');
          cycleMessage = `Référence circulaire : ${entry.key} → ${loop}`;
        } else if (r.terminal === null) {
          missing.push(theme);
        } else {
          ok.push(theme);
          terminalEntry = r.chain[r.chain.length - 1];
        }
      }

      if (cycleMessage !== undefined) {
        findings.push({ file: entry.file, span, severity: 'error', code: 'circular-ref', message: cycleMessage });
      } else if (ok.length === 0) {
        const keys = new Set<string>();
        for (const theme of themes) for (const k of index.themeSet(theme).keys()) keys.add(k);
        const near = suggest(ref, keys);
        findings.push({
          file: entry.file,
          span,
          severity: 'error',
          code: 'unknown-ref',
          message:
            `Référence introuvable : {${ref}}.` + (near ? ` Vouliez-vous dire {${near}} ?` : ''),
        });
      } else if (missing.length > 0) {
        findings.push({
          file: entry.file,
          span,
          severity: 'warning',
          code: 'partial-ref',
          message: `{${ref}} est résolu dans « ${ok.join(', ')} » mais pas dans « ${missing.join(', ')} ».`,
        });
      } else if (isFullAlias && entry.type && terminalEntry?.type && terminalEntry.type !== entry.type) {
        findings.push({
          file: entry.file,
          span,
          severity: 'warning',
          code: 'type-mismatch',
          message: `Type incohérent : ${entry.key} est déclaré « ${entry.type} » mais {${ref}} résout vers un token « ${terminalEntry.type} ».`,
        });
      }
    }
  }

  return findings;
}

/** Custom properties déclarées dans un texte CSS (--x: …). */
export function extractCssDecls(text: string): Set<string> {
  const decls = new Set<string>();
  for (const m of text.matchAll(/(?<![\w-])(--[A-Za-z0-9_-]+)\s*:/g)) decls.add(m[1]);
  return decls;
}

/** Sans aucun token indexé, l'extension n'a pas de vérité terrain : elle se tait. */
export function canLintCss(tokenCount: number): boolean {
  return tokenCount > 0;
}

export const CSS_VAR_USE_RE = /var\(\s*(--[A-Za-z0-9_-]+)/g;

/** var(--xxx) ne correspondant ni à un token ni à une custom property connue. */
export function analyzeCss(file: string, text: string, isKnown: (name: string) => boolean): Finding[] {
  const findings: Finding[] = [];
  for (const m of text.matchAll(CSS_VAR_USE_RE)) {
    const name = m[1];
    if (isKnown(name)) continue;
    findings.push({
      file,
      span: { offset: m.index + m[0].indexOf(name), length: name.length },
      severity: 'warning',
      code: 'unknown-css-var',
      message: `« ${name} » ne correspond à aucun design token ni custom property déclarée.`,
    });
  }
  return findings;
}
