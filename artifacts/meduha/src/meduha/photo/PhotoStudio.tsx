import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Download, ExternalLink, ImagePlus, Lightbulb, Lock, RefreshCw, Search, Sparkles, Trash2, Upload, X, Zap } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { getGetPhotoCatalogQueryKey, getGetMeduhaBootstrapQueryKey, getGetMeduhaWalletQueryKey, getListMeduhaGenerationsQueryKey, useCreatePhotoGeneration, useGetPhotoCatalog, useListMeduhaGenerations } from '@workspace/api-client-react';
import type { GenerationJob, PhotoCatalog, PhotoCatalogModel, PhotoGenerationInput } from '@workspace/api-client-react';
import { Frame, mood, useToast } from '../shared';
import { meduhaErrorMessage, useMeduhaSession } from '../session';
import { uploadMedia, validateFile } from '../templates/manage/api';
import { batchMultiplier, defaults, effective, fieldKind, isFileArray, isNullable, jsonExample, mediaUuid, validate, type Schema } from './schema';
import './photo-studio.css';

const read = { credentials: 'same-origin' as const };
const mutateReq = { credentials: 'same-origin' as const, headers: { 'X-Meduha-Request': '1' } };
const LOCKED_WORKFLOW = ['preset_id', 'enhance_prompt', 'quality'];

