import { build } from 'esbuild';
import esbuildPluginPino from 'esbuild-plugin-pino';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

globalThis.require = createRequire(import.meta.url);
const root = path.dirname(fileURLToPath(import.meta.url));
const outdir = path.join(root, 'node_modules/.cache/meduha-admin-browser');
await mkdir(outdir, { recursive: true });
await build({
  entryPoints: { fixture: path.join(root, 'src/routes/meduha-photo-limit-browser-fixture.ts') },
  outdir: path.join(root, 'node_modules/.cache/meduha-photo-limit-browser'),
  entryNames: '[name]',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outExtension: { '.js': '.cjs' },
  external: ['pg-native'],
  plugins: [esbuildPluginPino({ transports: ['pino-pretty'] })],
  logLevel: 'warning',
});
await build({
  entryPoints: {
    fixture: path.join(root, 'src/routes/meduha-admin-browser-fixture.ts'),
  },
  outdir,
  entryNames: '[name]',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outExtension: { '.js': '.cjs' },
  external: ['pg-native'],
  plugins: [esbuildPluginPino({ transports: ['pino-pretty'] })],
  logLevel: 'warning',
});
