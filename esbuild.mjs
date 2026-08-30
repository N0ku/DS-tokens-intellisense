import esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

const ctx = await esbuild.context({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  // Sans ça, esbuild prend le build UMD de jsonc-parser (champ "main"), dont les
  // require('./impl/…') internes ne sont pas bundlables et cassent au runtime.
  mainFields: ['module', 'main'],
  sourcemap: true,
});

if (watch) {
  await ctx.watch();
  console.log('esbuild : mode watch…');
} else {
  await ctx.rebuild();
  await ctx.dispose();
  console.log('esbuild : build terminé');
}
