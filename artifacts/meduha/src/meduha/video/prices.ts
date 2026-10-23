import type { VideoScenario } from './scenarios';

type Price = { upstreamId: string; creditPrice: number };

/** Composite workflows must not quote the cost of just one component. */
export function scenarioCreditPrice(scenario: VideoScenario, prices: Price[]): number | null {
  if (scenario.availability !== 'documented' || scenario.id === 'ai-blogger'
    || scenario.id === 'genjutsu' || !scenario.endpoint) return null;
  const endpoint = scenario.endpoint.replace(/^\/+/, '');
  const matching = prices.filter(p => p.upstreamId.replace(/^\/+/, '') === endpoint
    && Number.isSafeInteger(p.creditPrice) && p.creditPrice > 0);
  return matching.length ? Math.min(...matching.map(p => p.creditPrice)) : null;
}

export function formatScenarioPrice(price: number | null): string {
  return price === null ? 'Цена уточняется' : `от ${price.toLocaleString('ru-RU')} кр.`;
}
