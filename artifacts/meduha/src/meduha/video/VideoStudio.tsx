import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Download, FileText, Lock, Minus, Plus, RefreshCw, Search, SlidersHorizontal, Sparkles, Trash2, Upload, X, Zap } from 'lucide-react';
import { Link, useLocation, useSearch } from 'wouter';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getGetMeduhaBootstrapQueryKey, getGetMeduhaWalletQueryKey, getListMeduhaGenerationsQueryKey, useListMeduhaGenerations } from '@workspace/api-client-react';
import type { GenerationJob } from '@workspace/api-client-react';
import { Frame, Sheet, asset, mood, useToast } from '../shared';
import { meduhaErrorMessage, useMeduhaSession } from '../session';
import { uploadMedia } from '../templates/manage/api';
import { ScenarioCarousel, PromoBanner } from './ScenarioHero';
import { VIDEO_CATALOG_KEY, VideoApiError, createVideoGeneration, familyArt, quoteHref, providerLabel, providerOf, useVideoCatalog, userSafeModelText, videoErrorText, videoModelHref, type VideoCatalog, type VideoFamily, type VideoGenerationInput, type VideoModel } from './videoApi';
import { KIND_RULES, buildPayload, checkFile, defaults, describeConditions, dropGroupItem, effective, fieldKind, itemKey, mediaUuid, modeKind, modeLabel, normalizeFileFields, referencePromptExpansion, splitPath, unwrap, validate, type FileField, type FileKind, type Ref, type Schema } from './videoSchema';
import { useRecipeSource, type RecipeSource } from '../templates/recipe/useRecipeSource';
import RecipeBanner from '../templates/recipe/RecipeBanner';
import SaveAsTemplate from '../templates/recipe/SaveAsTemplate';
import { hydrateVideo } from './recipeHydrate';
import { videoScenarios } from './scenarios';
import { genjutsuPreviewScenario, videoScenarioGenerationHref, videoScenarioModel, videoScenarioNotice, videoScenarioParameters, type VideoScenarioContext } from './scenarioGeneration';
import ExamplePreview from './genjutsu/ExamplePreview';
import './genjutsu/genjutsu.css';
import './video.css';
import './catalogue.css';
import '../photo/photo-studio.css';
import './video-studio.css';

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
const read = { credentials: 'same-origin' as const };

type Ready = { ok: boolean; reason: string };
export function videoReadiness(c: VideoCatalog | undefined, m: VideoModel): Ready {
  if (!c) return { ok: false, reason: 'Каталог загружается' };
  if (!c.providerConfigured) return { ok: false, reason: 'Провайдер не настроен' };
  if (!c.storageConfigured) return { ok: false, reason: 'Хранилище не настроено' };
  if (!c.spendingEnabled) return { ok: false, reason: 'Списания выключены' };
  if (m.quoteScenario) return { ok: false, reason: 'Цена считается после проверки длительности видео — запуск через редактор с расчётом' };
  if (!m.available || !m.modelId) return { ok: false, reason: 'Модель пока не включена администратором' };
  if (m.creditPrice == null) return { ok: false, reason: 'Цена модели ещё не назначена' };
  return { ok: true, reason: '' };
}
const blurb = (f: VideoFamily, ms: VideoModel[]) => {
  const modes = ms.map(m => modeLabel(m.mode)).filter((x, i, a) => a.indexOf(x) === i).join(', ');
  return f.description ? `${userSafeModelText(f.description.trim())} Режимы: ${modes}.` : `${modes}.`;
};
type Group = { family: VideoFamily; members: VideoModel[] };
function groups(c: VideoCatalog | undefined): Group[] {
  if (!c) return [];
  const byId = new Map(c.models.map(m => [m.id, m]));
  return c.families.map(f => ({ family: f, members: f.modes.map(id => byId.get(id)).filter((m): m is VideoModel => !!m) })).filter(g => g.members.length);
}

