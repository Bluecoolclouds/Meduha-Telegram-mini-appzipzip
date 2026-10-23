// Minimal JSON Schema helpers for official Higgsfield Playground schemas.
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Schema = Record<string, any>;

export const FILE_FIELDS = new Set(['image_url', 'image_urls', 'item_image_urls']);
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const typesOf = (s: Schema): string[] => Array.isArray(s?.type) ? s.type : s?.type ? [s.type] : [];
export const isNullable = (s: Schema) => typesOf(s).includes('null') || (Array.isArray(s?.anyOf) && s.anyOf.some((x: Schema) => x?.type === 'null'));

export function resolve(s: Schema, root: Schema): Schema {
  if (s && typeof s.$ref === 'string' && s.$ref.startsWith('#/')) {
    let node: any = root;
    for (const part of s.$ref.slice(2).split('/')) node = node?.[part];
    return node || {};
  }
  return s || {};
}

export type FieldKind = 'text' | 'longtext' | 'enum' | 'number' | 'integer' | 'boolean' | 'uuid' | 'files' | 'json' | 'color';
export function fieldKind(name: string, s: Schema): FieldKind {
  if (FILE_FIELDS.has(name)) return 'files';
  const t = typesOf(s).filter(x => x !== 'null');
  if (Array.isArray(s.enum)) return 'enum';
  if (t.length === 1 && t[0] === 'boolean') return 'boolean';
  if (t.length === 1 && t[0] === 'number') return 'number';
  if (t.length === 1 && t[0] === 'integer') return 'integer';
  if (t.length === 1 && t[0] === 'string') {
    if (s.format === 'uuid') return 'uuid';
    if (s.pattern === '^#[0-9a-fA-F]{6}$') return 'color';
    if (['prompt', 'brief', 'negative_prompt', 'target_audience'].includes(name) || (s.maxLength ?? 1000) > 300) return 'longtext';
    return 'text';
  }
  return 'json';
}

export const isFileArray = (name: string, s: Schema) => name !== 'image_url' && (typesOf(s).includes('array') || !!s.items);

function matchesIf(cond: Schema, v: Record<string, unknown>): boolean {
  for (const r of cond.required || []) if (v[r] === undefined) return false;
  for (const [k, sub] of Object.entries<Schema>(cond.properties || {})) {
    const val = v[k];
    if (val === undefined) continue;
    if ('const' in sub && val !== sub.const) return false;
    if (Array.isArray(sub.enum) && !sub.enum.includes(val as Json)) return false;
    if (sub.not && 'const' in sub.not && val === sub.not.const) return false;
  }
  return true;
}

export interface Effective { required: Set<string>; props: Record<string, Schema>; forced: Record<string, unknown>; mustBeNull: Set<string> }
/** Applies allOf/if/then branches against the current values. */
export function effective(schema: Schema, values: Record<string, unknown>): Effective {
  const props: Record<string, Schema> = {};
  for (const [k, s] of Object.entries<Schema>(schema.properties || {})) props[k] = resolve(s, schema);
  const required = new Set<string>(schema.required || []);
  const forced: Record<string, unknown> = {};
  const mustBeNull = new Set<string>();
  for (const branch of schema.allOf || []) {
    if (!branch?.if || !branch.then || !matchesIf(branch.if, values)) continue;
    for (const r of branch.then.required || []) required.add(r);
    for (const [k, sub] of Object.entries<Schema>(branch.then.properties || {})) {
      if (!props[k]) continue;
      if ('const' in sub) forced[k] = sub.const;
      if (sub.type === 'null') mustBeNull.add(k);
      const merged = { ...props[k] };
      for (const key of ['maxItems', 'minItems', 'minimum', 'maximum']) if (key in sub) merged[key] = sub[key];
      props[k] = merged;
    }
  }
  return { required, props, forced, mustBeNull };
}

