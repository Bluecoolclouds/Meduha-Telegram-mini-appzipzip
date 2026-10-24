// Video-only JSON Schema helpers for the official Meduha video catalogue.
// Self-contained (no imports) so node --test can load it directly.
export type Schema = Record<string, any>;
export type FileKind = 'image' | 'video' | 'audio' | 'document';
export interface FileField { path: string; kind: FileKind; array: boolean }
export interface Ref { id: string; name: string; kind: FileKind }

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MiB = 1024 * 1024;
export const KIND_RULES: Record<FileKind, { types: string[]; max: number; label: string; noun: string }> = {
  image: { types: ['image/jpeg', 'image/png', 'image/webp'], max: 10 * MiB, label: 'JPG, PNG, WEBP до 10 МБ', noun: 'фото' },
  video: { types: ['video/mp4', 'video/webm', 'video/quicktime'], max: 100 * MiB, label: 'MP4, WebM, MOV до 100 МБ', noun: 'видео' },
  audio: { types: ['audio/mpeg', 'audio/wav', 'audio/x-wav'], max: 100 * MiB, label: 'MP3, WAV до 100 МБ', noun: 'аудио' },
  document: { types: ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'text/markdown', 'text/plain'], max: 10 * MiB, label: 'PDF, DOCX, XLSX, PPTX, MD, TXT до 10 МБ', noun: 'документ' },
};
export function checkFile(f: { type: string; size: number; name: string }, kind: FileKind): string | null {
  const r = KIND_RULES[kind];
  let type = f.type;
  if (kind === 'document' && !type && /\.(md|markdown)$/i.test(f.name)) type = 'text/markdown';
  if (kind === 'video' && !type && /\.mov$/i.test(f.name)) type = 'video/quicktime';
  if (!r.types.includes(type)) return `${f.name}: нужен формат ${r.label.split(' до ')[0]}`;
  if (f.size === 0) return `${f.name}: файл пуст`;
  if (f.size > r.max) return `${f.name}: больше ${r.max / MiB} МБ`;
  return null;
}

export const typesOf = (s: Schema): string[] => Array.isArray(s?.type) ? s.type : s?.type ? [s.type] : [];
export function resolve(s: Schema, root: Schema): Schema {
  if (s && typeof s.$ref === 'string' && s.$ref.startsWith('#/')) {
    let node: any = root;
    for (const part of s.$ref.slice(2).split('/')) node = node?.[part.replace(/~1/g, '/').replace(/~0/g, '~')];
    return node ? resolve(node, root) : {};
  }
  return s || {};
}
/** Unwraps anyOf/oneOf [X, null] and type [X, null]. */
export function unwrap(s0: Schema, root: Schema): { s: Schema; nullable: boolean } {
  const s = resolve(s0, root);
  const alts = s.anyOf || s.oneOf;
  if (Array.isArray(alts)) {
    const non = alts.filter((x: Schema) => resolve(x, root)?.type !== 'null');
    const nullable = non.length < alts.length;
    if (non.length === 1) { const { anyOf: _a, oneOf: _o, ...rest } = s; return { s: { ...rest, ...resolve(non[0], root) }, nullable }; }
    return { s, nullable };
  }
  const t = typesOf(s);
  if (t.includes('null')) { const rest = t.filter(x => x !== 'null'); return { s: { ...s, type: rest.length === 1 ? rest[0] : rest }, nullable: true }; }
  return { s, nullable: false };
}

export const kindFromName = (n: string): FileKind => n === 'file_url' ? 'document' : /audio|sound|voice|music/i.test(n) ? 'audio' : /video/i.test(n) ? 'video' : 'image';
const isUri = (s: Schema) => s?.format === 'uri' || s?.format === 'uri-reference';
/** Fallback when the API omits fileFields. link_url is an ordinary public webpage URL, never an upload. */
export function deriveFileFields(schema: Schema): FileField[] {
  const out: FileField[] = [];
  const walk = (props: Record<string, Schema>, prefix: string) => {
    for (const [k, s0] of Object.entries(props || {})) {
      if (k === 'link_url') continue;
      const { s } = unwrap(s0, schema);
      if (typesOf(s).includes('string') && isUri(s)) out.push({ path: `${prefix}/${k}`, kind: kindFromName(k), array: false });
      else if (s.items) {
        const it = unwrap(s.items, schema).s;
        if (isUri(it)) out.push({ path: `${prefix}/${k}`, kind: kindFromName(k), array: true });
        else if (it.properties) walk(it.properties, `${prefix}/${k}/*`);
      }
    }
  };
  walk(schema.properties || {}, '');
  return out;
}
/** Normalizes paths: leading slash, trailing /* means array. */
export function normalizeFileFields(list: FileField[] | undefined, schema: Schema): FileField[] {
  const src = list && list.length ? list : deriveFileFields(schema);
  const seen = new Map<string, FileField>();
  for (const f of src) {
    let p = f.path.startsWith('/') ? f.path : `/${f.path}`; let array = !!f.array;
    if (p.endsWith('/*')) { p = p.slice(0, -2); array = true; }
    if (p.split('/')[1] === 'link_url') continue;
    seen.set(p, { path: p, kind: f.kind, array });
  }
  return Array.from(seen.values());
}
export interface Split { root: string; parent: string | null; sub: string | null; supported: boolean }
export function splitPath(path: string): Split {
  const segs = path.slice(1).split('/');
  if (segs.length === 1) return { root: segs[0], parent: null, sub: null, supported: true };
  if (segs[1] === '*' && segs.length > 2 && !segs.slice(2).includes('*')) return { root: segs[0], parent: segs[0], sub: `/${segs.slice(2).join('/')}`, supported: true };
  return { root: segs[0], parent: segs[0], sub: null, supported: false };
}
export const itemKey = (parent: string, i: number, sub: string) => `/${parent}/${i}${sub}`;
export const fileRoots = (ff: FileField[]) => new Set(ff.map(f => splitPath(f.path).root));

