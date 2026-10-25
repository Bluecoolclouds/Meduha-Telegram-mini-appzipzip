import type { GenjutsuTariff, GenjutsuUsdRate } from '@workspace/api-client-react';

export const isSeedance25 = (id: string) =>
  /^bytedance\/seedance-2\.5\/(text-to-video|image-to-video|reference-to-video|video-edit|video-extend)$/.test(id);
export function videoPolicyProblem(id: string, limits: Record<string, number> | string): string | null {
  if (typeof limits === 'string') return null;
  const rate = limits.videoCreditsPerUsd, max = limits.videoMaxUsd;
  if (rate === undefined && max === undefined) return null;
  if (!isSeedance25(id) || !Number.isSafeInteger(rate) || rate < 1 || rate > 1_000_000
    || !Number.isFinite(max) || max <= 0 || max > 10_000 || Number(max.toFixed(6)) !== max
    || max * rate > 100_000_000) return 'Для Seedance укажи курс кредитов за USD и максимум сметы в USD. Неполная настройка не сохраняется.';
  return null;
}
export function appendGenjutsuTariffs(existing: GenjutsuTariff[], rates: GenjutsuUsdRate[], creditsPerUsd: number) {
  if (!Number.isSafeInteger(creditsPerUsd) || creditsPerUsd < 1 || creditsPerUsd > 1_000_000) throw new Error('Укажи целый положительный курс кредитов за USD.');
  const result = [...existing], keys = new Set(existing.map(t => `${t.scenario}/${t.resolution}/${t.duration}`));
  for (const rate of rates.filter(r => r.exact)) {
    const micros = Math.round(rate.usdPerSecond * 1_000_000);
    if (!Number.isSafeInteger(micros) || micros <= 0) throw new Error('Тариф не подтверждён.');
    for (let duration = 4; duration <= 30; duration++) {
      const key = `${rate.scenario}/${rate.resolution}/${duration}`;
      if (keys.has(key)) continue;
      const creditPrice = Number((BigInt(micros) * BigInt(duration) * BigInt(creditsPerUsd) + 999_999n) / 1_000_000n);
      if (creditPrice > 100_000_000) throw new Error('Тариф превышает допустимое число кредитов.');
      result.push({ scenario: rate.scenario, resolution: rate.resolution, duration, creditPrice }); keys.add(key);
    }
  }
  return result;
}
