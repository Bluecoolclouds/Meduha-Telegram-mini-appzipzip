// Refresh public, documented input schemas only. Never submits a generation.
import { writeFile } from 'node:fs/promises';
import vm from 'node:vm';

const origin = 'https://open.higgsfield.ai';
const seeds = [
  'higgsfield-ai/soul/standard', 'higgsfield-ai/soul/v2/standard',
  'higgsfield-ai/soul/v2/image-to-image', 'xai/grok-imagine-image-2.0',
  'marketing-studio/image', 'higgsfield/ai-influencer', 'ideogram/v4.0',
  'recraft/v4.1/text-to-image', 'alibaba/qwen-image-3/text-to-image',
  'z-image/turbo', 'workflows/ads-studio', 'workflows/product-shots',
  'workflows/graphic-ads', 'workflows/marketplace-design',
];
function expression(html, marker) {
  const at = html.indexOf(marker);
  if (at < 0) throw new Error(`Missing ${marker}`);
  const start = html.indexOf('{', at + marker.length);
  let depth = 0, quote = '', escaped = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === quote) quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) {
      // Isolated VM has no process, fetch, filesystem or application credentials.
      return JSON.parse(vm.runInNewContext(`JSON.stringify((${html.slice(start, i + 1).replace(/\$R\[\d+\]=/g, '')}))`, {}, { timeout: 500 }));
    }
  }
  throw new Error('Unterminated public schema');
}
const pending = new Set(seeds), models = [], seen = new Set();
for (const slug of pending) {
  if (seen.has(slug)) continue;
  seen.add(slug);
  const source = `${origin}/models/${slug}/playground`;
  const response = await fetch(source, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Catalog HTTP ${response.status}: ${slug}`);
  const html = await response.text();
  const schema = expression(html, 'input_schema:');
  // The SDK example identifies the actual submission endpoint, including workflows.
  const plain = html.replace(/<[^>]*>/g, '').replaceAll('&quot;', '"').replaceAll('&amp;', '&');
  const endpoint = /higgsfield\.subscribe\(\s*(?:\d+)?\s*"([^"]+)"/.exec(plain)?.[1];
  if (!endpoint) throw new Error(`No verified SDK endpoint: ${slug}`);
  const title = /<title>(.*?)<\/title>/.exec(html)?.[1]?.split(' — ')[0] ?? schema.title ?? slug;
  models.push({ id: slug, endpoint, name: title, source, schema, workflow: slug.startsWith('workflows/') });
  const family = slug.startsWith('marketing-studio/') ? 'marketing-studio/image'
    : slug.startsWith('recraft/') ? 'recraft/v4.1/'
    : slug.startsWith('alibaba/qwen-image-3/') ? 'alibaba/qwen-image-3/' : null;
  if (family) {
    for (const match of html.matchAll(/(?:route_slug|canonical_route_slug|slug):"([^"]+)"/g)) {
      if (match[1].startsWith(family) && !match[1].includes('..')) pending.add(match[1]);
    }
  }
  console.log(`${slug} → ${endpoint}`);
}
await writeFile(new URL('../artifacts/api-server/src/lib/photo-catalog.json', import.meta.url), JSON.stringify({ models }, null, 2) + '\n');
console.log(`Saved ${models.length} verified photo modes.`);
