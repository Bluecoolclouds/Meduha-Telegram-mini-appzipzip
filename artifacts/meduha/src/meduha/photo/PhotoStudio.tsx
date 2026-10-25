import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Download, Lock, RefreshCw, Search, SlidersHorizontal, Sparkles, Trash2, Upload, X, Zap } from 'lucide-react';
import { Link, useLocation, useSearch } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { getGetPhotoCatalogQueryKey, getGetMeduhaBootstrapQueryKey, getGetMeduhaWalletQueryKey, getListMeduhaGenerationsQueryKey, useCreatePhotoGeneration, useQuotePhotoGeneration, useGetPhotoCatalog, useListMeduhaGenerations } from '@workspace/api-client-react';
import type { GenerationJob, PhotoCatalog, PhotoCatalogModel, PhotoGenerationInput, PhotoQuote } from '@workspace/api-client-react';
import { Frame, asset, mood, useToast } from '../shared';
import { hideProviderBrand } from '../publicText';
import { ScenarioCarousel, PromoBanner } from '../video/ScenarioHero';
import { photoModelArt, photoProvider, photoProviderLabel } from './modelArt';
import { photoModelPreview } from './modelPreviews';
import ExamplePreview from '../video/genjutsu/ExamplePreview';
import '../video/video.css';
import '../video/catalogue.css';
import { meduhaErrorMessage, useMeduhaSession } from '../session';
import { uploadMedia, validateFile } from '../templates/manage/api';
import { defaults, effective, fieldKind, isFileArray, isNullable, jsonExample, mediaUuid, validate, type Schema } from './schema';
import './photo-studio.css';
import { useRecipeSource, type RecipeSource } from '../templates/recipe/useRecipeSource';
import RecipeBanner from '../templates/recipe/RecipeBanner';
import SaveAsTemplate from '../templates/recipe/SaveAsTemplate';
import { fieldOfPointer, pointerOf, type RecipeView } from '../templates/recipe/model';
import { familyOf, filterFamilies, groupFamilies, modeKind, modeLabelIn, photoModelHref, type Group } from './families';
import { photoIdeas, photoIdeaHref, photoIdeaParameters, type PhotoIdea } from './ideas';

const read = { credentials: 'same-origin' as const };
const mutateReq = { credentials: 'same-origin' as const, headers: { 'X-Meduha-Request': '1' } };
const LOCKED_WORKFLOW = ['preset_id', 'enhance_prompt', 'quality'];

