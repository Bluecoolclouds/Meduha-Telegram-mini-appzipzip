import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, Pencil, Plus, RotateCw, Send, ShieldCheck, Undo2, Upload } from 'lucide-react';
import { Link, useLocation, useSearch } from 'wouter';
import type { ListTemplatesScope, StudioTemplate, TemplateInput } from '@workspace/api-client-react';
import { Frame } from '../../shared';
import { meduhaErrorMessage, useMeduhaSession } from '../../session';
import { uploadMedia, useAccess, useManagedTemplates, usePublication, useSaveTemplate, validateFile } from './api';
import { ManagerRecipe, useRecipeDraft } from '../recipe/ManagerRecipe';
import { isRecipe, type Recipe, type RecipeView } from '../recipe/model';
import './manager.css';

const STATUS = { draft: 'Черновик', pending: 'На проверке', published: 'Опубликован' } as const;
type Form = { title: string; description: string; kind: 'photo' | 'video' | 'audio'; poster: string; videoUrl: string; audioUrl: string; width: string; height: string; prompt: string; tags: string; model: string; style: string; ratio: string; duration: string };
const empty: Form = { title: '', description: '', kind: 'photo', poster: '', videoUrl: '', audioUrl: '', width: '1024', height: '1024', prompt: '', tags: '', model: '', style: '', ratio: '1:1', duration: '' };
const recipeOf = (t: StudioTemplate): Recipe | null => { const r = (t as { recipe?: unknown }).recipe; return isRecipe(r) ? r : null; };
const fromView = (v: RecipeView): Form => { const p = v.recipe.parameters; const str = (x: unknown) => x === undefined || x === null ? '' : String(x); return { ...empty, title: v.title.slice(0, 100), kind: v.recipe.kind, prompt: str(p.prompt ?? p.brief), model: v.recipe.catalogId.slice(0, 100), ratio: str(p.aspect_ratio ?? p.resolution ?? '1:1').slice(0, 30), duration: str(p.duration).slice(0, 30), style: '' }; };
const fromTemplate = (t: StudioTemplate): Form => ({ title: t.title, description: t.description, kind: t.kind, poster: t.poster, videoUrl: t.videoUrl ?? '', audioUrl: t.audioUrl ?? '', width: String(t.width), height: String(t.height), prompt: t.prompt, tags: t.tags.join(', '), ...t.parameters });

function Uploader({ label, video = false, audio = false, value, onChange }: { label: string; video?: boolean; audio?: boolean; value: string; onChange: (path: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const last = useRef<File | null>(null);
  const run = async (file: File) => {
    last.current = file; setError('');
    const bad = validateFile(file, audio ? 'audio' : video);
    if (bad) { setError(bad); return; }
    setBusy(true);
    try { onChange(await uploadMedia(file)); last.current = null; } catch (e) { setError(meduhaErrorMessage(e)); } finally { setBusy(false); }
  };
  return <div className="tm-field"><span>{label}</span><div className="tm-up">
    {value && (audio ? <audio src={value} controls preload="metadata" style={{ width: '100%' }}/> : video ? <video src={value} muted preload="metadata"/> : <img src={value} alt=""/>)}
    <label className="tm-btn" style={{ cursor: 'pointer' }}><Upload size={13}/>{busy ? 'Загружаем…' : value ? 'Заменить' : 'Выбрать файл'}
      <input type="file" hidden disabled={busy} accept={audio ? 'audio/mpeg,audio/wav,audio/x-wav,.mp3,.wav' : video ? 'video/mp4,video/webm' : 'image/jpeg,image/png,image/webp'} data-testid={`input-upload-${audio ? 'audio' : video ? 'video' : 'cover'}`} onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void run(f); }}/></label>
    {value && (video || audio) && <button type="button" className="tm-btn" onClick={() => onChange('')}>Убрать</button>}
  </div>
  {error && <div className="tm-err" role="alert">{error} {last.current && <button type="button" className="tm-btn" onClick={() => last.current && void run(last.current)} data-testid="button-upload-retry"><RotateCw size={12}/> Повторить</button>}</div>}
  <small style={{ color: 'var(--muted)', fontWeight: 400 }}>{audio ? 'MP3 или WAV, до 100 МБ' : video ? 'MP4 или WebM, до 100 МБ' : 'JPEG, PNG или WebP, до 10 МБ'}</small></div>;
}

