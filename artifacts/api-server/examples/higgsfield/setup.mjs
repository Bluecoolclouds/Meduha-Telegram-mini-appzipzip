import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const output = new URL('../../node_modules/.cache/higgsfield-setup.cjs', import.meta.url);
await build({
  entryPoints: [fileURLToPath(new URL('./setup.ts', import.meta.url))],
  outfile: fileURLToPath(output), bundle: true, platform: 'node', format: 'cjs',
  external: ['pg-native'], logLevel: 'warning',
});
const child = spawnSync(process.execPath, [fileURLToPath(output), ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(child.status ?? 1);
