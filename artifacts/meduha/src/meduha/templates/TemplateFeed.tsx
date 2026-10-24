import { useCallback, useEffect, useRef, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Camera, Clapperboard, LoaderCircle, Music2, Play, Plus, RotateCw } from 'lucide-react';
import { Link, useLocation, useSearch } from 'wouter';
import { Sheet } from '../shared';
import { getExampleTemplate, getPublicTemplate, getTemplatePage, isExampleTemplate, type InspirationTemplate } from './catalog';
import { feedMediaUrl } from './feedMedia';
import WorkViewer from './WorkViewer';
import { useMeduhaSession } from '../session';
import { usePlaybackPolicy } from './playback-policy';

type TemplateKind = 'all' | 'photo' | 'video' | 'audio';

function plural(n: number) {
  const a = n % 10, b = n % 100;
  if (a === 1 && b !== 11) return 'работа';
  if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return 'работы';
  return 'работ';
}

function ratioOf(t: InspirationTemplate) {
  const r = t.width > 0 && t.height > 0 ? t.height / t.width : 1.25;
  return Math.min(1.78, Math.max(0.56, r));
}

export default function TemplateFeed({ search = '', tag = '', kind = 'all', likedOnly = false, savedOnly = false }: { search?: string; tag?: string; kind?: TemplateKind; likedOnly?: boolean; savedOnly?: boolean }) {
  const playback = usePlaybackPolicy();
  const [visibleIds, setVisibleIds] = useState<string[]>([]);
  const reportVisibility = useCallback((id: string, visible: boolean) => {
    setVisibleIds(previous => visible
      ? previous.includes(id) ? previous : [...previous, id]
      : previous.includes(id) ? previous.filter(item => item !== id) : previous);
  }, []);
  const session = useMeduhaSession();
  const accountId = session.phase === 'authenticated' ? session.account?.id : undefined;
  const normalizedSearch = search.trim().replace(/\s+/g, ' ');
  const sentinel = useRef<HTMLDivElement>(null);
  const [routeLocation, navigate] = useLocation();
  const searchParams = useSearch();
  const workId = new URLSearchParams(searchParams).get('work');
  const exampleTemplate = workId ? getExampleTemplate(workId) : undefined;
  const query = useInfiniteQuery({
    queryKey: ['meduha-template-feed', accountId ?? 'guest', likedOnly, savedOnly, normalizedSearch.toLocaleLowerCase(), kind, tag],
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam, signal }) => getTemplatePage({ query: normalizedSearch, tag, kind, likedOnly, savedOnly, cursor: pageParam, limit: 12 }, signal),
    getNextPageParam: page => page.nextCursor ?? undefined,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    refetchOnMount: 'always',
  });
  const items = Array.from(new Map((query.data?.pages.flatMap(page => page.items) ?? []).map(item => [item.id, item])).values());
  const total = query.data?.pages[0]?.total ?? 0;
  const feedTemplate = workId ? items.find(item => item.id === workId) : undefined;
  const workQuery = useQuery({
    queryKey: ['meduha-public-template', accountId ?? 'guest', workId],
    queryFn: ({ signal }) => getPublicTemplate(workId!, signal),
    enabled: !!workId && !exampleTemplate && !feedTemplate,
    retry: false,
    staleTime: 30_000,
  });
  const activeTemplate = exampleTemplate ?? feedTemplate ?? workQuery.data;
  const viewerItems = activeTemplate && !items.some(item => item.id === activeTemplate.id)
    ? [activeTemplate, ...items]
    : items;
  const playingIds = new Set(playback.canAutoplay && !workId
    ? visibleIds.filter(id => items.some(item => item.id === id)).slice(0, playback.previewLimit) : []);

  function setWork(id: string, replace = false) {
    const params = new URLSearchParams(searchParams);
    params.set('work', id);
    navigate(`${routeLocation.split('?')[0]}?${params.toString()}`, { replace });
  }

  function closeWork() {
    const params = new URLSearchParams(searchParams);
    params.delete('work');
    const suffix = params.toString();
    navigate(`${routeLocation.split('?')[0]}${suffix ? `?${suffix}` : ''}`);
  }

  useEffect(() => {
    const marker = sentinel.current;
    if (!marker || !query.hasNextPage || query.isFetchingNextPage || query.isFetchNextPageError) return;
    const root = marker.closest('.m-scroll');
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) void query.fetchNextPage();
    }, { root, rootMargin: '240px 0px', threshold: 0 });
    observer.observe(marker);
    return () => observer.disconnect();
  }, [query.hasNextPage, query.isFetchingNextPage, query.isFetchNextPageError, query.fetchNextPage, items.length]);

  const head = <div className="mt-trend-head">
    <h2>{likedOnly ? 'Понравившиеся' : savedOnly ? 'Сохранённые' : 'В тренде'}</h2>
    {total > 0 && <span data-testid="text-community-total">{total} {plural(total)}</span>}
  </div>;

  if (query.isPending && !workId) return <>{head}<div className="mt-mosaic" aria-label="Загружаем работы" data-testid="status-template-loading">
    {[0, 1].map(c => <div className="mt-mosaic-column" key={c}>{[0, 1, 2].map(i => <span key={i} className={`mt-skeleton mt-skeleton-${(i + c) % 3}`}/>)}</div>)}
  </div></>;
  if (query.isError && !query.data && !workId) {
    return <>{head}<div className="mt-state mt-state-error" role="alert" data-testid="status-template-error">
      <strong>Лента пока не открылась</strong><span>Проверь соединение и попробуй ещё раз.</span>
      <button onClick={() => void query.refetch()} data-testid="button-template-retry"><RotateCw size={15}/> Повторить</button>
    </div></>;
  }
  if (!items.length && !workId) {
    const filtered = !!normalizedSearch || !!tag || kind !== 'all';
    return <>{head}<div className="mt-state mt-state-empty" data-testid="status-template-empty">
      <span className="mt-empty-mark">{kind === 'audio' ? <Music2 size={19}/> : kind === 'video' ? <Clapperboard size={19}/> : <Camera size={19}/>}</span>
      <strong>{filtered ? 'Ничего не нашлось' : likedOnly ? 'Здесь будут понравившиеся работы' : savedOnly ? 'Здесь будут сохранённые работы' : 'Здесь пока тихо'}</strong>
      <span>{filtered ? 'Попробуй другой запрос или сними фильтр.' : likedOnly ? 'Нажми на сердечко в публикации участника — она появится здесь.' : savedOnly ? 'Сохраняй публикации в просмотре, чтобы вернуться к ним позже.' : 'Опубликованных работ ещё нет. Поделись фото, видео или аудио вместе с промптом — после проверки работа появится здесь.'}</span>
      {!filtered && !likedOnly && !savedOnly && <Link className="mt-empty-share" href="/community/manage" data-testid="link-empty-share"><Plus size={14}/> Поделиться работой</Link>}
    </div></>;
  }

  // Greedy balance into two columns by estimated height.
  const cols: InspirationTemplate[][] = [[], []];
  const h = [0, 0];
  items.forEach(t => { const c = h[0] <= h[1] ? 0 : 1; cols[c].push(t); h[c] += ratioOf(t) + 0.02; });

  return <>
    {head}
    {items.length > 0 && <div className="mt-mosaic" data-testid="grid-template-mosaic" aria-label="Работы сообщества">
      {cols.map((col, ci) => <div className="mt-mosaic-column" key={ci}>
        {col.map(t => <MosaicTile key={t.id} template={t} onOpen={item => setWork(item.id)} autoplay={playingIds.has(t.id)} reportVisibility={reportVisibility}/>)}
      </div>)}
    </div>}
    <div className="mt-feed-footer" ref={sentinel} aria-live="polite">
      {query.isFetchingNextPage && <span className="mt-loading-inline"><LoaderCircle size={14} className="mt-spin"/> Загружаем ещё</span>}
      {query.isFetchNextPageError && <button className="mt-retry-inline" onClick={() => void query.fetchNextPage()} data-testid="button-next-retry"><RotateCw size={13}/> Не удалось загрузить — повторить</button>}
      {!query.hasNextPage && !query.isFetchNextPageError && <span>{items.length < total ? `${items.length} из ${total}` : 'Ты долистал до конца'}</span>}
    </div>
    {workId && !activeTemplate && workQuery.isPending && <Sheet title="Загружаем работу" onClose={closeWork} className="mt-depth-sheet">
      <p className="mt-depth-state" role="status" data-testid="status-work-loading">Загружаем опубликованную работу…</p>
    </Sheet>}
    {workId && !activeTemplate && workQuery.isError && <Sheet title="Работа недоступна" onClose={closeWork} className="mt-depth-sheet">
      <div className="mt-depth-state" role="alert" data-testid="status-work-unavailable">
        <strong>{(workQuery.error as { status?: number } | null)?.status === 404 ? 'Эта работа удалена или больше не опубликована.' : 'Не удалось загрузить эту работу.'}</strong>
        <span>Попроси автора поделиться актуальной ссылкой.</span>
        {(workQuery.error as { status?: number } | null)?.status !== 404 && <button type="button" onClick={() => void workQuery.refetch()} data-testid="button-work-retry"><RotateCw size={14}/>Повторить</button>}
      </div>
    </Sheet>}
    {workId && activeTemplate && <WorkViewer template={activeTemplate} items={viewerItems} onSelect={item => setWork(item.id, true)} onClose={closeWork}
      hasMore={!!query.hasNextPage} loadingMore={query.isFetchingNextPage} loadError={query.isFetchNextPageError}
      onLoadMore={() => void query.fetchNextPage()}/>}
  </>;
}

