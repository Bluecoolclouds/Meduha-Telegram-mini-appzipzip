/**
 * Display-only monthly USD reference prices, verified 2026-10-24.
 * Base tiers: https://higgsfield.ai/pricing
 * Ultra volume prices: https://higgsfield.ai/blog/seedance-2-5-pricing-2026
 * These do not grant subscriptions, credits, or Higgsfield website benefits.
 * Keep volume prices explicit; do not extrapolate them from a base price.
 */
export type TopupLevel = { credits: number; usd: number };
export type TopupTier = { id: string; levels: TopupLevel[]; note?: string };
export type TopupPackage = TopupLevel & { id: string; note?: string };
export type LevelPicks = Record<string, number>;

export const TOPUP_PACKAGES: TopupTier[] = [
  { id: 'p100', levels: [{ credits: 270, usd: 19 }] },
  { id: 'p300', levels: [{ credits: 1200, usd: 59 }] },
  { id: 'p1000', levels: [
    { credits: 3000, usd: 129 },
    { credits: 6000, usd: 220 },
    { credits: 9000, usd: 310 },
  ] },
];

export function levelOf(tier: TopupTier, picks: LevelPicks): number {
  const index = picks[tier.id] ?? 0;
  return Number.isSafeInteger(index) ? Math.min(Math.max(0, index), tier.levels.length - 1) : 0;
}

export function resolvePackage(tier: TopupTier, picks: LevelPicks): TopupPackage {
  return { id: tier.id, note: tier.note, ...tier.levels[levelOf(tier, picks)] };
}

export const usd = (value: number) => `$${value.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}`;
export const perCredit = (pkg: TopupPackage) => `$${(pkg.usd / pkg.credits).toLocaleString('ru-RU', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`;
