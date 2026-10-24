/* How many generations a credit amount covers at the cheapest currently
   available (enabled, priced) model. Nothing is invented: if no model of a
   kind is available with a price, the result is null. */
export type PricedModel = { name: string; creditPrice: number | null | undefined; available: boolean };
export type Cheapest = { name: string; price: number };

export function cheapestAvailable(models: readonly PricedModel[] | undefined): Cheapest | null {
  let best: Cheapest | null = null;
  for (const m of models ?? []) {
    const price = m.creditPrice;
    if (!m.available || typeof price !== 'number' || !Number.isSafeInteger(price) || price <= 0) continue;
    if (!best || price < best.price) best = { name: m.name, price };
  }
  return best;
}

export function generationsFor(credits: number, cheapest: Cheapest | null): number | null {
  if (!cheapest || !Number.isSafeInteger(credits) || credits < 0) return null;
  return Math.floor(credits / cheapest.price);
}
