import './templates/manage/manager.css';
import { useDeferredValue, useEffect, useRef, useState } from 'react';
import { Bookmark, Camera, Clapperboard, Heart, Music2, Plus, Search, Sparkles, X } from 'lucide-react';
import { Link, useLocation, useSearch } from 'wouter';
import { Frame } from './shared';
import TemplateFeed from './templates/TemplateFeed';
import { useMeduhaSession } from './session';
import { videoScenarios } from './video/scenarios';

const filters = [
  { kind: 'all', label: 'Все', Icon: Sparkles },
  { kind: 'video', label: 'Видео', Icon: Clapperboard },
  { kind: 'photo', label: 'Фото', Icon: Camera },
  { kind: 'audio', label: 'Аудио', Icon: Music2 },
] as const;

export default function Community() {
  const session = useMeduhaSession();
  const [tab, setTab] = useState<'all' | 'liked' | 'saved'>('all');
  const [search, setSearch] = useState('');
  const searchInput = useRef<HTMLInputElement>(null);
  const search_ = useSearch();
  const [, navigate] = useLocation();
  const tag = new URLSearchParams(search_).get('tag')?.normalize('NFKC').trim().replace(/^#/, '').trim().toLocaleLowerCase() ?? '';
  const scenarioLabel = videoScenarios.find(scenario => scenario.id === tag)?.title ?? tag;
  const clearTag = () => {
    const params = new URLSearchParams(search_);
    params.delete('tag');
    navigate(`/community${params.size ? `?${params.toString()}` : ''}`);
  };
  const queryKind = filters.find(f => f.kind === new URLSearchParams(search_).get('kind'))?.kind ?? 'all';
  const [kind, setKind] = useState<(typeof filters)[number]['kind']>(queryKind);
  useEffect(() => { setKind(queryKind); }, [queryKind]);
  const deferredSearch = useDeferredValue(search);
  useEffect(() => {
    const openSearch = () => {
      setTab('all');
      setKind('all');
      setSearch('');
      if (tag) clearTag();
      requestAnimationFrame(() => searchInput.current?.focus());
    };
    window.addEventListener('meduha:focus-community-search', openSearch);
    return () => window.removeEventListener('meduha:focus-community-search', openSearch);
  }, [search_]);
  return <Frame active="Community">
    <div className="mt-community-shell">
      <header className="mt-community-heading">
        <span className="mt-community-kicker"><Sparkles size={12}/> Сообщество</span>
        <div className="mt-community-title-row">
          <h1>Вдохновение<span>.</span></h1>
          <Link className="mt-share-work" href="/community/manage" aria-label="Поделиться работой" data-testid="link-manage-templates"><Plus size={14}/><span>Поделиться работой</span></Link>
        </div>
        <p>Фото, видео и аудио участников — с промптами, которые можно взять себе</p>
      </header>
      <div className="mt-community-filters" role="tablist" aria-label="Раздел комьюнити">
        <button role="tab" aria-selected={tab === 'all'} className={tab === 'all' ? 'selected' : ''} onClick={() => setTab('all')} data-testid="tab-community-all"><Sparkles size={13}/>В тренде</button>
        <button role="tab" aria-selected={tab === 'liked'} className={tab === 'liked' ? 'selected' : ''} onClick={() => setTab('liked')} data-testid="tab-community-liked"><Heart size={13}/>Понравившиеся</button>
        <button role="tab" aria-selected={tab === 'saved'} className={tab === 'saved' ? 'selected' : ''} onClick={() => setTab('saved')} data-testid="tab-community-saved"><Bookmark size={13}/>Сохранённые</button>
      </div>
      <div className="mt-community-filters" role="tablist" aria-label="Фильтры работ">
        {filters.map(({kind: filterKind, label, Icon}) => <button
          key={filterKind}
          type="button"
          role="tab"
          aria-selected={kind === filterKind}
          className={kind === filterKind ? 'selected' : ''}
          onClick={() => setKind(filterKind)}
          data-testid={`filter-community-${filterKind}`}
        ><Icon size={13}/>{label}</button>)}
      </div>
      {tag && <div className="mt-community-filters" aria-label="Выбранный сценарий">
        <button type="button" className="selected" style={{ maxWidth: '100%', whiteSpace: 'normal' }} data-testid="filter-community-scenario" onClick={clearTag} aria-label={`Снять фильтр: ${scenarioLabel}`}>
          <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>#{tag} · {scenarioLabel}</span><X size={13}/>
        </button>
      </div>}
      <div className="mt-search" role="search">
        <Search size={17}/><input ref={searchInput} value={search} onChange={event => setSearch(event.target.value)} placeholder="Найти работу" aria-label="Поиск по названиям работ" data-testid="input-community-search"/>
        {search && <button type="button" aria-label="Очистить поиск" onClick={() => setSearch('')} data-testid="button-clear-search"><X size={15}/></button>}
      </div>
      {tab !== 'all' && session.phase !== 'authenticated'
        ? <div className="mt-empty" data-testid={tab === 'liked' ? 'text-liked-sign-in' : 'text-saved-sign-in'}>{tab === 'liked' ? <Heart size={24}/> : <Bookmark size={24}/>}<h3>{tab === 'liked' ? 'Понравившиеся — в твоём аккаунте' : 'Сохранённые работы — в твоём аккаунте'}</h3><p>{tab === 'liked' ? 'Войди через Telegram, чтобы ставить лайки и находить любимые работы здесь.' : 'Войди через Telegram, чтобы сохранять работы и возвращаться к ним позже.'}</p>
          {session.telegram ? <button className="mt-share-work" onClick={session.reauthenticate}>Войти</button> : session.telegramBotUrl ? <a className="mt-share-work" href={session.telegramBotUrl} target="_blank" rel="noopener noreferrer">Открыть в Telegram</a> : <Link className="mt-share-work" href="/profile">Открыть профиль</Link>}
        </div>
        : <TemplateFeed search={deferredSearch} tag={tag} kind={kind} likedOnly={tab === 'liked'} savedOnly={tab === 'saved'}/>}
    </div>
  </Frame>;
}
