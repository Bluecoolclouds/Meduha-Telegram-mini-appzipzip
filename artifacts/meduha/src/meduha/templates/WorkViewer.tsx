import { useCallback, useEffect, useRef, useState } from 'react';
import { Flag } from 'lucide-react';
import { Bookmark, Check, ChevronLeft, Clapperboard, Copy, Download, Heart, LoaderCircle, MoreHorizontal, Pause, Play, RotateCw, Search, Share2, Sparkles, UserRound, Volume2, VolumeX } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import meduhaMascot from '../meduha-mascot.png';
import { AppNavigation, mood, Sheet } from '../shared';
import { isExampleTemplate, templateMediaUrl, type InspirationTemplate } from './catalog';
import { usePublicationLike } from './likes';
import { usePublicationSave } from './saves';
import { usePlaybackPolicy } from './playback-policy';
import { PublicationReport } from './PublicationReport';
import { isRecipe, recipeHref } from './recipe/model';
import './work-viewer.css';

type Props = {
  template: InspirationTemplate;
  items: InspirationTemplate[];
  onSelect: (item: InspirationTemplate) => void;
  onClose: () => void;
  hasMore: boolean;
  loadingMore: boolean;
  loadError: boolean;
  onLoadMore: () => void;
};

/** Graduated from the original «Глубина» full-screen feed, not its studio-card variant. */
export default function WorkViewer({ template, items, onSelect, onClose, hasMore, loadingMore, loadError, onLoadMore }: Props) {
  const playback = usePlaybackPolicy();
  const [location, navigate] = useLocation();
  const like = usePublicationLike(template);
  const save = usePublicationSave(template);
  const media = useRef<HTMLMediaElement | null>(null);
  const gesture = useRef<{ x: number; y: number } | null>(null);
  const suppressMediaTapUntil = useRef(0);
  const lastMove = useRef(0);
  const pendingNext = useRef(false);
  const [detail, setDetail] = useState(false);
  const [coach, setCoach] = useState(true);
  const [mediaError, setMediaError] = useState(false);
  const [posterError, setPosterError] = useState(false);
  const [mediaReady, setMediaReady] = useState(false);
  const [failedAvatar, setFailedAvatar] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [duration, setDuration] = useState(0);
  const [time, setTime] = useState(0);
  const [notice, setNotice] = useState('');
  const [copyFailed, setCopyFailed] = useState(false);
  const [shareError, setShareError] = useState('');
  const [actionsOpen, setActionsOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const actionMenu = useRef<HTMLDivElement>(null);
  const index = Math.max(0, items.findIndex(item => item.id === template.id));
  const next = items[index + 1];
  const example = isExampleTemplate(template);
  const isVideo = template.kind === 'video' && !!template.videoUrl;
  const isAudio = template.kind === 'audio' && !!template.audioUrl;
  const hasPlayback = isVideo || isAudio;
  const prompt = template.prompt ?? '';
  const hasPrompt = prompt.trim().length > 0;
  const author = example ? 'Meduha' : template.authorName?.trim() || 'Автор сообщества';
  const avatar = example
    ? failedAvatar === meduhaMascot ? null : meduhaMascot
    : template.authorAvatarUrl !== failedAvatar ? template.authorAvatarUrl : null;
  const recipe = isRecipe((template as { recipe?: unknown }).recipe) ? (template as { recipe?: unknown }).recipe as Parameters<typeof recipeHref>[0] : null;
  const repeatUrl = recipe ? recipeHref(recipe, { template: template.id }) : null;
  const prepareUrl = `/create?preset=${encodeURIComponent(template.title)}&type=${isAudio ? 'music' : template.kind}&prompt=${encodeURIComponent(prompt)}`;
  useEffect(() => {
    setMediaError(false); setPosterError(false); setMediaReady(false); setCopyFailed(false); setShareError('');
    setReportOpen(false);
    setPlaying(false); setMuted(template.kind !== 'audio'); setTime(0); setDuration(0); setDetail(false); setActionsOpen(false);
    const current = media.current;
    return () => { current?.pause(); };
  }, [template.id]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 2500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (actionsOpen) actionMenu.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
  }, [actionsOpen]);

  useEffect(() => {
    if (detail || reportOpen || !playback.pageActive) media.current?.pause();
  }, [detail, reportOpen, playback.pageActive, template.id]);

  useEffect(() => {
    if (pendingNext.current && next) { pendingNext.current = false; onSelect(next); }
    if (loadError) pendingNext.current = false;
  }, [next, loadError, onSelect]);

  const go = useCallback((direction: 1 | -1) => {
    if (detail || reportOpen || Date.now() - lastMove.current < 650) return;
    lastMove.current = Date.now(); setCoach(false);
    const item = items[index + direction];
    if (item) onSelect(item);
    else if (direction === 1 && hasMore && !loadingMore) { pendingNext.current = true; onLoadMore(); }
  }, [detail, reportOpen, items, index, onSelect, hasMore, loadingMore, onLoadMore]);

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (detail || reportOpen || (event.target instanceof HTMLElement && event.target.matches('input,textarea,select'))) return;
      if (event.key === 'Escape' && actionsOpen) { event.preventDefault(); setActionsOpen(false); menuTrigger.current?.focus(); return; }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); go(event.key === 'ArrowDown' ? 1 : -1); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [detail, reportOpen, actionsOpen, go]);

  async function copy() {
    try { await navigator.clipboard.writeText(prompt); setCopyFailed(false); setNotice('Промпт скопирован'); }
    catch { setCopyFailed(true); setDetail(true); }
  }

  async function sharePublication() {
    setNotice('');
    setShareError('');
    const url = new URL(window.location.href);
    url.searchParams.set('work', template.id);
    url.hash = '';
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: template.title, text: 'Посмотри эту работу в meduha', url: url.toString() });
        setNotice('Ссылка отправлена.');
        return;
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(url.toString());
      setNotice('Ссылка скопирована.');
    } catch {
      setShareError('Не удалось скопировать ссылку. Скопируй адрес страницы вручную.');
    }
  }

  function openCommunitySearch() {
    setActionsOpen(false);
    if (location.startsWith('/community')) onClose();
    else navigate('/community');
    window.setTimeout(() => window.dispatchEvent(new Event('meduha:focus-community-search')), 0);
  }

  function downloadMedia() {
    setActionsOpen(false);
    const source = isAudio ? template.audioUrl : isVideo ? template.videoUrl : template.poster;
    if (!source) { setNotice('У этой публикации нет файла для скачивания.'); return; }
    const url = new URL(templateMediaUrl(source), window.location.href);
    if (url.origin !== window.location.origin) {
      setNotice('Для этого внешнего источника скачивание недоступно.');
      return;
    }
    const extension = url.pathname.match(/\.(mp4|webm|jpg|jpeg|png|webp|mp3|wav)$/i)?.[1] ?? (isAudio ? 'mp3' : isVideo ? 'mp4' : 'jpg');
    const filename = `${template.title.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/^\.+/, '').slice(0, 80) || 'meduha'}.${extension}`;
    if (/^\/api\/meduha\/media\/[0-9a-f-]{36}$/i.test(url.pathname)) {
      url.searchParams.set('download', 'true');
      url.searchParams.set('filename', template.title.slice(0, 80));
    }
    const anchor = document.createElement('a');
    anchor.href = url.toString();
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setActionsOpen(false);
    setNotice('Скачивание началось.');
  }

  async function togglePlayback() {
    if (!playback.pageActive) return;
    const current = media.current;
    if (!current) return;
    if (!current.paused) current.pause();
    else try { await current.play(); } catch { setNotice('Не удалось начать воспроизведение. Попробуй ещё раз.'); }
  }

  return <Sheet title={`Работа: ${template.title}`} onClose={onClose} className="mw-sheet">
    <article className="mw-surface" data-testid="detail-published-work"
      onClick={event => { if (actionsOpen && !(event.target as HTMLElement).closest('.mw-action-menu,.mw-menu-trigger')) setActionsOpen(false); }}
      onWheel={event => { if (!detail && Math.abs(event.deltaY) > 24 && !(event.target as HTMLElement).closest('input')) go(event.deltaY > 0 ? 1 : -1); }}
      onTouchStart={event => {
        const target = event.target as HTMLElement;
        if (detail || (target.closest('button,a,input') && !target.closest('.mw-media-tap'))) { gesture.current = null; return; }
        gesture.current = { x: event.touches[0].clientX, y: event.touches[0].clientY };
      }}
      onTouchEnd={event => {
        const start = gesture.current; gesture.current = null;
        if (!start || detail) return;
        const y = start.y - event.changedTouches[0].clientY, x = start.x - event.changedTouches[0].clientX;
        if (Math.abs(y) > 10 || Math.abs(x) > 10) suppressMediaTapUntil.current = Date.now() + 700;
        if (Math.abs(y) > 50 && Math.abs(y) > Math.abs(x) * 1.2) go(y > 0 ? 1 : -1);
      }}
      onTouchCancel={() => { gesture.current = null; suppressMediaTapUntil.current = Date.now() + 700; }}>
      {!posterError && <img key={`poster-${template.id}`} className={`mw-background${isVideo ? ' video-poster' : ''}`} src={templateMediaUrl(template.poster)} alt={isVideo ? '' : template.title} onLoad={() => { if (!hasPlayback) setMediaReady(true); }} onError={() => setPosterError(true)} data-testid="img-work-preview"/>}
      {isVideo && !mediaError && <video key={template.id} ref={node => { media.current = node; }} className="mw-video" src={templateMediaUrl(template.videoUrl!)} poster={templateMediaUrl(template.poster)} autoPlay={playback.canAutoplay} muted={muted} playsInline loop preload="metadata"
        onError={() => setMediaError(true)} onLoadedData={() => setMediaReady(true)} onPlay={event => { if (!playback.pageActive) event.currentTarget.pause(); else setPlaying(true); }} onPause={() => setPlaying(false)}
        onLoadedMetadata={event => { setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0); setMediaReady(true); }}
        onTimeUpdate={event => setTime(event.currentTarget.currentTime)}
        aria-label={`Видео: ${template.title}`} data-testid="video-work-preview"/>}
      {isAudio && !mediaError && <audio key={template.id} ref={node => { media.current = node; }} src={templateMediaUrl(template.audioUrl!)} muted={muted} preload="metadata"
        onError={() => setMediaError(true)} onPlay={event => { if (!playback.pageActive) event.currentTarget.pause(); else setPlaying(true); }} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
        onLoadedMetadata={event => { setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0); setMediaReady(true); }}
        onTimeUpdate={event => setTime(event.currentTarget.currentTime)}
        aria-label={`Аудио: ${template.title}`} data-testid="audio-work-preview"/>}
      {hasPlayback && !mediaError && <button type="button" className={`mw-media-tap${isAudio ? ' is-audio' : ''}`}
        aria-label={isAudio ? playing ? 'Пауза аудио' : 'Воспроизвести аудио' : playing ? 'Поставить видео на паузу' : 'Продолжить видео'}
        data-testid={isAudio ? 'button-audio-toggle' : 'button-video-tap'}
        onClick={() => { if (Date.now() >= suppressMediaTapUntil.current) void togglePlayback(); }}>
        {(isAudio || (!playing && mediaReady)) && <span className="mw-tap-icon" aria-hidden="true">{playing ? <Pause size={32}/> : <Play size={32} fill="currentColor"/>}</span>}
      </button>}
      <span className="mw-scrim" aria-hidden="true"/>
      {!mediaReady && !mediaError && !(posterError && !hasPlayback) && <div className="mw-loading" role="status"><LoaderCircle size={22} className="mt-spin"/><span>Загружаем медиа</span></div>}
      {(mediaError || (posterError && !hasPlayback)) && <div className="mw-media-error" role="alert">
        <Clapperboard size={26}/><strong>Медиа не загрузилось</strong>
        <button onClick={() => { setMediaError(false); setPosterError(false); setMediaReady(false); }} data-testid="button-media-retry"><RotateCw size={14}/>Повторить</button>
      </div>}
      <header className="mw-top">
        <button className="mw-back" onClick={onClose} data-testid="button-close-work"><ChevronLeft size={17}/>В ленту</button>
        <button className="mw-search" onClick={openCommunitySearch} aria-label="Искать работы в комьюнити" title="Поиск по комьюнити" data-testid="button-search-community"><Search size={17}/></button>
      </header>
      {coach && <button className="mw-coach" onClick={() => setCoach(false)} aria-label="Скрыть подсказку">
        <img src={mood('wink')} alt=""/><span>Листай вверх — там глубже.<small>Промпт можно открыть и взять за основу</small></span>
      </button>}
      <div className="mw-progress" aria-hidden="true">{items.slice(Math.max(0, index - 3), index + 4).map(item => <i key={item.id} className={item.id === template.id ? 'on' : ''}/>)}</div>
      <aside className="mw-rail" aria-label="Действия с работой">
        <button className={like.likedByMe ? 'mw-liked' : ''} disabled={like.pending} aria-pressed={like.likedByMe}
          aria-label={like.likedByMe ? 'Убрать лайк' : 'Поставить лайк'} aria-busy={like.pending}
          data-testid="button-like-work" onClick={() => { void like.toggle().then(message => { if (message) setNotice(message); }); }}>
          <span>{like.pending ? <LoaderCircle size={21} className="mt-spin"/> : <Heart size={21} fill={like.likedByMe ? 'currentColor' : 'none'}/>}</span>
          <small data-testid="text-like-count">{example ? 'Лайк' : like.likeCount}</small>
        </button>
        {!example && <button className={save.savedByMe ? 'mw-saved' : ''} disabled={save.pending} aria-pressed={save.savedByMe}
          aria-label={save.savedByMe ? 'Удалить из сохранённого' : 'Сохранить публикацию'} aria-busy={save.pending}
          data-testid="button-save-work" onClick={() => { void save.toggle().then(message => { if (message) setNotice(message); }); }}>
          <span>{save.pending ? <LoaderCircle size={21} className="mt-spin"/> : <Bookmark size={20} fill={save.savedByMe ? 'currentColor' : 'none'}/>}</span>
          <small>{save.savedByMe ? 'Сохранено' : 'Сохранить'}</small>
        </button>}
        {hasPlayback && !mediaError && <>
    <button onClick={() => setMuted(value => !value)} aria-label={muted ? 'Включить звук' : 'Выключить звук'} aria-pressed={!muted}><span>{muted ? <VolumeX size={20}/> : <Volume2 size={20}/>}</span>Звук</button>
        </>}
        <button ref={menuTrigger} className="mw-menu-trigger" onClick={() => setActionsOpen(open => !open)} aria-label="Дополнительные действия" aria-haspopup="menu" aria-expanded={actionsOpen} data-testid="button-work-more"><span><MoreHorizontal size={21}/></span>Ещё</button>
        {hasPrompt && <button onClick={() => void copy()} aria-label="Скопировать промпт" data-testid="button-copy-prompt"><span><Copy size={20}/></span>Промпт</button>}
      </aside>
      {actionsOpen && <div ref={actionMenu} className="mw-action-menu" role="menu" aria-label="Действия с публикацией" data-testid="menu-work-actions"
        onKeyDown={event => {
          const buttons = Array.from(actionMenu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
          const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
          const nextIndex = event.key === 'ArrowDown' ? (current + 1) % buttons.length
            : event.key === 'ArrowUp' ? (current - 1 + buttons.length) % buttons.length
              : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : -1;
          if (nextIndex >= 0 && buttons.length) { event.preventDefault(); event.stopPropagation(); buttons[nextIndex].focus(); }
        }}>
        <button type="button" role="menuitem" onClick={downloadMedia}><Download size={16}/>Скачать</button>
        {!example && <button type="button" role="menuitem" onClick={() => { setActionsOpen(false); void sharePublication(); requestAnimationFrame(() => menuTrigger.current?.focus()); }}><Share2 size={16}/>Поделиться</button>}
        {!example && <button type="button" role="menuitem" onClick={() => { setActionsOpen(false); setReportOpen(true); }}><Flag size={16}/>Пожаловаться</button>}
      </div>}
      <div className="mw-body" key={`body-${template.id}`}>
        <div className="mw-author" data-testid="text-work-origin">
          <span className={`mw-avatar${example ? ' mw-avatar-example' : ''}`}>{avatar ? <img src={avatar} alt="" referrerPolicy="no-referrer" onError={() => setFailedAvatar(avatar)}/> : example ? <Sparkles size={17}/> : <UserRound size={18}/>}</span>
          <span><strong>{author}</strong></span>
        </div>
        <h1 className="mw-title-accessible" data-testid="text-viewer-title">{template.title}</h1>
        <button className="mw-prompt" onClick={() => setDetail(true)} data-testid="text-work-prompt">{hasPrompt ? prompt : 'Автор не добавил промпт к этой работе.'}</button>
        {template.tags[0] && <p className="mw-template-name" data-testid="text-template-name">Шаблон: {template.tags[0]}</p>}
        {repeatUrl ? <Link className="mw-remix" href={repeatUrl} data-testid={`link-repeat-${template.id}`}><Sparkles size={17}/>Повторить</Link>
          : hasPrompt && <Link className="mw-remix" href={prepareUrl} data-testid={`link-prepare-${template.id}`}><Sparkles size={17}/>Сделать так же · только промпт</Link>}
        {hasPlayback && duration > 0 && <input className="mw-seek" type="range" min="0" max={duration} step="0.1" value={time} aria-label="Позиция воспроизведения" onChange={event => { if (media.current) media.current.currentTime = Number(event.target.value); }}/>}
      </div>
      <AppNavigation active={location.startsWith('/community') ? 'Community' : 'Home'} onNavigate={onClose}/>
      {(notice || shareError) && <div className="mw-notice" role={shareError ? 'alert' : 'status'}>{shareError ? <Share2 size={15}/> : <Check size={15} />}{shareError || notice}</div>}
      {reportOpen && <PublicationReport templateId={template.id} onClose={() => setReportOpen(false)}
        onSubmitted={() => { setReportOpen(false); setNotice('Жалоба отправлена модератору.'); }}/>}
      {detail && <Sheet title={template.title} onClose={() => setDetail(false)} className="mw-prompt-sheet">
        <div className="mw-detail-intro"><img src={mood('curious')} alt=""/><span>{example ? 'Промпт примера' : 'Промпт автора'}</span></div>
        <p className="mw-full-prompt" data-testid="text-full-work-prompt">{prompt || 'Автор не добавил промпт к этой работе.'}</p>
        {copyFailed && <p role="status" data-testid="status-copy-prompt-error">Не удалось скопировать. Выдели текст и скопируй его вручную.</p>}
        {prompt && <button className="mw-detail-copy" onClick={() => void copy()}><Copy size={15}/>Копировать промпт</button>}
        {template.description && <p>{template.description}</p>}
        {template.credit && <p>{template.credit}</p>}
        {template.sourceUrl && <a className="mw-source" href={template.sourceUrl} target="_blank" rel="noopener noreferrer">Источник медиа</a>}
        <p className="mw-detail-note">{repeatUrl ? 'Повтор откроет нужную модель с промптом, настройками и файлами шаблона. Файлы копируются в твой аккаунт, генерация сама не запускается.' : example ? 'Референс для вдохновения, а не результат генерации по этому промпту.' : 'У этой работы нет рецепта: в редактор перейдёт только промпт.'}</p>
        {repeatUrl ? <Link className="mw-remix" href={repeatUrl} data-testid={`link-repeat-detail-${template.id}`}><Sparkles size={17}/>Повторить</Link>
          : hasPrompt && <Link className="mw-remix" href={prepareUrl}><Sparkles size={17}/>Сделать так же · только промпт</Link>}
      </Sheet>}
    </article>
  </Sheet>;
}
