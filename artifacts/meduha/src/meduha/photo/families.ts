// Explicit grouping of exact photo catalogue entries into one scenario card per model family.
// Not prefix/provider based: workflows that share an endpoint stay separate scenarios.
export type ModeKind = 'text' | 'image' | 'workflow';
export type FamilyModel = { id: string; endpoint: string; workflow?: boolean };
export type FamilyDef = { id: string; title?: string; modes: { id: string; label: string }[] };

export const PHOTO_FAMILIES: FamilyDef[] = [
  { id: 'soul', title: 'Soul', modes: [
    { id: 'higgsfield-ai/soul/standard', label: 'Soul · стандарт' },
    { id: 'higgsfield-ai/soul/v2/standard', label: 'Soul 2 · текст → фото' },
    { id: 'higgsfield-ai/soul/v2/image-to-image', label: 'Soul 2 · фото → фото' },
  ] },
  { id: 'recraft-4.1', title: 'Recraft 4.1', modes: [
    { id: 'recraft/v4.1/text-to-image', label: 'Стандарт' },
    { id: 'recraft/v4.1/pro/text-to-image', label: 'Pro' },
    { id: 'recraft/v4.1/utility/text-to-image', label: 'Utility' },
    { id: 'recraft/v4.1/utility/pro/text-to-image', label: 'Utility Pro' },
  ] },
  { id: 'marketing-studio', title: 'Marketing Studio', modes: [
    { id: 'marketing-studio/image', label: 'Alpha' },
    { id: 'marketing-studio/image/flare', label: 'Flare' },
    { id: 'marketing-studio/image/sunburst', label: 'Sunburst' },
  ] },
  { id: 'qwen-image-3', title: 'Qwen Image 3', modes: [
    { id: 'alibaba/qwen-image-3/text-to-image', label: 'Текст → фото' },
    { id: 'alibaba/qwen-image-3/edit', label: 'Правки по фото' },
  ] },
  ...['xai/grok-imagine-image-2.0', 'higgsfield/ai-influencer', 'ideogram/v4.0', 'z-image/turbo',
    'workflows/product-shots', 'workflows/graphic-ads', 'workflows/marketplace-design', 'workflows/ads-studio']
    .map(id => ({ id, modes: [{ id, label: '' }] })),
];

const byMode = new Map<string, FamilyDef>();
for (const f of PHOTO_FAMILIES) for (const m of f.modes) byMode.set(m.id, f);

export const modeKind = (m: FamilyModel): ModeKind => m.workflow ? 'workflow' : /image-to-image|\/edit/.test(m.endpoint) ? 'image' : 'text';

/** Family for an exact catalogue id; unknown ids become their own single-mode family. */
export const familyOf = (id: string): FamilyDef => byMode.get(id) ?? { id, modes: [{ id, label: '' }] };
export const modeLabelIn = (id: string) => familyOf(id).modes.find(m => m.id === id)?.label ?? '';

export type Group<M extends FamilyModel> = { family: FamilyDef; members: M[]; matched: M[]; initial: M };

/** All families present in the catalogue, members ordered as in the explicit map. */
export function groupFamilies<M extends FamilyModel>(models: M[]): Group<M>[] {
  const seen = new Map<string, Group<M>>();
  for (const m of models) {
    const fam = familyOf(m.id);
    if (seen.has(fam.id)) continue;
    const members = fam.modes.map(x => models.find(y => y.id === x.id)).filter((x): x is M => !!x);
    seen.set(fam.id, { family: fam, members, matched: members, initial: members[0] });
  }
  return [...seen.values()];
}

export type Filter<M> = { q: string; mode: 'all' | ModeKind; provider: string; providerOf: (m: M) => string; text: (m: M) => string };
/** Families with at least one matching child mode; `initial` is the first matching child. */
export function filterFamilies<M extends FamilyModel>(models: M[], f: Filter<M>): Group<M>[] {
  const t = f.q.trim().toLowerCase();
  const out: Group<M>[] = [];
  for (const g of groupFamilies(models)) {
    const matched = g.members.filter(m => (f.mode === 'all' || modeKind(m) === f.mode)
      && (f.provider === 'all' || f.providerOf(m) === f.provider)
      && (!t || `${f.text(m)} ${g.family.title ?? ''} ${modeLabelIn(m.id)}`.toLowerCase().includes(t)));
    if (!matched.length) continue;
    // Prefer a mode whose own text matches the query (not just the family title).
    const specific = t ? matched.find(m => `${f.text(m)} ${modeLabelIn(m.id)}`.toLowerCase().includes(t)) : undefined;
    out.push({ ...g, matched, initial: specific ?? matched[0] });
  }
  return out;
}

export const photoModelHref = (id: string) => `/create?type=photo&photoModel=${encodeURIComponent(id)}`;

/** Price from eligible modes only. null when none eligible. */
export function familyPrice<M>(members: M[], price: (m: M) => number | null): { value: number; from: boolean } | null {
  const ps = members.map(price).filter((p): p is number => p != null);
  if (!ps.length) return null;
  const min = Math.min(...ps);
  return { value: min, from: new Set(ps).size > 1 };
}