export function validate(s0: Schema, v: unknown, root: Schema, path = ''): string | null {
  const s = resolve(s0, root);
  if (Array.isArray(s.anyOf)) {
    const errs = s.anyOf.map((x: Schema) => validate(x, v, root, path));
    return errs.some((e: string | null) => e === null) ? null : errs[0];
  }
  const label = path || 'значение';
  if ('const' in s && v !== s.const) return `${label}: ожидается ${JSON.stringify(s.const)}`;
  if (Array.isArray(s.enum) && !s.enum.includes(v as Json)) return `${label}: допустимо ${s.enum.join(', ')}`;
  const types = typesOf(s);
  if (types.length) {
    const actual = v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v === 'number' ? (Number.isInteger(v) ? 'integer' : 'number') : typeof v;
    const ok = types.some(t => t === actual || (t === 'number' && actual === 'integer'));
    if (!ok) return `${label}: нужен тип ${types.join(' или ')}`;
  }
  if (typeof v === 'number') {
    if (s.minimum !== undefined && v < s.minimum) return `${label}: не меньше ${s.minimum}`;
    if (s.maximum !== undefined && v > s.maximum) return `${label}: не больше ${s.maximum}`;
  }
  if (typeof v === 'string') {
    if (s.minLength !== undefined && v.length < s.minLength) return `${label}: минимум ${s.minLength} симв.`;
    if (s.maxLength !== undefined && v.length > s.maxLength) return `${label}: максимум ${s.maxLength} симв.`;
    if (s.pattern && !new RegExp(s.pattern).test(v)) return `${label}: неверный формат`;
    if (s.format === 'uuid' && !UUID_RE.test(v)) return `${label}: нужен UUID`;
  }
  if (Array.isArray(v)) {
    if (s.minItems !== undefined && v.length < s.minItems) return `${label}: минимум ${s.minItems} эл.`;
    if (s.maxItems !== undefined && v.length > s.maxItems) return `${label}: максимум ${s.maxItems} эл.`;
    if (s.items) for (let i = 0; i < v.length; i++) { const e = validate(s.items, v[i], root, `${label}[${i}]`); if (e) return e; }
  }
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const obj = v as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (s.maxProperties !== undefined && keys.length > s.maxProperties) return `${label}: слишком много ключей`;
    for (const r of s.required || []) if (obj[r] === undefined) return `${label}: нужно поле ${r}`;
    for (const k of keys) {
      const sub = s.properties?.[k];
      if (sub) { const e = validate(sub, obj[k], root, `${label}.${k}`); if (e) return e; }
      else if (s.additionalProperties === false) return `${label}: лишнее поле ${k}`;
      else if (s.additionalProperties && typeof s.additionalProperties === 'object') { const e = validate(s.additionalProperties, obj[k], root, `${label}.${k}`); if (e) return e; }
    }
  }
  return null;
}

export function jsonExample(name: string, s: Schema): string {
  if (name === 'colors') return '[{"rgb":[255,107,24]},{"rgb":[42,24,16]}]';
  if (name === 'background_color') return '{"rgb":[255,243,230]}';
  if (name === 'selection') return '{"hair":["short"]}';
  if (name === 'trait_variants') return '{"version":"appearance-v2","choices":{"eyes":"v2"}}';
  if (typesOf(s).includes('array')) return '[]';
  return '{}';
}

export function defaults(schema: Schema): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, s0] of Object.entries<Schema>(schema.properties || {})) {
    const s = resolve(s0, schema);
    if (FILE_FIELDS.has(k)) continue;
    if (s.default !== undefined && s.default !== null && !(typeof s.default === 'object')) out[k] = s.default;
  }
  return out;
}

export function batchMultiplier(schema: Schema, values: Record<string, unknown>): { field: string | null; n: number } {
  for (const f of ['batch_size', 'num_images']) {
    if (schema.properties?.[f]) {
      const n = Number(values[f] ?? schema.properties[f].default ?? 1);
      return { field: f, n: Number.isFinite(n) && n > 0 ? n : 1 };
    }
  }
  return { field: null, n: 1 };
}

export const mediaUuid = (path: string) => path.match(/\/api\/meduha\/media\/([0-9a-f-]{36})/i)?.[1] ?? null;