export const modeLabel = (m: PhotoCatalogModel) => m.workflow ? 'Сценарий' : /image-to-image|\/edit/.test(m.endpoint) ? 'Фото → фото' : 'Текст → фото';
const suffixes: [RegExp, string][] = [[/utility\/pro/, 'Utility Pro'], [/\/pro\//, 'Pro'], [/utility/, 'Utility'], [/\/flare$/, 'Flare'], [/\/sunburst$/, 'Sunburst'], [/^marketing-studio\/image$/, 'Alpha'], [/image-to-image/, 'фото → фото'], [/soul\/v2\/standard/, 'текст → фото'], [/\/edit$/, 'правки'], [/qwen-image-3\/text-to-image/, 'текст → фото']];
export const displayName = (m: PhotoCatalogModel) => { const hit = suffixes.find(([r]) => r.test(m.endpoint)); return hit && !m.name.toLowerCase().includes(hit[1].toLowerCase()) ? `${m.name} · ${hit[1]}` : m.name; };
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
const blurb = (m: PhotoCatalogModel) => blurbs[m.id] || (m.id.startsWith('recraft') ? 'Чистая графика с заданной палитрой и фоном. Файл JPG, PNG или WEBP.' : m.id.startsWith('marketing') ? 'Маркетинговые изображения с пресетами.' : m.id.includes('qwen') ? 'Точное следование описанию, режим размышления.' : m.id.includes('z-image') ? 'Быстрые черновые кадры.' : 'Модель генерации изображений.');
const fieldLabels: Record<string, string> = { prompt: 'Описание', brief: 'Бриф', seed: 'Seed', style_id: 'Soul Style ID', batch_size: 'Сколько изображений', resolution: 'Разрешение', aspect_ratio: 'Формат кадра', enhance_prompt: 'Улучшить описание', style_strength: 'Сила стиля', custom_reference_id: 'Soul ID', custom_reference_strength: 'Сила Soul ID', image_url: 'Фото-референс', image_urls: 'Фото-референсы', item_image_urls: 'Фото предметов', quality: 'Качество', moderation: 'Модерация', preset_id: 'Пресет (UUID)', image_weight: 'Вес исходного фото', rendering_speed: 'Скорость', colors: 'Палитра', background_color: 'Цвет фона', output_format: 'Формат файла', negative_prompt: 'Чего избегать', prompt_extend: 'Расширить описание', enable_thinking: 'Режим размышления', prompt_extend_mode: 'Режим расширения', tier: 'Тип персонажа', selection: 'Выбор черт', body_color: 'Цвет тела', pinned_species: 'Вид', trait_variants: 'Варианты черт', variation_index: 'Индекс вариации', niche: 'Ниша', language: 'Язык', target_audience: 'Аудитория' };
const order = ['prompt', 'brief', 'image_url', 'image_urls', 'item_image_urls'];

type Ready = { ok: boolean; reason: string };
export function readiness(c: PhotoCatalog | undefined, m: PhotoCatalogModel): Ready {
  if (!c) return { ok: false, reason: 'Каталог загружается' };
  if (!c.providerConfigured) return { ok: false, reason: 'Провайдер не настроен' };
  if (!c.storageConfigured) return { ok: false, reason: 'Хранилище не настроено' };
  if (!c.spendingEnabled) return { ok: false, reason: 'Списания выключены' };
  if (!m.available || !m.modelId || m.creditPrice == null) return { ok: false, reason: 'Модель не подключена' };
  return { ok: true, reason: '' };
}
const go = (navigate: (to: string) => void, to: string) => (e: React.MouseEvent) => { e.preventDefault(); navigate(to); };

export function PhotoCatalogue() {
  const [, navigate] = useLocation();
  const catalog = useGetPhotoCatalog({ request: read });
  const [q, setQ] = useState('');
  const [mode, setMode] = useState<'all' | 'text' | 'image' | 'workflow'>('all');
  const models = catalog.data?.models || [];
  const shown = models.filter(m => {
    const label = modeLabel(m);
    if (mode === 'text' && label !== 'Текст → фото') return false;
    if (mode === 'image' && label !== 'Фото → фото') return false;
    if (mode === 'workflow' && !m.workflow) return false;
    const t = q.trim().toLowerCase();
    return !t || `${m.name} ${m.id} ${blurb(m)}`.toLowerCase().includes(t);
  });
  const readyCount = models.filter(m => readiness(catalog.data, m).ok).length;
  return <Frame active="Create"><div className="ps-page" data-testid="catalogue-photo-models">
    <div className="ps-head"><span className="ps-kicker"><Sparkles size={12}/>ФОТОСТУДИЯ</span><h1>Выбери<br/>фотомодель<span>.</span></h1><p>Настоящие модели с официальными настройками. Результаты приватные и видны только тебе.</p></div>
    <div className="ps-links">
      <Link href="/create?type=photo&ideas=1" className="ps-link" data-testid="link-photo-ideas"><Lightbulb size={16}/><span><strong>Фотоидеи</strong><small>Готовые сюжеты для вдохновения</small></span><ArrowRight size={14}/></Link>
      <Link href="/create?type=photo&editor=1" className="ps-link" data-testid="link-photo-editor"><ImagePlus size={16}/><span><strong>Черновик идеи</strong><small>Записать мысль без генерации</small></span><ArrowRight size={14}/></Link>
    </div>
    {catalog.data && <div className="ps-status" data-testid="status-photo-readiness"><i className={readyCount ? 'on' : ''}/>{readyCount ? `Готовы к запуску: ${readyCount} из ${models.length}` : 'Сейчас запуск недоступен — настройки можно смотреть и сохранять'}</div>}
    <div className="ps-search"><Search size={14}/><input data-testid="input-photo-model-search" value={q} onChange={e => setQ(e.target.value)} placeholder="Soul, Recraft, товар…" aria-label="Поиск модели"/>{q && <button aria-label="Очистить" onClick={() => setQ('')}><X size={13}/></button>}</div>
    <div className="ps-chips" role="group" aria-label="Режим">{([['all', 'Все'], ['text', 'Текст → фото'], ['image', 'Фото → фото'], ['workflow', 'Сценарии']] as const).map(([id, l]) => <button key={id} data-testid={`button-photo-mode-${id}`} className={mode === id ? 'on' : ''} aria-pressed={mode === id} onClick={() => setMode(id)}>{l}</button>)}</div>
    {catalog.isLoading ? <div className="ps-grid">{[0, 1, 2, 3].map(i => <div key={i} className="ps-card ps-skel"/>)}</div>
      : catalog.isError ? <div className="ps-empty"><img src={mood('curious')} alt=""/><strong>Каталог не загрузился</strong><p>{meduhaErrorMessage(catalog.error)}</p><button className="ps-btn" onClick={() => catalog.refetch()}><RefreshCw size={14}/>Повторить</button></div>
      : shown.length === 0 ? <div className="ps-empty"><img src={mood('curious')} alt=""/><strong>Ничего не нашлось</strong><button className="ps-btn" onClick={() => { setQ(''); setMode('all'); }}>Сбросить</button></div>
      : <div className="ps-grid">{shown.map((m, i) => { const r = readiness(catalog.data, m); const b = m.schema.properties && (m.schema.properties as Schema).batch_size; return <a key={m.id} href={`${import.meta.env.BASE_URL.replace(/\/$/, '')}/create?type=photo&photoModel=${encodeURIComponent(m.id)}`} onClick={go(navigate, `/create?type=photo&photoModel=${encodeURIComponent(m.id)}`)} className="ps-card" data-testid={`card-photo-model-${m.id}`} style={{ animationDelay: `${Math.min(i, 10) * 30}ms` }}>
        <span className="ps-mono" aria-hidden="true">{m.name.replace(/[^A-Za-zА-я0-9 ]/g, '').split(' ').map(w => w[0]).join('').slice(0, 2)}</span>
        <span className="ps-card-body"><span className="ps-mode">{modeLabel(m)}</span><strong>{displayName(m)}</strong><small>{blurb(m)}</small><code className="ps-endpoint">{m.id}</code>
          <span className="ps-card-foot">{r.ok ? <span className="ps-price"><Zap size={11} fill="currentColor"/>{m.creditPrice}{b ? ' за фото' : ''}</span> : <span className="ps-off"><Lock size={10}/>{r.reason}</span>}</span></span>
      </a>; })}</div>}
    <p className="ps-foot-note">Схемы настроек взяты из официальных страниц Higgsfield Playground. Ссылки на источник есть на странице каждой модели.</p>
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
  const model = catalog.data?.models.find(m => m.id === catalogId);
  if (catalog.isLoading) return <Frame active="Create"><div className="ps-page"><div className="ps-card ps-skel" style={{ height: 120 }}/><div className="ps-card ps-skel" style={{ height: 260, marginTop: 12 }}/></div></Frame>;
  if (catalog.isError || !model) return <Frame active="Create"><div className="ps-page"><div className="ps-empty"><img src={mood('curious')} alt=""/><strong>{catalog.isError ? 'Каталог не загрузился' : 'Модель не найдена'}</strong><p>{catalog.isError ? meduhaErrorMessage(catalog.error) : 'Возможно, она убрана из каталога.'}</p>{catalog.isError && <button className="ps-btn" onClick={() => catalog.refetch()}><RefreshCw size={14}/>Повторить</button>}<Link className="ps-btn" href="/create?type=photo">К каталогу</Link></div></div></Frame>;
  return <ModelForm key={model.id} model={model} catalog={catalog.data!} authed={authed} navigate={navigate}/>;
}

function ModelForm({ model, catalog, authed, navigate }: { model: PhotoCatalogModel; catalog: PhotoCatalog; authed: boolean; navigate: (to: string) => void }) {
  const schema = model.schema as Schema;
  const qc = useQueryClient();
  const { toast, notify } = useToast();
  const stored = useMemo(() => loadStored(model.id), [model.id]);
  const lockedDefaults = useMemo(() => { const d = defaults(schema); const out: Record<string, unknown> = {}; if (model.workflow) { for (const k of LOCKED_WORKFLOW) if (schema.properties?.[k]) out[k] = k === 'enhance_prompt' ? true : k === 'quality' ? 'high' : d[k]; } if (model.id === 'higgsfield-ai/soul/v2/image-to-image' && schema.properties?.enhance_prompt) out.enhance_prompt = true; return out; }, [schema, model.workflow, model.id]);
  const [params, setParams] = useState<Record<string, unknown>>(() => ({ ...defaults(schema), ...(stored?.params || {}), ...lockedDefaults }));
  const [json, setJson] = useState<Record<string, string>>(() => stored?.json || {});
  const [refs, setRefs] = useState<Record<string, Ref[]>>(() => stored?.refs || {});
  const [uploading, setUploading] = useState<Record<string, number>>({});
  const [touched, setTouched] = useState(false);
  const idem = useRef<{ fp: string; key: string } | null>(null);
  const create = useCreatePhotoGeneration({ request: mutateReq });

  useEffect(() => { try { localStorage.setItem(storeKey(model.id), JSON.stringify({ params, json, refs })); localStorage.setItem('meduha.photo.last', model.id); } catch { /* storage full */ } }, [params, json, refs, model.id]);

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
  const { field: batchField, n: batchN } = batchMultiplier(schema, values);
  const total = model.creditPrice != null ? model.creditPrice * batchN : null;

  const payloadParams: Record<string, unknown> = {};
  for (const k of fields) { if (FILE_KEYS.has(k)) continue; const v = values[k]; if (v !== undefined && v !== '') payloadParams[k] = v; }
  const references: Record<string, string[]> = {};
  for (const [k, list] of Object.entries(refs)) if (list.length && eff.props[k]) references[k] = list.map(r => r.id);
  const fp = JSON.stringify([model.id, payloadParams, references]);
  if (!idem.current || idem.current.fp !== fp) idem.current = { fp, key: uuid() };

  const invalid = Object.keys(errors).length > 0;
  const canSubmit = authed && ready.ok && !invalid && !busyUpload && !create.isPending;

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
    if (!canSubmit || !model.modelId || !idem.current) return;
    const key = idem.current.key;
    const data: PhotoGenerationInput = { idempotencyKey: key, modelId: model.modelId, catalogId: model.id, expectedCreditPrice: total!, parameters: payloadParams, references };
    create.mutate({ data }, {
      onSuccess: () => { notify('Генерация запущена. Результат появится ниже'); idem.current = { fp, key: uuid() }; qc.invalidateQueries({ queryKey: getListMeduhaGenerationsQueryKey() }); qc.invalidateQueries({ queryKey: getGetPhotoCatalogQueryKey() }); qc.invalidateQueries({ queryKey: getGetMeduhaBootstrapQueryKey() }); qc.invalidateQueries({ queryKey: getGetMeduhaWalletQueryKey() }); },
      onError: e => notify(`Не запустилось: ${meduhaErrorMessage(e)}. Повтор с теми же настройками не спишет дважды`),
    });
  };

  return <Frame active="Create"><div className="ps-page" data-testid={`page-photo-model-${model.id}`}>
    <a className="ps-back" href="/create?type=photo" onClick={go(navigate, '/create?type=photo')} data-testid="link-photo-catalogue"><ArrowLeft size={13}/>Все фотомодели</a>
    <div className="ps-model-head"><span className="ps-mono big" aria-hidden="true">{model.name.split(' ').map(w => w[0]).join('').slice(0, 2)}</span><div><span className="ps-mode">{modeLabel(model)}</span><h1>{displayName(model)}<span>.</span></h1><code className="ps-endpoint">{model.id}</code><p>{blurb(model)}</p><a className="ps-source" href={model.source} target="_blank" rel="noreferrer" data-testid="link-photo-source">Официальная страница<ExternalLink size={11}/></a></div></div>
    {!authed && <div className="ps-alert" data-testid="status-login-required"><Lock size={15}/><span><strong>Нужен вход через Telegram</strong>Открой студию из Telegram, чтобы загружать фото и запускать генерацию. Настройки можно смотреть и менять уже сейчас.</span></div>}
    {authed && !ready.ok && <div className="ps-alert muted" data-testid="status-model-unavailable"><Lock size={15}/><span><strong>Запуск пока недоступен</strong>{ready.reason}. Настройки сохраняются на этом устройстве.</span></div>}
    {model.workflow && schema.properties?.preset_id && <div className="ps-note">Сценарий использует официальный пресет и улучшение описания с высоким качеством — эти параметры зафиксированы.</div>}
    <div className="ps-form">{fields.map(k => <Field key={k} name={k} s={eff.props[k]} schema={schema} required={eff.required.has(k)} locked={k in lockedDefaults} value={values[k]} jsonText={json[k] ?? ''} error={touched || values[k] !== undefined || refs[k]?.length ? errors[k] : undefined} refs={refs[k] || []} uploading={uploading[k] || 0} authed={authed}
      onChange={v => setP(k, v)} onJson={t => setJson(j => ({ ...j, [k]: t }))}
      onFiles={(f, max, idx) => void addFiles(k, f, max, idx)} onRemove={i => setRefs(r => ({ ...r, [k]: (r[k] || []).filter((_, j) => j !== i) }))}/>)}</div>
    <div className="ps-submit">
      <div className="ps-cost" data-testid="text-photo-cost">{total != null ? <><Zap size={13} fill="currentColor"/><strong>{total}</strong> кредитов{batchField && batchN > 1 ? <small>{model.creditPrice} × {batchN} изображения</small> : <small>фиксированная цена модели</small>}</> : <small>Цена не указана — запуск недоступен</small>}</div>
      <button className="m-generate" data-testid="button-photo-generate" disabled={!canSubmit} onClick={submit}><Sparkles size={16}/>{create.isPending ? 'Отправляем…' : busyUpload ? 'Ждём загрузку фото…' : 'Создать'}</button>
      {touched && invalid && <p className="ps-err">Проверь отмеченные поля: {Object.keys(errors).map(k => fieldLabels[k] || k).join(', ')}</p>}
    </div>
    {authed && <PhotoJobs/>}
    {toast}
  </div></Frame>;
}
const FILE_KEYS = new Set(['image_url', 'image_urls', 'item_image_urls']);

function Field({ name, s, schema, required, locked, value, jsonText, error, refs, uploading, authed, onChange, onJson, onFiles, onRemove }: { name: string; s: Schema; schema: Schema; required: boolean; locked: boolean; value: unknown; jsonText: string; error?: string; refs: Ref[]; uploading: number; authed: boolean; onChange: (v: unknown) => void; onJson: (t: string) => void; onFiles: (f: FileList | null, max: number, idx?: number) => void; onRemove: (i: number) => void }) {
  const kind = fieldKind(name, s);
  const label = fieldLabels[name] || s.title || name;
  const input = useRef<HTMLInputElement>(null); const replaceAt = useRef<number | undefined>(undefined);
  const head = <div className="ps-label"><span>{label}{required && <b> *</b>}</span>{s.description && kind !== 'longtext' && <small>{s.description}</small>}</div>;
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
