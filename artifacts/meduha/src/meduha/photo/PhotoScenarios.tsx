import { useMemo, useState } from 'react';
import { ArrowRight, Check, Image as ImageIcon, Search, SlidersHorizontal, X } from 'lucide-react';
import { Link, useLocation, useSearch } from 'wouter';
import { Frame, Sheet, asset, mood } from '../shared';
import { ScenarioCarousel } from '../video/ScenarioHero';
import { photoCategories, photoIdeaHref, photoIdeas, searchPhotoIdeas, type PhotoCategory, type PhotoIdea } from './ideas';
import '../video/video.css';
import '../video/catalogue.css';
import './photo.css';

export default function PhotoScenarios() {
  const search = useSearch();
  const [, navigate] = useLocation();
  const initial = new URLSearchParams(search).get('q') || '';
  const [query, setQuery] = useState(initial);
  const [category, setCategory] = useState<'all' | PhotoCategory>('all');
  const [filterOpen, setFilterOpen] = useState(false);
  const [selected, setSelected] = useState<PhotoIdea | null>(null);
  const results = useMemo(() => searchPhotoIdeas(query).filter(idea => category === 'all' || idea.category === category), [query, category]);
  const activeFilters = category === 'all' ? 0 : 1;
  const searching = query.trim().length > 0;
  const updateQuery = (value: string) => {
    setQuery(value);
    const params = new URLSearchParams({ type: 'photo' });
    if (value.trim()) params.set('q', value.trim());
    window.history.replaceState(window.history.state, '', `${import.meta.env.BASE_URL.replace(/\/$/, '')}/create?${params}`);
  };
  const openEditor = (idea: PhotoIdea) => navigate(photoIdeaHref(idea));

  return <Frame active="Create">
    <div className="vs-page photo-page" data-testid="catalogue-photo">
      <div className="photo-heading"><span className="photo-kicker"><ImageIcon size={12}/> СТУДИЯ ФОТОИДЕЙ</span><h1>Какой будет<br/>твой кадр<span>.</span></h1><p>Выбери направление — доработай текст и сохрани идею.</p></div>
      <ScenarioCarousel items={photoIdeas.slice(0, 5)} image={asset} label={() => 'Идея для фото'} eyebrow={() => 'Подборка · фотоидеи'} onOpen={(idea: PhotoIdea) => setSelected(idea)} paused={selected !== null}/>
      <Link href="/create?type=photo&editor=1" className="vs-promo" data-testid="link-photo-promo">
        <span className="vs-promo-icon"><ImageIcon size={17}/></span>
        <span className="vs-promo-text"><strong>Уже знаешь, что хочешь?</strong><small>Запиши свою идею без готового сценария</small></span>
        <span className="vs-promo-cta">К идее</span>
      </Link>
      <div className="vs-toolbar">
        <div className="vs-toolrow">
          <form className="vs-search" role="search" onSubmit={event => { event.preventDefault(); if (results[0]) setSelected(results[0]); }}>
            <Search size={14} aria-hidden="true"/>
            <input data-testid="input-photo-search" aria-label="Поиск фотоидей" value={query} onChange={event => updateQuery(event.target.value)} maxLength={300} placeholder="Найди идею: портрет, товар, горы" enterKeyHint="search"/>
            {searching && <button type="button" className="vs-clear" data-testid="button-photo-clear-search" aria-label="Очистить поиск" onClick={() => updateQuery('')}><X size={13}/></button>}
          </form>
          <button type="button" data-testid="button-photo-filter" className={`vs-filter${activeFilters ? ' on' : ''}`} aria-expanded={filterOpen} aria-controls="photo-filter-panel" onClick={() => setFilterOpen(value => !value)}><SlidersHorizontal size={13}/>Фильтр{activeFilters > 0 && <b>{activeFilters}</b>}</button>
        </div>
        {filterOpen && <div id="photo-filter-panel" className="vs-panel">
          <span className="vs-panel-label">Направление</span>
          <div className="vs-chips" role="group" aria-label="Категории фотоидей">{photoCategories.map(item => <button key={item.id} data-testid={`button-photo-category-${item.id}`} aria-pressed={category === item.id} className={category === item.id ? 'on' : ''} onClick={() => setCategory(item.id)}>{item.label}</button>)}</div>
          {activeFilters > 0 && <button type="button" data-testid="button-photo-reset-filter" className="vs-panel-reset" onClick={() => setCategory('all')}>Сбросить фильтр</button>}
        </div>}
      </div>
      <h2 className="vs-section">{searching ? 'Подходящие фотоидеи' : category === 'all' ? 'Все фотоидеи' : photoCategories.find(item => item.id === category)?.label}</h2>
      <span className="vs-sr" aria-live="polite">{results.length ? `Найдено фотоидей: ${results.length}` : 'Ничего не нашлось'}</span>
      {results.length ? <div className="vs-grid photo-grid">{results.map((idea, index) => <button key={idea.id} data-testid={`card-photo-idea-${idea.id}`} className={`vs-card photo-card${searching && index === 0 ? ' best' : ''}`} style={{ animationDelay: `${Math.min(index, 8) * 35}ms` }} onClick={() => setSelected(idea)}>
        <span className="vs-card-img"><img src={asset(idea.image)} alt="" loading="lazy"/>{searching && index === 0 && <span className="vs-best">Ближе всего</span>}</span>
        <span className="vs-card-body"><strong>{idea.title}</strong><small>{idea.subtitle}</small><span className="vs-card-foot"><span className="photo-tag">{photoCategories.find(item => item.id === idea.category)?.label}</span><span className="photo-tag">Идея для фото</span></span></span>
      </button>)}</div> : <div className="vs-empty photo-empty" data-testid="empty-photo-ideas">
        <img src={mood('curious')} alt=""/><strong>Пока нет такой идеи</strong><p>Попробуй другое слово или сбрось фильтры, чтобы вернуться ко всей подборке.</p>
        <div className="vs-empty-actions"><button data-testid="button-photo-reset-all" onClick={() => { updateQuery(''); setCategory('all'); }}>Сбросить поиск и фильтр</button></div>
      </div>}
      <Link className="vs-free" href="/create?type=photo&editor=1" data-testid="link-photo-free-editor"><span><strong>Без сценария</strong><small>Открыть редактор и записать идею с нуля</small></span><ArrowRight size={15}/></Link>
    </div>
    {selected && <PhotoIdeaSheet idea={selected} onClose={() => setSelected(null)} onContinue={() => openEditor(selected)}/>}
  </Frame>;
}

function PhotoIdeaSheet({ idea, onClose, onContinue }: { idea: PhotoIdea; onClose: () => void; onContinue: () => void }) {
  return <Sheet title={idea.title} onClose={onClose} className="vs-sheet photo-sheet">
    <img className="vs-sheet-img" src={asset(idea.image)} alt={`Пример для идеи «${idea.title}»`}/>
    <div className="vs-sheet-tags"><span className="vs-status documented"><ImageIcon size={11}/>Фотоидея</span><span className="vs-provider">{photoCategories.find(item => item.id === idea.category)?.label}</span></div>
    <p className="vs-sub">{idea.subtitle}</p>
    <h3 className="vs-h"><Check size={15}/>Текст идеи</h3>
    <p className="photo-prompt-preview">{idea.prompt}</p>
    <div className="vs-disclose"><strong>Это сценарий, не готовый результат.</strong> Откроется студия генерации с этим описанием. Можно выбрать модель и добавить фото-референсы. Запуск доступен только после входа и включения модели администратором; цена показывается до отправки.</div>
    <button data-testid={`button-use-photo-idea-${idea.id}`} className="m-generate" onClick={onContinue}>Настроить генерацию<ArrowRight size={16}/></button>
  </Sheet>;
}