function MosaicTile({ template, onOpen, autoplay, reportVisibility }: { template: InspirationTemplate; onOpen: (item: InspirationTemplate) => void; autoplay: boolean; reportVisibility: (id: string, visible: boolean) => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [imgFailed, setImgFailed] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);
  const [videoPlaying, setVideoPlaying] = useState(false);
  const [visible, setVisible] = useState(false);
  const isVideo = template.kind === 'video';
  const canVideo = isVideo && !!template.videoUrl && !videoFailed;
  const shouldPlay = canVideo && visible && autoplay;
  const Icon = template.kind === 'audio' ? Music2 : isVideo ? Clapperboard : Camera;

  useEffect(() => {
    const node = ref.current;
    if (!node || !canVideo || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(entries => {
      const onScreen = !!entries[0]?.isIntersecting && entries[0].intersectionRatio >= 0.35;
      setVisible(onScreen);
      reportVisibility(template.id, onScreen);
    }, { root: node.closest('.m-scroll'), rootMargin: '0px', threshold: [0, 0.35] });
    observer.observe(node);
    return () => { observer.disconnect(); reportVisibility(template.id, false); };
  }, [canVideo, template.id, reportVisibility]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !shouldPlay) return;
    setVideoPlaying(false);
    v.muted = true;
    void v.play().catch(() => undefined);
    return () => { v.pause(); v.removeAttribute('src'); v.load(); };
  }, [shouldPlay, template.videoUrl]);

  const both = imgFailed && (!canVideo);
  return <button
    ref={ref}
    type="button"
    className="mt-card mt-tile"
    style={{ aspectRatio: `1 / ${ratioOf(template)}` }}
      onClick={() => onOpen(template)}
    aria-label={`Открыть работу: ${template.title}, ${template.kind === 'audio' ? 'аудио' : isVideo ? 'видео' : 'фото'}`}
    data-testid={`card-template-${template.id}`}
  >
    {!imgFailed && <img src={feedMediaUrl(template.id, 'thumb')} alt="" loading="lazy" decoding="async" onError={() => setImgFailed(true)}/>}
    {shouldPlay && <video ref={videoRef} className={videoPlaying ? 'on' : ''} src={feedMediaUrl(template.id, 'preview')} poster={feedMediaUrl(template.id, 'thumb')} muted playsInline loop preload="none" aria-hidden="true" tabIndex={-1} onPlaying={() => setVideoPlaying(true)} onPause={() => setVideoPlaying(false)} onError={() => setVideoFailed(true)}/>}
    {both && <span className="mt-card-failed"><Icon size={18}/><span>Превью недоступно</span></span>}
    <span className="mt-card-shade"/>
    <span className="mt-tile-badges">
      {isVideo && <span className="mt-kind-badge"><Play size={9} fill="currentColor"/>Видео</span>}
      {template.kind === 'audio' && <span className="mt-kind-badge"><Music2 size={10}/>Аудио</span>}
      {isExampleTemplate(template) && <span className="mt-example-badge" data-testid={`badge-example-${template.id}`}>Пример</span>}
    </span>
    <span className="mt-card-title">{template.title}</span>
  </button>;
}
