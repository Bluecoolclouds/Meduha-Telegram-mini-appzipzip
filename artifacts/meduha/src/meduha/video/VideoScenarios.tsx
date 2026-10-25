import { useMemo, useState } from 'react';
import { ArrowRight, Search, SlidersHorizontal, X } from 'lucide-react';
import { getGetModelCatalogPricesQueryKey, useGetModelCatalogPrices } from '@workspace/api-client-react';
import { Link, useLocation, useSearch } from 'wouter';
import { Frame, asset, mood } from '../shared';
import { searchVideoScenarios, scenarioDraftHref, scenarioProvider, videoScenarioProviderLabel, videoScenarioProviders, videoScenarios, type VideoScenario } from './scenarios';
import { ScenarioCarousel, PromoBanner } from './ScenarioHero';
import { formatScenarioPrice, scenarioCreditPrice } from './prices';
import './video.css';
import './catalogue.css';
import { isGenjutsuScenario } from './genjutsu/intent';

import { videoScenarioCover } from '../scenarioCovers';

const chips: { id: 'all' | VideoScenario['category']; label: string }[] = [
  { id: 'all', label: 'Все' }, { id: 'characters', label: 'Персонажи' }, { id: 'editing', label: 'Монтаж и замена' },
  { id: 'creation', label: 'С нуля' }, { id: 'business', label: 'Для бизнеса' },
];

export function withQuery(href: string, q: string) { return q.trim() ? `${href}&q=${encodeURIComponent(q.trim())}` : href; }

