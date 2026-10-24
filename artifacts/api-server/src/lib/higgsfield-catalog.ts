export type HiggsfieldModelKind = 'photo' | 'video' | 'audio';
type Scalar = string | number | boolean;

export type HiggsfieldCatalogParameter = {
  name: string;
  type: string;
  required: boolean;
  description?: string;
  defaultValue?: Scalar;
  allowedValues?: Scalar[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  format?: string;
};

export type HiggsfieldCatalogEntry = {
  endpointId: string;
  displayName: string;
  kind: HiggsfieldModelKind;
  category: string;
  endpointUrl: string;
  docsUrl: string;
  schemaAvailable: boolean;
  parameters: HiggsfieldCatalogParameter[];
};

export type HiggsfieldCatalogResult = {
  status: 'live' | 'partial' | 'stale';
  discoveryApi: 'not_documented';
  refreshedAt: string;
  sourceUrls: string[];
  entries: HiggsfieldCatalogEntry[];
  warnings: string[];
};

const DOCS_ORIGIN = 'https://docs.higgsfield.ai';
const SOURCE_URLS = [
  `${DOCS_ORIGIN}/docs/models/video-generation.md`,
  `${DOCS_ORIGIN}/docs/models/image-generation.md`,
];
const CATALOG_TTL_MS = 5 * 60_000;
const MAX_DOCUMENT_BYTES = 2_000_000;
const cache = { value: null as HiggsfieldCatalogResult | null };

function docUrl(path: string): string | null {
  let url: URL;
  try { url = new URL(path, DOCS_ORIGIN); } catch { return null; }
  if (url.origin !== DOCS_ORIGIN || url.username || url.password || !url.pathname.startsWith('/docs/models/')) return null;
  if (!url.pathname.endsWith('.md')) url.pathname += '.md';
  url.hash = '';
  url.search = '';
  return url.toString();
}

async function fetchMarkdown(url: string, fetcher: typeof fetch): Promise<string> {
  const response = await fetcher(url, {
    headers: { Accept: 'text/markdown' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Official documentation returned HTTP ${response.status}.`);
  const body = await response.text();
  if (Buffer.byteLength(body, 'utf8') > MAX_DOCUMENT_BYTES) {
    throw new Error('Official documentation page exceeded the size limit.');
  }
  return body;
}

function linksIn(text: string): string[] {
  return [...text.matchAll(/\]\(([^)\s]+)\)/g)]
    .map(match => docUrl(match[1]))
    .filter((url): url is string => url !== null
      && !url.endsWith('/video-generation.md') && !url.endsWith('/image-generation.md'));
}

function workflowLinks(familyPage: string): string[] {
  const heading = /^#{1,3}\s+Workflows\s*$/im.exec(familyPage);
  if (!heading || heading.index === undefined) return [];
  const tail = familyPage.slice(heading.index + heading[0].length);
  const nextHeading = /^#{1,3}\s+/m.exec(tail);
  return linksIn(nextHeading ? tail.slice(0, nextHeading.index) : tail);
}

function modelListingLinks(listing: string): {
  links: string[];
  declaredFamilies: number | null;
  declaredEntries: number | null;
  linkedEntries: number | null;
} | null {
  const heading = /^#{1,3}\s+Models\s*$/im.exec(listing);
  if (!heading || heading.index === undefined) return null;
  const tail = listing.slice(heading.index + heading[0].length);
  const nextHeading = /^#{1,3}\s+/m.exec(tail);
  const section = nextHeading ? tail.slice(0, nextHeading.index) : tail;
  const modelLinks = [...section.matchAll(/\[([^\]]+)\]\(([^)\s]+)\)/g)]
    .filter(match => docUrl(match[2]) !== null);
  const summary = /Choose from \*\*(\d+)\s+model famil(?:y|ies)\*\* and \*\*(\d+)\s+catalog entr(?:y|ies)\*\*/i.exec(listing);
  const workflowCounts = modelLinks.map(match => /·\s*(\d+)\s+workflows?\b/i.exec(match[1])?.[1]);
  return {
    links: linksIn(section),
    declaredFamilies: summary ? Number(summary[1]) : null,
    declaredEntries: summary ? Number(summary[2]) : null,
    linkedEntries: workflowCounts.every(count => count !== undefined)
      ? workflowCounts.reduce((total, count) => total + Number(count), 0)
      : null,
  };
}

function scalar(value: unknown): value is Scalar {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function parseParameters(page: string): HiggsfieldCatalogParameter[] {
  const schemaBlock = /Complete JSON schema[\s\S]*?```json[^\n]*\n([\s\S]*?)```/i.exec(page)?.[1];
  if (!schemaBlock) return [];
  const normalized = schemaBlock.replace(/^>\s?/gm, '');
  let schema: unknown;
  try {
    schema = JSON.parse(normalized);
  } catch {
    return [];
  }
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return [];
  const schemaRecord = schema as Record<string, unknown>;
  if (schemaRecord.type !== 'object') return [];
  const supportedRootKeys = new Set(['$schema', 'type', 'required', 'properties', 'additionalProperties', 'title', 'description']);
  if (Object.keys(schemaRecord).some(key => !supportedRootKeys.has(key))) return [];
  const properties = schemaRecord.properties;
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return [];
  const propertyEntries = Object.entries(properties);
  if (!propertyEntries.length || propertyEntries.some(([, property]) => !property || typeof property !== 'object' || Array.isArray(property))) return [];
  const records = propertyEntries as [string, Record<string, unknown>][];
  const supportedPropertyKeys = new Set([
    'type', 'description', 'default', 'enum', 'minimum', 'maximum', 'minLength', 'maxLength', 'format',
  ]);
  if (records.some(([, property]) =>
    (typeof property.type !== 'string' && !(Array.isArray(property.type) && property.type.every(type => typeof type === 'string')))
      || Object.keys(property).some(key => !supportedPropertyKeys.has(key)))) return [];
  if (records.some(([, property]) => Array.isArray(property.enum) && !property.enum.every(scalar))) return [];
  const requiredValue = schemaRecord.required;
  if (requiredValue !== undefined && (!Array.isArray(requiredValue) || !requiredValue.every(key => typeof key === 'string'))) return [];
  const required = new Set((requiredValue ?? []) as string[]);
  if ([...required].some(name => !Object.hasOwn(properties, name))) return [];
  return records.map(([name, property]) => {
    const parameter: HiggsfieldCatalogParameter = {
      name,
      type: typeof property.type === 'string'
        ? property.type
        : Array.isArray(property.type) && property.type.every(x => typeof x === 'string')
          ? property.type.join(' | ')
          : 'unknown',
      required: required.has(name),
    };
    if (typeof property.description === 'string') parameter.description = property.description;
    if (scalar(property.default)) parameter.defaultValue = property.default;
    if (Array.isArray(property.enum)) parameter.allowedValues = property.enum as Scalar[];
    for (const key of ['minimum', 'maximum', 'minLength', 'maxLength'] as const) {
      if (typeof property[key] === 'number') parameter[key] = property[key] as number;
    }
    if (typeof property.format === 'string') parameter.format = property.format;
    return parameter;
  });
}

function parseWorkflow(
  page: string,
  docsUrl: string,
  category: string,
  kind: HiggsfieldModelKind,
): HiggsfieldCatalogEntry | null {
  const endpointId = /\*\*Endpoint ID:\*\*\s*`([^`]+)`/i.exec(page)?.[1]?.trim();
  const endpoint = /\*\*Endpoint:\*\*\s*`POST\s+(https:\/\/api\.higgsfield\.ai\/[^`\s]+)`/i.exec(page)?.[1];
  if (!endpointId || !endpoint || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/.test(endpointId)) return null;
  const endpointUrl = new URL(endpoint);
  if (endpointUrl.origin !== 'https://api.higgsfield.ai' || endpointUrl.pathname.slice(1) !== endpointId) return null;
  const title = /^#\s+(.+)$/m.exec(page)?.[1]?.trim() ?? endpointId;
  const displayName = title.replace(/\s+API$/i, '').trim();
  const parameters = parseParameters(page);
  return {
    endpointId,
    displayName,
    kind,
    category,
    endpointUrl: endpointUrl.toString(),
    docsUrl,
    schemaAvailable: parameters.length > 0,
    parameters,
  };
}

async function mapLimit<T, R>(items: T[], limit: number, action: (item: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      try {
        results[index] = { status: 'fulfilled', value: await action(items[index]) };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  }));
  return results;
}

export async function discoverHiggsfieldCatalog(fetcher: typeof fetch = fetch): Promise<HiggsfieldCatalogResult> {
  const listings = await mapLimit(SOURCE_URLS.map((url, index) => ({ url, index })), SOURCE_URLS.length, async ({ url, index }) => ({
    url,
    kind: index === 0 ? 'video' as const : 'photo' as const,
    text: await fetchMarkdown(url, fetcher),
  }));
  const familyPages = new Map<string, { kind: HiggsfieldModelKind }>();
  const warnings: string[] = [];
  for (const result of listings) {
    if (result.status === 'rejected') {
      warnings.push('Не удалось прочитать одну из официальных страниц каталога моделей.');
      continue;
    }
    const listing = result.value;
    const modelListing = modelListingLinks(listing.text);
    if (modelListing === null) {
      warnings.push('Одна официальная страница каталога не содержит ожидаемый раздел Models.');
      continue;
    }
    if (!modelListing.links.length) {
      warnings.push('Одна официальная страница каталога не содержит ссылок на модели.');
    }
    if (modelListing.declaredFamilies === null || modelListing.declaredEntries === null || modelListing.linkedEntries === null) {
      warnings.push('Одна официальная страница каталога не публикует проверяемые количества семейств и workflows.');
    } else if (modelListing.declaredFamilies !== new Set(modelListing.links).size || modelListing.declaredEntries !== modelListing.linkedEntries) {
      warnings.push('Опубликованные количества семейств или workflows не совпадают со ссылками в официальном каталоге.');
    }
    for (const path of modelListing.links) {
      const url = docUrl(path);
      if (url) familyPages.set(url, { kind: listing.kind });
    }
  }

  const familyResults = await mapLimit([...familyPages.entries()], 10, async ([url, { kind }]) => ({
    url,
    kind,
    text: await fetchMarkdown(url, fetcher),
  }));
  const workflowPages = new Map<string, { kind: HiggsfieldModelKind; category: string }>();
  const directEntries: HiggsfieldCatalogEntry[] = [];
  for (const result of familyResults) {
    if (result.status === 'rejected') {
      warnings.push('Не удалось прочитать одну из страниц семейств моделей.');
      continue;
    }
    const family = result.value;
    const category = ( /^#\s+(.+)$/m.exec(family.text)?.[1] ?? 'Higgsfield' ).replace(/\s+API$/i, '').trim();
    const direct = parseWorkflow(family.text, family.url, category, family.kind);
    if (direct) {
      directEntries.push(direct);
      if (!direct.schemaAvailable) warnings.push(`У одной официальной модели опубликован endpoint ID, но схема параметров недоступна: ${direct.docsUrl}`);
      continue;
    }
    const documentedWorkflows = workflowLinks(family.text);
    if (!documentedWorkflows.length) {
      warnings.push(`Одна официальная страница семейства не содержит проверяемых generation endpoint ID и исключена из импорта: ${family.url}`);
    }
    for (const path of documentedWorkflows) {
      const url = docUrl(path);
      if (url) workflowPages.set(url, { kind: family.kind, category });
    }
  }

  const workflowResults = await mapLimit([...workflowPages.entries()], 12, async ([url, { kind, category }]) => ({
    url,
    entry: parseWorkflow(await fetchMarkdown(url, fetcher), url, category, kind),
  }));
  const entries = [...directEntries];
  for (const result of workflowResults) {
    if (result.status === 'rejected') {
      warnings.push('Не удалось прочитать параметры одной из официальных моделей.');
      continue;
    }
    if (result.value.entry) {
      entries.push(result.value.entry);
      if (!result.value.entry.schemaAvailable) warnings.push(`У одной официальной модели опубликован endpoint ID, но схема параметров недоступна: ${result.value.url}`);
    } else {
      warnings.push(`Одна официальная workflow-страница не содержит проверяемого endpoint ID и исключена из импорта: ${result.value.url}`);
    }
  }
  const unique = [...new Map(entries.map(entry => [entry.endpointId, entry])).values()]
    .sort((a, b) => a.displayName.localeCompare(b.displayName) || a.endpointId.localeCompare(b.endpointId));
  if (!unique.length) throw new Error('Официальные страницы не содержат проверяемых endpoint ID.');
  const now = new Date().toISOString();
  const result: HiggsfieldCatalogResult = {
    status: warnings.length ? 'partial' : 'live',
    discoveryApi: 'not_documented',
    refreshedAt: now,
    sourceUrls: SOURCE_URLS,
    entries: unique,
    warnings: [...new Set(warnings)],
  };
  cache.value = result;
  return result;
}

export async function refreshHiggsfieldCatalog(fetcher: typeof fetch = fetch): Promise<HiggsfieldCatalogResult> {
  try {
    return await discoverHiggsfieldCatalog(fetcher);
  } catch (caught) {
    if (!cache.value) throw caught;
    cache.value = {
      ...cache.value,
      status: 'stale',
      warnings: ['Не удалось обновить официальный каталог; показан последний успешно загруженный снимок. Импорт из устаревшего снимка запрещён.'],
    };
    return cache.value;
  }
}

export async function getFreshHiggsfieldCatalog(fetcher: typeof fetch = fetch): Promise<HiggsfieldCatalogResult> {
  if (cache.value && cache.value.status !== 'stale' && Date.now() - Date.parse(cache.value.refreshedAt) < CATALOG_TTL_MS) return cache.value;
  return discoverHiggsfieldCatalog(fetcher);
}