export const present = (v: unknown) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0);
export function matches(cond: Schema, v: Record<string, unknown>): boolean {
  if (!cond || typeof cond !== 'object') return true;
  for (const r of cond.required || []) if (!present(v[r])) return false;
  for (const [k, sub] of Object.entries<Schema>(cond.properties || {})) {
    const val = v[k];
    if (val === undefined) continue;
    if ('const' in sub && val !== sub.const) return false;
    if (Array.isArray(sub.enum) && !sub.enum.includes(val)) return false;
    if (Array.isArray(val) && sub.minItems !== undefined && val.length < sub.minItems) return false;
    if (sub.not && 'const' in sub.not && val === sub.not.const) return false;
  }
  if (Array.isArray(cond.allOf) && !cond.allOf.every((c: Schema) => matches(c, v))) return false;
  if (Array.isArray(cond.anyOf) && !cond.anyOf.some((c: Schema) => matches(c, v))) return false;
  if (Array.isArray(cond.oneOf) && cond.oneOf.filter((c: Schema) => matches(c, v)).length !== 1) return false;
  if (cond.not && matches(cond.not, v)) return false;
  return true;
}

export interface Effective {
  props: Record<string, Schema>; required: Set<string>; forced: Record<string, unknown>; mustBeNull: Set<string>;
  /** field -> alternatives that would also satisfy the rule */
  alternatives: Record<string, string[]>;
  /** conflicts: groups of fields that must not be combined */
  conflicts: string[][];
}
export function effective(schema: Schema, v: Record<string, unknown>): Effective {
  const props: Record<string, Schema> = {};
  for (const [k, s] of Object.entries<Schema>(schema.properties || {})) props[k] = resolve(s, schema);
  const e: Effective = { props, required: new Set(), forced: {}, mustBeNull: new Set(), alternatives: {}, conflicts: [] };
  const apply = (node: Schema | undefined, alts: string[], root: boolean) => {
    if (!node || typeof node !== 'object') return;
    for (const r of node.required || []) { e.required.add(r); if (alts.length) e.alternatives[r] = alts; }
    if (!root) for (const [k, sub] of Object.entries<Schema>(node.properties || {})) {
      if (!props[k]) continue;
      if ('const' in sub) e.forced[k] = sub.const;
      if (sub.type === 'null') e.mustBeNull.add(k);
      const merged = { ...props[k] };
      for (const key of ['maxItems', 'minItems', 'minimum', 'maximum', 'enum']) if (key in sub) merged[key] = sub[key];
      props[k] = merged;
    }
    if (node.if) { if (matches(node.if, v)) apply(node.then, alts, false); else apply(node.else, [...alts, ...(node.if.required || [])], false); }
    for (const b of node.allOf || []) apply(b, alts, false);
    const group = (list: Schema[]) => list.flatMap(a => a?.required || []);
    if (Array.isArray(node.anyOf) && !node.anyOf.some((a: Schema) => matches(a, v))) { const g = group(node.anyOf); for (const r of g) e.alternatives[r] = g.filter(x => x !== r); if (g[0]) e.required.add(g[0]); }
    if (Array.isArray(node.oneOf)) {
      const hits = node.oneOf.filter((a: Schema) => matches(a, v)).length;
      const g = group(node.oneOf);
      if (hits === 0 && g[0]) { e.required.add(g[0]); for (const r of g) e.alternatives[r] = g.filter(x => x !== r); }
      if (hits > 1) e.conflicts.push(g);
    }
    if (node.not?.required && matches(node.not, v)) e.conflicts.push(node.not.required);
  };
  apply(schema, [], true);
  return e;
}