export default function VideoScenarios() {
  const search = useSearch(); const [, navigate] = useLocation();
  const initial = new URLSearchParams(search).get('q') || '';
  const [q, setQ] = useState(initial); const [cat, setCat] = useState<typeof chips[number]['id']>('all');
  const [filterOpen, setFilterOpen] = useState(false);
  const [provider, setProvider] = useState('all');
  const pricing = useGetModelCatalogPrices({ query: { queryKey: getGetModelCatalogPricesQueryKey(), staleTime: 30_000, refetchInterval: 60_000 } });
  const priceLabel = (s: VideoScenario) => isGenjutsuScenario(s.id) ? 'Цена после проверки видео'
    : pricing.isLoading ? 'Загружаем цену…'
    : pricing.isError ? 'Цена недоступна' : formatScenarioPrice(scenarioCreditPrice(s, pricing.data?.models ?? []));
  const results = useMemo(() => searchVideoScenarios(q).filter(s => (cat === 'all' || s.category === cat) && (provider === 'all' || scenarioProvider(s) === provider)), [q, cat, provider]);
  const searching = q.trim().length > 0;
  const activeFilters = (cat !== 'all' ? 1 : 0) + (provider !== 'all' ? 1 : 0);
  const syncUrl = (value: string) => { const p = new URLSearchParams({ type: 'video', ideas: '1' }); if (value.trim()) p.set('q', value.trim()); window.history.replaceState(window.history.state, '', `${import.meta.env.BASE_URL.replace(/\/$/, '')}/create?${p}`); };
  const update = (v: string) => { setQ(v); syncUrl(v); };
  const openScenario = (s: VideoScenario) => navigate(withQuery(scenarioDraftHref(s, q), q));

  return <Frame active="Create">
    <div className="vs-page">
    <ScenarioCarousel items={videoScenarios.slice(0, 5)} image={asset} cover={scenario => videoScenarioCover(scenario.id, 'hero')} thumbnail={scenario => videoScenarioCover(scenario.id, 'thumb')} label={(scenario: VideoScenario) => priceLabel(scenario)} onOpen={(scenario: VideoScenario) => openScenario(scenario)}/>
    <PromoBanner/>
    <div className="vs-toolbar">
      <div className="vs-toolrow">
        <form className="vs-search" role="search" onSubmit={e => { e.preventDefault(); if (results[0]) openScenario(results[0]); }}>
          <Search size={14} aria-hidden/>
          <input data-testid="input-scenario-search" aria-label="Опиши задачу для видео" value={q} onChange={e => update(e.target.value)} maxLength={500} placeholder="Опиши задачу: танец, товар, стиль" enterKeyHint="search"/>
          {searching && <button type="button" className="vs-clear" aria-label="Очистить поиск" onClick={() => update('')}><X size={13}/></button>}
        </form>
        <button type="button" data-testid="button-scenario-filter" className={`vs-filter${activeFilters ? ' on' : ''}`} aria-expanded={filterOpen} aria-controls="vs-filter-panel" onClick={() => setFilterOpen(v => !v)}><SlidersHorizontal size={13}/>Фильтр{activeFilters > 0 && <b>{activeFilters}</b>}</button>
      </div>
      {filterOpen && <div id="vs-filter-panel" className="vs-panel">
        <span className="vs-panel-label">Категория</span>
        <div className="vs-chips" role="group" aria-label="Категории">{chips.map(c => <button key={c.id} data-testid={`button-category-${c.id}`} aria-pressed={cat === c.id} className={cat === c.id ? 'on' : ''} onClick={() => setCat(c.id)}>{c.label}</button>)}</div>
        <span className="vs-panel-label">Модель</span>
        <div id="vs-provider-filters" className="vs-chips" role="group" aria-label="Модель">
          <button data-testid="button-provider-all" className={provider === 'all' ? 'on' : ''} aria-pressed={provider === 'all'} onClick={() => setProvider('all')}>Все модели</button>
          {videoScenarioProviders.map(value => <button key={value} data-testid={`button-provider-${value}`} className={provider === value ? 'on' : ''} aria-pressed={provider === value} onClick={() => setProvider(value)}>{videoScenarioProviderLabel(value)}</button>)}
        </div>
        {activeFilters > 0 && <button type="button" className="vs-panel-reset" onClick={() => { setCat('all'); setProvider('all'); }}>Сбросить фильтры</button>}
      </div>}
    </div>
    <h2 className="vs-section">{searching ? 'Подходящие сценарии' : cat === 'all' ? 'Все сценарии' : chips.find(c => c.id === cat)?.label}</h2>
    <span className="vs-sr" aria-live="polite">{searching ? (results.length ? `Найдено: ${results.length}` : 'Ничего не нашлось') : ''}</span>
    {results.length ? <div className="vs-grid">{results.map((s, i) => { return (
      <button key={s.id} data-testid={`card-scenario-${s.id}`} className={`vs-card${searching && i === 0 ? ' best' : ''}`} style={{ animationDelay: `${Math.min(i, 8) * 35}ms` }} onClick={() => openScenario(s)}>
        <span className="vs-card-img"><img src={videoScenarioCover(s.id)} alt="" loading="lazy"/>{searching && i === 0 && <span className="vs-best">Ближе всего</span>}</span>
        <span className="vs-card-body"><strong>{s.title}{s.id === 'genjutsu' && <em> · Genjutsu</em>}</strong><small>{s.subtitle}</small>
          <span className="vs-card-foot"><span className="vs-prov">{s.providerLabel}</span><span className="vs-price" data-testid={`text-price-${s.id}`}>{priceLabel(s)}</span></span></span>
              </button>); })}</div>
      : <div className="vs-empty"><img src={mood('curious')} alt=""/><strong>Такого сценария пока нет</strong><p>Попробуй описать проще: «танец», «товар», «стиль», «фото». Или начни с чистого листа.</p>
        <div className="vs-empty-actions"><button onClick={() => { update(''); setCat('all'); setProvider('all'); }}>Сбросить поиск</button><Link href="/create?type=video&editor=1">Свободная идея</Link></div></div>}
    <Link className="vs-free" href="/create?type=video" data-testid="link-video-models"><span><strong>Видеомодели</strong><small>Официальный каталог моделей с генерацией</small></span><ArrowRight size={15}/></Link>
    <Link className="vs-free" href="/create?type=video&editor=1"><span><strong>Без сценария</strong><small>Открыть обычный редактор видеоидеи</small></span><ArrowRight size={15}/></Link>
    </div>
  </Frame>;
}

