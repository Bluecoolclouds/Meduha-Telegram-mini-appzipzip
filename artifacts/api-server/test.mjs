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
    path.join(root,'src/lib/feed-media.test.ts'),
    { in: path.join(root,'src/routes/feed-media.test.ts'), out: 'feed-media-route.test' },
    path.join(root,'src/lib/telegram-init-data.test.ts'),
    path.join(root,'src/lib/telegram-commands.test.ts'),
    path.join(root,'src/lib/template-files.test.ts'),
    path.join(root,'src/lib/higgsfield-catalog.test.ts'),
    path.join(root,'src/lib/higgsfield.test.ts'),
    path.join(root,'src/lib/template-upload-cleanup.test.ts'),
    path.join(root,'src/lib/objectStorage-generation.test.ts'),
    path.join(root,'src/lib/storage-transport.test.ts'),
    path.join(root,'src/lib/video-pricing.test.ts'),
    path.join(root,'src/lib/photo-pricing.test.ts'),
    path.join(root,'src/lib/billing-pricing.test.ts'),
    path.join(root,'src/lib/payment-providers.test.ts'),
    path.join(root,'src/lib/catalog-availability.test.ts'),
    path.join(root,'src/routes/meduha.integration.test.ts'),
    path.join(root,'src/lib/finance.test.ts'),
    path.join(root,'src/lib/finance-multiprocess.integration.test.ts'),
    path.join(root,'src/routes/meduha-admin.integration.test.ts'),
    path.join(root,'src/routes/meduha-admin-password.integration.test.ts'),
    path.join(root,'src/routes/meduha-generations.integration.test.ts'),
    path.join(root,'src/routes/meduha-genjutsu.integration.test.ts'),
    path.join(root,'src/routes/meduha-photo.integration.test.ts'),
    path.join(root,'src/routes/meduha-video.integration.test.ts'),
    path.join(root,'src/routes/template-recipes.integration.test.ts'),
    path.join(root,'src/routes/example-media.test.ts'),
  ],
  bundle:true,platform:'node',format:'cjs',outdir:out,entryNames:'[name]',
  outExtension:{'.js':'.cjs'},external:['pg-native'],logLevel:'warning',
});
if (process.argv.includes('--finance-isolated')) {
  const financeResult = spawnSync(process.execPath, [
    '--test', path.join(out, 'finance-multiprocess.integration.test.cjs'),
  ], { stdio: 'inherit', env: { ...process.env, NODE_ENV: 'production' } });
  process.exit(financeResult.status ?? 1);
}
if (process.argv.includes('--photo-pricing')) {
  const pricingResult = spawnSync(process.execPath, [
    '--test', path.join(out, 'photo-pricing.test.cjs'),
  ], { stdio: 'inherit', env: { ...process.env, NODE_ENV: 'production' } });
  process.exit(pricingResult.status ?? 1);
}
if (process.argv.includes('--payment-unit')) {
  const paymentResult = spawnSync(process.execPath, [
    '--test', path.join(out, 'billing-pricing.test.cjs'), path.join(out, 'payment-providers.test.cjs'),
  ], { stdio: 'inherit', env: { ...process.env, NODE_ENV: 'production' } });
  process.exit(paymentResult.status ?? 1);
}
if (process.argv.includes('--photo')) {
  const photoResult = spawnSync(process.execPath, [
    '--test', path.join(out, 'meduha-photo.integration.test.cjs'),
  ], { stdio: 'inherit', env: { ...process.env, NODE_ENV: 'production' } });
  process.exit(photoResult.status ?? 1);
}
if (process.argv.includes('--feed-media')) {
  const mediaResult = spawnSync(process.execPath, [
    '--test', path.join(out, 'feed-media.test.cjs'), path.join(out, 'feed-media-route.test.cjs'),
  ], { stdio: 'inherit', env: { ...process.env, NODE_ENV: 'production' } });
  process.exit(mediaResult.status ?? 1);
}
if (process.argv.includes('--admin-access')) {
  const adminResult = spawnSync(process.execPath, [
    '--test', path.join(out, 'meduha-admin-password.integration.test.cjs'),
  ], { stdio: 'inherit', env: { ...process.env, NODE_ENV: 'production' } });
  process.exit(adminResult.status ?? 1);
}
const result=spawnSync(process.execPath,[
  '--test', '--test-concurrency=1', path.join(out,'storage-transport.test.cjs'),
  path.join(out,'video-pricing.test.cjs'),
  path.join(out,'photo-pricing.test.cjs'),
  path.join(out,'billing-pricing.test.cjs'),
  path.join(out,'payment-providers.test.cjs'),
  path.join(out,'catalog-availability.test.cjs'),
  path.join(out,'feed-media.test.cjs'),path.join(out,'feed-media-route.test.cjs'),path.join(out,'telegram-init-data.test.cjs'),path.join(out,'telegram-commands.test.cjs'),path.join(out,'template-files.test.cjs'),path.join(out,'higgsfield-catalog.test.cjs'),path.join(out,'higgsfield.test.cjs'),path.join(out,'template-upload-cleanup.test.cjs'),path.join(out,'objectStorage-generation.test.cjs'),path.join(out,'meduha.integration.test.cjs'),path.join(out,'finance.test.cjs'),path.join(out,'finance-multiprocess.integration.test.cjs'),path.join(out,'meduha-admin.integration.test.cjs'),path.join(out,'example-media.test.cjs'),
  path.join(out,'meduha-admin-password.integration.test.cjs'),
],{stdio:'inherit',env:{...process.env,NODE_ENV:'production'}});
if(result.status!==0)process.exit(result.status??1);
// The bundled test runner cannot resolve pino-pretty's worker entry under its
// temporary output directory. Production logger mode avoids that test-only transport.
const generationResult=spawnSync(process.execPath,[
  '--test','--test-concurrency=1',path.join(out,'meduha-generations.integration.test.cjs'),
  path.join(out,'meduha-genjutsu.integration.test.cjs'),
  path.join(out,'meduha-photo.integration.test.cjs'),
  path.join(out,'meduha-video.integration.test.cjs'),
  path.join(out,'template-recipes.integration.test.cjs'),
],{stdio:'inherit',env:{...process.env,NODE_ENV:'production'}});
process.exit(generationResult.status??1);
