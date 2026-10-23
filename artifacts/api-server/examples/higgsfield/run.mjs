import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const entry = new URL('./index.ts', import.meta.url);
const output = new URL('../../node_modules/.cache/higgsfield-example.mjs', import.meta.url);
await build({ entryPoints: [fileURLToPath(entry)], outfile: fileURLToPath(output), bundle: true, packages: 'external', platform: 'node', format: 'esm' });
const child = spawnSync(process.execPath, [fileURLToPath(output)], { stdio: 'inherit' });
process.exit(child.status ?? 1);
