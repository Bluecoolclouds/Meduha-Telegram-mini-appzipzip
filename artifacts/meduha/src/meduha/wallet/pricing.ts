import type { BillingPlan } from '@workspace/api-client-react';

export type BillingMonths = 1 | 3 | 12;
export const BILLING_PERIODS: { months: BillingMonths; label: string }[] = [
  { months: 1, label: '1 месяц' },
  { months: 3, label: '3 месяца' },
  { months: 12, label: '1 год' },
];

export type BillingTier = { id: string; levels: BillingPlan[] };

/** The API owns all sale prices; the UI groups its catalog for the carousel. */
export function groupBillingPlans(plans: BillingPlan[] = []): BillingTier[] {
  const groups = new Map<string, BillingPlan[]>();
  for (const plan of plans) {
    const tierId = plan.id.slice(0, plan.id.lastIndexOf('-'));
    groups.set(tierId, [...(groups.get(tierId) ?? []), plan]);
  }
  return [...groups.entries()].map(([id, levels]) => ({ id, levels }));
}

export function planTierId(planId: string): string {
  return planId.slice(0, planId.lastIndexOf('-'));
}

export function priceInRubles(amountMinor: number): string {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency', currency: 'RUB', maximumFractionDigits: 0,
  }).format(amountMinor / 100);
}

export function discountPercent(monthlyAmountMinor: number, months: number, savingsMinor: number): number {
  const referenceTotal = monthlyAmountMinor * months;
  return referenceTotal > 0 ? Math.round(savingsMinor / referenceTotal * 100) : 0;
}