export function VideoCatalogue() {
  const [, navigate] = useLocation();
  const search = useSearch();
  const catalog = useVideoCatalog();
  const [q, setQ] = useState(() => new URLSearchParams(search).get('q') || '');
  const [mode, setMode] = useState<'all' | 'text' | 'image' | 'video'>('all');
  const [provider, setProvider] = useState('all');
  const [filterOpen, setFilterOpen] = useState(false);
  const all = useMemo(() => groups(catalog.data), [catalog.data]);
  const providers = useMemo(() => Array.from(new Set(all.map(g => providerOf(g.members[0])))), [all]);
  const t = q.trim().toLowerCase();
  const shown = all.filter(g => (provider === 'all' || providerOf(g.members[0]) === provider) && (mode === 'all' || g.members.some(m => modeKind(m.mode) === mode))
    && (!t || t.split(/\s+/).every(w => `${g.family.name} ${g.family.description} ${g.family.id} ${g.members.map(m => `${m.mode} ${modeLabel(m.mode)} ${m.id}`).join(' ')} ${providerLabel(providerOf(g.members[0]))}`.toLowerCase().includes(w))));
  const searching = t.length > 0;
  const activeFilters = (mode !== 'all' ? 1 : 0) + (provider !== 'all' ? 1 : 0);
  const update = (v: string) => { setQ(v); const p = new URLSearchParams({ type: 'video' }); if (v.trim()) p.set('q', v.trim()); window.history.replaceState(window.history.state, '', `${BASE}/create?${p}`); };
  const priceLabel = (list: VideoModel[]) => { const ok = list.filter(m => videoReadiness(catalog.data, m).ok); if (!ok.length) { if (list.some(m => m.quoteScenario)) return 'Цена после проверки видео'; } if (!ok.length) return list.some(m => m.creditPrice != null && m.available) ? videoReadiness(catalog.data, list[0]).reason : 'Скоро'; const ps = ok.map(m => m.creditPrice!); const min = Math.min(...ps); return `${ps.some(p => p !== min) ? 'от ' : ''}${min} кр.`; };
  const open = (id: string) => navigate(videoModelHref(id));
  const hero = all.slice(0, 5).map(g => ({ id: g.family.id, title: userSafeModelText(g.family.name), subtitle: blurb(g.family, g.members), image: familyArt(g.family.id), providerLabel: providerLabel(providerOf(g.members[0])), g }));
  const modes = [['all', 'Все'], ['text', 'Из текста'], ['image', 'Из фото'], ['video', 'Из видео']] as const;
  return <Frame active="Create"><div className="vs-page" data-testid="catalogue-video-models">
    {catalog.isLoading ? <div className="vs-hero vst-skel" style={{ height: 268 }}/> : hero.length > 0 && <ScenarioCarousel items={hero} image={asset} label={h => priceLabel(h.g.members)} eyebrow={h => `${h.g.members.length > 1 ? `${h.g.members.length} режимов` : modeLabel(h.g.members[0].mode)} · ${h.providerLabel}`} onOpen={h => open(h.g.family.modes[0])}/>}
    <PromoBanner/>
    <div className="vs-toolbar">
      <div className="vs-toolrow">
        <form className="vs-search" role="search" onSubmit={e => { e.preventDefault(); if (shown[0]) open(shown[0].family.modes[0]); }}>
          <Search size={14} aria-hidden/>
          <input data-testid="input-video-model-search" aria-label="Поиск видеомодели" value={q} onChange={e => update(e.target.value)} maxLength={300} placeholder="Seedance, Kling, продление" enterKeyHint="search"/>
          {searching && <button type="button" className="vs-clear" aria-label="Очистить поиск" data-testid="button-video-search-clear" onClick={() => update('')}><X size={13}/></button>}
        </form>
        <button type="button" data-testid="button-video-filter" className={`vs-filter${activeFilters ? ' on' : ''}`} aria-expanded={filterOpen} aria-controls="vst-filter-panel" onClick={() => setFilterOpen(v => !v)}><SlidersHorizontal size={13}/>Фильтр{activeFilters > 0 && <b>{activeFilters}</b>}</button>
      </div>
      {filterOpen && <div id="vst-filter-panel" className="vs-panel">
        <span className="vs-panel-label">Режим</span>
        <div className="vs-chips" role="group" aria-label="Режим">{modes.map(([id, l]) => <button key={id} data-testid={`button-video-kind-${id}`} className={mode === id ? 'on' : ''} aria-pressed={mode === id} onClick={() => setMode(id)}>{l}</button>)}</div>
        <span className="vs-panel-label">Поставщик модели</span>
        <div className="vs-chips" role="group" aria-label="Поставщик модели">
          <button data-testid="button-video-provider-all" className={provider === 'all' ? 'on' : ''} aria-pressed={provider === 'all'} onClick={() => setProvider('all')}>Все поставщики</button>
          {providers.map(p => <button key={p} data-testid={`button-video-provider-${p}`} className={provider === p ? 'on' : ''} aria-pressed={provider === p} onClick={() => setProvider(p)}>{providerLabel(p)}</button>)}
        </div>
        {activeFilters > 0 && <button type="button" className="vs-panel-reset" data-testid="button-video-filter-reset" onClick={() => { setMode('all'); setProvider('all'); }}>Сбросить фильтры</button>}
      </div>}
    </div>
    <h2 className="vs-section">{searching ? 'Подходящие модели' : 'Все видеомодели'}{catalog.data && <small className="vst-count" data-testid="text-video-family-count"> {shown.length}</small>}</h2>
    <span className="vs-sr" aria-live="polite">{searching ? (shown.length ? `Найдено: ${shown.length}` : 'Ничего не нашлось') : ''}</span>
    {catalog.isLoading ? <div className="vs-grid">{[0, 1, 2, 3].map(i => <div key={i} className="vs-card vst-skel" style={{ height: 250 }}/>)}</div>
      : catalog.isError ? <div className="vs-empty"><img src={mood('curious')} alt=""/><strong>Каталог не загрузился</strong><p>{videoErrorText(catalog.error)}</p><div className="vs-empty-actions"><button data-testid="button-video-catalog-retry" onClick={() => catalog.refetch()}><RefreshCw size={12}/> Повторить</button><Link href="/create?type=video&ideas=1">Видеоидеи</Link></div></div>
      : shown.length ? <div className="vs-grid">{shown.map((g, i) => <article key={g.family.id} data-testid={`card-video-family-${g.family.id}`} className={`vs-card vst-card${searching && i === 0 ? ' best' : ''}`} style={{ animationDelay: `${Math.min(i, 8) * 35}ms` }}>
        <button type="button" className="vst-open" data-testid={`button-open-video-family-${g.family.id}`} onClick={() => open(g.family.modes[0])}>
          <span className="vs-card-img"><img src={asset(familyArt(g.family.id))} alt="" loading="lazy"/>{searching && i === 0 && <span className="vs-best">Ближе всего</span>}</span>
          <span className="vs-card-body"><strong>{userSafeModelText(g.family.name)}<em> · {g.members.length > 1 ? `${g.members.length} режимов` : modeLabel(g.members[0].mode)}</em></strong><small>{blurb(g.family, g.members)}</small></span>
        </button>
        <span className="vs-card-foot vst-foot"><span className="vs-prov">{providerLabel(providerOf(g.members[0]))}</span><span className="vs-price" data-testid={`text-video-price-${g.family.id}`}>{priceLabel(g.members)}</span></span>
      </article>)}</div>
      : <div className="vs-empty"><img src={mood('curious')} alt=""/><strong>Такой модели пока нет</strong><p>Попробуй проще: «Seedance», «Kling», «продление». Или сбрось фильтры.</p>
        <div className="vs-empty-actions"><button data-testid="button-video-empty-reset" onClick={() => { update(''); setMode('all'); setProvider('all'); }}>Сбросить поиск</button><Link href="/create?type=video&ideas=1">Видеоидеи</Link></div></div>}
    <Link className="vs-free" href="/create?type=video&ideas=1" data-testid="link-video-ideas"><span><strong>Видеоидеи и Genjutsu</strong><small>Готовые сценарии, Genjutsu и авторские редакторы</small></span><ArrowRight size={15}/></Link>
    <Link className="vs-free" href="/create?type=video&editor=1" data-testid="link-video-editor"><span><strong>Без модели</strong><small>Записать идею как черновик</small></span><ArrowRight size={15}/></Link>
  </div></Frame>;
}

