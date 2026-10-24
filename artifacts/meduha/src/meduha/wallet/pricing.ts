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
export type BillingMonths = 1 | 3 | 12;
export const BILLING_PERIODS: { months: BillingMonths; label: string }[] = [
  { months: 1, label: '1 месяц' },
  { months: 3, label: '3 месяца' },
  { months: 12, label: '1 год' },
];
// Verified base annual monthly equivalents. Volume discounts for larger Ultra
// levels are Meduha's calculation, not verified Higgsfield volume quotes.
const annualMonthlyBase: Record<string, number> = { p100: 19, p300: 47, p1000: 99 };

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

export function billingQuote(pkg: TopupPackage, months: BillingMonths) {
  const tier = TOPUP_PACKAGES.find(t => t.id === pkg.id);
  if (!tier) throw new Error('Unknown tariff');
  const annualDiscount = 1 - annualMonthlyBase[tier.id] / tier.levels[0].usd;
  const discount = months === 12 ? annualDiscount : months === 3 ? annualDiscount / 2 : 0;
  const monthlyCents = Math.round(pkg.usd * 100 * (1 - discount));
  const totalCents = monthlyCents * months;
  return {
    monthlyUsd: monthlyCents / 100,
    totalUsd: totalCents / 100,
    savingsUsd: (Math.round(pkg.usd * 100) * months - totalCents) / 100,
    discount,
    volumeCalculated: pkg.id === 'p1000' && pkg.credits !== tier.levels[0].credits && months !== 1,
  };
}

export const discountLabel = (discount: number) => `${(discount * 100).toLocaleString('ru-RU', { maximumFractionDigits: 1 })}%`;
export const usd = (value: number) => `$${value.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}`;
export const perCredit = (pkg: TopupPackage) => `$${(pkg.usd / pkg.credits).toLocaleString('ru-RU', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`;
