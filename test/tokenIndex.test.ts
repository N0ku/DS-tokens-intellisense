import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TokenIndex } from '../src/tokenIndex.ts';
import { analyzeTokens, analyzeCss, extractCssDecls } from '../src/diagnostics.ts';

function fixtureIndex(overrides: Partial<Record<'core' | 'light' | 'dark' | 'component', string>> = {}) {
  const index = new TokenIndex();
  index.indexFile(
    '/ws/tokens/core/color.json',
    overrides.core ??
      JSON.stringify({
        color: {
          blue: {
            '500': { $value: '#378ADD', $type: 'color' },
            '600': { $value: '#185FA5', $type: 'color' },
          },
        },
        space: { '400': { $value: '16px', $type: 'dimension' } },
      })
  );
  index.indexFile(
    '/ws/tokens/semantic/light.json',
    overrides.light ??
      JSON.stringify({
        color: { action: { primary: { $value: '{color.blue.600}', $type: 'color' } } },
      })
  );
  index.indexFile(
    '/ws/tokens/semantic/dark.json',
    overrides.dark ??
      JSON.stringify({
        color: { action: { primary: { $value: '{color.blue.500}', $type: 'color' } } },
      })
  );
  index.indexFile(
    '/ws/tokens/component/button.json',
    overrides.component ??
      JSON.stringify({
        button: {
          background: { $value: '{color.action.primary}', $type: 'color' },
          'padding-x': { $value: '{space.400}', $type: 'dimension' },
        },
      })
  );
  return index;
}

test('résolution en chaîne par thème (miroir de build.js)', () => {
  const index = fixtureIndex();
  const light = index.resolve('button.background', 'light');
  assert.equal(light.terminal, '#185FA5');
  assert.deepEqual(light.chain.map((e) => e.key), ['button.background', 'color.action.primary', 'color.blue.600']);
  const dark = index.resolve('button.background', 'dark');
  assert.equal(dark.terminal, '#378ADD');
  assert.deepEqual(index.themeNames(), ['light', 'dark']);
});

test('référence introuvable → error avec suggestion (le bug historique)', () => {
  const index = fixtureIndex({
    component: JSON.stringify({
      button: { text: { $value: '{color.action.primari}', $type: 'color' } },
    }),
  });
  const findings = analyzeTokens(index);
  const f = findings.find((x) => x.code === 'unknown-ref');
  assert.ok(f, 'un unknown-ref attendu');
  assert.equal(f.severity, 'error');
  assert.equal(f.file, '/ws/tokens/component/button.json');
  assert.match(f.message, /color\.action\.primari/);
  assert.match(f.message, /color\.action\.primary/); // suggestion
});

test('résolu dans un seul thème → warning partial-ref', () => {
  const index = fixtureIndex({
    dark: JSON.stringify({ color: { other: { $value: '#000000', $type: 'color' } } }),
  });
  // color.action.primary n'existe que dans light ; button.background y fait référence
  const findings = analyzeTokens(index);
  const f = findings.find((x) => x.code === 'partial-ref');
  assert.ok(f, 'un partial-ref attendu');
  assert.equal(f.severity, 'warning');
  assert.match(f.message, /light/);
  assert.match(f.message, /dark/);
});

test('cycle a → b → a → error sans boucle infinie', () => {
  const index = fixtureIndex({
    light: JSON.stringify({
      color: {
        a: { $value: '{color.b}', $type: 'color' },
        b: { $value: '{color.a}', $type: 'color' },
      },
    }),
  });
  const r = index.resolve('color.a', 'light');
  assert.equal(r.terminal, null);
  assert.equal(r.cycleAt, 'color.a');
  const findings = analyzeTokens(index);
  const cycles = findings.filter((x) => x.code === 'circular-ref');
  assert.ok(cycles.length >= 2, 'error sur chaque token du cycle');
});

test('hex invalide → error, hex court → warning', () => {
  const index = fixtureIndex({
    core: JSON.stringify({
      color: {
        bad: { $value: '#1855', $type: 'color' },
        short: { $value: '#18F', $type: 'color' },
        ok: { $value: '#185FA5', $type: 'color' },
        okAlpha: { $value: '#185FA5CC', $type: 'color' },
      },
    }),
  });
  const findings = analyzeTokens(index);
  assert.equal(findings.find((x) => x.message.includes('#1855'))?.severity, 'warning'); // #1855 = hex 4 → court
  const invalid = fixtureIndex({
    core: JSON.stringify({ color: { bad: { $value: '#18ZZZZ', $type: 'color' } } }),
  });
  assert.equal(analyzeTokens(invalid).find((x) => x.code === 'invalid-color')?.severity, 'error');
});

test('type mismatch alias → warning', () => {
  const index = fixtureIndex({
    component: JSON.stringify({
      button: { radius: { $value: '{color.blue.600}', $type: 'dimension' } },
    }),
  });
  const f = analyzeTokens(index).find((x) => x.code === 'type-mismatch');
  assert.ok(f);
  assert.equal(f.severity, 'warning');
});

test('nommage cssVar + reverse map (vérifié contre build/css)', () => {
  const index = fixtureIndex();
  const vars = index.cssVars();
  assert.ok(vars.has('--color-blue-600'));
  assert.ok(vars.has('--button-padding-x'));
  assert.equal(vars.get('--color-action-primary')?.length, 2); // light + dark
});

test('analyse CSS : var inconnue → warning, var connue ou locale → ok', () => {
  const index = fixtureIndex();
  const css = ':root { --local-thing: 4px; }\n.a { padding: var(--space-400) var(--space-999); margin: var(--local-thing); }';
  const decls = extractCssDecls(css);
  const known = (n: string) => index.cssVars().has(n) || decls.has(n);
  const findings = analyzeCss('/ws/demo.css', css, known);
  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /--space-999/);
});