export const modeLabel = (m: PhotoCatalogModel) => ({ workflow: 'Сценарий', image: 'Фото → фото', text: 'Текст → фото' })[modeKind(m)];
const suffixes: [RegExp, string][] = [[/utility\/pro/, 'Utility Pro'], [/\/pro\//, 'Pro'], [/utility/, 'Utility'], [/\/flare$/, 'Flare'], [/\/sunburst$/, 'Sunburst'], [/^marketing-studio\/image$/, 'Alpha'], [/image-to-image/, 'фото → фото'], [/soul\/v2\/standard/, 'текст → фото'], [/\/edit$/, 'правки'], [/qwen-image-3\/text-to-image/, 'текст → фото']];
const userSafeName = (name: string) => hideProviderBrand(name) || 'Модель Meduha';
export const displayName = (m: PhotoCatalogModel) => { const hit = suffixes.find(([r]) => r.test(m.endpoint)); const name = userSafeName(m.name); return hit && !name.toLowerCase().includes(hit[1].toLowerCase()) ? `${name} · ${hit[1]}` : name; };
const blurbs: Record<string, string> = {
  'higgsfield-ai/soul/standard': 'Фирменная эстетика Soul: живая кожа, мода, свет как в журнале.',
  'higgsfield-ai/soul/v2/standard': 'Soul второго поколения из текста. Поддерживает Soul ID.',
  'higgsfield-ai/soul/v2/image-to-image': 'Soul 2 по твоему фото-референсу с сохранением композиции.',
  'xai/grok-imagine-image-2.0': 'Смелые образы, до 10 фото-референсов.',
  'higgsfield/ai-influencer': 'Персонаж-инфлюенсер по брифу, с предметами и чертами.',
  'ideogram/v4.0': 'Сильна в типографике и надписях на изображении.',
  'alibaba/qwen-image-3/edit': 'Правки по фото: замени, добавь, перекрась.',
  'workflows/product-shots': 'Предметная съёмка товара по 1–2 фото.',
  'workflows/graphic-ads': 'Графическая реклама из фото продукта.',
  'workflows/marketplace-design': 'Карточки для маркетплейсов из фото товара.',
  'workflows/ads-studio': 'Рекламные креативы под нишу и аудиторию.',
};
const blurb = (m: PhotoCatalogModel) => userSafeName(blurbs[m.id] || (m.id.startsWith('recraft') ? 'Чистая графика с заданной палитрой и фоном. Файл JPG, PNG или WEBP.' : m.id.startsWith('marketing') ? 'Маркетинговые изображения с пресетами.' : m.id.includes('qwen') ? 'Точное следование описанию, режим размышления.' : m.id.includes('z-image') ? 'Быстрые черновые кадры.' : 'Модель генерации изображений.'));
const fieldLabels: Record<string, string> = { prompt: 'Описание', brief: 'Бриф', seed: 'Seed', style_id: 'Soul Style ID', batch_size: 'Сколько изображений', resolution: 'Разрешение', aspect_ratio: 'Формат кадра', enhance_prompt: 'Улучшить описание', style_strength: 'Сила стиля', custom_reference_id: 'Soul ID', custom_reference_strength: 'Сила Soul ID', image_url: 'Фото-референс', image_urls: 'Фото-референсы', item_image_urls: 'Фото предметов', quality: 'Качество', moderation: 'Модерация', preset_id: 'Пресет (UUID)', image_weight: 'Вес исходного фото', rendering_speed: 'Скорость', colors: 'Палитра', background_color: 'Цвет фона', output_format: 'Формат файла', negative_prompt: 'Чего избегать', prompt_extend: 'Расширить описание', enable_thinking: 'Режим размышления', prompt_extend_mode: 'Режим расширения', tier: 'Тип персонажа', selection: 'Выбор черт', body_color: 'Цвет тела', pinned_species: 'Вид', trait_variants: 'Варианты черт', variation_index: 'Индекс вариации', niche: 'Ниша', language: 'Язык', target_audience: 'Аудитория' };
const order = ['prompt', 'brief', 'image_url', 'image_urls', 'item_image_urls'];

type Ready = { ok: boolean; reason: string };
export function readiness(c: PhotoCatalog | undefined, m: PhotoCatalogModel): Ready {
  if (!c) return { ok: false, reason: 'Каталог загружается' };
  if (m.pricingBlockedReason) return { ok: false, reason: m.pricingBlockedReason };
  if (!c.providerConfigured) return { ok: false, reason: 'Провайдер не настроен' };
  if (!c.storageConfigured) return { ok: false, reason: 'Хранилище не настроено' };
  if (!c.spendingEnabled) return { ok: false, reason: 'Списания выключены' };
  if (!m.available || !m.modelId || m.creditPrice == null) return { ok: false, reason: 'Модель не подключена' };
  return { ok: true, reason: '' };
}
const go = (navigate: (to: string) => void, to: string) => (e: React.MouseEvent) => { e.preventDefault(); navigate(to); };

export function PhotoCatalogue() {
  const [, navigate] = useLocation();
  const search = useSearch();
  const catalog = useGetPhotoCatalog({ request: read });
  const [q, setQ] = useState(() => new URLSearchParams(search).get('q') || '');
  const [mode, setMode] = useState<'all' | 'text' | 'image' | 'workflow'>('all');
  const [provider, setProvider] = useState('all');
  const [filterOpen, setFilterOpen] = useState(false);
  const models = catalog.data?.models || [];
  const providers = useMemo(() => Array.from(new Set(models.map(photoProvider))), [models]);
  const t = q.trim().toLowerCase();
  const shown = filterFamilies(models, { q, mode, provider, providerOf: photoProvider, text: m => `${m.name} ${displayName(m)} ${m.id} ${blurb(m)} ${modeLabel(m)}` });
  const searching = t.length > 0;
  const activeFilters = (mode !== 'all' ? 1 : 0) + (provider !== 'all' ? 1 : 0);
  const update = (v: string) => { setQ(v); const p = new URLSearchParams({ type: 'photo' }); if (v.trim()) p.set('q', v.trim()); window.history.replaceState(window.history.state, '', `${import.meta.env.BASE_URL.replace(/\/$/, '')}/create?${p}`); };
  const href = (g: Group<PhotoCatalogModel>) => photoModelHref(g.initial.id);
  const priceLabel = (list: PhotoCatalogModel[]) => { const ok = list.filter(m => readiness(catalog.data, m).ok); if (!ok.length) return readiness(catalog.data, list[0]).reason; return 'Цена по настройкам'; };
  const title = (g: Group<PhotoCatalogModel>) => g.family.title ?? displayName(g.initial);
  const kinds = (g: Group<PhotoCatalogModel>) => Array.from(new Set(g.members.map(modeLabel))).join(' · ');
  const hero = groupFamilies(models).slice(0, 5).map(g => ({ id: g.family.id, title: title(g), subtitle: blurb(g.initial), image: photoModelArt(g.initial), providerLabel: photoProviderLabel(photoProvider(g.initial)), g }));
  const modes = [['all', 'Все'], ['text', 'Текст → фото'], ['image', 'Фото → фото'], ['workflow', 'Сценарии']] as const;
  return <Frame active="Create"><div className="vs-page" data-testid="catalogue-photo-models">
    {catalog.isLoading ? <div className="vs-hero" style={{ height: 268, background: 'var(--vk-card)' }}/> : hero.length > 0 && <ScenarioCarousel items={hero} image={asset} label={h => priceLabel(h.g.members)} eyebrow={h => `${kinds(h.g)} · ${h.providerLabel}`} onOpen={h => navigate(href(h.g))}/>}
    <PromoBanner/>
    <div className="vs-toolbar">
      <div className="vs-toolrow">
        <form className="vs-search" role="search" onSubmit={e => { e.preventDefault(); if (shown[0]) navigate(href(shown[0])); }}>
          <Search size={14} aria-hidden/>
          <input data-testid="input-photo-model-search" aria-label="Поиск фотомодели" value={q} onChange={e => update(e.target.value)} maxLength={300} placeholder="Soul, Recraft, товар" enterKeyHint="search"/>
          {searching && <button type="button" className="vs-clear" aria-label="Очистить поиск" onClick={() => update('')}><X size={13}/></button>}
        </form>
        <button type="button" data-testid="button-photo-filter" className={`vs-filter${activeFilters ? ' on' : ''}`} aria-expanded={filterOpen} aria-controls="ps-filter-panel" onClick={() => setFilterOpen(v => !v)}><SlidersHorizontal size={13}/>Фильтр{activeFilters > 0 && <b>{activeFilters}</b>}</button>
      </div>
      {filterOpen && <div id="ps-filter-panel" className="vs-panel">
        <span className="vs-panel-label">Режим</span>
        <div className="vs-chips" role="group" aria-label="Режим">{modes.map(([id, l]) => <button key={id} data-testid={`button-photo-mode-${id}`} className={mode === id ? 'on' : ''} aria-pressed={mode === id} onClick={() => setMode(id)}>{l}</button>)}</div>
        <span className="vs-panel-label">Поставщик модели</span>
        <div className="vs-chips" role="group" aria-label="Поставщик модели">
          <button data-testid="button-photo-provider-all" className={provider === 'all' ? 'on' : ''} aria-pressed={provider === 'all'} onClick={() => setProvider('all')}>Все поставщики</button>
          {providers.map(p => <button key={p} data-testid={`button-photo-provider-${p}`} className={provider === p ? 'on' : ''} aria-pressed={provider === p} onClick={() => setProvider(p)}>{photoProviderLabel(p)}</button>)}
        </div>
        {activeFilters > 0 && <button type="button" className="vs-panel-reset" onClick={() => { setMode('all'); setProvider('all'); }}>Сбросить фильтры</button>}
      </div>}
    </div>
    <h2 className="vs-section">{searching ? 'Подходящие модели' : mode === 'all' ? 'Все фотомодели' : modes.find(x => x[0] === mode)?.[1]}</h2>
    <span className="vs-sr" aria-live="polite">{searching ? (shown.length ? `Найдено: ${shown.length}` : 'Ничего не нашлось') : ''}</span>
    {catalog.isLoading ? <div className="vs-grid">{[0, 1, 2, 3].map(i => <div key={i} className="vs-card" style={{ height: 230, opacity: .5 }}/>)}</div>
      : catalog.isError ? <div className="vs-empty"><img src={mood('curious')} alt=""/><strong>Каталог не загрузился</strong><p>{meduhaErrorMessage(catalog.error)}</p><div className="vs-empty-actions"><button onClick={() => catalog.refetch()}><RefreshCw size={12}/> Повторить</button></div></div>
      : shown.length ? <div className="vs-grid">{shown.map((g, i) => <button key={g.family.id} data-testid={`card-photo-model-${g.family.id}`} className={`vs-card${searching && i === 0 ? ' best' : ''}`} style={{ animationDelay: `${Math.min(i, 8) * 35}ms` }} onClick={() => navigate(href(g))}>
        <span className="vs-card-img"><img src={asset(photoModelArt(g.initial))} alt="" loading="lazy"/>{searching && i === 0 && <span className="vs-best">Ближе всего</span>}</span>
        <span className="vs-card-body"><strong>{title(g)}<em> · {g.members.length > 1 ? `${g.members.length} режима` : modeLabel(g.initial)}</em></strong><small>{blurb(g.initial)}</small>
          <span className="vs-card-foot"><span className="vs-prov">{photoProviderLabel(photoProvider(g.initial))}</span><span className="vs-price" data-testid={`text-price-${g.family.id}`}>{priceLabel(g.matched)}</span></span></span>
      </button>)}</div>
      : <div className="vs-empty"><img src={mood('curious')} alt=""/><strong>Такой модели пока нет</strong><p>Попробуй проще: «Soul», «товар», «правки». Или сбрось фильтры.</p>
        <div className="vs-empty-actions"><button onClick={() => { update(''); setMode('all'); setProvider('all'); }}>Сбросить поиск</button><Link href="/create?type=photo&ideas=1">Фотоидеи</Link></div></div>}
    <Link className="vs-free" href="/create?type=photo&ideas=1" data-testid="link-photo-ideas"><span><strong>Фотоидеи</strong><small>Готовые сюжеты для вдохновения</small></span><ArrowRight size={15}/></Link>
    <Link className="vs-free" href="/create?type=photo&editor=1" data-testid="link-photo-editor"><span><strong>Без модели</strong><small>Записать идею без генерации</small></span><ArrowRight size={15}/></Link>
  </div></Frame>;
}

type Ref = { id: string; name: string };
type Stored = { params: Record<string, unknown>; json: Record<string, string>; refs: Record<string, Ref[]> };
const storeKey = (id: string) => `meduha.photo.v1.${id}`;
const loadStored = (id: string): Stored | null => { try { const raw = localStorage.getItem(storeKey(id)); return raw ? JSON.parse(raw) : null; } catch { return null; } };
const uuid = () => crypto.randomUUID();

export function PhotoModelPage({ catalogId }: { catalogId: string }) {
  const [, navigate] = useLocation();
  const session = useMeduhaSession();
  const authed = session.phase === 'authenticated';
  const catalog = useGetPhotoCatalog({ request: read });
  const source = useRecipeSource();
  const ideaId = new URLSearchParams(useSearch()).get('photoIdea');
  const idea = source.active ? undefined : photoIdeas.find(item => item.id === ideaId);
  const [selected, setSelected] = useState(catalogId);
  const model = catalog.data?.models.find(m => m.id === selected);
  const siblings = catalog.data ? familyOf(catalogId).modes.map(x => catalog.data!.models.find(m => m.id === x.id)).filter((m): m is PhotoCatalogModel => !!m) : [];
  const pick = (id: string) => { setSelected(id); window.history.replaceState(window.history.state, '', `${import.meta.env.BASE_URL.replace(/\/$/, '')}${idea ? photoIdeaHref(idea, id) : `${photoModelHref(id)}${source.carry}`}`); };
  if (catalog.isLoading || (source.active && source.phase === 'loading')) return <Frame active="Create"><div className="ps-page"><div className="ps-card ps-skel" style={{ height: 120 }}/><div className="ps-card ps-skel" style={{ height: 260, marginTop: 12 }}/></div></Frame>;
  if (ideaId && !idea && !source.active) return <Frame active="Create"><div className="ps-page"><div className="ps-empty"><strong>Фото-сценарий не найден</strong><p>Выбери сценарий из актуальной подборки.</p><Link className="ps-btn" href="/create?type=photo&ideas=1">К фотоидеям</Link></div></div></Frame>;
  if (catalog.isError || !model) return <Frame active="Create"><div className="ps-page"><div className="ps-empty"><img src={mood('curious')} alt=""/><strong>{catalog.isError ? 'Каталог не загрузился' : 'Модель не найдена'}</strong><p>{catalog.isError ? meduhaErrorMessage(catalog.error) : 'Возможно, она убрана из каталога.'}</p>{catalog.isError && <button className="ps-btn" onClick={() => catalog.refetch()}><RefreshCw size={14}/>Повторить</button>}<Link className="ps-btn" href="/create?type=photo">К каталогу</Link></div></div></Frame>;
  const recipeView = source.view && source.view.recipe.kind === 'photo' && source.view.recipe.catalogId === model.id ? source.view : null;
  const suffix = source.storeSuffix ?? (recipeView ? 'preview' : idea ? `idea.${idea.id}` : null);
  return <ModelForm key={`${model.id}:${suffix ?? ''}`} idea={idea} suffix={suffix} source={source} recipeView={recipeView} model={model} catalog={catalog.data!} authed={authed} navigate={navigate} siblings={siblings} onPick={pick}/>;
}

function ModelForm({ idea, suffix, source, recipeView, model, catalog, authed, navigate, siblings, onPick }: { idea?: PhotoIdea; suffix: string | null; source: RecipeSource; recipeView: RecipeView | null; model: PhotoCatalogModel; catalog: PhotoCatalog; authed: boolean; navigate: (to: string) => void; siblings: PhotoCatalogModel[]; onPick: (id: string) => void }) {
  const fam = familyOf(model.id);
  const schema = model.schema as Schema;
  const qc = useQueryClient();
  const { toast, notify } = useToast();
  const storeId = suffix ? `${model.id}.${suffix}` : model.id;
  const stored = useMemo(() => (suffix === 'preview' ? null : loadStored(storeId)) ?? (recipeView ? hydratePhoto(recipeView, schema) : null), [storeId]); // eslint-disable-line react-hooks/exhaustive-deps
  const lockedDefaults = useMemo(() => { const d = defaults(schema); const out: Record<string, unknown> = {}; if (model.workflow) { for (const k of LOCKED_WORKFLOW) if (schema.properties?.[k]) out[k] = k === 'enhance_prompt' ? true : k === 'quality' ? 'high' : d[k]; } if (model.id === 'higgsfield-ai/soul/v2/image-to-image' && schema.properties?.enhance_prompt) out.enhance_prompt = true; return out; }, [schema, model.workflow, model.id]);
  const [params, setParams] = useState<Record<string, unknown>>(() => ({ ...defaults(schema), ...(idea ? photoIdeaParameters(idea, schema) : {}), ...(stored?.params || {}), ...lockedDefaults }));
  const [json, setJson] = useState<Record<string, string>>(() => stored?.json || {});
  const [refs, setRefs] = useState<Record<string, Ref[]>>(() => stored?.refs || {});
  const [uploading, setUploading] = useState<Record<string, number>>({});
  const [touched, setTouched] = useState(false);
  const idem = useRef<{ fp: string; key: string } | null>(null);
  const create = useCreatePhotoGeneration({ request: mutateReq });
  const quoteRequest = useQuotePhotoGeneration({ request: mutateReq });
  const [quote, setQuote] = useState<{ fp: string; key: string; value: PhotoQuote } | null>(null);
  const [quoteError, setQuoteError] = useState('');
  const [now, setNow] = useState(Date.now);
  const requestLock = useRef(false);
  useEffect(() => {
    if (!quote) return;
    const timer = window.setTimeout(() => setNow(Date.now()), Math.max(0, quote.value.expiresAt - Date.now()) + 20);
    return () => window.clearTimeout(timer);
  }, [quote]);

  useEffect(() => { if (suffix === 'preview') return; try { localStorage.setItem(storeKey(storeId), JSON.stringify({ params, json, refs })); if (!suffix) localStorage.setItem('meduha.photo.last', model.id); } catch { /* storage full */ } }, [params, json, refs, model.id, storeId, suffix]);

  const parsedJson: Record<string, unknown> = {}; const jsonErr: Record<string, string> = {};
  for (const [k, txt] of Object.entries(json)) { if (!txt.trim()) continue; try { parsedJson[k] = JSON.parse(txt); } catch { jsonErr[k] = 'Некорректный JSON'; } }
  const values: Record<string, unknown> = { ...params, ...parsedJson, ...lockedDefaults };
  for (const [k, list] of Object.entries(refs)) if (list.length) values[k] = list.map(r => r.id);
  const eff = effective(schema, values);
  const fields = Object.keys(eff.props).sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));

  const errors: Record<string, string> = { ...jsonErr };
  for (const k of fields) {
    if (errors[k]) continue;
    const s = eff.props[k]; const kind = fieldKind(k, s); const v = values[k];
    if (kind === 'files') {
      const n = refs[k]?.length || 0; const max = isFileArray(k, s) ? s.maxItems ?? 16 : 1;
      if (eff.required.has(k) && n < Math.max(1, s.minItems || 0)) errors[k] = s.minItems > 1 ? `Добавь минимум ${s.minItems} фото` : 'Добавь фото';
      else if (n && s.minItems && n < s.minItems) errors[k] = `Минимум ${s.minItems} фото`;
      else if (n > max) errors[k] = `Максимум ${max} фото`;
      continue;
    }
    if (v === undefined || v === '') { if (eff.required.has(k)) errors[k] = kind === 'json' ? 'Обязательное сложное поле — заполни JSON' : 'Обязательное поле'; continue; }
    if (k in eff.forced && v !== eff.forced[k]) { errors[k] = `При текущих настройках нужно значение ${JSON.stringify(eff.forced[k])}`; continue; }
    if (eff.mustBeNull.has(k) && v !== null) { errors[k] = 'При выбранном типе это поле должно быть пустым'; continue; }
    const e = validate(s, v, schema, fieldLabels[k] || k); if (e) errors[k] = e;
  }
  const busyUpload = Object.values(uploading).some(n => n > 0);
  const ready = readiness(catalog, model);

  const payloadParams: Record<string, unknown> = {};
  for (const k of fields) { if (FILE_KEYS.has(k)) continue; const v = values[k]; if (v !== undefined && v !== '') payloadParams[k] = v; }
  const references: Record<string, string[]> = {};
  for (const [k, list] of Object.entries(refs)) if (list.length && eff.props[k]) references[k] = list.map(r => r.id);
  const fp = JSON.stringify([model.id, model.modelId, model.creditPrice, authed, payloadParams, references]);
  const currentFp = useRef(fp);
  currentFp.current = fp;
  if (!idem.current || idem.current.fp !== fp) idem.current = { fp, key: uuid() };
  const activeQuote = quote?.fp === fp && quote.key === idem.current.key ? quote.value : null;
  const expired = !!activeQuote && activeQuote.expiresAt <= now;

  const invalid = Object.keys(errors).length > 0;
  const canSubmit = authed && ready.ok && !invalid && !busyUpload && !create.isPending && !quoteRequest.isPending;

  const calculate = () => {
    setTouched(true);
    if (!canSubmit || !model.modelId || requestLock.current) return;
    requestLock.current = true;
    setQuote(null); setQuoteError('');
    const key = uuid();
    idem.current = { fp, key };
    quoteRequest.mutate({ data: { idempotencyKey: key, modelId: model.modelId, catalogId: model.id, parameters: payloadParams, references } }, {
      onSuccess: value => {
        if (currentFp.current === fp && idem.current?.key === key) { setQuote({ fp, key, value }); setNow(Date.now()); }
      },
      onError: error => { if (currentFp.current === fp) setQuoteError(meduhaErrorMessage(error)); },
      onSettled: () => { requestLock.current = false; },
    });
  };

  const setP = (k: string, v: unknown) => setParams(p => { const n = { ...p }; if (v === undefined) delete n[k]; else n[k] = v; return n; });
  const addFiles = async (k: string, files: FileList | null, max: number, replaceIndex?: number) => {
    if (!files?.length) return;
    if (!authed) { notify('Загрузка фото доступна после входа через Telegram'); return; }
    const list = Array.from(files).slice(0, replaceIndex !== undefined ? 1 : Math.max(0, max - (refs[k]?.length || 0)));
    if (!list.length) { notify(`Можно не больше ${max} фото`); return; }
    for (const f of list) {
      const bad = validateFile(f, false); if (bad) { notify(bad); continue; }
      setUploading(u => ({ ...u, [k]: (u[k] || 0) + 1 }));
      try {
        const path = await uploadMedia(f); const id = mediaUuid(path);
        if (!id) throw new Error('Сервер вернул неожиданный путь файла');
        setRefs(r => { const cur = [...(r[k] || [])]; if (replaceIndex !== undefined) cur[replaceIndex] = { id, name: f.name }; else cur.push({ id, name: f.name }); return { ...r, [k]: cur.slice(0, max) }; });
      } catch (e) { notify(`Не удалось загрузить ${f.name}: ${meduhaErrorMessage(e)}`); }
      finally { setUploading(u => ({ ...u, [k]: (u[k] || 1) - 1 })); }
    }
  };

  const submit = () => {
    setTouched(true);
    if (!canSubmit || !model.modelId || !idem.current || !activeQuote || activeQuote.expiresAt <= Date.now() || requestLock.current) return;
    requestLock.current = true;
    const key = idem.current.key;
    const data: PhotoGenerationInput = { idempotencyKey: key, modelId: model.modelId, catalogId: model.id, expectedCreditPrice: activeQuote.creditPrice, priceQuote: activeQuote.token, parameters: payloadParams, references };
    create.mutate({ data }, {
      onSuccess: () => { setQuote(null); notify('Генерация запущена. Результат появится ниже'); if (currentFp.current === fp) idem.current = { fp, key: uuid() }; qc.invalidateQueries({ queryKey: getListMeduhaGenerationsQueryKey() }); qc.invalidateQueries({ queryKey: getGetPhotoCatalogQueryKey() }); qc.invalidateQueries({ queryKey: getGetMeduhaBootstrapQueryKey() }); qc.invalidateQueries({ queryKey: getGetMeduhaWalletQueryKey() }); },
      onError: e => {
        const code = (e as { data?: { code?: string } })?.data?.code;
        if (['STALE_PRICE_QUOTE', 'UNSAFE_PHOTO_PRICE', 'PRICE_CHANGED'].includes(code ?? '')) {
          setQuote(null);
          void qc.invalidateQueries({ queryKey: getGetPhotoCatalogQueryKey() });
        }
        notify(`Не запустилось: ${meduhaErrorMessage(e)}. Повтор с теми же настройками не спишет дважды`);
      },
      onSettled: () => { requestLock.current = false; },
    });
  };

  return <Frame active="Create"><div className="ps-page vs-page ps-model" data-testid={`page-photo-model-${model.id}`}>
    <a className="ps-back" href="/create?type=photo" onClick={go(navigate, '/create?type=photo')} data-testid="link-photo-catalogue"><ArrowLeft size={13}/>Все фотомодели</a>
    <ExamplePreview scenario={model.id} heading={userSafeName(fam.title ?? displayName(model))} media={photoModelPreview(model.id)}
      communityHref="/community?kind=photo" emptyText="Для этого режима на исходной странице пока нет фотопримера"/>
    {idea && <>
      <div className="ps-note" data-testid="status-photo-idea"><strong>{idea.title}</strong><p>Описание можно изменить. У каждой модели — отдельный черновик этого сценария: настройки и загруженные референсы сохраняются на этом устройстве и восстанавливаются при возвращении к модели.</p><Link href="/create?type=photo&ideas=1">Выбрать другой сценарий</Link></div>
      <label className="ps-field"><span>Модель для этого сценария</span><select data-testid="select-photo-idea-model" value={model.id} onChange={event => onPick(event.target.value)}>{catalog.models.map(option => <option key={option.id} value={option.id}>{displayName(option)}</option>)}</select></label>
    </>}
    {siblings.length > 1 && <div className="ps-modes" role="group" aria-label="Режим модели" data-testid="group-photo-modes">{siblings.map(m => { const on = m.id === model.id; return <button key={m.id} type="button" aria-pressed={on} className={on ? 'on' : ''} data-testid={`button-photo-mode-${m.id}`} onClick={() => { if (!on) onPick(m.id); }}>{modeLabelIn(m.id) || displayName(m)}</button>; })}</div>}
    {!authed && <div className="ps-alert" data-testid="status-login-required"><Lock size={15}/><span><strong>Нужен вход через Telegram</strong>Открой студию из Telegram, чтобы загружать фото и запускать генерацию. Настройки можно смотреть и менять уже сейчас.</span></div>}
    {(authed || idea || model.pricingBlockedReason) && !ready.ok && <div className="ps-alert muted" data-testid="status-model-unavailable"><Lock size={15}/><span><strong>Запуск пока недоступен</strong>{ready.reason}. Настройки сохраняются на этом устройстве.</span></div>}
    <RecipeBanner source={source} mismatch={!!source.view && !recipeView}/>
    {model.workflow && schema.properties?.preset_id && <div className="ps-note">Сценарий использует официальный пресет и улучшение описания с высоким качеством — эти параметры зафиксированы.</div>}
    <div className="ps-form">{fields.map(k => <Field key={k} name={k} s={eff.props[k]} schema={schema} required={eff.required.has(k)} locked={k in lockedDefaults} value={values[k]} jsonText={json[k] ?? ''} error={touched || values[k] !== undefined || refs[k]?.length ? errors[k] : undefined} refs={refs[k] || []} uploading={uploading[k] || 0} authed={authed}
      onChange={v => setP(k, v)} onJson={t => setJson(j => ({ ...j, [k]: t }))}
      onFiles={(f, max, idx) => void addFiles(k, f, max, idx)} onRemove={i => setRefs(r => ({ ...r, [k]: (r[k] || []).filter((_, j) => j !== i) }))}/>)}</div>
    <div className="ps-submit">
      <div className="ps-cost" data-testid="text-photo-cost" aria-live="polite">{activeQuote && !expired ? <><Zap size={13} fill="currentColor"/><strong>{activeQuote.creditPrice}</strong> кредитов за весь запрос<small>{activeQuote.images} изображ. · {activeQuote.resolution} · качество: {activeQuote.quality} · референсов: {activeQuote.referenceCount}</small></> : <small>{expired ? 'Смета истекла — рассчитай цену заново' : 'Итоговая цена появится после расчёта по твоим настройкам'}</small>}</div>
      <p className="ps-note">Расчёт не запускает генерацию и не резервирует кредиты. Смета действует 5 минут. Только отдельное подтверждение отправит запрос в очередь.</p>
      {activeQuote && !expired ? <>
        <button className="m-generate" data-testid="button-photo-generate" disabled={!canSubmit} onClick={submit}><Sparkles size={16}/>{create.isPending ? 'Отправляем…' : `Подтвердить и создать за ${activeQuote.creditPrice} кр.`}</button>
        <button className="ps-btn" disabled={create.isPending} onClick={() => setQuote(null)}>Отменить</button>
      </> : <button className="m-generate" data-testid="button-photo-quote" disabled={!canSubmit} onClick={calculate}><Sparkles size={16}/>{quoteRequest.isPending ? 'Рассчитываем…' : busyUpload ? 'Ждём загрузку фото…' : 'Рассчитать стоимость'}</button>}
      {quoteError && <p className="ps-err" role="alert">{quoteError}</p>}
      {touched && invalid && <p className="ps-err">Проверь отмеченные поля: {Object.keys(errors).map(k => fieldLabels[k] || k).join(', ')}</p>}
    </div>
    <SaveAsTemplate recipe={{ version: 1, kind: 'photo', catalogId: model.id, parameters: payloadParams, references: Object.fromEntries(Object.entries(references).map(([k, v]) => [pointerOf(k), v])) }}
      title={String(values.prompt ?? values.brief ?? displayName(model)).split(/[.!?\n]/)[0]}
      disabledReason={!authed ? 'Сохранить шаблон можно после входа через Telegram.' : busyUpload ? 'Дождись загрузки фото.' : invalid ? 'Сначала исправь отмеченные поля.' : null}/>
    {authed && <PhotoJobs/>}
    {toast}
  </div></Frame>;
}
const FILE_KEYS = new Set(['image_url', 'image_urls', 'item_image_urls']);
function hydratePhoto(view: RecipeView, schema: Schema): Stored {
  const out: Stored = { params: {}, json: {}, refs: {} };
  for (const [k, v] of Object.entries(view.recipe.parameters)) {
    const s = schema.properties?.[k];
    if (s && fieldKind(k, s) === 'json') out.json[k] = typeof v === 'string' ? v : JSON.stringify(v, null, 2); else out.params[k] = v;
  }
  for (const [ptr, ids] of Object.entries(view.recipe.references)) { const k = fieldOfPointer(ptr); if (k) out.refs[k] = ids.map((id, i) => ({ id, name: `Фото ${i + 1}` })); }
  return out;
}

