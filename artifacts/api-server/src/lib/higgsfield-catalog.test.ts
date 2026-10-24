import { test } from 'node:test';
import assert from 'node:assert/strict';
import { discoverHiggsfieldCatalog, getFreshHiggsfieldCatalog, refreshHiggsfieldCatalog } from './higgsfield-catalog';

const videoListing = `# Video Generation API
Choose from **1 model family** and **1 catalog entry**.
## Models
[ByteDanceVideo · 1 workflow
Seedance 2.5
View API reference →](/docs/models/seedance-2-5.md)
`;
const imageListing = `# Image Generation API
Choose from **2 model families** and **2 catalog entries**.
## Models
[RecraftImage · 1 workflow
Recraft V4.1
Generate images with palette controls.
View API reference →](/docs/models/recraft-v4-1)
[HiggsfieldImage · 1 workflow
Soul ID
Train a character from reference images.
View API reference →](/docs/models/soul-id)
[External reference](https://example.test/docs/models/not-a-model)
`;
const seedanceFamily = `# Seedance 2.5 API
## Workflows
| Workflow | Endpoint |
| --- | --- |
| [Text to video](/docs/models/seedance-2-5/text-to-video) | \`POST /bytedance/seedance-2.5/text-to-video\` |
`;
const seedanceWorkflow = `# Seedance 2.5 — Text to video API
**Endpoint:** \`POST https://api.higgsfield.ai/bytedance/seedance-2.5/text-to-video\`
**Endpoint ID:** \`bytedance/seedance-2.5/text-to-video\`
## Input schema
> **Complete JSON schema**
>
> \`\`\`json theme={"theme":{"light":"github-light","dark":"github-dark"}}
> {
>   "type": "object",
>   "required": ["prompt"],
>   "properties": {
>     "prompt": { "type": "string", "minLength": 1, "description": "Write your prompt here" },
>     "duration": { "type": "integer", "default": 5, "minimum": 4, "maximum": 30 },
>     "resolution": { "type": "string", "default": "720p", "enum": ["480p", "720p", "1080p"] },
>     "generate_audio": { "type": "boolean", "default": true },
>     "aspect_ratio": { "type": ["string", "null"], "enum": ["16:9", "1:1", "9:16"] },
>     "callback_url": { "type": "string", "format": "uri", "maxLength": 2048 }
>   },
>   "additionalProperties": false
> }
> \`\`\`
`;
const recraftWorkflow = `# Recraft V4.1 — Text to image API
**Endpoint:** \`POST https://api.higgsfield.ai/recraft/v4.1/text-to-image\`
**Endpoint ID:** \`recraft/v4.1/text-to-image\`
## Input schema
**Complete JSON schema**
\`\`\`json theme={"theme":{"light":"github-light","dark":"github-dark"}}
{
  "type": "object",
  "required": ["prompt", "style"],
  "properties": {
    "prompt": { "type": "string", "minLength": 1, "maxLength": 2000 },
    "style": { "type": "string", "enum": ["realistic_image", "digital_illustration"] },
    "seed": { "type": "integer", "minimum": 0, "maximum": 2147483647 }
  }
}
\`\`\`
`;
const soulIdFamily = `# Soul ID API
## Workflows
| Workflow | Endpoint |
| --- | --- |
| [Create character](/docs/models/soul-id/create-character) | \`POST /v1/custom-references\` |
`;
const soulIdWorkflow = `# Soul ID — Create character API
**Endpoint:** \`POST https://api.higgsfield.ai/v1/custom-references\`
## Input schema
\`\`\`json
{ "type": "object", "properties": { "name": { "type": "string" } } }
\`\`\`
`;

