// Imports public documentation only. Never submits a generation or reads credentials.
import { writeFile } from 'node:fs/promises';
import vm from 'node:vm';

const seeds = [
  'bytedance/seedance-2.5/text-to-video',
  'higgsfield/genjutsu-light/motion-transfer/v1.0',
  'higgsfield/genjutsu/motion-transfer/v1.0',
  'kling-video/v4.0/text-to-video', 'minimax/h3/text-to-video',
  'alibaba/wan-3.0-prime/text-to-video', 'bytedance/seedance-2.0/text-to-video',
  'higgsfield/cinema-studio/4.0', 'workflows/genjutsu',
  'kling-video/v3.0/std/text-to-video', 'alibaba/wan-3.0/text-to-video',
  'lightricks/ltx-2.5/text-to-video/fast', 'lightricks/ltx-2.5/text-to-video/pro',
  'xai/grok-imagine-video/v1.5/reference-to-video', 'wan/v2.7/text-to-video',
  'alibaba/happy-horse/v1.1/text-to-video', 'alibaba/happy-horse/text-to-video',
  'pixverse/v6/text-to-video', 'kling-video/o3/first-last-frame',
  'kling-video/v2.6/pro/text-to-video', 'kling-video/omni/first-last-frame',
  'wan/v2.6/text-to-video', 'minimax/hailuo-2.3/standard/text-to-video',
  'kling-video/v2.5-turbo/standard/image-to-video',
];
function expression(html, marker, opening = '{') {
  const at = html.indexOf(marker);
  if (at < 0) throw new Error(`Missing ${marker}`);
  const offset = at + marker.length;
  const assignment = /^\$R\[\d+\]=/.exec(html.slice(offset));
  const start = html.indexOf(opening, offset + (assignment?.[0].length ?? 0));
  let depth = 0, quote = '', escaped = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === quote) quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '{' || c === '[') depth++;
    else if ((c === '}' || c === ']') && --depth === 0) {
      const literal = html.slice(start, i + 1).replace(/\$R\[\d+\]=/g, '');
      return JSON.parse(vm.runInNewContext(`JSON.stringify((${literal}))`, {}, { timeout: 500 }));
    }
  }
  throw new Error(`Unterminated ${marker}`);
}
async function page(slug) {
  const source = `https://open.higgsfield.ai/models/${slug}/playground`;
  const response = await fetch(source, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Catalog ${response.status}: ${slug}`);
  const html = await response.text();
  const plain = html.replace(/<[^>]*>/g, '').replaceAll('&quot;', '"').replaceAll('&amp;', '&');
  const endpoint = /higgsfield\.subscribe\(\s*(?:\d+)?\s*"([^"]+)"/.exec(plain)?.[1];
  if (!endpoint) throw new Error(`Missing documented SDK endpoint: ${slug}`);
  const schema = expression(html, 'input_schema:');
  const name = /<title>(.*?)<\/title>/.exec(html)?.[1]?.split(' — ')[0].replace(/\s*\|.*$/, '') ?? slug;
  const family = expression(html, 'family:', '[');
  const description = /catalog_description:"((?:\\.|[^"])*)"/.exec(html)?.[1] ?? '';
  let outputSchema;
  try { outputSchema = expression(html, 'output_schema:'); } catch { outputSchema = {}; }
  return { id: slug, name, endpoint, source, schema, outputSchema, family, description };
}
const models = new Map(), families = [];
for (const seed of seeds) {
  const first = models.get(seed) ?? await page(seed);
  const members = first.family.length ? first.family : [{ slug: seed, variant_title: '', title: first.name }];
  const familyId = seed;
  const ids = [];
  for (const entry of members) {
    if (ids.includes(entry.slug)) continue;
    const model = models.get(entry.slug) ?? (entry.slug === seed ? first : await page(entry.slug));
    models.set(entry.slug, { ...model, familyId, mode: entry.variant_title ?? '', workflow: seed.startsWith('workflows/') });
    ids.push(entry.slug);
  }
  families.push({ id: familyId, name: first.name, description: first.description, source: first.source, modes: ids });
  console.log(`${first.name}: ${ids.length} modes`);
}
const out = { source: 'https://open.higgsfield.ai/explore?tab=video', families, models: [...models.values()].map(({ family, ...model }) => model) };
await writeFile(new URL('../artifacts/api-server/src/lib/video-catalog.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');
console.log(`Verified ${families.length} families / ${models.size} distinct modes.`);