/** Static human-readable summary of the documented conditions (shown even when satisfied). */
export function describeConditions(schema: Schema): string[] {
  const out: string[] = [];
  const chain: string[] = [];
  let n: Schema | undefined = schema;
  while (n?.if) { for (const r of n.if.required || []) chain.push(r); if (!n.else?.if) { for (const r of n.else?.required || []) chain.push(r); break; } n = n.else; }
  if (chain.length > 1) out.push(`Нужен хотя бы один из вариантов: ${chain.join(', ')}`);
  const walk = (node: Schema) => {
    for (const b of node.allOf || []) {
      if (b?.not?.required?.length > 1) out.push(`Нельзя использовать вместе: ${b.not.required.join(' и ')}`);
      if (b?.if && b.then) {
        const when = Object.entries<Schema>(b.if.properties || {}).map(([k, s]) => 'const' in s ? `${k} = ${JSON.stringify(s.const)}` : k).concat(b.if.required && !b.if.properties ? b.if.required : []).join(', ');
        const then = [...(b.then.required || []).map((r: string) => `нужно ${r}`), ...Object.entries<Schema>(b.then.properties || {}).map(([k, s]) => s.type === 'null' ? `${k} пусто` : 'const' in s ? `${k} = ${JSON.stringify(s.const)}` : s.maxItems !== undefined ? `${k} до ${s.maxItems}` : k)].join(', ');
        if (when && then) out.push(`Если ${when}: ${then}`);
      }
      walk(b || {});
    }
    if (Array.isArray(node.oneOf) && node.oneOf.every((a: Schema) => a?.required)) out.push(`Ровно один из: ${node.oneOf.map((a: Schema) => a.required.join('+')).join(' / ')}`);
    if (Array.isArray(node.anyOf) && node.anyOf.every((a: Schema) => a?.required)) out.push(`Хотя бы один из: ${node.anyOf.map((a: Schema) => a.required.join('+')).join(' / ')}`);
    if (node.not?.required?.length > 1) out.push(`Нельзя использовать вместе: ${node.not.required.join(' и ')}`);
  };
  walk(schema);
  return Array.from(new Set(out));
}

export function validate(s0: Schema, v: unknown, root: Schema, label = 'значение'): string | null {
  const s = resolve(s0, root);
  if (Array.isArray(s.anyOf) || Array.isArray(s.oneOf)) {
    const errs = (s.anyOf || s.oneOf).map((x: Schema) => validate(x, v, root, label));
    return errs.some((e: string | null) => e === null) ? null : errs[0];
  }
  if ('const' in s && v !== s.const) return `${label}: ожидается ${JSON.stringify(s.const)}`;
  if (Array.isArray(s.enum) && !s.enum.includes(v)) return `${label}: допустимо ${s.enum.map(String).join(', ')}`;
  const types = typesOf(s);
  if (types.length) {
    const actual = v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v === 'number' ? (Number.isInteger(v) ? 'integer' : 'number') : typeof v;
    if (!types.some(t => t === actual || (t === 'number' && actual === 'integer'))) return `${label}: нужен тип ${types.join(' или ')}`;
  }
  if (typeof v === 'number') {
    if (s.minimum !== undefined && v < s.minimum) return `${label}: не меньше ${s.minimum}`;
    if (s.maximum !== undefined && v > s.maximum) return `${label}: не больше ${s.maximum}`;
    if (s.exclusiveMinimum !== undefined && v <= s.exclusiveMinimum) return `${label}: больше ${s.exclusiveMinimum}`;
    if (s.exclusiveMaximum !== undefined && v >= s.exclusiveMaximum) return `${label}: меньше ${s.exclusiveMaximum}`;
  }
  if (typeof v === 'string') {
    if (s.minLength !== undefined && v.length < s.minLength) return s.minLength === 1 ? `${label}: заполни поле` : `${label}: минимум ${s.minLength} симв.`;
    if (s.maxLength !== undefined && v.length > s.maxLength) return `${label}: максимум ${s.maxLength} симв.`;
    if (s.pattern) { try { if (!new RegExp(s.pattern).test(v)) return `${label}: неверный формат`; } catch { /* unsupported pattern */ } }
    if (s.format === 'uuid' && !UUID_RE.test(v)) return `${label}: нужен UUID`;
    if (isUri(s)) { try { const u = new URL(v); if (u.protocol !== 'https:') return `${label}: нужна ссылка https://`; } catch { return `${label}: нужна ссылка https://`; } }
  }
  if (Array.isArray(v)) {
    if (s.minItems !== undefined && v.length < s.minItems) return `${label}: минимум ${s.minItems} эл.`;
    if (s.maxItems !== undefined && v.length > s.maxItems) return `${label}: максимум ${s.maxItems} эл.`;
    if (s.items) for (let i = 0; i < v.length; i++) { const e = validate(s.items, v[i], root, `${label}[${i}]`); if (e) return e; }
  }
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const obj = v as Record<string, unknown>;
    for (const r of s.required || []) if (obj[r] === undefined) return `${label}: нужно поле ${r}`;
    for (const k of Object.keys(obj)) {
      const sub = s.properties?.[k];
      if (sub) { const e = validate(sub, obj[k], root, `${label}.${k}`); if (e) return e; }
      else if (s.additionalProperties === false) return `${label}: лишнее поле ${k}`;
    }
  }
  return null;
}

