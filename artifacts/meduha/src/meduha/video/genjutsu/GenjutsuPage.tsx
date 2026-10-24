import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, Check, Download, Film, ImagePlus, LoaderCircle, Lock, RefreshCw, RotateCw, Sparkles, X } from 'lucide-react';
import { useLocation } from 'wouter';
import {
  createGenjutsuGeneration, createGenjutsuPriceQuote, getListGenjutsuModelsQueryKey, getListGenjutsuStylesQueryKey, getListMeduhaGenerationsQueryKey,
  useListGenjutsuModels, useListGenjutsuStyles, useListMeduhaGenerations,
} from '@workspace/api-client-react';
import type { GenerationJob, GenjutsuInput, GenjutsuInputResolution, GenjutsuPriceQuote } from '@workspace/api-client-react';
import { Frame, useToast } from '../../shared';
import { meduhaErrorMessage, useMeduhaSession } from '../../session';
import { uploadMedia, validateFile } from '../../templates/manage/api';
import { UPSTREAM, clearIntent, mediaUuid, payloadSignature, readIntent, readVideoMeta, writeIntent, type GenjutsuScenarioId, type StoredIntent, type VideoMeta } from './intent';
import ModeSelector from './ModeSelector';
import ExamplePreview from './ExamplePreview';
import './genjutsu.css';

type Media = { localId: string; name: string; preview: string; status: 'uploading' | 'done' | 'error'; mediaId: string | null; error: string | null; file: File };
type VideoSlot = Media & { meta: VideoMeta | null; metaError: string | null };

const copy: Record<GenjutsuScenarioId, { title: string; lead: string; video: string; photos: string; steps: string[] }> = {
  genjutsu: { title: 'Перенос движения', lead: 'Возьми движение из своего видео и подари его герою с фото.', video: 'Видео с движением', photos: 'Фото героя', steps: ['Загрузи видео, где хорошо видно движение', 'Добавь 1-8 фото героя, лучше в полный рост', 'Выбери качество и запусти'] },
  'object-swap': { title: 'Замена объекта', lead: 'Оставь сцену и движение, поменяй вещь, товар или героя в кадре.', video: 'Исходное видео', photos: 'Фото нового объекта', steps: ['Видео минимум 640x640 по площади кадра', 'Добавь 1-8 фото объекта с разных сторон', 'Подскажи в описании, что именно заменить'] },
  restyle: { title: 'Новый стиль', lead: 'Та же сцена и тайминг, но другая картинка: выбери стиль из живого списка.', video: 'Исходное видео', photos: 'Референсы стиля (необязательно)', steps: ['Загрузи видео от 4 секунд', 'Выбери ровно один стиль', 'По желанию добавь до 5 референсов'] },
};
const statusLabel: Record<GenerationJob['status'], string> = {
  awaiting_reservation: 'Резервируем кредиты', queued: 'В очереди', submitting: 'Отправляем провайдеру', unknown: 'Статус уточняется',
  in_progress: 'Видео создаётся', finalizing: 'Завершаем и сохраняем', completed: 'Видео готово', failed: 'Не получилось',
};
const terminal = (s: GenerationJob['status']) => s === 'completed' || s === 'failed';
const resolutions: GenjutsuInputResolution[] = ['480p', '720p', '1080p'];
let seq = 0;
const nextId = () => `m${Date.now().toString(36)}${(seq++).toString(36)}`;
type DisplayQuote = GenjutsuPriceQuote & { key: string };