export function VideoModelPage({ catalogId, scenarioId }: { catalogId: string; scenarioId?: string }) {
  const session = useMeduhaSession();
  const catalog = useVideoCatalog();
  const source = useRecipeSource();
  const query = new URLSearchParams(useSearch());
  const ideaId = query.get('videoIdea') ?? scenarioId;
  const scenario = source.active ? undefined : videoScenarios.find(item => item.id === ideaId && videoScenarioModel(item.id));
  const context: VideoScenarioContext | undefined = scenario ? {
    scenario, prompt: query.get('ideaPrompt') ?? query.get('prompt') ?? scenario.prompt,
    ratio: query.get('ideaRatio') ?? undefined, duration: query.get('ideaDuration') ?? undefined,
    draftId: query.get('videoDraft')?.slice(0, 128) ?? undefined,
  } : undefined;
  const model = catalog.data?.models.find(m => m.id === catalogId);
  if (catalog.isLoading) return <Frame active="Create"><div className="ps-page"><div className="ps-card vst-skel" style={{ height: 120 }}/><div className="ps-card vst-skel" style={{ height: 300, marginTop: 12 }}/></div></Frame>;
  if (ideaId && !scenario && !source.active) return <Frame active="Create"><div className="ps-page"><div className="ps-empty"><strong>Видео-сценарий не найден</strong><Link className="ps-btn" href="/create?type=video&ideas=1">К видеосценариям</Link></div></div></Frame>;
  if (catalog.isError || !model) return <Frame active="Create"><div className="ps-page"><div className="ps-empty"><img src={mood('curious')} alt=""/><strong>{catalog.isError ? 'Каталог не загрузился' : 'Модель не найдена'}</strong><p>{catalog.isError ? videoErrorText(catalog.error) : 'Возможно, она убрана из каталога.'}</p>{catalog.isError && <button className="ps-btn" data-testid="button-video-model-retry" onClick={() => catalog.refetch()}><RefreshCw size={14}/>Повторить</button>}<Link className="ps-btn" href="/create?type=video" data-testid="link-video-catalogue-missing">К каталогу</Link></div></div></Frame>;
  const family = catalog.data!.families.find(f => f.id === model.familyId) ?? catalog.data!.families.find(f => f.modes.includes(model.id)) ?? { id: model.id, name: userSafeModelText(model.name), description: '', source: model.source, modes: [model.id] };
  const siblings = family.modes.map(id => catalog.data!.models.find(m => m.id === id)).filter((m): m is VideoModel => !!m);
  const scope = session.phase === 'authenticated' && session.account?.id ? `acct-${session.account.id}` : session.phase === 'authenticated' ? null : 'guest';
  if (!scope || (source.active && source.phase === 'loading')) return <Frame active="Create"><div className="ps-page"><RecipeBanner source={source}/><div className="ps-card vst-skel" style={{ height: 300 }}/></div></Frame>;
  const recipeView = source.view && source.view.recipe.kind === 'video' && source.view.recipe.catalogId === model.id ? source.view : null;
  // Recipe edits are scoped to account + repeat id; guest previews of a public source are never persisted under the account scope.
  const formScope = source.storeSuffix ? `${scope}.${source.storeSuffix}` : recipeView ? `preview.${source.templateId ?? 'x'}` : context ? `${scope}.scenario.${context.scenario.id}.${context.draftId ?? 'new'}` : scope;
  return <ModelForm key={`${formScope}:${model.id}:${recipeView?.id ?? ''}`} context={context} scope={formScope} source={source} recipeView={recipeView} model={model} family={family} siblings={siblings} catalog={catalog.data!} authed={session.phase === 'authenticated'}/>;
}

type Stored = { params: Record<string, unknown>; json: Record<string, string>; refs: Record<string, Ref[]>; items: Record<string, string[]>; pending?: { fp: string; key: string } };
const storeKey = (scope: string, id: string) => `meduha.video.v2.${scope}.${id}`;
const loadStored = (scope: string, id: string): Stored | null => { try { const raw = localStorage.getItem(storeKey(scope, id)); return raw ? JSON.parse(raw) : null; } catch { return null; } };

const labels: Record<string, string> = { prompt: 'Описание', negative_prompt: 'Чего избегать', duration: 'Длительность, сек', resolution: 'Разрешение', aspect_ratio: 'Формат кадра', bitrate_mode: 'Битрейт', output_format: 'Формат файла', generate_audio: 'Генерировать звук', image_url: 'Фото-референс', end_image_url: 'Последний кадр', last_image_url: 'Последний кадр', first_frame_url: 'Первый кадр', last_frame_url: 'Последний кадр', image_urls: 'Фото-референсы', video_url: 'Исходное видео', video_urls: 'Видео-референсы', audio_url: 'Аудио', audio_urls: 'Аудио-референсы', file_url: 'Документ', link_url: 'Ссылка на страницу', seed: 'Seed', elements: 'Элементы (ID)', multi_prompt: 'Мульти-промпт', multi_shots: 'Несколько планов', camera_movement: 'Движение камеры', camera_lens: 'Объектив', camera_model: 'Камера', camera_aperture: 'Диафрагма', color_palette: 'Палитра', light: 'Свет', pacing: 'Темп', genre: 'Жанр', era: 'Эпоха', sound: 'Звук', cfg_scale: 'CFG', fps: 'Кадров в секунду', keep_original_sound: 'Сохранить исходный звук', character_orientation: 'Ориентация персонажа', mode: 'Режим', shot_type: 'Тип плана', prompt_optimizer: 'Оптимизация описания', prompt_extend: 'Расширить описание', enable_thinking: 'Режим размышления', aigc_watermark: 'Водяной знак AIGC', preset_id: 'Пресет' };
const label = (k: string, s?: Schema) => labels[k] || s?.title || k;
const fieldOrder = (k: string) => k === 'prompt' ? 0 : /url/.test(k) ? 1 : k === 'negative_prompt' ? 2 : 3;