test('reads only official docs, parses documented endpoints and schemas, and marks a failed refresh stale', async () => {
  const requested: string[] = [];
  const fixture = new Map([
    ['/docs/models/video-generation.md', videoListing],
    ['/docs/models/image-generation.md', imageListing],
    ['/docs/models/seedance-2-5.md', seedanceFamily],
    ['/docs/models/seedance-2-5/text-to-video.md', seedanceWorkflow],
    ['/docs/models/recraft-v4-1.md', recraftWorkflow],
    ['/docs/models/soul-id.md', soulIdFamily],
    ['/docs/models/soul-id/create-character.md', soulIdWorkflow],
  ]);
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    requested.push(`${url.origin}${url.pathname}:${init?.method ?? 'GET'}`);
    assert.equal(url.origin, 'https://docs.higgsfield.ai');
    assert.ok(init?.method === undefined || init.method === 'GET', 'discovery must remain read-only');
    const body = fixture.get(url.pathname);
    return new Response(body ?? 'not found', { status: body ? 200 : 404 });
  };

  const catalog = await discoverHiggsfieldCatalog(fetcher);
  assert.equal(catalog.status, 'partial');
  assert.equal(catalog.discoveryApi, 'not_documented');
  assert.equal(catalog.entries.length, 2);
  const seedance = catalog.entries.find(entry => entry.endpointId === 'bytedance/seedance-2.5/text-to-video');
  assert(seedance);
  assert.equal(seedance.schemaAvailable, true);
  assert.deepEqual(seedance.parameters.map(parameter => parameter.name),
    ['prompt', 'duration', 'resolution', 'generate_audio', 'aspect_ratio', 'callback_url']);
  assert.equal(seedance.parameters[0].required, true);
  assert.equal(seedance.parameters[0].description, 'Write your prompt here');
  assert.equal(seedance.parameters[1].defaultValue, 5);
  assert.deepEqual(seedance.parameters[2].allowedValues, ['480p', '720p', '1080p']);
  assert.equal(seedance.parameters[3].defaultValue, true);
  assert.equal(seedance.parameters[4].type, 'string | null');
  assert.equal(seedance.parameters[5].format, 'uri');
  assert.equal(seedance.parameters[5].maxLength, 2048);
  const recraft = catalog.entries.find(entry => entry.endpointId === 'recraft/v4.1/text-to-image');
  assert(recraft);
  assert.equal(recraft.parameters[0].maxLength, 2000);
  assert.deepEqual(recraft.parameters[1].allowedValues, ['realistic_image', 'digital_illustration']);
  assert.equal(recraft.parameters[2].maximum, 2147483647);
  assert.match(catalog.warnings.join(' '), /не содержит проверяемого endpoint ID/);
  assert(requested.every(url => url.startsWith('https://docs.higgsfield.ai/docs/models/') && /:(GET)$/.test(url)));
  assert.equal(requested.some(url => url.includes('example.test') || url.includes('api.higgsfield.ai')), false);
  assert(catalog.sourceUrls.every(url => new URL(url).origin === 'https://docs.higgsfield.ai'));

  const failedRefresh: typeof fetch = async () => new Response('offline', { status: 503 });
  const stale = await refreshHiggsfieldCatalog(failedRefresh);
  assert.equal(stale.status, 'stale');
  assert.match(stale.warnings[0], /устаревшего снимка/);
  await assert.rejects(() => getFreshHiggsfieldCatalog(failedRefresh));
});

test('a changed model listing and a direct endpoint without a schema remain visibly partial', async () => {
  const fixture = new Map([
    ['/docs/models/video-generation.md', `# Video Generation API
## Featured models
[Undocumented format](/docs/models/changed-format)
`],
    ['/docs/models/image-generation.md', `# Image Generation API
Choose from **2 model families** and **2 catalog entries**.
## Models
[Model · 1 workflow](/docs/models/no-schema)
[Model with changed schema · 1 workflow](/docs/models/unsupported-schema)
`],
    ['/docs/models/no-schema.md', `# Example Model API
**Endpoint:** \`POST https://api.higgsfield.ai/example/generate\`
**Endpoint ID:** \`example/generate\`
## Input schema
`],
    ['/docs/models/unsupported-schema.md', `# Example Model with changed schema API
**Endpoint:** \`POST https://api.higgsfield.ai/example/changed-schema\`
**Endpoint ID:** \`example/changed-schema\`
**Complete JSON schema**
\`\`\`json
{
  "type": "object",
  "properties": {
    "prompt": { "type": "string", "pattern": "^[a-z]+$" }
  }
}
\`\`\`
`],
  ]);
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, 'https://docs.higgsfield.ai');
    assert.ok(init?.method === undefined || init.method === 'GET');
    const body = fixture.get(url.pathname);
    return new Response(body ?? 'not found', { status: body ? 200 : 404 });
  };

  const catalog = await discoverHiggsfieldCatalog(fetcher);
  assert.equal(catalog.status, 'partial');
  assert.deepEqual(catalog.entries.map(entry => entry.endpointId).sort(), ['example/changed-schema', 'example/generate']);
  assert(catalog.entries.every(entry => entry.schemaAvailable === false),
    'a missing schema and an unrecognized schema constraint must not be presented as complete');
  assert.match(catalog.warnings.join(' '), /раздел Models/);
  assert.match(catalog.warnings.join(' '), /схема параметров недоступна/);
});