function Editor({ item, draft, onClose, onDone }: { item: StudioTemplate | null; draft?: RecipeView | null; onClose: () => void; onDone: (m: string) => void }) {
  const [f, setF] = useState<Form>(item ? fromTemplate(item) : draft ? fromView(draft) : empty);
  const [recipe, setRecipe] = useState<Recipe | null>(item ? recipeOf(item) : draft?.recipe ?? null);
  const hadRecipe = item ? !!recipeOf(item) : false;
  const [consent, setConsent] = useState(false);
  const [err, setErr] = useState('');
  const save = useSaveTemplate();
  const pub = usePublication();
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF(p => ({ ...p, [k]: v }));
  const build = (): TemplateInput | string => {
    const w = Number(f.width), h = Number(f.height);
    if (!f.title.trim()) return 'Укажи название.';
    if (recipe && f.kind !== recipe.kind) return `Рецепт создан для типа «${recipe.kind === 'video' ? 'Видео' : 'Фото'}». Выбери этот тип или убери рецепт.`;
    if (!f.prompt.trim()) return 'Добавь промпт.';
    if (!f.poster) return 'Загрузи обложку.';
    if (f.kind === 'video' && !f.videoUrl) return 'Для видеоработы загрузи видео.';
    if (f.kind === 'audio' && !f.audioUrl) return 'Для аудиоработы загрузи MP3 или WAV.';
    if (!(w >= 1 && w <= 8192 && h >= 1 && h <= 8192)) return 'Ширина и высота — от 1 до 8192.';
    const tags = f.tags.split(',').map(t => t.trim()).filter(Boolean);
    if (tags.length > 12 || tags.some(t => t.length > 50)) return 'Не больше 12 тегов, каждый до 50 символов.';
    return { title: f.title.trim(), description: f.description, kind: f.kind, poster: f.poster, videoUrl: f.kind === 'video' ? f.videoUrl : null, audioUrl: f.kind === 'audio' ? f.audioUrl : null, width: Math.round(w), height: Math.round(h), prompt: f.prompt, tags, parameters: { model: f.model, style: f.style, ratio: f.ratio, duration: f.duration }, ...(recipe ? { recipe } : hadRecipe ? { recipe: null } : {}) } as TemplateInput;
  };
  const go = async (submit: boolean) => {
    const data = build();
    if (typeof data === 'string') { setErr(data); return; }
    if (submit && recipe && !consent) { setErr('Подтверди, что исходные файлы рецепта станут доступны другим.'); return; }
    setErr('');
    try {
      const saved = await save.mutateAsync({ id: item?.id, data });
      if (submit) await pub.mutateAsync({ id: saved.id, action: 'submit' });
      onDone(submit ? 'Отправлено на проверку' : 'Черновик сохранён');
    } catch (e) { setErr(meduhaErrorMessage(e)); }
  };
  const busy = save.isPending || pub.isPending;
  return <form className="tm-form" onSubmit={e => { e.preventDefault(); void go(false); }} data-testid="form-template">
    <button type="button" className="tm-back mt-back" onClick={onClose} style={{ background: 'none', border: 0, padding: 0 }}><ArrowLeft size={15}/>К списку</button>
    <h2 style={{ font: '800 22px Manrope,sans-serif', margin: 0 }}>{item ? 'Редактировать работу' : 'Новая работа'}</h2>
    {item && item.status !== 'draft' && <div className="tm-warn" data-testid="text-edit-warning">Эта работа {item.status === 'published' ? 'опубликована' : 'на проверке'}. После сохранения она вернётся в черновики и пропадёт из комьюнити, пока её снова не отправят и не одобрят.</div>}
    <label>Название<input value={f.title} maxLength={100} onChange={e => set('title', e.target.value)} data-testid="input-title"/></label>
    <label>Описание<textarea value={f.description} maxLength={2000} onChange={e => set('description', e.target.value)} data-testid="input-description"/></label>
    <label>Тип<select value={f.kind} onChange={e => set('kind', e.target.value as Form['kind'])} data-testid="select-kind"><option value="photo">Фото</option><option value="video">Видео</option><option value="audio">Аудио</option></select></label>
    <div className="tm-guide" data-testid="text-result-files">Результат — то, что увидят в ленте: обложка{f.kind === 'video' ? ' и готовое видео' : f.kind === 'audio' ? ' и аудио' : ''}.</div>
    <Uploader label="Обложка" video={false} value={f.poster} onChange={v => set('poster', v)}/>
    {f.kind === 'video' && <Uploader label="Видео" video value={f.videoUrl} onChange={v => set('videoUrl', v)}/>}
    {f.kind === 'audio' && <Uploader label="Аудиофайл" audio value={f.audioUrl} onChange={v => set('audioUrl', v)}/>}
    <div className="tm-grid"><label>Ширина<input type="number" min={1} max={8192} value={f.width} onChange={e => set('width', e.target.value)} data-testid="input-width"/></label><label>Высота<input type="number" min={1} max={8192} value={f.height} onChange={e => set('height', e.target.value)} data-testid="input-height"/></label></div>
    <label>Промпт<textarea value={f.prompt} maxLength={10000} onChange={e => set('prompt', e.target.value)} data-testid="input-prompt"/></label>
    <label>Теги (через запятую)<input value={f.tags} onChange={e => set('tags', e.target.value)} data-testid="input-tags"/></label>
    <div className="tm-grid"><label>Модель<input value={f.model} maxLength={100} onChange={e => set('model', e.target.value)}/></label><label>Стиль<input value={f.style} maxLength={100} onChange={e => set('style', e.target.value)}/></label><label>Пропорции<input value={f.ratio} maxLength={30} onChange={e => set('ratio', e.target.value)}/></label><label>Длительность<input value={f.duration} maxLength={30} onChange={e => set('duration', e.target.value)}/></label></div>
    {recipe ? <ManagerRecipe recipe={recipe} viewId={draft && !item ? draft.id : null} templateId={item && hadRecipe ? item.id : null} consent={consent} onConsent={setConsent} onClear={() => { setRecipe(null); setConsent(false); }}/>
      : <div className="tm-guide" data-testid="text-prompt-only">{hadRecipe ? 'Рецепт будет удалён при сохранении — работа станет только с промптом.' : 'Без рецепта: другие смогут взять только промпт. Рецепт сохраняется из редактора модели кнопкой «Сохранить как шаблон».'}{hadRecipe && item && <> <button type="button" className="tm-btn" onClick={() => setRecipe(recipeOf(item))} data-testid="button-restore-recipe">Вернуть рецепт</button></>}</div>}
    {err && <div className="tm-err" role="alert" data-testid="text-form-error">{err}</div>}
    <div className="tm-acts"><button type="submit" className="tm-btn" disabled={busy} data-testid="button-save-draft"><Check size={13}/>{save.isPending ? 'Сохраняем…' : 'Сохранить черновик'}</button>
      <button type="button" className="tm-btn primary" disabled={busy} onClick={() => void go(true)} data-testid="button-save-submit"><Send size={13}/>Сохранить и отправить</button></div>
  </form>;
}