export type FieldKind = 'text' | 'longtext' | 'url' | 'enum' | 'number' | 'integer' | 'boolean' | 'json';
export function fieldKind(name: string, s: Schema): FieldKind {
  if (Array.isArray(s.enum)) return 'enum';
  const t = typesOf(s).filter(x => x !== 'null');
  if (t.length === 1 && t[0] === 'boolean') return 'boolean';
  if (t.length === 1 && t[0] === 'number') return 'number';
  if (t.length === 1 && t[0] === 'integer') return 'integer';
  if (t.length === 1 && t[0] === 'string') {
    if (isUri(s) || name === 'link_url') return 'url';
    if (/prompt/.test(name) || (s.maxLength ?? 1000) > 300) return 'longtext';
    return 'text';
  }
  return 'json';
}

export function defaults(schema: Schema, skip: Set<string>): { params: Record<string, unknown>; json: Record<string, string> } {
  const params: Record<string, unknown> = {}; const json: Record<string, string> = {};
  for (const [k, s0] of Object.entries<Schema>(schema.properties || {})) {
    if (skip.has(k)) continue;
    const s = resolve(s0, schema);
    if (s.default === undefined || s.default === null) continue;
    if (typeof s.default === 'object') json[k] = JSON.stringify(s.default, null, 2); else params[k] = s.default;
  }
  return { params, json };
}

/** Builds the POST body parts. Media fields never go into parameters; their private UUIDs go into references by JSON pointer. */
export function referencePromptExpansion(modelId: string, values: Record<string, unknown>) {
  return ['alibaba/wan-3.0/reference-to-video', 'alibaba/wan-3.0-prime/reference-to-video'].includes(modelId)
    && !!(values.file_url || values.link_url);
}

export function buildPayload(a: { fileFields: FileField[]; values: Record<string, unknown>; refs: Record<string, Ref[]>; groups: Record<string, Record<string, unknown>[]> }) {
  const roots = fileRoots(a.fileFields);
  const parents = new Set(a.fileFields.map(f => splitPath(f.path).parent).filter((x): x is string => !!x));
  const parameters: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(a.values)) { if (roots.has(k) && !parents.has(k)) continue; if (parents.has(k)) continue; if (v !== undefined && v !== '') parameters[k] = v; }
  for (const p of parents) if (a.groups[p]?.length) parameters[p] = a.groups[p];
  const references: Record<string, string[]> = {};
  for (const [k, list] of Object.entries(a.refs)) if (list.length) references[k] = list.map(r => r.id);
  return { parameters, references };
}

/** Shift nested reference keys after removing item i of a group. */
export function dropGroupItem(refs: Record<string, Ref[]>, parent: string, i: number): Record<string, Ref[]> {
  const out: Record<string, Ref[]> = {};
  const re = new RegExp(`^/${parent.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/(\\d+)(/.*)$`);
  for (const [k, v] of Object.entries(refs)) {
    const m = k.match(re);
    if (!m) { out[k] = v; continue; }
    const n = Number(m[1]);
    if (n === i) continue;
    out[n > i ? `/${parent}/${n - 1}${m[2]}` : k] = v;
  }
  return out;
}

export const mediaUuid = (path: string) => path.match(/\/api\/meduha\/media\/([0-9a-f-]{36})/i)?.[1] ?? null;

const modeRu: [RegExp, string][] = [[/^text[- ]to[- ]video$/i, 'Текст → видео'], [/^image[- ]to[- ]video$/i, 'Фото → видео'], [/reference/i, 'По референсам'], [/edit/i, 'Правка видео'], [/extend/i, 'Продление'], [/start.*end|first.*last|frame/i, 'Кадры начала и конца'], [/motion/i, 'Перенос движения'], [/lip|talk|avatar|speech/i, 'Речь и аватар'], [/video[- ]to[- ]video/i, 'Видео → видео'], [/audio/i, 'Аудио → видео']];
export const modeLabel = (mode: string) => modeRu.find(([r]) => r.test(mode))?.[1] ?? mode;
export type ModeKind = 'text' | 'image' | 'video' | 'other';
export const modeKind = (mode: string): ModeKind => /^text/i.test(mode) ? 'text' : /image|frame|reference/i.test(mode) ? 'image' : /video|edit|extend|motion/i.test(mode) ? 'video' : 'other';
