export const INITIAL_PAYMENT_PROVIDER = 'yookassa';
export const BILLING_CURRENCY = 'RUB';
export const USD_TO_RUB_REFERENCE_RATE = 89;

export type BillingMonths = 1 | 3 | 12;
export type BillingPlan = {
  id: string;
  name: string;
  credits: number;
  monthlyAmountMinor: number;
  monthlyAmountRub: number;
  termPrices: Array<{
    months: BillingMonths;
    monthlyAmountMinor: number;
    totalAmountMinor: number;
    savingsMinor: number;
  }>;
};

const sourceTiers = [
  { id: 'p100', name: 'Starter', levels: [{ credits: 270, referenceUsd: 19 }] },
  { id: 'p300', name: 'Plus', levels: [{ credits: 1200, referenceUsd: 59 }] },
  { id: 'p1000', name: 'Ultra', levels: [
    { credits: 3000, referenceUsd: 129 },
    { credits: 6000, referenceUsd: 220 },
    { credits: 9000, referenceUsd: 310 },
  ] },
] as const;

const annualReferenceUsd: Record<string, number> = { p100: 19, p300: 47, p1000: 99 };
const termMonths: BillingMonths[] = [1, 3, 12];

export function getBillingPlans(): BillingPlan[] {
  return sourceTiers.flatMap(tier => tier.levels.map(level => {
    const monthlyAmountMinor = Math.round(level.referenceUsd * USD_TO_RUB_REFERENCE_RATE * 100);
    const annualDiscount = 1 - annualReferenceUsd[tier.id] / tier.levels[0].referenceUsd;
    const termPrices = termMonths.map(months => {
      const discount = months === 12 ? annualDiscount : months === 3 ? annualDiscount / 2 : 0;
      const termMonthlyMinor = Math.round(monthlyAmountMinor * (1 - discount));
      return {
        months,
        monthlyAmountMinor: termMonthlyMinor,
        totalAmountMinor: termMonthlyMinor * months,
        savingsMinor: monthlyAmountMinor * months - termMonthlyMinor * months,
      };
    });
    return {
      id: `${tier.id}-${level.credits}`,
      name: tier.name,
      credits: level.credits,
      monthlyAmountMinor,
      monthlyAmountRub: monthlyAmountMinor / 100,
      termPrices,
    };
  }));
}

export function resolveBillingPlan(planId: string, months: number) {
  const plan = getBillingPlans().find(item => item.id === planId);
  const price = plan?.termPrices.find(item => item.months === months);
  if (!plan || !price) return null;
  return { ...plan, ...price };
}