export default function TemplateManager() {
  const session = useMeduhaSession();
  const accountId = session.phase === 'authenticated' ? session.account?.id : undefined;
  const access = useAccess(accountId);
  const isAdmin = access.data?.isAdmin === true;
  const [scope, setScope] = useState<ListTemplatesScope>('mine');
  const effective: ListTemplatesScope = scope === 'moderation' && isAdmin ? 'moderation' : 'mine';
  const list = useManagedTemplates(accountId, effective, '');
  const pub = usePublication();
  const [editing, setEditing] = useState<StudioTemplate | 'new' | null>(null);
  const [location, navigate] = useLocation();
  const draftId = new URLSearchParams(useSearch()).get('recipeDraft');
  const draft = useRecipeDraft(draftId, accountId);
  useEffect(() => { if (draft.data) setEditing('new'); }, [draft.data]);
  const closeEditor = () => { setEditing(null); if (draftId) navigate(location, { replace: true }); };
  const [note, setNote] = useState('');
  const [actionErr, setActionErr] = useState('');
  const items = list.data?.pages.flatMap(p => p.items) ?? [];
  const total = list.data?.pages[0]?.total ?? 0;
  const act = async (id: string, action: 'submit' | 'publish' | 'withdraw') => {
    setActionErr('');
    try { await pub.mutateAsync({ id, action }); setNote(action === 'submit' ? 'Отправлено на проверку' : action === 'publish' ? 'Опубликовано' : 'Снято с публикации'); } catch (e) { setActionErr(meduhaErrorMessage(e)); }
  };
  const head = <div className="mt-community-heading"><Link className="mt-back" href="/community" data-testid="link-manage-back"><ArrowLeft size={15}/><span>Комьюнити</span></Link><span className="mt-community-kicker">Твои публикации</span><h1>Мои работы<span>.</span></h1><p>Загрузи фото или видео, добавь промпт и отправь на проверку — после одобрения работа появится в комьюнити.</p></div>;
  if (!accountId) return <Frame active="Community">{head}<div className="tm-guide" data-testid="text-manage-guest">Чтобы делиться работами, нужен вход через Telegram. Открой meduha как Mini App из Telegram — аккаунт подтвердится автоматически.{session.telegramBotUrl && <> <a href={session.telegramBotUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--orange-ink)', fontWeight: 700 }}>Открыть бота</a></>}</div></Frame>;
  if (draftId && (draft.isLoading || draft.isError)) return <Frame active="Community">{head}{draft.isLoading ? <div className="tm-skel" data-testid="status-recipe-draft-loading"/> : <div className="tm-err" role="alert">Рецепт не загрузился: {meduhaErrorMessage(draft.error)} <button className="tm-btn" onClick={() => void draft.refetch()}><RotateCw size={12}/>Повторить</button> <button className="tm-btn" onClick={closeEditor}>К списку</button></div>}</Frame>;
  if (editing) return <Frame active="Community"><Editor key={editing === 'new' ? `new-${draft.data?.id ?? ''}` : editing.id} item={editing === 'new' ? null : editing} draft={editing === 'new' ? draft.data : null} onClose={closeEditor} onDone={m => { closeEditor(); setNote(m); }}/></Frame>;
  return <Frame active="Community">{head}
    <div className="tm-tabs"><button className={effective === 'mine' ? 'on' : ''} onClick={() => setScope('mine')} data-testid="tab-mine">Мои</button>
      {isAdmin && <button className={effective === 'moderation' ? 'on' : ''} onClick={() => setScope('moderation')} data-testid="tab-moderation"><ShieldCheck size={13}/>Модерация</button>}
      <button className="tm-btn primary tm-manage-link" onClick={() => setEditing('new')} data-testid="button-new-template"><Plus size={13}/>Поделиться</button></div>
    {note && <div className="tm-guide" role="status" data-testid="text-manage-note">{note}</div>}
    {actionErr && <div className="tm-err" role="alert">{actionErr}</div>}
    {list.isLoading && <><div className="tm-skel"/><div className="tm-skel"/><div className="tm-skel"/></>}
    {list.isError && <div className="tm-err" role="alert">{meduhaErrorMessage(list.error)} <button className="tm-btn" onClick={() => void list.refetch()} data-testid="button-retry-list"><RotateCw size={12}/>Повторить</button></div>}
    {!list.isLoading && !list.isError && items.length === 0 && <div className="tm-empty" data-testid="text-manage-empty">{effective === 'mine' ? 'Работ пока нет. Поделись первой.' : 'Нет работ для модерации.'}</div>}
    {items.map(t => { const own = t.ownerId === accountId; return <div className="tm-row" key={t.id} data-testid={`row-template-${t.id}`}>
      <img className="tm-thumb" src={t.poster} alt="" loading="lazy"/>
      <div className="tm-body"><h3>{t.title}</h3><small><span className={`tm-st ${t.status}`}>{STATUS[t.status]}</span>{t.kind === 'audio' ? 'Аудио' : t.kind === 'video' ? 'Видео' : 'Фото'}{recipeOf(t) ? ' · с рецептом' : ' · только промпт'}{!own && ' · чужой'}</small>
        <div className="tm-acts">
          {(own || isAdmin) && <button className="tm-btn" onClick={() => setEditing(t)} data-testid={`button-edit-${t.id}`}><Pencil size={11}/>Править</button>}
          {own && t.status === 'draft' && <button className="tm-btn" disabled={pub.isPending} onClick={() => void act(t.id, 'submit')} data-testid={`button-submit-${t.id}`}><Send size={11}/>Отправить</button>}
          {isAdmin && t.status !== 'published' && <button className="tm-btn primary" disabled={pub.isPending} onClick={() => void act(t.id, 'publish')} data-testid={`button-publish-${t.id}`}><Check size={11}/>Опубликовать</button>}
          {(own || isAdmin) && t.status !== 'draft' && <button className="tm-btn danger" disabled={pub.isPending} onClick={() => void act(t.id, 'withdraw')} data-testid={`button-withdraw-${t.id}`}><Undo2 size={11}/>Снять</button>}
        </div></div></div>; })}
    {list.hasNextPage && <button className="tm-btn" disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()} data-testid="button-load-more">{list.isFetchingNextPage ? 'Загружаем…' : `Показать ещё (${items.length} из ${total})`}</button>}
  </Frame>;
}