function Field({ name, s, schema, required, locked, value, jsonText, error, refs, uploading, authed, onChange, onJson, onFiles, onRemove }: { name: string; s: Schema; schema: Schema; required: boolean; locked: boolean; value: unknown; jsonText: string; error?: string; refs: Ref[]; uploading: number; authed: boolean; onChange: (v: unknown) => void; onJson: (t: string) => void; onFiles: (f: FileList | null, max: number, idx?: number) => void; onRemove: (i: number) => void }) {
  const kind = fieldKind(name, s);
  const label = fieldLabels[name] || s.title || name;
  const input = useRef<HTMLInputElement>(null); const replaceAt = useRef<number | undefined>(undefined);
  const head = <div className="ps-label"><span>{label}{required && <b> *</b>}</span>{s.description && kind !== 'longtext' && <small>{userSafeName(s.description)}</small>}</div>;
  const id = `ps-${name}`;
  let body: React.ReactNode;
  if (kind === 'files') {
    const max = isFileArray(name, s) ? s.maxItems ?? 16 : 1;
    body = <><input ref={input} type="file" hidden accept="image/jpeg,image/png,image/webp" multiple={max > 1 && replaceAt.current === undefined} onChange={e => { onFiles(e.target.files, max, replaceAt.current); replaceAt.current = undefined; e.target.value = ''; }}/>
      <div className="ps-files">{refs.map((r, i) => <div key={r.id + i} className="ps-file"><img src={`${import.meta.env.BASE_URL.replace(/\/$/, '')}/api/meduha/media/${r.id}`} alt={r.name}/><span>{r.name}</span><div><button type="button" aria-label="Заменить" data-testid={`button-replace-${name}-${i}`} onClick={() => { replaceAt.current = i; input.current?.click(); }}><RefreshCw size={12}/></button><button type="button" aria-label="Удалить" data-testid={`button-remove-${name}-${i}`} onClick={() => onRemove(i)}><Trash2 size={12}/></button></div></div>)}
        {Array.from({ length: uploading }).map((_, i) => <div key={`u${i}`} className="ps-file loading"><i/><span>Загружаем…</span></div>)}
        {refs.length + uploading < max && <button type="button" className="ps-add" disabled={!authed} data-testid={`button-upload-${name}`} onClick={() => { replaceAt.current = undefined; input.current?.click(); }}><Upload size={15}/><span>{authed ? 'Добавить фото' : 'Нужен вход'}</span><small>{refs.length}/{max} · JPG, PNG, WEBP до 10 МБ</small></button>}</div></>;
  } else if (kind === 'enum') {
    const opts: unknown[] = s.enum; const many = opts.length > 8;
    body = many ? <select id={id} data-testid={`select-${name}`} disabled={locked} value={value === undefined ? '' : String(value)} onChange={e => { const raw = e.target.value; onChange(raw === '' ? undefined : opts.find(o => String(o) === raw)); }}>{!required && <option value="">По умолчанию</option>}{opts.map(o => <option key={String(o)} value={String(o)}>{String(o)}</option>)}</select>
      : <div className="ps-seg">{opts.map(o => <button type="button" key={String(o)} disabled={locked} data-testid={`button-${name}-${String(o)}`} className={value === o ? 'on' : ''} aria-pressed={value === o} onClick={() => onChange(o)}>{String(o)}</button>)}</div>;
  } else if (kind === 'boolean') {
    body = <button type="button" role="switch" aria-checked={value === true} disabled={locked} data-testid={`switch-${name}`} className={`ps-switch${value === true ? ' on' : ''}`} onClick={() => onChange(!(value === true))}><i/>{value === true ? 'Включено' : 'Выключено'}</button>;
  } else if (kind === 'number' || kind === 'integer') {
    const slider = kind === 'number' && s.minimum !== undefined && s.maximum !== undefined;
    body = <div className="ps-num">{slider && <input type="range" min={s.minimum} max={s.maximum} step={0.01} value={typeof value === 'number' ? value : s.minimum} onChange={e => onChange(Number(e.target.value))} data-testid={`range-${name}`}/>}
      <input id={id} type="number" inputMode={kind === 'integer' ? 'numeric' : 'decimal'} min={s.minimum} max={s.maximum} step={kind === 'integer' ? 1 : 0.01} placeholder={s.minimum !== undefined ? `${s.minimum}–${s.maximum ?? '∞'}` : ''} value={typeof value === 'number' ? value : ''} data-testid={`input-${name}`} onChange={e => onChange(e.target.value === '' ? (isNullable(s) && !required ? undefined : undefined) : Number(e.target.value))}/>
      {value !== undefined && !required && <button type="button" className="ps-clear" onClick={() => onChange(undefined)} aria-label="Сбросить"><X size={12}/></button>}</div>;
  } else if (kind === 'longtext') {
    const str = typeof value === 'string' ? value : '';
    body = <><textarea id={id} rows={name === 'prompt' || name === 'brief' ? 5 : 3} maxLength={s.maxLength} value={str} placeholder={name === 'negative_prompt' ? 'Размытие, лишние пальцы, текст…' : 'Опиши кадр: кто, где, свет, настроение'} data-testid={`textarea-${name}`} onChange={e => onChange(e.target.value === '' ? undefined : e.target.value)}/><small className="ps-count">{str.length}{s.maxLength ? `/${s.maxLength}` : ''}</small></>;
  } else if (kind === 'color') {
    const str = typeof value === 'string' ? value : '';
    body = <div className="ps-num"><input type="color" value={/^#[0-9a-f]{6}$/i.test(str) ? str : '#ff6b18'} onChange={e => onChange(e.target.value)} aria-label={label}/><input id={id} value={str} placeholder="#ff6b18" onChange={e => onChange(e.target.value || undefined)} data-testid={`input-${name}`}/>{str && <button type="button" className="ps-clear" onClick={() => onChange(undefined)} aria-label="Сбросить"><X size={12}/></button>}</div>;
  } else if (kind === 'json') {
    body = <><textarea id={id} className="ps-json" rows={3} spellCheck={false} value={jsonText} placeholder={jsonExample(name, s)} data-testid={`json-${name}`} onChange={e => onJson(e.target.value)}/><small className="ps-hint">JSON по официальной схеме. Пример: <code>{jsonExample(name, s)}</code>{!required && ' · оставь пустым, чтобы не передавать'}</small></>;
  } else {
    const str = typeof value === 'string' ? value : '';
    body = <input id={id} value={str} disabled={locked} placeholder={kind === 'uuid' ? '00000000-0000-0000-0000-000000000000' : ''} data-testid={`input-${name}`} onChange={e => onChange(e.target.value.trim() === '' ? undefined : e.target.value.trim())}/>;
  }
  return <div className={`ps-field${error ? ' bad' : ''}${locked ? ' locked' : ''}`}>{head}{body}{locked && <small className="ps-hint"><Lock size={10}/> Зафиксировано для этого режима</small>}{error && <small className="ps-err" role="alert">{error}</small>}</div>;
}

const running = new Set(['awaiting_reservation', 'queued', 'submitting', 'in_progress', 'finalizing']);
const statusRu: Record<string, string> = { awaiting_reservation: 'Резервируем кредиты', queued: 'В очереди', submitting: 'Отправляем', unknown: 'Статус неизвестен', in_progress: 'Создаётся', finalizing: 'Сохраняем', completed: 'Готово', failed: 'Ошибка' };
export const jobUrls = (j: GenerationJob) => j.resultUrls?.length ? j.resultUrls : j.resultUrl ? [j.resultUrl] : [];

export function PhotoJobs({ compact }: { compact?: boolean }) {
  const list = useListMeduhaGenerations({ request: read, query: { queryKey: getListMeduhaGenerationsQueryKey(), refetchInterval: q => (q.state.data?.items || []).some(j => running.has(j.status)) ? 4000 : (q.state.data?.items || []).some(j => j.status === 'unknown') ? 15000 : false, refetchOnMount: 'always' } });
  const qc = useQueryClient();
  const statusFingerprint = (list.data?.items || []).filter(j => j.mediaKind === 'photo').map(j => `${j.id}:${j.status}`).join(',');
  useEffect(() => {
    if (!statusFingerprint) return;
    void qc.invalidateQueries({ queryKey: getGetMeduhaBootstrapQueryKey() });
    void qc.invalidateQueries({ queryKey: getGetMeduhaWalletQueryKey() });
  }, [qc, statusFingerprint]);
  const jobs = (list.data?.items || []).filter(j => j.mediaKind === 'photo');
  return <section className="ps-jobs" data-testid="section-photo-jobs"><div className="m-section-title"><h2>Мои фото</h2><span>{list.data ? jobs.length : '—'}</span></div>
    {list.isLoading ? <div className="m-server-loading"><i/><i/></div>
      : list.isError ? <div className="ps-alert muted"><span>{meduhaErrorMessage(list.error)}</span><button className="ps-btn" onClick={() => list.refetch()}><RefreshCw size={13}/>Повторить</button></div>
      : jobs.length === 0 ? <p className="m-info-note">{compact ? 'Здесь появятся созданные фото.' : 'Пока нет фото. Выбери модель, настрой кадр и нажми «Создать».'}</p>
      : <div className="ps-job-list">{jobs.map(j => { const urls = jobUrls(j); return <article key={j.id} className={`ps-job ${j.status}`} data-testid={`card-photo-job-${j.id}`}>
        <div className="ps-job-top"><strong>{j.modelName}</strong><span className={`ps-pill ${j.status}`}>{statusRu[j.status] || j.status}</span></div>
        {j.prompt && <p>{j.prompt}</p>}
        {j.status === 'completed' && urls.length > 0 && <div className={`ps-results n${Math.min(urls.length, 4)}`}>{urls.map((u, i) => <div key={u} className="ps-result"><a href={u} target="_blank" rel="noreferrer" data-testid={`link-photo-result-${j.id}-${i}`} aria-label={`Открыть результат ${i + 1}`}><img src={u} alt={`Результат ${i + 1}`} loading="lazy"/></a><a className="ps-dl" href={`${u}${u.includes('?') ? '&' : '?'}download=1`} download data-testid={`link-photo-download-${j.id}-${i}`} aria-label={`Скачать результат ${i + 1}`}><Download size={11}/></a></div>)}</div>}
        {running.has(j.status) && <div className="ps-progress"><i/></div>}
        {j.status === 'unknown' && <small className="ps-err">Статус запроса неизвестен. Мы не отправляем его повторно автоматически, чтобы не списать кредиты дважды.{j.requestId ? ` Номер запроса: ${j.requestId}.` : ' Номер запроса у провайдера не получен.'}</small>}
        {(j.status === 'failed' || j.status === 'unknown' || j.status === 'finalizing') && j.error && <small className="ps-err">{j.error}</small>}
        <small className="ps-meta">{new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(j.createdAt))} · {j.creditPrice} кр.</small>
      </article>; })}</div>}
  </section>;
}
