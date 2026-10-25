import { useState } from 'react';
import { getGetVideoPricingReferenceQueryKey, useGetVideoPricingReference, type GenjutsuTariff } from '@workspace/api-client-react';
import { appendGenjutsuTariffs, isSeedance25, videoEstimateName } from './videoTariffs';

type Props = {
  upstreamId: string;
  limits: Record<string, number> | string;
  tariffs: GenjutsuTariff[] | string;
  scenario?: GenjutsuTariff['scenario'];
  onLimits: (limits: Record<string, number>) => void;
  onTariffs: (tariffs: GenjutsuTariff[]) => void;
};
export default function PricingTools(props: Props) {
  const reference = useGetVideoPricingReference({ query: { queryKey: getGetVideoPricingReferenceQueryKey(), staleTime: 3_600_000 } });
  const [rate, setRate] = useState(''), [error, setError] = useState('');
  const estimateName = videoEstimateName(props.upstreamId);
  if (!estimateName && !props.scenario) return null;
  const data = reference.data;
  const update = (key: string, value: string) => {
    if (typeof props.limits === 'string') return;
    const next = { ...props.limits };
    if (value === '') delete next[key]; else next[key] = Number(value);
    props.onLimits(next);
  };
  const rates = data?.genjutsuRates.filter(r => r.scenario === props.scenario) ?? [];
  const build = () => {
    if (typeof props.tariffs === 'string') return;
    try { props.onTariffs(appendGenjutsuTariffs(props.tariffs, rates, Number(rate))); setError(''); }
    catch (e) { setError(e instanceof Error ? e.message : 'Не удалось подготовить тарифы.'); }
  };
  return <section className="adm-field full" data-testid="video-pricing-tools">
    <strong>Подготовка тарифов · {estimateName ?? 'Genjutsu'}</strong>
    <small>Справочные ставки до скидок. Изменяется только черновик формы; применение — после «Сохранить». Модель, канал и списания автоматически не включаются.</small>
    {reference.isPending && <small role="status">Загружаем справочные ставки…</small>}
    {reference.isError && <button type="button" onClick={() => void reference.refetch()}>Повторить загрузку ставок</button>}
    {estimateName ? <>
      {typeof props.limits === 'string' ? <small role="alert">Сначала исправь формат поля «Лимиты».</small> : <>
        <label><span>Кредитов за 1 USD</span><input aria-label="Кредитов за 1 USD" data-testid="input-video-credit-rate" type="number" min={1} max={1000000} step={1} value={props.limits.videoCreditsPerUsd ?? ''} onChange={e => update('videoCreditsPerUsd', e.target.value)}/></label>
        <label><span>Максимум одной сметы, USD</span><input aria-label="Максимум одной сметы, USD" data-testid="input-video-max-usd" type="number" min={0.000001} max={10000} step="any" value={props.limits.videoMaxUsd ?? ''} onChange={e => update('videoMaxUsd', e.target.value)}/></label>
        <small>Заполни оба поля для расчёта по параметрам. Округление кредитов — вверх. Превышение максимума блокирует запуск. Очисти оба поля для возврата к прежней фиксированной цене.</small>
      </>}
      {data && isSeedance25(props.upstreamId) && <div>{(['480p', '720p', '1080p'] as const).map(resolution =>
        <small key={resolution} style={{ display: 'block' }}>{resolution}: {data.seedanceRates.filter(r => r.resolution === resolution).map(r => `$${r.usdPer1000Tokens}/1000 токенов ${r.videoInput ? 'с входным видео' : 'без входного видео'}`).join(' · ')}</small>)}</div>}
      {!isSeedance25(props.upstreamId) && data && (data.klingRates ?? []).filter(r => r.endpoint === props.upstreamId).map(r => <small key={r.endpoint} data-testid="text-kling-reference-rate">
        Справочно: ${r.usdPerSecondMin}{r.usdPerSecondMax !== r.usdPerSecondMin ? `–$${r.usdPerSecondMax}` : ''}/сек. {r.note} По схеме допустимы 3–15 секунд.</small>)}
      <small>Сервер получает смету по всем выбранным параметрам и исходникам. Справочные ставки не подставляются вместо неё. Рекламные скидки автоматически не применяются.</small>
    </> : <>
      <div>{rates.map(r => <small key={r.resolution} style={{ display: 'block' }}>{r.resolution}: ${r.usdPerSecond}/сек {r.exact ? '' : '· приблизительно'}</small>)}</div>
      <label><span>Кредитов за 1 USD для черновика матрицы</span><input data-testid="input-genjutsu-credit-rate" aria-label="Курс для матрицы Genjutsu" type="number" min={1} max={1000000} step={1} value={rate} onChange={e => setRate(e.target.value)}/></label>
      <button type="button" data-testid="button-build-genjutsu-tariffs" disabled={!data || !rates.some(r => r.exact) || typeof props.tariffs === 'string' || !rate} onClick={build}>Добавить недостающие тарифы 4–30 сек</button>
      <small>Существующие ячейки не заменяются. Для Restyle ставка только приблизительная — автоматическое заполнение запрещено; можно оставить ручные подтверждённые тарифы.</small>
      {error && <small role="alert">{error}</small>}
    </>}
    {data && <details><summary>Источники и условия · проверено {data.reviewedAt}</summary>
      {data.notes.map(note => <p key={note}>{note}</p>)}
      {data.sources.map((source, i) => <p key={source}><a href={source} target="_blank" rel="noreferrer">Источник {i + 1}</a></p>)}
    </details>}
  </section>;
}