export default function GenjutsuPage({ scenario, initialPrompt, backQ }: { scenario: GenjutsuScenarioId; initialPrompt: string; backQ: string }) {
  const meduha = useMeduhaSession();
  const [, navigate] = useLocation();
  const { toast, notify } = useToast();
  const authenticated = meduha.phase === 'authenticated';
  const accountId = meduha.account?.id ?? '';
  const text = copy[scenario];
  const maxPhotos = scenario === 'restyle' ? 5 : 8;
  const minPhotos = scenario === 'restyle' ? 0 : 1;

  const [video, setVideo] = useState(null as VideoSlot | null);
  const [photos, setPhotos] = useState([] as Media[]);
  const [prompt, setPrompt] = useState(initialPrompt.slice(0, 10000));
  const [resolution, setResolution] = useState('720p' as GenjutsuInputResolution);
  const [modelChoice, setModelChoice] = useState('');
  const [styleId, setStyleId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [quote, setQuote] = useState(null as DisplayQuote | null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState('');
  const [quoteRefreshSeq, setQuoteRefreshSeq] = useState(0);
  const [submitError, setSubmitError] = useState('');
  const [intent, setIntent] = useState(null as StoredIntent | null);
  const [ambiguous, setAmbiguous] = useState(false);
  const videoInput = useRef<HTMLInputElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const urls = useRef(new Set<string>());
  const busy = useRef(false);

  useEffect(() => () => { urls.current.forEach(u => URL.revokeObjectURL(u)); }, []);
  useEffect(() => { if (accountId) { const stored = readIntent(accountId, scenario); setIntent(stored); setAmbiguous(!!stored); } else setIntent(null); }, [accountId, scenario]);

  const modelsQuery = useListGenjutsuModels({ query: { queryKey: getListGenjutsuModelsQueryKey(), enabled: authenticated, retry: false } });
  const models = useMemo(() => (modelsQuery.data?.models ?? []).filter(m => m.upstreamId === UPSTREAM[scenario]), [modelsQuery.data, scenario]);
  const spendingEnabled = modelsQuery.data?.spendingEnabled ?? false;
  const model = models.find(m => m.id === modelChoice) ?? models[0];
  const modelId = model?.id ?? '';
  const quoteKey = video?.mediaId && modelId
    ? JSON.stringify([accountId, modelId, scenario, video.mediaId, resolution]) : '';
  const currentQuote = quote?.key === quoteKey ? quote : null;
  useEffect(() => {
    setQuote(null);
    setQuoteError('');
    if (!authenticated || !modelId || !video?.mediaId || video.status !== 'done' || video.metaError) {
      setQuoteLoading(false);
      return;
    }
    let active = true;
    setQuoteLoading(true);
    createGenjutsuPriceQuote({
      modelId, scenario, videoId: video.mediaId, resolution,
    }, { headers: { 'X-Meduha-Request': '1' }, credentials: 'same-origin' })
      .then(result => {
        if (active) setQuote({ ...result, key: quoteKey });
      })
      .catch(error => {
        if (active) setQuoteError(meduhaErrorMessage(error));
      })
      .finally(() => { if (active) setQuoteLoading(false); });
    return () => { active = false; };
  }, [authenticated, modelId, scenario, video?.mediaId, video?.status, video?.metaError, resolution, quoteKey, quoteRefreshSeq]);
  useEffect(() => {
    if (!currentQuote) return;
    const refreshIn = Math.max(1000, currentQuote.expiresAt - Date.now() - 15_000);
    const timer = window.setTimeout(() => setQuoteRefreshSeq(value => value + 1), refreshIn);
    return () => window.clearTimeout(timer);
  }, [currentQuote]);

  const stylesQuery = useListGenjutsuStyles({ modelId }, { query: { queryKey: getListGenjutsuStylesQueryKey({ modelId }), enabled: authenticated && !!modelId && scenario === 'restyle', retry: false } });
  const styles = stylesQuery.data?.items ?? [];
  const styleLive = styles.some(s => s.id === styleId);
  useEffect(() => { if (styleId && stylesQuery.isSuccess && !styleLive) { setStyleId(''); notify('Выбранный стиль больше недоступен, выбери другой'); } }, [styleId, styleLive, stylesQuery.isSuccess]);

  const jobsQuery = useListMeduhaGenerations({ query: { queryKey: [...getListMeduhaGenerationsQueryKey(), accountId], enabled: authenticated, refetchInterval: 5000 } });
  const allJobs = jobsQuery.data?.items ?? [];
  const jobs = useMemo(() => allJobs.filter(j => j.scenario === scenario || (intent && j.idempotencyKey === intent.key)).sort((a, b) => b.createdAt - a.createdAt).slice(0, 6), [allJobs, scenario, intent]);
  const intentJob = intent ? allJobs.find(j => j.idempotencyKey === intent.key) : undefined;

  // Settle the stored key once its job reaches a terminal state; refresh credits once per terminal transition.
  const seenTerminal = useRef(null as Set<string> | null);
  const refreshRef = useRef(meduha.refreshBootstrap); refreshRef.current = meduha.refreshBootstrap;
  useEffect(() => {
    if (!jobsQuery.data) return;
    const ids = jobsQuery.data.items.filter(j => terminal(j.status)).map(j => j.id);
    if (!seenTerminal.current) { seenTerminal.current = new Set(ids); return; }
    const fresh = ids.filter(id => !seenTerminal.current!.has(id));
    fresh.forEach(id => seenTerminal.current!.add(id));
    if (fresh.length) void refreshRef.current().catch(() => undefined);
  }, [jobsQuery.data]);
  useEffect(() => {
    if (intent && intentJob) {
      setAmbiguous(false);
      if (terminal(intentJob.status)) { clearIntent(accountId, scenario); setIntent(null); }
    }
  }, [intent, intentJob, accountId, scenario]);

  const track = (file: File) => { const u = URL.createObjectURL(file); urls.current.add(u); return u; };
  const drop = (u: string) => { URL.revokeObjectURL(u); urls.current.delete(u); };

  const runUpload = async (localId: string, file: File, isVideo: boolean) => {
    const patch = (p: Partial<Media>) => isVideo ? setVideo(v => v && v.localId === localId ? { ...v, ...p } : v) : setPhotos(list => list.map(m => m.localId === localId ? { ...m, ...p } : m));
    patch({ status: 'uploading', error: null });
    try {
      const path = await uploadMedia(file);
      const id = mediaUuid(path);
      if (!id) throw new Error('Сервер вернул неожиданный адрес файла.');
      patch({ status: 'done', mediaId: id });
    } catch (e) { patch({ status: 'error', error: meduhaErrorMessage(e) }); }
  };

  const pickVideo = async (file?: File) => {
    if (!file || !authenticated || submitting) return;
    const bad = validateFile(file, true); if (bad) { notify(bad); return; }
    if (video) drop(video.preview);
    const preview = track(file); const localId = nextId();
    setVideo({ localId, name: file.name, preview, file, status: 'uploading', mediaId: null, error: null, meta: null, metaError: null });
    let metaError: string | null = null; let meta: VideoMeta | null = null;
    try {
      meta = await readVideoMeta(preview);
      if (!Number.isFinite(meta.duration) || meta.duration < 4) metaError = 'Видео короче 4 секунд. Нужен ролик подлиннее.';
      else if (scenario === 'object-swap' && meta.width * meta.height < 409600) metaError = `Кадр ${meta.width}x${meta.height} слишком маленький: нужно минимум 409 600 пикселей (например, 640x640).`;
    } catch (e) { metaError = (e as Error).message; }
    setVideo(v => v && v.localId === localId ? { ...v, meta, metaError } : v);
    if (metaError) { setVideo(v => v && v.localId === localId ? { ...v, status: 'error', error: null } : v); return; }
    await runUpload(localId, file, true);
  };

  const pickPhotos = (files: FileList | null) => {
    if (!files || !authenticated || submitting) return;
    const room = maxPhotos - photos.length;
    const chosen = Array.from(files).slice(0, Math.max(0, room));
    if (files.length > room) notify(`Можно добавить не больше ${maxPhotos} фото`);
    const added: Media[] = [];
    for (const file of chosen) {
      const bad = validateFile(file, false); if (bad) { notify(`${file.name}: ${bad.replace('Обложка', 'Фото')}`); continue; }
      added.push({ localId: nextId(), name: file.name, preview: track(file), file, status: 'uploading', mediaId: null, error: null });
    }
    setPhotos(list => [...list, ...added]);
    added.forEach(m => void runUpload(m.localId, m.file, false));
  };

  const anyUploading = video?.status === 'uploading' || photos.some(p => p.status === 'uploading');
  const removePhoto = (m: Media) => { if (submitting || m.status === 'uploading') return; drop(m.preview); setPhotos(list => list.filter(x => x.localId !== m.localId)); };
  const removeVideo = () => { if (!video || submitting || video.status === 'uploading') return; drop(video.preview); setVideo(null); };

  const readyPhotos = photos.filter(p => p.status === 'done' && p.mediaId);
  const problems: string[] = [];
  if (!video) problems.push('Добавь видео');
  else if (video.metaError) problems.push('Видео не подходит');
  else if (video.status !== 'done') problems.push(video.status === 'error' ? 'Повтори загрузку видео' : 'Видео ещё загружается');
  if (photos.some(p => p.status !== 'done')) problems.push('Дождись загрузки всех фото или удали неудачные');
  if (readyPhotos.length < minPhotos) problems.push('Добавь хотя бы одно фото');
  if (scenario === 'restyle' && !styleLive) problems.push('Выбери стиль');
  if (!model) problems.push('Модель недоступна');
  if (model && !spendingEnabled) problems.push('Запуски временно выключены');

  const send = async (payload: GenjutsuInput) => {
    busy.current = true; setSubmitting(true); setSubmitError('');
    try {
      const res = await createGenjutsuGeneration(payload, { headers: { 'X-Meduha-Request': '1' }, credentials: 'same-origin' });
      setAmbiguous(false);
      if (terminal(res.job.status)) { clearIntent(accountId, scenario); setIntent(null); }
      notify(`Запрос принят · зарезервировано ${res.job.creditPrice} кредитов`);
      void jobsQuery.refetch();
      void refreshRef.current().catch(() => undefined);
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status && status < 500 && status !== 408 && status !== 429) {
        clearIntent(accountId, scenario); setIntent(null); setAmbiguous(false);
        setSubmitError(meduhaErrorMessage(e));
      } else {
        setAmbiguous(true);
        setSubmitError(status === 429 ? meduhaErrorMessage(e) : 'Ответ не дошёл. Запрос мог быть принят — проверь его, прежде чем повторять.');
      }
    } finally { busy.current = false; setSubmitting(false); }
  };

  const submit = async () => {
    if (busy.current || submitting || problems.length || !authenticated || !model || !video?.mediaId) return;
    if (!currentQuote) { notify('Сначала дождись точной цены для выбранного видео.'); return; }
    const base = { modelId: model.id, scenario, videoId: video.mediaId, imageIds: readyPhotos.map(p => p.mediaId!), prompt: prompt.trim(), resolution, ...(scenario === 'restyle' ? { presetId: styleId } : {}) };
    const signature = payloadSignature(base);
    const key = intent && intent.signature === signature ? intent.key : crypto.randomUUID();
    const payload: GenjutsuInput = { idempotencyKey: key, ...base, quoteToken: currentQuote.quoteToken };
    if (allJobs.some(j => j.idempotencyKey === key)) { notify('Этот запрос уже принят — смотри статус ниже'); return; }
    const stored: StoredIntent = { key, signature, payload, savedAt: Date.now() };
    writeIntent(accountId, scenario, stored); setIntent(stored);
    await send(payload);
  };

  const checkOrRetry = async () => {
    if (!intent || busy.current) return;
    busy.current = true; setSubmitting(true);
    const fresh = await jobsQuery.refetch().catch(() => null);
    busy.current = false; setSubmitting(false);
    if (!fresh?.data) { setSubmitError('Не удалось проверить историю. Проверь соединение и попробуй снова.'); return; }
    if (fresh.data.items.some(j => j.idempotencyKey === intent.key)) { setAmbiguous(false); setSubmitError(''); notify('Запрос найден, повторять не нужно'); return; }
    await send(intent.payload);
  };
  const forgetIntent = () => { clearIntent(accountId, scenario); setIntent(null); setAmbiguous(false); setSubmitError(''); };

  const back = () => navigate(`/create?type=video&ideas=1${backQ ? `&q=${encodeURIComponent(backQ)}` : ''}`);
  const balance = meduha.bootstrap?.account.credits ?? meduha.account?.credits;
  const lacking = currentQuote && balance !== undefined && balance < currentQuote.creditPrice;
  const pendingIntent = intent && !intentJob && ambiguous;
  const switchMode = (next: GenjutsuScenarioId) => {
    if (next === scenario || busy.current || submitting) return;
    const hasInputs = !!video || photos.length > 0 || anyUploading || prompt !== initialPrompt.slice(0, 10000) || resolution !== '720p' || !!styleId || !!modelChoice;
    if (hasInputs && !window.confirm('Сменить режим? Введённые настройки и загруженные файлы этого режима будут сброшены. Смена режима не запускает генерацию; уже отправленные задания не изменятся.')) return;
    navigate(`/create?type=video&scenario=${next}${backQ ? `&q=${encodeURIComponent(backQ)}` : ''}`);
  };

  return <Frame active="Create"><div className="gj-page" data-testid={`page-genjutsu-${scenario}`}>
    <button className="gj-back" data-testid="button-back-catalog" onClick={back}><ArrowLeft size={14}/>Все сценарии</button>
    <ExamplePreview scenario={scenario}/>
    <div className="gj-grid"><div className="gj-input">
    <div className="gj-top"><h1>Genjutsu</h1><ModeSelector value={scenario} disabled={submitting} onChange={switchMode}/></div>
    <p className="gj-lead">{text.lead}</p>

    {!authenticated && <div className="gj-guest" data-testid="status-guest"><Lock size={16}/><span><strong>Нужен вход через Telegram</strong>Посмотреть, как всё устроено, можно и так. Загрузка файлов и запуск доступны только в Mini App из Telegram.</span></div>}

    <section className="gj-block">
      <div className="gj-label"><span>1</span>{text.video}<small>MP4 или WebM, до 100 МБ, от 4 сек</small></div>
      <input ref={videoInput} type="file" accept="video/mp4,video/webm" hidden onChange={e => { void pickVideo(e.target.files?.[0]); e.target.value = ''; }}/>
      {video ? <div className={`gj-video ${video.status}`}>
        <video src={video.preview} controls playsInline preload="metadata" muted data-testid="video-source-preview"/>
        <div className="gj-video-info">
          <strong>{video.name}</strong>
          <small>{video.meta ? `${Math.round(video.meta.duration * 10) / 10} сек · ${video.meta.width}x${video.meta.height}` : 'Читаем параметры…'}</small>
          {video.meta && video.meta.duration > 30 && !video.metaError && <small className="gj-warn">Длиннее 30 сек: провайдер обрежет ролик сам.</small>}
          {video.metaError && <small className="gj-err" role="alert">{video.metaError}</small>}
          {video.status === 'uploading' && <small className="gj-up"><LoaderCircle className="gj-spin" size={12}/>Загружаем…</small>}
          {video.status === 'done' && <small className="gj-ok"><Check size={12}/>Загружено</small>}
          {video.status === 'error' && video.error && <small className="gj-err">{video.error}</small>}
          <div className="gj-row">
            {video.status === 'error' && !video.metaError && <button data-testid="button-retry-video" onClick={() => void runUpload(video.localId, video.file, true)}><RotateCw size={12}/>Повторить</button>}
            <button data-testid="button-replace-video" disabled={video.status === 'uploading' || submitting} onClick={() => videoInput.current?.click()}>Заменить</button>
            <button data-testid="button-remove-video" disabled={video.status === 'uploading' || submitting} onClick={removeVideo}><X size={12}/>Убрать</button>
          </div>
        </div>
      </div> : <button className="gj-drop" data-testid="button-add-video" disabled={!authenticated} onClick={() => videoInput.current?.click()}><Film size={22}/><span><strong>Выбрать видео</strong><small>{authenticated ? 'Длительность и размер кадра берём из самого файла' : 'Доступно после входа через Telegram'}</small></span></button>}
    </section>

    <section className="gj-block">
      <div className="gj-label"><span>2</span>{text.photos}<small>{minPhotos ? `1-${maxPhotos}` : `до ${maxPhotos}`} · JPEG, PNG, WebP до 10 МБ</small></div>
      <input ref={photoInput} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={e => { pickPhotos(e.target.files); e.target.value = ''; }}/>
      <div className="gj-photos">
        {photos.map((p, i) => <div key={p.localId} className={`gj-photo ${p.status}`} data-testid={`photo-${i}`}>
          <img src={p.preview} alt={`Фото ${i + 1}`}/>
          <b className="gj-order">{i + 1}</b>
          {p.status === 'uploading' && <span className="gj-photo-veil"><LoaderCircle className="gj-spin" size={16}/></span>}
          {p.status === 'error' && <button className="gj-photo-veil err" title={p.error ?? ''} data-testid={`button-retry-photo-${i}`} onClick={() => void runUpload(p.localId, p.file, false)}><RotateCw size={15}/><small>Повторить</small></button>}
          {p.status !== 'uploading' && !submitting && <button className="gj-photo-x" aria-label="Убрать фото" data-testid={`button-remove-photo-${i}`} onClick={() => removePhoto(p)}><X size={11}/></button>}
        </div>)}
        {photos.length < maxPhotos && <button className="gj-photo-add" data-testid="button-add-photos" disabled={!authenticated} onClick={() => photoInput.current?.click()}><ImagePlus size={19}/><small>Добавить</small></button>}
      </div>
      {photos.some(p => p.status === 'error') && <p className="gj-err">{photos.find(p => p.status === 'error')?.error} Нажми на фото, чтобы повторить, или убери его.</p>}
    </section>

    {scenario === 'restyle' && <section className="gj-block">
      <div className="gj-label"><span>3</span>Стиль<small>Ровно один</small></div>
      {!authenticated ? <p className="gj-muted">Список стилей появится после входа.</p>
        : !modelId ? <p className="gj-muted">Стили станут доступны, когда модель включена.</p>
        : stylesQuery.isLoading ? <div className="gj-styles">{[0, 1, 2, 3].map(i => <i key={i} className="gj-skel"/>)}</div>
        : stylesQuery.isError ? <div className="gj-state"><span>Не удалось загрузить стили. {meduhaErrorMessage(stylesQuery.error)}</span><button onClick={() => void stylesQuery.refetch()}><RefreshCw size={12}/>Повторить</button></div>
        : !styles.length ? <p className="gj-muted">Сейчас нет доступных стилей. Загляни позже.</p>
        : <div className="gj-styles" role="radiogroup">{styles.map(s => <button key={s.id} role="radio" aria-checked={styleId === s.id} data-testid={`button-style-${s.id}`} className={styleId === s.id ? 'on' : ''} onClick={() => setStyleId(s.id)}>
          <img src={s.previewUrl} alt="" loading="lazy"/><span>{s.name}</span>{styleId === s.id && <Check className="gj-tick" size={13}/>}
        </button>)}</div>}
    </section>}

    <section className="gj-block">
      <div className="gj-label"><span>{scenario === 'restyle' ? 4 : 3}</span>Подсказка<small>Необязательно</small></div>
      <div className="m-prompt"><textarea data-testid="input-genjutsu-prompt" value={prompt} onChange={e => setPrompt(e.target.value)} maxLength={10000} placeholder="Например: сохранить лицо, мягкий вечерний свет"/><div className="m-prompt-bottom"><span/><small className="m-muted">{prompt.length}/10000</small></div></div>
      <div className="gj-label sub">Качество<small>Длительность и формат берутся из видео</small></div>
      <div className="m-options">{resolutions.map(r => <button key={r} data-testid={`button-resolution-${r}`} className={`m-option ${resolution === r ? 'selected' : ''}`} onClick={() => setResolution(r)}>{r}</button>)}</div>
    </section>

    <section className="gj-launch" aria-live="polite">
      {!authenticated ? <p className="gj-muted">Цена и запуск показываются после входа через Telegram.</p>
        : modelsQuery.isLoading ? <div className="gj-skel wide"/>
        : modelsQuery.isError ? <div className="gj-state"><span>Не удалось проверить модель. {meduhaErrorMessage(modelsQuery.error)}</span><button data-testid="button-retry-models" onClick={() => void modelsQuery.refetch()}><RefreshCw size={12}/>Повторить</button></div>
        : !models.length ? <div className="gj-state"><span>Сценарий пока недоступен: модель не включена в студии. Мы ничего не спишем.</span><button data-testid="button-retry-models" onClick={() => void modelsQuery.refetch()}><RefreshCw size={12}/>Проверить снова</button></div>
        : <>
          {models.length > 1 && <div className="gj-models" role="radiogroup">{models.map(m => <button key={m.id} role="radio" aria-checked={model?.id === m.id} data-testid={`button-model-${m.id}`} className={model?.id === m.id ? 'on' : ''} onClick={() => setModelChoice(m.id)}><strong>{m.name}</strong><small>Цена по настроенному тарифу</small></button>)}</div>}
          {currentQuote
            ? <div className="gj-price"><span>{currentQuote.duration} сек · {resolution}</span><strong data-testid="text-genjutsu-price">{currentQuote.creditPrice} кредитов</strong></div>
            : quoteLoading ? <p className="gj-muted" role="status">Проверяем видео и рассчитываем точную цену…</p>
              : quoteError ? <div className="gj-state"><span>Не удалось проверить цену. {quoteError}</span><button onClick={() => setQuoteRefreshSeq(value => value + 1)}><RefreshCw size={12}/>Повторить</button></div>
                : <p className="gj-muted">Точная цена появится после загрузки видео.</p>}
          {balance !== undefined && <p className="gj-muted">Баланс: {balance} кредитов{lacking ? ' · не хватает для запуска' : ''}</p>}
          {!spendingEnabled && <p className="gj-warn">Новые запуски временно выключены в настройках студии.</p>}
        </>}

      {pendingIntent ? <div className="gj-ambig" role="alert">
        <AlertTriangle size={16}/><span><strong>Запрос мог уйти</strong>{submitError || 'Прошлая отправка не подтвердилась. Проверим по тому же ключу — повторной оплаты не будет.'}</span>
        <button className="m-generate" data-testid="button-check-retry" disabled={submitting} onClick={() => void checkOrRetry()}>{submitting ? <LoaderCircle className="gj-spin" size={15}/> : <RefreshCw size={15}/>}Проверить / повторить этот запрос</button>
        <button className="gj-link" disabled={submitting} onClick={forgetIntent}>Забыть и начать заново</button>
      </div> : <>
        {submitError && <p className="gj-err" role="alert">{submitError}</p>}
        <button className="m-generate gj-go" data-testid="button-genjutsu-submit" disabled={!authenticated || submitting || anyUploading || problems.length > 0 || !currentQuote || quoteLoading} onClick={() => void submit()}>
          {submitting ? <LoaderCircle className="gj-spin" size={16}/> : <Sparkles size={16}/>}{submitting ? 'Отправляем…' : currentQuote ? `Создать · ${currentQuote.creditPrice} кр.` : 'Создать видео'}
        </button>
        {authenticated && problems.length > 0 && <p className="gj-muted center">{problems[0]}</p>}
      </>}
    </section>

    </div><aside className="gj-output">
    <div className="gj-out-head">Результат{jobsQuery.isFetching && <LoaderCircle className="gj-spin" size={12}/>}</div>
    {!authenticated ? <div className="gj-void"><Film size={20}/><span>Результаты появятся здесь после входа.</span></div> : <section className="gj-block flat">
      <div className="gj-label">Запуски этого режима</div>
      {jobsQuery.isLoading ? <div className="gj-skel wide"/>
        : jobsQuery.isError && !jobsQuery.data ? <div className="gj-state"><span>Историю не загрузить. {meduhaErrorMessage(jobsQuery.error)}</span><button onClick={() => void jobsQuery.refetch()}><RefreshCw size={12}/>Повторить</button></div>
        : !jobs.length ? <div className="gj-void"><Film size={20}/><span>Пока нет запусков в этом режиме.</span></div>
        : <div className="gj-jobs">{jobs.map(j => <article key={j.id} className={`gj-job ${j.status}`} data-testid={`card-job-${j.id}`}>
          <div className="gj-job-line">{!terminal(j.status) && <LoaderCircle className="gj-spin" size={13}/>}<strong>{statusLabel[j.status] ?? j.status}</strong><small>{new Date(j.createdAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</small></div>
          <small className="gj-muted">{j.modelName} · {j.creditPrice} кредитов</small>
          {j.status === 'unknown' && <p className="gj-warn">Не удалось подтвердить отправку. Кредиты зарезервированы, повторной отправки не будет — статус проверяется.</p>}
          {j.status === 'failed' && <p className="gj-err">{j.error || 'Провайдер не завершил генерацию. Резерв снят.'}</p>}
          {j.status === 'completed' && j.resultUrl && <>
            <video className="gj-result" src={j.resultUrl} controls playsInline preload="metadata"/>
            <a className="gj-dl" href={j.resultUrl} download data-testid={`link-result-${j.id}`}>Скачать видео<Download size={12}/></a>
          </>}
        </article>)}</div>}
    </section>}
    </aside></div>
    {toast}
  </div></Frame>;
}