test('catalog pages with no verified endpoint are unavailable rather than an empty live catalog', async () => {
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, 'https://docs.higgsfield.ai');
    assert.ok(init?.method === undefined || init.method === 'GET');
    return new Response('# Model index\n## Featured models\nNo verified model links.', { status: 200 });
  };
  await assert.rejects(() => discoverHiggsfieldCatalog(fetcher), /проверяемых endpoint ID/);
});

test('discovers absolute official documentation links without following other origins', async () => {
  const absoluteLinks = (text: string) => text.replace(/\]\((\/docs\/models\/[^)]+)\)/g, '](' + 'https://docs.higgsfield.ai$1)');
  const fixture = new Map([
    ['/docs/models/video-generation.md', absoluteLinks(videoListing)],
    ['/docs/models/image-generation.md', absoluteLinks(imageListing)
      + '\n[Injected · 1 workflow](https://docs.higgsfield.ai.evil.test/docs/models/injected.md)\n'],
    ['/docs/models/seedance-2-5.md', absoluteLinks(seedanceFamily)],
    ['/docs/models/seedance-2-5/text-to-video.md', seedanceWorkflow],
    ['/docs/models/recraft-v4-1.md', recraftWorkflow],
    ['/docs/models/soul-id.md', absoluteLinks(soulIdFamily)],
    ['/docs/models/soul-id/create-character.md', soulIdWorkflow],
  ]);
  const requested: string[] = [];
  const fetcher: typeof fetch = async input => {
    const url = new URL(String(input));
    assert.equal(url.origin, 'https://docs.higgsfield.ai');
    requested.push(url.pathname);
    const body = fixture.get(url.pathname);
    return new Response(body ?? '', { status: body ? 200 : 404 });
  };
  const catalog = await discoverHiggsfieldCatalog(fetcher);
  assert.deepEqual(catalog.entries.map(entry => entry.endpointId).sort(),
    ['bytedance/seedance-2.5/text-to-video', 'recraft/v4.1/text-to-image']);
  assert(requested.includes('/docs/models/seedance-2-5/text-to-video.md'));
  assert(!requested.includes('/docs/models/injected.md'));
});

test('a mismatch between published catalog totals and visible model links is partial', async () => {
  const fixture = new Map([
    ['/docs/models/video-generation.md', `# Video Generation API
Choose from **2 model families** and **3 catalog entries**.
## Models
[Example · 1 workflow](/docs/models/example)
`],
    ['/docs/models/image-generation.md', `# Image Generation API
Choose from **0 model families** and **0 catalog entries**.
## Models
`],
    ['/docs/models/example.md', `# Example API
## Workflows
| Workflow | Endpoint |
| --- | --- |
| [Generate](/docs/models/example/generate) | POST |
`],
    ['/docs/models/example/generate.md', `# Example — Generate API
**Endpoint:** \`POST https://api.higgsfield.ai/example/generate\`
**Endpoint ID:** \`example/generate\`
**Complete JSON schema**
\`\`\`json
{ "type": "object", "properties": { "prompt": { "type": "string" } } }
\`\`\`
`],
  ]);
  const fetcher: typeof fetch = async input => {
    const url = new URL(String(input));
    assert.equal(url.origin, 'https://docs.higgsfield.ai');
    const body = fixture.get(url.pathname);
    return new Response(body ?? 'not found', { status: body ? 200 : 404 });
  };

  const catalog = await discoverHiggsfieldCatalog(fetcher);
  assert.equal(catalog.status, 'partial');
  assert.deepEqual(catalog.entries.map(entry => entry.endpointId), ['example/generate']);
  assert.match(catalog.warnings.join(' '), /не совпадают со ссылками/);
});
