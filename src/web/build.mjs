import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';

const fontLicenses = await Promise.all([
  readFile('node_modules/@fontsource-variable/manrope/LICENSE', 'utf8'),
  readFile('node_modules/@fontsource/ibm-plex-mono/LICENSE', 'utf8'),
]);

await build({
  entryPoints: ['src/web/app.ts'],
  outfile: 'src/web/app.js',
  bundle: true,
  minify: true,
  target: 'es2022',
  format: 'esm',
  loader: { '.woff2': 'binary' },
  banner: { js: '/*! Bundled font licenses\n' + fontLicenses.join('\n') + '\n*/' },
});