function ModelForm({ context, scope, source, recipeView, model, family, siblings, catalog, authed }: { context?: VideoScenarioContext; scope: string; source: RecipeSource; recipeView: import('../templates/recipe/model').RecipeView | null; model: VideoModel; family: VideoFamily; siblings: VideoModel[]; catalog: VideoCatalog; authed: boolean }) {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { toast, notify } = useToast();
  const schema = model.schema as Schema;
  const fileFields = useMemo(() => normalizeFileFields(model.fileFields, schema), [model.fileFields, schema]);
  const topFiles = fileFields.filter(f => !splitPath(f.path).parent);
  const nested = fileFields.filter(f => splitPath(f.path).parent);
  const parents = Array.from(new Set(nested.map(f => splitPath(f.path).root)));
  const roots = useMemo(() => new Set(fileFields.map(f => splitPath(f.path).root)), [fileFields]);
  const init = useMemo(() => defaults(schema, roots), [schema, roots]);
  // Saved local edits win over the recipe so a refresh never overwrites them.
  const stored = useMemo(() => loadStored(scope, model.id) ?? (recipeView ? hydrateVideo(recipeView, fileFields, new Set(Object.keys(init.json)), Array.from(new Set(fileFields.map(f => splitPath(f.path).parent).filter((x): x is string => !!x)))) : null), [scope, model.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const seed = context ? videoScenarioParameters(context, schema) : { parameters: {}, ignored: [] };
  const [params, setParams] = useState<Record<string, unknown>>(() => ({ ...init.params, ...seed.parameters, ...(stored?.params || {}) }));
  const [json, setJson] = useState<Record<string, string>>(() => ({ ...init.json, ...(stored?.json || {}) }));
  const [refs, setRefs] = useState<Record<string, Ref[]>>(() => stored?.refs || {});
  const [items, setItems] = useState<Record<string, string[]>>(() => stored?.items || {});
  const [uploading, setUploading] = useState<Record<string, number>>({});
  const [touched, setTouched] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [uncertain, setUncertain] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const idem = useRef<{ fp: string; key: string } | null>(stored?.pending ?? null);
  const pending = useRef<{ fp: string; key: string } | null>(stored?.pending ?? null);
  const create = useMutation({ mutationFn: createVideoGeneration });

  // Parse JSON editors
  const parsed: Record<string, unknown> = {}; const errors: Record<string, string> = {};
  for (const [k, txt] of Object.entries(json)) { if (roots.has(k) || !schema.properties?.[k] || !txt.trim()) continue; try { parsed[k] = JSON.parse(txt); } catch { errors[k] = 'Некорректный JSON'; } }
  const groupValues: Record<string, Record<string, unknown>[]> = {};
  for (const p of parents) groupValues[p] = (items[p] || []).map((txt, i) => { if (!txt.trim()) return {}; try { const v = JSON.parse(txt); if (v && typeof v === 'object' && !Array.isArray(v)) return v; errors[`${p}#${i}`] = 'Нужен объект JSON'; } catch { errors[`${p}#${i}`] = 'Некорректный JSON'; } return {}; });
  const values: Record<string, unknown> = { ...params, ...parsed };
  for (const f of topFiles) { const k = splitPath(f.path).root; const list = refs[f.path] || []; if (list.length) values[k] = f.array ? list.map(r => r.id) : list[0].id; }
  for (const p of parents) if (groupValues[p].length) values[p] = groupValues[p];
  const forcePromptExpansion = referencePromptExpansion(model.id, values);
  if (forcePromptExpansion) values.prompt_extend = true;
  const eff = effective(schema, values);
  if (forcePromptExpansion) eff.forced.prompt_extend = true;
  const conditions = useMemo(() => describeConditions(schema), [schema]);
  const fields = Object.keys(eff.props).sort((a, b) => fieldOrder(a) - fieldOrder(b));
  if (Array.isArray(values.elements) && values.elements.length) {
    errors.elements = 'Элементы этого сценария пока не привязаны к вашему аккаунту Meduha. Используй свои загруженные референсы.';
  }

  for (const k of fields) {
    if (errors[k]) continue;
    const { s, nullable } = unwrap(eff.props[k], schema);
    const v = values[k];
    const tf = topFiles.find(f => splitPath(f.path).root === k);
    if (tf) {
      const n = refs[tf.path]?.length || 0; const max = tf.array ? s.maxItems ?? 10 : 1; const min = tf.array ? s.minItems ?? 0 : 0;
      if (eff.required.has(k) && n === 0) errors[k] = eff.alternatives[k]?.length ? `Добавь файл или заполни одно из: ${eff.alternatives[k].map(x => label(x)).join(', ')}` : 'Добавь файл';
      else if (n && n < min) errors[k] = `Минимум ${min}`;
      else if (n > max) errors[k] = `Максимум ${max}`;
      else if (eff.mustBeNull.has(k) && n) errors[k] = 'При текущих настройках это поле должно быть пустым';
      continue;
    }
    if (parents.includes(k)) { if (eff.required.has(k) && !(items[k]?.length)) errors[k] = 'Добавь хотя бы один элемент'; continue; }
    if (v === undefined || v === '') { if (eff.required.has(k)) errors[k] = eff.alternatives[k]?.length ? `Заполни это поле или одно из: ${eff.alternatives[k].map(x => label(x)).join(', ')}` : 'Обязательное поле'; continue; }
    if (k in eff.forced && v !== eff.forced[k]) { errors[k] = `При текущих настройках нужно значение ${JSON.stringify(eff.forced[k])}`; continue; }
    if (eff.mustBeNull.has(k) && v !== null) { errors[k] = 'При текущих настройках это поле должно быть пустым'; continue; }
    if (v === null && nullable) continue;
    const e = validate(s, v, schema, label(k, s)); if (e) errors[k] = e;
  }
  for (const g of eff.conflicts) errors[`conflict:${g.join(',')}`] = `Нельзя сочетать: ${g.map(x => label(x)).join(', ')}`;
  for (const f of nested) { const { root, sub } = splitPath(f.path); if (!sub) continue; (items[root] || []).forEach((_, i) => { const n = refs[itemKey(root, i, sub)]?.length || 0; if (!f.array && n > 1) errors[`${root}#${i}`] = 'Только один файл'; }); }

  const busyUpload = Object.values(uploading).some(n => n > 0);
  const ready = videoReadiness(catalog, model);
  const price = model.creditPrice;
  const flatValues: Record<string, unknown> = {};
  for (const k of fields) if (!roots.has(k) && values[k] !== undefined) flatValues[k] = values[k];
  const liveRefs: Record<string, Ref[]> = {};
  const validPaths = new Set<string>();
  for (const f of topFiles) validPaths.add(f.path);
  for (const f of nested) { const { root, sub } = splitPath(f.path); if (sub) (items[root] || []).forEach((_, i) => validPaths.add(itemKey(root, i, sub))); }
  for (const [k, list] of Object.entries(refs)) if (validPaths.has(k) && list.length) liveRefs[k] = list;
  const { parameters, references } = buildPayload({ fileFields, values: flatValues, refs: liveRefs, groups: groupValues });
  const fp = JSON.stringify([model.id, model.modelId, price, parameters, references]);
  if (!idem.current || idem.current.fp !== fp) idem.current = { fp, key: crypto.randomUUID() };
  const keepKey = pending.current?.fp === fp;

  const persistState = () => { if (scope.startsWith('preview.')) return; try { localStorage.setItem(storeKey(scope, model.id), JSON.stringify({ params, json, refs, items, pending: pending.current ?? undefined })); } catch { /* storage full */ } };
  useEffect(persistState, [params, json, refs, items, scope, model.id, uncertain]);

  const invalid = Object.keys(errors).length > 0;
  const canSubmit = authed && ready.ok && !invalid && !busyUpload && !create.isPending;

  const setP = (k: string, v: unknown) => setParams(p => { const n = { ...p }; if (v === undefined) delete n[k]; else n[k] = v; return n; });
  const addFiles = async (key: string, kind: FileKind, files: FileList | null, max: number, replaceIndex?: number) => {
    if (!files?.length) return;
    if (!authed) { notify('Загрузка файлов доступна после входа через Telegram'); return; }
    const list = Array.from(files).slice(0, replaceIndex !== undefined ? 1 : Math.max(0, max - (refs[key]?.length || 0)));
    if (!list.length) { notify(`Можно не больше ${max}`); return; }
    for (const f0 of list) {
      const bad = checkFile(f0, kind); if (bad) { notify(bad); continue; }
      const f = kind === 'document' && !f0.type ? new File([f0], f0.name, { type: 'text/markdown' }) : f0;
      setUploading(u => ({ ...u, [key]: (u[key] || 0) + 1 }));
      try {
        const id = mediaUuid(await uploadMedia(f));
        if (!id) throw new Error('Сервер вернул неожиданный путь файла');
        setRefs(r => { const cur = [...(r[key] || [])]; const ref = { id, name: f.name, kind }; if (replaceIndex !== undefined) cur[replaceIndex] = ref; else cur.push(ref); return { ...r, [key]: cur.slice(0, max) }; });
      } catch (e) { notify(`Не удалось загрузить ${f.name}: ${meduhaErrorMessage(e)}`); }
      finally { setUploading(u => ({ ...u, [key]: (u[key] || 1) - 1 })); }
    }
  };

  const ask = () => { setTouched(true); if (canSubmit) setConfirm(true); };
  const submit = () => {
    setConfirm(false);
    if (!canSubmit || !model.modelId || price == null || !idem.current) return;
    const key = idem.current.key;
    pending.current = { fp, key }; setLastError(null);
    // Persist before the network call: reload/close during submission must reuse
    // this key, even before React has had a chance to run an effect.
    persistState();
    const data: VideoGenerationInput = { catalogId: model.id, modelId: model.modelId, expectedCreditPrice: price, idempotencyKey: key, parameters, references };
    create.mutate(data, {
      onSuccess: () => {
        notify('Генерация запущена. Результат появится ниже'); pending.current = null; setUncertain(null);
        persistState();
        idem.current = { fp, key: crypto.randomUUID() };
        for (const k of [getListMeduhaGenerationsQueryKey(), VIDEO_CATALOG_KEY, getGetMeduhaBootstrapQueryKey(), getGetMeduhaWalletQueryKey()]) void qc.invalidateQueries({ queryKey: k });
      },
      onError: e => {
        const text = videoErrorText(e);
        if (e instanceof VideoApiError && e.uncertain) { persistState(); setUncertain(text); void qc.invalidateQueries({ queryKey: getListMeduhaGenerationsQueryKey() }); return; }
        pending.current = null; setUncertain(null); setLastError(text);
        persistState();
        if (e instanceof VideoApiError && e.status === 409) void qc.invalidateQueries({ queryKey: VIDEO_CATALOG_KEY });
      },
    });
  };
  const fileOf = (k: string) => topFiles.find(f => splitPath(f.path).root === k);
  const previewScenario = genjutsuPreviewScenario(model.id);
  const pickModel = (id: string) => navigate(context
    ? videoScenarioGenerationHref(context.scenario, context, id)
    : `${videoModelHref(id)}${source.carry}`, { replace: true });

  return <Frame active="Create"><div className="ps-page vs-page ps-model" data-testid={`page-video-model-${model.id}`}>
    <Link className="ps-back" href="/create?type=video" data-testid="link-video-catalogue"><ArrowLeft size={13}/>Все видеомодели</Link>
    {previewScenario ? <ExamplePreview scenario={previewScenario} heading={userSafeModelText(family.name)}/> : <div className="ps-model-head"><span className="ps-art" aria-hidden="true"><img src={asset(familyArt(family.id))} alt=""/></span><div><span className="ps-mode">{modeLabel(model.mode)}{model.workflow ? ' · сценарий' : ''}</span><h1>{userSafeModelText(family.name)}<span>.</span></h1><p>{userSafeModelText(family.description || model.name)}</p></div></div>}
    {context && <>
      <div className="ps-note" data-testid="status-video-idea"><strong>{context.scenario.title}</strong><p>{videoScenarioNotice(context.scenario.id)}</p><p>У каждого режима — свой черновик: при возвращении восстановятся его текст, настройки и загруженные исходники.</p><Link href="/create?type=video&ideas=1">Выбрать другой сценарий</Link></div>
      <label className="ps-field"><span>Модель и режим для этого сценария</span><select data-testid="select-video-idea-model" value={model.id} onChange={event => pickModel(event.target.value)}>{catalog.families.map(group => <optgroup key={group.id} label={userSafeModelText(group.name)}>{group.modes.map(id => catalog.models.find(item => item.id === id)).filter((item): item is VideoModel => !!item).map(option => <option key={option.id} value={option.id}>{userSafeModelText(option.name)} · {modeLabel(option.mode)}{option.quoteScenario ? ' · отдельный расчёт' : ''}</option>)}</optgroup>)}</select></label>
      {!stored && seed.ignored.length > 0 && <div className="ps-note" data-testid="status-video-seed-settings">{seed.ignored.join(', ')} из брифа не поддерживаются этим режимом. Проверь показанные настройки модели — исходные значения не подменяются ближайшими.</div>}
    </>}
    {siblings.length > 1 && <div className="ps-modes" role="group" aria-label="Режим модели" data-testid="group-video-modes">{siblings.map(m => { const on = m.id === model.id; return <button key={m.id} type="button" aria-pressed={on} className={on ? 'on' : ''} data-testid={`button-video-mode-${m.id}`} onClick={() => { if (!on) pickModel(m.id); }}>{modeLabel(m.mode)}</button>; })}</div>}
    {!authed && <div className="ps-alert" data-testid="status-video-login-required"><Lock size={15}/><span><strong>Нужен вход через Telegram</strong>Открой студию из Telegram, чтобы загружать файлы и запускать генерацию. Настройки можно смотреть и менять уже сейчас.</span></div>}
    <RecipeBanner source={source} mismatch={!!source.view && !recipeView}/>
    {model.quoteScenario && <Link className="vs-free" href={`${quoteHref(model.quoteScenario)}${source.carry}${context ? `&q=${encodeURIComponent(String(values.prompt ?? context.prompt))}` : ''}`} data-testid="link-video-quote-editor"><span><strong>Открыть редактор с расчётом цены</strong><small>Цена рассчитывается после проверки длительности загруженного видео. Обычный запуск здесь отключён. Исходники нужно добавить в отдельном редакторе; настройки этого режима сохранятся здесь.</small></span><ArrowRight size={15}/></Link>}
    {!ready.ok && !model.quoteScenario && <div className="ps-alert muted" data-testid="status-video-model-unavailable"><Lock size={15}/><span><strong>Запуск недоступен</strong>{ready.reason}. Настройки этого режима сохраняются на устройстве.</span></div>}
    {conditions.length > 0 && <div className="ps-note" data-testid="text-video-conditions"><strong>Правила модели</strong>{conditions.map(c => <span key={c}>{c}</span>)}</div>}
    <div className="ps-form">{fields.map(k => {
      const s = eff.props[k]; const err = touched || values[k] !== undefined ? errors[k] : undefined;
      const tf = fileOf(k);
      if (tf) { const { s: us } = unwrap(s, schema); const max = tf.array ? us.maxItems ?? 10 : 1;
        return <FilesField key={k} name={k} title={label(k, us)} hint={userSafeModelText(us.description || '')} kind={tf.kind} required={eff.required.has(k)} refs={refs[tf.path] || []} max={max} uploading={uploading[tf.path] || 0} authed={authed} error={err}
          onFiles={(f, idx) => void addFiles(tf.path, tf.kind, f, max, idx)} onRemove={i => setRefs(r => ({ ...r, [tf.path]: (r[tf.path] || []).filter((_, j) => j !== i) }))}/>; }
      if (parents.includes(k)) {
        const subs = nested.filter(f => splitPath(f.path).root === k);
        const list = items[k] || []; const { s: us } = unwrap(s, schema); const maxItems = us.maxItems ?? 10;
        return <div key={k} className={`ps-field vst-group${err ? ' bad' : ''}`} data-testid={`group-${k}`}><div className="ps-label"><span>{label(k, us)}{eff.required.has(k) && <b> *</b>}</span>{us.description && <small>{userSafeModelText(us.description)}</small>}</div>
          {list.map((txt, i) => <div key={i} className="vst-item" data-testid={`item-${k}-${i}`}><div className="vst-item-head"><strong>Элемент {i + 1}</strong><button type="button" aria-label="Удалить элемент" data-testid={`button-remove-item-${k}-${i}`} onClick={() => { setItems(it => ({ ...it, [k]: (it[k] || []).filter((_, j) => j !== i) })); setRefs(r => dropGroupItem(r, k, i)); }}><Minus size={12}/></button></div>
            {subs.map(f => { const { sub } = splitPath(f.path); if (!sub) return null; const key = itemKey(k, i, sub); const max = f.array ? 10 : 1;
              return <FilesField key={key} name={`${k}-${i}-${sub.slice(1)}`} title={label(sub.slice(1).split('/').pop()!)} kind={f.kind} required={false} refs={refs[key] || []} max={max} uploading={uploading[key] || 0} authed={authed}
                onFiles={(fl, idx) => void addFiles(key, f.kind, fl, max, idx)} onRemove={j => setRefs(r => ({ ...r, [key]: (r[key] || []).filter((_, x) => x !== j) }))}/>; })}
            <textarea className="ps-json" rows={2} spellCheck={false} value={txt} placeholder='{"name": "..."}' data-testid={`json-item-${k}-${i}`} onChange={e => setItems(it => ({ ...it, [k]: (it[k] || []).map((x, j) => j === i ? e.target.value : x) }))}/>
            <small className="ps-hint">Остальные поля элемента в JSON, без ссылок на файлы.</small>{errors[`${k}#${i}`] && <small className="ps-err">{errors[`${k}#${i}`]}</small>}
          </div>)}
          {list.length < maxItems && <button type="button" className="ps-btn" data-testid={`button-add-item-${k}`} onClick={() => setItems(it => ({ ...it, [k]: [...(it[k] || []), ''] }))}><Plus size={13}/>Добавить элемент</button>}
          {err && <small className="ps-err" role="alert">{err}</small>}</div>;
      }
      return <Field key={k} name={k} s={s} schema={schema} required={eff.required.has(k)} locked={forcePromptExpansion && k === 'prompt_extend'} value={values[k]} jsonText={json[k] ?? ''} error={err} onChange={v => setP(k, v)} onJson={t => setJson(j => ({ ...j, [k]: t }))}/>;
    })}</div>
    <div className="ps-submit">
      <div className="ps-cost" data-testid="text-video-cost">{model.quoteScenario ? <small>Цена после проверки длительности видео</small> : price != null ? <><Zap size={13} fill="currentColor"/><strong>{price}</strong> кредитов<small>фиксированная цена за одну генерацию</small></> : <small>Цена не назначена — запуск недоступен</small>}</div>
      {uncertain && <div className="ps-alert" data-testid="status-video-uncertain"><RefreshCw size={15}/><span><strong>Неизвестно, принят ли запрос</strong>{uncertain}. Проверь историю ниже. Повтор отправит тот же ключ запроса — кредиты не спишутся дважды. Не меняй настройки, если хочешь повторить именно этот запуск.</span></div>}
      {lastError && <p className="ps-err" data-testid="text-video-error" role="alert">Не запустилось: {lastError}</p>}
      <button className="m-generate" data-testid="button-video-generate" disabled={!canSubmit} onClick={ask}><Sparkles size={16}/>{create.isPending ? 'Отправляем…' : busyUpload ? 'Ждём загрузку…' : uncertain && keepKey ? 'Повторить с тем же ключом' : 'Создать видео'}</button>
      {!authed ? <p className="m-cost-note">Запуск после входа через Telegram</p> : !ready.ok && <p className="m-cost-note">{ready.reason}</p>}
      {touched && invalid && <p className="ps-err" data-testid="text-video-invalid">Проверь поля: {Object.keys(errors).map(k => k.startsWith('conflict:') ? errors[k] : label(k.split('#')[0])).join(', ')}</p>}
    </div>
    <SaveAsTemplate recipe={{ version: 1, kind: 'video', catalogId: model.id, parameters, references }} title={typeof values.prompt === 'string' ? values.prompt.split(/[.!?\n]/)[0] : family.name}
      disabledReason={!authed ? 'Сохранить шаблон можно после входа через Telegram.' : busyUpload ? 'Дождись загрузки файлов.' : invalid ? 'Сначала исправь отмеченные поля.' : null}/>
    {authed && <VideoJobs catalogId={model.id}/>}
    {confirm && <Sheet title="Подтверди запуск" onClose={() => setConfirm(false)}><div className="vst-confirm" data-testid="dialog-video-confirm"><p><strong>{family.name}</strong> · {modeLabel(model.mode)}</p><p>Будет списано <strong data-testid="text-confirm-price">{price}</strong> кредитов. Если цена на сервере изменилась, запуск отклонится без списания.</p>
      <button className="m-generate" data-testid="button-video-confirm" onClick={submit}><Sparkles size={15}/>Списать {price} кр. и создать</button><button className="ps-btn" data-testid="button-video-cancel" onClick={() => setConfirm(false)}>Отмена</button></div></Sheet>}
    {toast}
  </div></Frame>;
}

function mediaSrc(id: string) { return `${BASE}/api/meduha/media/${id}`; }
function FilesField({ name, title, hint, kind, required, refs, max, uploading, authed, error, onFiles, onRemove }: { name: string; title: string; hint?: string; kind: FileKind; required: boolean; refs: Ref[]; max: number; uploading: number; authed: boolean; error?: string; onFiles: (f: FileList | null, idx?: number) => void; onRemove: (i: number) => void }) {
  const input = useRef<HTMLInputElement>(null); const replaceAt = useRef<number | undefined>(undefined);
  const rule = KIND_RULES[kind];
  const accept = kind === 'document' ? `${rule.types.join(',')},.md,.markdown` : rule.types.join(',');
  return <div className={`ps-field${error ? ' bad' : ''}`}><div className="ps-label"><span>{title}{required && <b> *</b>}</span>{hint && <small>{hint}</small>}</div>
    <input ref={input} type="file" hidden accept={accept} multiple={max > 1} data-testid={`input-file-${name}`} onChange={e => { onFiles(e.target.files, replaceAt.current); replaceAt.current = undefined; e.target.value = ''; }}/>
    <div className="ps-files">{refs.map((r, i) => <div key={r.id + i} className="ps-file vst-file">
      {r.kind === 'image' ? <img src={mediaSrc(r.id)} alt={r.name}/> : r.kind === 'video' ? <video src={mediaSrc(r.id)} muted playsInline preload="metadata"/> : r.kind === 'audio' ? <audio src={mediaSrc(r.id)} controls preload="none"/> : <span className="vst-doc"><FileText size={18}/></span>}
      <span>{r.name}</span><div><button type="button" aria-label="Заменить" data-testid={`button-replace-${name}-${i}`} onClick={() => { replaceAt.current = i; input.current?.click(); }}><RefreshCw size={12}/></button><button type="button" aria-label="Удалить" data-testid={`button-remove-${name}-${i}`} onClick={() => onRemove(i)}><Trash2 size={12}/></button></div></div>)}
      {Array.from({ length: uploading }).map((_, i) => <div key={`u${i}`} className="ps-file loading"><i/><span>Загружаем…</span></div>)}
      {refs.length + uploading < max && <button type="button" className="ps-add" disabled={!authed} data-testid={`button-upload-${name}`} onClick={() => { replaceAt.current = undefined; input.current?.click(); }}><Upload size={15}/><span>{authed ? `Добавить ${rule.noun}` : 'Нужен вход'}</span><small>{refs.length}/{max} · {rule.label}</small></button>}</div>
    <small className="ps-hint">Файл загружается приватно в Медуху. Внешние ссылки на медиа не принимаются.</small>
    {error && <small className="ps-err" role="alert">{error}</small>}</div>;
}

function Field({ name, s: s0, schema, required, locked = false, value, jsonText, error, onChange, onJson }: { name: string; s: Schema; schema: Schema; required: boolean; locked?: boolean; value: unknown; jsonText: string; error?: string; onChange: (v: unknown) => void; onJson: (t: string) => void }) {
  const { s, nullable } = unwrap(s0, schema);
  const kind = fieldKind(name, s);
  const title = label(name, s); const id = `vst-${name}`;
  const head = <div className="ps-label"><label htmlFor={id}>{title}{required && <b> *</b>}</label>{s.description && <small>{userSafeModelText(s.description)}</small>}</div>;
  const none = !required && (nullable || s.default === undefined);
  let body: React.ReactNode;
  if (kind === 'enum') {
    const opts: unknown[] = s.enum.filter((o: unknown) => o !== null);
    body = opts.length > 6 ? <select id={id} data-testid={`select-${name}`} value={value === undefined || value === null ? '' : String(value)} onChange={e => onChange(e.target.value === '' ? undefined : opts.find(o => String(o) === e.target.value))}>{(none || value === undefined) && <option value="">{nullable ? 'Не задано' : 'По умолчанию'}</option>}{opts.map(o => <option key={String(o)} value={String(o)}>{String(o)}</option>)}</select>
      : <div className="ps-seg">{none && <button type="button" data-testid={`button-${name}-default`} className={value === undefined ? 'on' : ''} aria-pressed={value === undefined} onClick={() => onChange(undefined)}>Авто</button>}{opts.map(o => <button type="button" key={String(o)} data-testid={`button-${name}-${String(o)}`} className={value === o ? 'on' : ''} aria-pressed={value === o} onClick={() => onChange(o)}>{String(o)}</button>)}</div>;
  } else if (kind === 'boolean') {
    body = <button type="button" role="switch" id={id} disabled={locked} aria-checked={value === true} data-testid={`switch-${name}`} className={`ps-switch${value === true ? ' on' : ''}`} onClick={() => onChange(!(value === true))}><i/>{value === true ? 'Включено' : value === undefined ? 'По умолчанию: выкл.' : 'Выключено'}</button>;
  } else if (kind === 'number' || kind === 'integer') {
    const slider = s.minimum !== undefined && s.maximum !== undefined && (kind === 'number' || s.maximum - s.minimum <= 60);
    const step = kind === 'integer' ? 1 : s.multipleOf ?? 0.01;
    body = <div className="ps-num">{slider && <input type="range" min={s.minimum} max={s.maximum} step={step} value={typeof value === 'number' ? value : s.minimum} onChange={e => onChange(Number(e.target.value))} data-testid={`range-${name}`} aria-label={title}/>}
      <input id={id} type="number" inputMode={kind === 'integer' ? 'numeric' : 'decimal'} min={s.minimum} max={s.maximum} step={step} placeholder={s.minimum !== undefined ? `${s.minimum}–${s.maximum ?? '∞'}` : ''} value={typeof value === 'number' ? value : ''} data-testid={`input-${name}`} onChange={e => onChange(e.target.value === '' ? undefined : Number(e.target.value))}/>
      {value !== undefined && !required && <button type="button" className="ps-clear" aria-label="Сбросить" data-testid={`button-clear-${name}`} onClick={() => onChange(undefined)}><X size={12}/></button>}</div>;
  } else if (kind === 'longtext') {
    const str = typeof value === 'string' ? value : '';
    body = <><textarea id={id} rows={name === 'prompt' ? 5 : 3} maxLength={s.maxLength} value={str} placeholder={name === 'negative_prompt' ? 'Дрожание, размытие, лишние объекты' : 'Опиши сцену: кто, где, движение камеры, свет'} data-testid={`textarea-${name}`} onChange={e => onChange(e.target.value === '' ? undefined : e.target.value)}/><small className="ps-count">{str.length}{s.maxLength ? `/${s.maxLength}` : ''}</small></>;
  } else if (kind === 'url') {
    const str = typeof value === 'string' ? value : '';
    body = <><input id={id} type="url" inputMode="url" value={str} placeholder="https://example.com/page" data-testid={`input-${name}`} onChange={e => onChange(e.target.value.trim() === '' ? undefined : e.target.value.trim())}/><small className="ps-hint">Публичная веб-страница https://, не медиафайл.</small></>;
  } else if (kind === 'json') {
    const ex = s.default !== undefined ? JSON.stringify(s.default) : typesOf(s).includes('array') ? '[]' : '{}';
    body = <><textarea id={id} className="ps-json" rows={4} spellCheck={false} value={jsonText} placeholder={ex} data-testid={`json-${name}`} onChange={e => onJson(e.target.value)}/><small className="ps-hint">JSON по официальной схеме{!required && ' · оставь пустым, чтобы не передавать'}</small></>;
  } else {
    const str = typeof value === 'string' ? value : '';
    body = <input id={id} value={str} maxLength={s.maxLength} data-testid={`input-${name}`} onChange={e => onChange(e.target.value === '' ? undefined : e.target.value)}/>;
  }
  return <div className={`ps-field${error ? ' bad' : ''}`}>{head}{body}{error && <small className="ps-err" role="alert">{error}</small>}</div>;
}
const typesOf = (s: Schema): string[] => Array.isArray(s?.type) ? s.type : s?.type ? [s.type] : [];

const running = new Set(['awaiting_reservation', 'queued', 'submitting', 'in_progress', 'finalizing']);
const statusRu: Record<string, string> = { awaiting_reservation: 'Резервируем кредиты', queued: 'В очереди', submitting: 'Отправляем', unknown: 'Статус неизвестен', in_progress: 'Создаётся', finalizing: 'Сохраняем', completed: 'Готово', failed: 'Ошибка' };
const jobUrls = (j: GenerationJob) => j.resultUrls?.length ? j.resultUrls : j.resultUrl ? [j.resultUrl] : [];

export function VideoJobs({ catalogId }: { catalogId: string }) {
  const qc = useQueryClient();
  const list = useListMeduhaGenerations({ request: read, query: { queryKey: getListMeduhaGenerationsQueryKey(), refetchOnMount: 'always', refetchInterval: q => { const it = q.state.data?.items || []; return it.some(j => running.has(j.status)) ? 5000 : it.some(j => j.status === 'unknown') ? 15000 : false; } } });
  const jobs = (list.data?.items || []).filter(j => j.scenario === catalogId && j.mediaKind === 'video');
  const fingerprint = jobs.map(j => `${j.id}:${j.status}`).join(',');
  useEffect(() => { if (!fingerprint) return; void qc.invalidateQueries({ queryKey: getGetMeduhaBootstrapQueryKey() }); void qc.invalidateQueries({ queryKey: getGetMeduhaWalletQueryKey() }); }, [qc, fingerprint]);
  return <section className="ps-jobs" data-testid="section-video-jobs"><div className="m-section-title"><h2>Мои видео в этом режиме</h2><span data-testid="text-video-job-count">{list.data ? jobs.length : '—'}</span></div>
    {list.isLoading ? <div className="m-server-loading"><i/><i/></div>
      : list.isError ? <div className="ps-alert muted"><span>{meduhaErrorMessage(list.error)}</span><button className="ps-btn" data-testid="button-video-jobs-retry" onClick={() => list.refetch()}><RefreshCw size={13}/>Повторить</button></div>
      : jobs.length === 0 ? <p className="m-info-note">Пока нет видео. Настрой режим и нажми «Создать видео».</p>
      : <div className="ps-job-list">{jobs.map(j => { const urls = jobUrls(j); return <article key={j.id} className={`ps-job ${j.status}`} data-testid={`card-video-job-${j.id}`}>
        <div className="ps-job-top"><strong>{j.modelName}</strong><span className={`ps-pill ${j.status}`} data-testid={`status-video-job-${j.id}`}>{statusRu[j.status] || j.status}</span></div>
        {j.prompt && <p>{j.prompt}</p>}
        {j.status === 'completed' && urls.map((u, i) => <div key={u} className="vst-result"><video src={u} controls playsInline preload="metadata" data-testid={`video-result-${j.id}-${i}`}>Браузер не может воспроизвести этот формат. Скачай файл.</video>{/\.mov(\?|$)/i.test(u) && <small className="ps-hint">MOV может не играть в браузере — скачай файл.</small>}<a className="ps-btn" href={`${u}${u.includes('?') ? '&' : '?'}download=1`} download data-testid={`link-video-download-${j.id}-${i}`}><Download size={12}/>Скачать</a></div>)}
        {running.has(j.status) && <div className="ps-progress"><i/></div>}
        {j.status === 'unknown' && <small className="ps-err">Статус запроса неизвестен. Повторно автоматически не отправляем, чтобы не списать дважды.{j.requestId ? ` Номер запроса: ${j.requestId}.` : ''}</small>}
        {j.error && (j.status === 'failed' || j.status === 'unknown' || j.status === 'finalizing') && <small className="ps-err">{j.error}</small>}
        <small className="ps-meta">{new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(j.createdAt))} · {j.creditPrice} кр.</small>
      </article>; })}</div>}
  </section>;
}
