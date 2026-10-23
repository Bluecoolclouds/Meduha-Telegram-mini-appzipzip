import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root=path.dirname(fileURLToPath(import.meta.url));
const out=path.join(root,'node_modules/.cache/meduha-tests');
await mkdir(out,{recursive:true});
// Bundle workspace TypeScript just like the server; no native Node TS resolver
// or extra test runtime is required. CJS handles pg's optional dynamic requires.
await build({
  entryPoints:[
    path.join(root,'src/lib/telegram-init-data.test.ts'),
    path.join(root,'src/lib/telegram-commands.test.ts'),
    path.join(root,'src/lib/template-files.test.ts'),
    path.join(root,'src/lib/higgsfield-catalog.test.ts'),
    path.join(root,'src/lib/template-upload-cleanup.test.ts'),
    path.join(root,'src/lib/objectStorage-generation.test.ts'),
    path.join(root,'src/routes/meduha.integration.test.ts'),
    path.join(root,'src/lib/finance.test.ts'),
    path.join(root,'src/lib/finance-multiprocess.integration.test.ts'),
    path.join(root,'src/routes/meduha-admin.integration.test.ts'),
    path.join(root,'src/routes/meduha-generations.integration.test.ts'),
    path.join(root,'src/routes/meduha-genjutsu.integration.test.ts'),
    path.join(root,'src/routes/meduha-photo.integration.test.ts'),
  ],
  bundle:true,platform:'node',format:'cjs',outdir:out,entryNames:'[name]',
  outExtension:{'.js':'.cjs'},external:['pg-native'],logLevel:'warning',
});
const result=spawnSync(process.execPath,[
  '--test','--test-concurrency=1',path.join(out,'telegram-init-data.test.cjs'),path.join(out,'telegram-commands.test.cjs'),path.join(out,'template-files.test.cjs'),path.join(out,'higgsfield-catalog.test.cjs'),path.join(out,'template-upload-cleanup.test.cjs'),path.join(out,'objectStorage-generation.test.cjs'),path.join(out,'meduha.integration.test.cjs'),path.join(out,'finance.test.cjs'),path.join(out,'finance-multiprocess.integration.test.cjs'),path.join(out,'meduha-admin.integration.test.cjs'),
],{stdio:'inherit',env:{...process.env,NODE_ENV:'production'}});
if(result.status!==0)process.exit(result.status??1);
// The bundled test runner cannot resolve pino-pretty's worker entry under its
// temporary output directory. Production logger mode avoids that test-only transport.
const generationResult=spawnSync(process.execPath,[
  '--test','--test-concurrency=1',path.join(out,'meduha-generations.integration.test.cjs'),
  path.join(out,'meduha-genjutsu.integration.test.cjs'),
  path.join(out,'meduha-photo.integration.test.cjs'),
],{stdio:'inherit',env:{...process.env,NODE_ENV:'production'}});
process.exit(generationResult.status??1);
