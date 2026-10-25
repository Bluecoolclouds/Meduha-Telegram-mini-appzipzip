import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import {
  getHiggsfieldCatalog, getListAdminChannelsQueryKey, getListAdminModelsQueryKey, getGetAdminChannelQueryKey,
  useCreateAdminChannel, useCreateAdminModel, useDeleteAdminChannel, useDeleteAdminModel, useImportHiggsfieldCatalogModels, useListAdminChannels,
  useListAdminModels, useUpdateAdminChannel, useUpdateAdminModel,
} from '@workspace/api-client-react';
import type { AdminChannel, AdminModel, AdminModelInputKind, GenjutsuTariff, HiggsfieldCatalog, HiggsfieldCatalogEntry } from '@workspace/api-client-react';
import PricingTools from './PricingTools';
import { videoPolicyProblem } from './videoTariffs';
import { Confirm, Empty, ErrorBox, Feedback, Modal, PageHead, Panel, Skeleton, Switch, adminQueryRequest, adminRequest, asArray, fmtInt, useFlash } from './ui';

const req = { request: adminRequest };
const kinds: Record<AdminModelInputKind, string> = { photo: 'Фото', video: 'Видео', audio: 'Аудио' };
const intOk = (s: string, min: number, max = 2147483647) => /^\d+$/.test(s.trim()) && Number(s) >= min && Number(s) <= max;

function useInvalidateConfig() {
  const qc = useQueryClient();
  return (channelId?: string) => {
    void qc.invalidateQueries({ queryKey: getListAdminChannelsQueryKey() });
    void qc.invalidateQueries({ queryKey: getListAdminModelsQueryKey() });
    void qc.invalidateQueries({ predicate: q => String(q.queryKey[0]).startsWith('/api/meduha/admin/audit') });
    if (channelId) void qc.invalidateQueries({ queryKey: getGetAdminChannelQueryKey(channelId) });
  };
}

type ChannelDraft = { name: string; baseUrl: string; adapter: string; enabled: boolean; priority: string; concurrencyLimit: string; dailyCreditLimit: string };
function ChannelDialog({ channel, onClose, onDone }: { channel: AdminChannel | null; onClose: () => void; onDone: (m: string) => void }) {
  const invalidate = useInvalidateConfig();
  const [d, setD] = useState<ChannelDraft>(() => channel ? { name: channel.name, baseUrl: channel.baseUrl, adapter: channel.adapter, enabled: Boolean(channel.enabled), priority: String(channel.priority), concurrencyLimit: String(channel.concurrencyLimit), dailyCreditLimit: String(channel.dailyCreditLimit) } : { name: '', baseUrl: 'https://', adapter: '', enabled: false, priority: '100', concurrencyLimit: '1', dailyCreditLimit: '0' });
  const [touched, setTouched] = useState(false);
  const create = useCreateAdminChannel(req); const update = useUpdateAdminChannel(req);
  const m = channel ? update : create;
  const problems = [
    !d.name.trim() && 'Укажи название.', !/^https:\/\/\S+$/.test(d.baseUrl.trim()) && 'Адрес должен начинаться с https://.',
    !d.adapter.trim() && 'Укажи адаптер.', !intOk(d.priority, 0, 100000) && 'Приоритет: целое 0–100000.',
    !intOk(d.concurrencyLimit, 1, 10000) && 'Параллельность: целое 1–10000.', !intOk(d.dailyCreditLimit, 0) && 'Дневной лимит: целое от 0.',
  ].filter(Boolean) as string[];
  const submit = (e: FormEvent) => {
    e.preventDefault(); setTouched(true); if (problems.length) return;
    const body = { name: d.name.trim(), baseUrl: d.baseUrl.trim(), adapter: d.adapter.trim(), enabled: d.enabled, priority: Number(d.priority), concurrencyLimit: Number(d.concurrencyLimit), dailyCreditLimit: Number(d.dailyCreditLimit) };
    const done = () => { invalidate(channel?.id); onDone(channel ? 'Канал сохранён' : 'Канал создан'); onClose(); };
    if (channel) update.mutate({ channelId: channel.id, data: body }, { onSuccess: done });
    else create.mutate({ data: body }, { onSuccess: done });
  };
  const set = (k: keyof ChannelDraft) => (e: { target: { value: string } }) => setD(v => ({ ...v, [k]: e.target.value }));
  return <Modal title={channel ? 'Изменить канал' : 'Новый канал'} onClose={onClose} busy={m.isPending}>
    <form className="adm-form" onSubmit={submit} noValidate>
      <div className="adm-fields">
        <label className="adm-field"><span>Название</span><input value={d.name} onChange={set('name')} maxLength={100} data-testid="input-channel-name" /></label>
        <label className="adm-field"><span>Адаптер</span><input value={d.adapter} onChange={set('adapter')} maxLength={80} placeholder="openai-compatible" data-testid="input-channel-adapter" /></label>
        <label className="adm-field full"><span>Базовый адрес</span><input value={d.baseUrl} onChange={set('baseUrl')} inputMode="url" data-testid="input-channel-url" /><small>Только https. Ключи и секреты здесь не хранятся.</small></label>
        <label className="adm-field"><span>Приоритет</span><input type="number" min={0} max={100000} value={d.priority} onChange={set('priority')} data-testid="input-channel-priority" /></label>
        <label className="adm-field"><span>Параллельных задач</span><input type="number" min={1} max={10000} value={d.concurrencyLimit} onChange={set('concurrencyLimit')} data-testid="input-channel-concurrency" /></label>
        <label className="adm-field"><span>Дневной лимит, кредиты</span><input type="number" min={0} value={d.dailyCreditLimit} onChange={set('dailyCreditLimit')} data-testid="input-channel-limit" /><small>0 — без ёмкости, а не безлимит.</small></label>
        <label className="adm-check adm-field"><span style={{ display: 'flex', gap: 9, alignItems: 'center' }}><input type="checkbox" checked={d.enabled} onChange={e => setD(v => ({ ...v, enabled: e.target.checked }))} data-testid="checkbox-channel-enabled" />Включён в конфигурации</span><small>Подключение не проверяется, генерация не запускается.</small></label>
      </div>
      {touched && problems.length > 0 && <div className="adm-feedback bad" role="alert">{problems.join(' ')}</div>}
      <Feedback error={m.error} />
      <div className="adm-actions" style={{ justifyContent: 'flex-end' }}><button type="button" className="adm-btn" onClick={onClose} disabled={m.isPending}>Отмена</button><button className="adm-btn primary" disabled={m.isPending} data-testid="button-channel-save">{m.isPending ? 'Сохраняем…' : m.error ? 'Повторить' : 'Сохранить'}</button></div>
    </form>
  </Modal>;
}

type ModelDraft = { channelId: string; upstreamId: string; displayName: string; kind: AdminModelInputKind; enabled: boolean; creditPrice: string; estimatedCost: string; limits: string; genjutsuPricing: string };
const limitsToText = (l: unknown) => l && typeof l === 'object' ? Object.entries(l as Record<string, unknown>).map(([k, v]) => `${k}=${v}`).join('\n') : '';
const genjutsuPricingToText = (tariffs?: GenjutsuTariff[]) => (tariffs ?? [])
  .map(t => `${t.scenario},${t.resolution},${t.duration}=${t.creditPrice}`).join('\n');
const genjutsuScenarioByUpstream: Record<string, GenjutsuTariff['scenario']> = {
  'higgsfield/genjutsu/motion-transfer/v1.0': 'genjutsu',
  'higgsfield/genjutsu/object-swap/v1.0': 'object-swap',
  'higgsfield/genjutsu/restyle/v1.0': 'restyle',
};
function parseGenjutsuPricing(s: string): GenjutsuTariff[] | string {
  const tariffs: GenjutsuTariff[] = [];
  const seen = new Set<string>();
  for (const raw of s.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const match = /^(genjutsu|object-swap|restyle),(480p|720p|1080p),(\d{1,2})=(\d+)$/.exec(line);
    if (!match) return `Строка «${line}» должна быть в формате сценарий,качество,секунды=кредиты.`;
    const duration = Number(match[3]); const creditPrice = Number(match[4]);
    if (duration < 4 || duration > 30) return `В строке «${line}» длительность должна быть от 4 до 30 секунд.`;
    if (creditPrice < 1 || creditPrice > 2147483647) return `В строке «${line}» цена должна быть целым числом от 1.`;
    const key = `${match[1]}:${match[2]}:${duration}`;
    if (seen.has(key)) return `Сочетание «${match[1]},${match[2]},${duration}» указано дважды.`;
    seen.add(key);
    tariffs.push({ scenario: match[1] as GenjutsuTariff['scenario'], resolution: match[2] as GenjutsuTariff['resolution'], duration, creditPrice });
  }
  return tariffs;
}
function parseLimits(s: string): Record<string, number> | string {
  const out: Record<string, number> = {};
  for (const raw of s.split('\n')) {
    const line = raw.trim(); if (!line) continue;
    const m = /^([A-Za-z0-9_.-]{1,60})\s*=\s*(-?\d+(?:\.\d+)?)$/.exec(line);
    if (!m) return `Строка «${line}» не в формате ключ=число.`;
    out[m[1]] = Number(m[2]);
  }
  return out;
}
function renderHiggsfieldParameter(parameter: HiggsfieldCatalogEntry['parameters'][number]) {
  const bounds = [
    parameter.minimum !== undefined ? `от ${parameter.minimum}` : '',
    parameter.maximum !== undefined ? `до ${parameter.maximum}` : '',
    parameter.minLength !== undefined ? `мин. длина ${parameter.minLength}` : '',
    parameter.maxLength !== undefined ? `макс. длина ${parameter.maxLength}` : '',
  ].filter(Boolean).join(' · ');
  return <li key={parameter.name}>
    <span className="mono">{parameter.name}</span> · {parameter.type}{parameter.required ? ' · обязательно' : ''}
    {parameter.defaultValue !== undefined && <> · по умолчанию: <span className="mono">{String(parameter.defaultValue)}</span></>}
    {parameter.allowedValues && <> · варианты: {parameter.allowedValues.map(String).join(', ')}</>}
    {bounds && <> · {bounds}</>}
    {parameter.format && <> · формат: {parameter.format}</>}
    {parameter.description && <small className="adm-catalog-description">{parameter.description}</small>}
  </li>;
}

function ModelDialog({ model, channels, onClose, onDone }: { model: AdminModel | null; channels: AdminChannel[]; onClose: () => void; onDone: (m: string) => void }) {
  const invalidate = useInvalidateConfig();
  const [d, setD] = useState<ModelDraft>(() => model ? { channelId: model.channelId, upstreamId: model.upstreamId, displayName: model.displayName, kind: model.kind, enabled: Boolean(model.enabled), creditPrice: String(model.creditPrice), estimatedCost: model.estimatedCost == null ? '' : String(model.estimatedCost), limits: limitsToText(model.limits), genjutsuPricing: genjutsuPricingToText(model.genjutsuPricing) } : { channelId: channels[0]?.id ?? '', upstreamId: '', displayName: '', kind: 'photo', enabled: false, creditPrice: '0', estimatedCost: '', limits: '', genjutsuPricing: '' });
  const [touched, setTouched] = useState(false);
  const create = useCreateAdminModel(req); const update = useUpdateAdminModel(req); const m = model ? update : create;
  const limits = parseLimits(d.limits);
  const genjutsuPricing = parseGenjutsuPricing(d.genjutsuPricing);
  const expectedGenjutsuScenario = genjutsuScenarioByUpstream[d.upstreamId.trim()];
  const selectedChannel = channels.find(channel => channel.id === d.channelId);
  const problems = [
    videoPolicyProblem(d.upstreamId.trim(), limits),
    !d.channelId && 'Выбери канал.', !d.upstreamId.trim() && 'Укажи идентификатор модели у провайдера.', !d.displayName.trim() && 'Укажи отображаемое имя.',
    !intOk(d.creditPrice, 0) && 'Цена: целое число кредитов от 0.', d.estimatedCost.trim() !== '' && !intOk(d.estimatedCost, 0) && 'Оценка себестоимости: целое число от 0.',
    typeof limits === 'string' && limits,
    typeof genjutsuPricing === 'string' && genjutsuPricing,
    typeof genjutsuPricing !== 'string' && genjutsuPricing.length > 0
      && (!expectedGenjutsuScenario || genjutsuPricing.some(tariff => tariff.scenario !== expectedGenjutsuScenario)
        || selectedChannel?.adapter !== 'higgsfield')
      && 'Сценарий тарифа должен совпадать с endpoint модели в канале Higgsfield.',
  ].filter(Boolean) as string[];
  const submit = (e: FormEvent) => {
    e.preventDefault(); setTouched(true); if (problems.length || typeof limits === 'string' || typeof genjutsuPricing === 'string') return;
    const body = { channelId: d.channelId, upstreamId: d.upstreamId.trim(), displayName: d.displayName.trim(), kind: d.kind, enabled: d.enabled, creditPrice: Number(d.creditPrice), genjutsuPricing, estimatedCost: d.estimatedCost.trim() === '' ? null : Number(d.estimatedCost), limits };
    const done = () => { invalidate(); onDone(model ? 'Модель сохранена' : 'Модель создана'); onClose(); };
    if (model) update.mutate({ modelId: model.id, data: body }, { onSuccess: done }); else create.mutate({ data: body }, { onSuccess: done });
  };
  const set = (k: keyof ModelDraft) => (e: { target: { value: string } }) => setD(v => ({ ...v, [k]: e.target.value }));
  return <Modal title={model ? 'Изменить модель' : 'Новая модель'} onClose={onClose} busy={m.isPending}>
    <form className="adm-form" onSubmit={submit} noValidate>
      <div className="adm-fields">
        <label className="adm-field"><span>Канал</span><select value={d.channelId} onChange={set('channelId')} data-testid="select-model-channel">{!channels.some(c => c.id === d.channelId) && <option value={d.channelId}>{d.channelId ? 'Неизвестный канал' : 'Выбери канал'}</option>}{channels.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label className="adm-field"><span>Тип</span><select value={d.kind} onChange={set('kind')} data-testid="select-model-kind">{(Object.keys(kinds) as AdminModelInputKind[]).map(k => <option key={k} value={k}>{kinds[k]}</option>)}</select></label>
        <label className="adm-field"><span>Отображаемое имя</span><input value={d.displayName} onChange={set('displayName')} maxLength={120} data-testid="input-model-name" /></label>
        <label className="adm-field"><span>ID у провайдера</span><input className="mono" value={d.upstreamId} onChange={set('upstreamId')} maxLength={200} data-testid="input-model-upstream" /></label>
        <label className="adm-field"><span>Фиксированная цена, кредиты</span><input type="number" min={0} value={d.creditPrice} onChange={set('creditPrice')} data-testid="input-model-price" /><small>Используется для Genjutsu, только если список тарифов ниже пуст.</small></label>
        <label className="adm-field full"><span>Тарифы Genjutsu по длительности</span><textarea className="mono" value={d.genjutsuPricing} onChange={set('genjutsuPricing')} placeholder={'genjutsu,720p,8=24\nobject-swap,1080p,12=40'} data-testid="input-model-genjutsu-pricing" /><small>По одной строке: сценарий,качество,секунды=кредиты. Длительность — проверенная сервером и округлённая вверх, максимум 30 секунд. Если список пуст, для любой поддержанной комбинации используется указанная выше фиксированная цена. Заполненные тарифы не включают модель или расходование.</small></label>
        <label className="adm-field"><span>Оценка себестоимости</span><input type="number" min={0} step={1} inputMode="numeric" value={d.estimatedCost} onChange={set('estimatedCost')} placeholder="не указана" data-testid="input-model-cost" /><small>Справочное целое значение в единицах провайдера. Не рубли и не доллары, ничего не списывает.</small></label>
        <label className="adm-field full"><span>Лимиты и параметры цены</span><textarea className="mono" value={d.limits} onChange={set('limits')} placeholder={'concurrencyLimit=2\ndailyCreditLimit=500'} data-testid="input-model-limits" /><small>По одному на строку: ключ=число. concurrencyLimit и dailyCreditLimit ограничивают расход. Для Seedance 2.5 videoCreditsPerUsd задаёт курс кредитов, videoMaxUsd — предел одной сметы в USD. Оба параметра цены заполняются вместе; они не включают списания. Другие ключи остаются метаданными.</small></label>
        <label className="adm-check"><input type="checkbox" checked={d.enabled} onChange={e => setD(v => ({ ...v, enabled: e.target.checked }))} data-testid="checkbox-model-enabled" />Включена в конфигурации</label>
      </div>
      {d.kind === 'video' && selectedChannel?.adapter === 'higgsfield' && <PricingTools key={d.upstreamId} upstreamId={d.upstreamId.trim()} limits={limits} tariffs={genjutsuPricing} scenario={expectedGenjutsuScenario}
        onLimits={next => setD(value => ({ ...value, limits: limitsToText(next) }))}
        onTariffs={next => setD(value => ({ ...value, genjutsuPricing: genjutsuPricingToText(next) }))}/>}
      {touched && problems.length > 0 && <div className="adm-feedback bad" role="alert">{problems.join(' ')}</div>}
      <Feedback error={m.error} />
      <div className="adm-actions" style={{ justifyContent: 'flex-end' }}><button type="button" className="adm-btn" onClick={onClose} disabled={m.isPending}>Отмена</button><button className="adm-btn primary" disabled={m.isPending} data-testid="button-model-save">{m.isPending ? 'Сохраняем…' : m.error ? 'Повторить' : 'Сохранить'}</button></div>
    </form>
  </Modal>;
}

function HiggsfieldCatalogPanel({ channel, models, onImported }: { channel: AdminChannel; models: AdminModel[]; onImported: (message: string) => void }) {
  const [catalog, setCatalog] = useState<HiggsfieldCatalog | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const importModels = useImportHiggsfieldCatalogModels({ request: adminRequest });
  const configuredIds = new Set(models.map(model => model.upstreamId));

  const refresh = async () => {
    setLoading(true);
    setLoadError('');
    try {
      const next = await getHiggsfieldCatalog({ ...adminRequest, cache: 'no-store' });
      setCatalog(next);
      setSelected([]);
    } catch {
      setLoadError('Не удалось получить официальный каталог Higgsfield. Проверь доступ к документации и повтори обновление.');
    } finally {
      setLoading(false);
    }
  };
  const toggleSelected = (id: string) => setSelected(value => value.includes(id) ? value.filter(item => item !== id) : [...value, id]);
  const filtered = (catalog?.entries ?? []).filter(entry => `${entry.displayName} ${entry.endpointId} ${entry.category}`.toLowerCase().includes(filter.toLowerCase()));
  const importSelected = () => {
    if (!catalog || catalog.status === 'stale' || selected.length === 0) return;
    importModels.mutate({ data: { channelId: channel.id, endpointIds: selected } }, {
      onSuccess: result => {
        onImported(`Добавлено моделей: ${result.imported.length}; обновлена схема у существующих: ${result.updated.length}; без изменений: ${result.skipped.length - result.updated.length}. Новые модели выключены; настройки тарифа и лимитов сохранены.`);
        setSelected([]);
      },
    });
  };
  return <Panel title="Каталог Higgsfield" meta={catalog ? `${catalog.entries.length} подтверждённых endpoint ID` : undefined}
    actions={<button className="adm-btn sm" onClick={() => void refresh()} disabled={loading || importModels.isPending} data-testid="button-higgsfield-catalog-refresh">{loading ? 'Обновляем…' : 'Обновить каталог'}</button>}>
    <div className="adm-panel-body adm-catalog">
      <p className="sub">Официального read-only API для обнаружения моделей в документации Higgsfield нет. Здесь показаны модели и параметры из публичных официальных API Reference; доступность для вашего аккаунта не проверяется. Обновление не запускает генерацию.</p>
      {loadError && <div className="adm-feedback bad" role="alert">{loadError}</div>}
      {catalog && <div className={`adm-feedback ${catalog.status === 'live' ? 'ok' : 'bad'}`} role="status">
        {catalog.status === 'live' ? 'Каталог успешно обновлён.' : catalog.status === 'partial' ? 'Каталог частичный: часть workflow не удалось подтвердить как импортируемые модели.' : 'Источник сейчас недоступен; показан сохранённый снимок. Импорт отключён.'}
        {' '}Обновлено: {new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(catalog.refreshedAt))}.
        {catalog.warnings.map(warning => <div key={warning}>{warning}</div>)}
      </div>}
      <Feedback error={importModels.error} />
      {!catalog && !loading && !loadError && <Empty title="Каталог ещё не загружен">Нажми «Обновить каталог», чтобы получить текущие официальные страницы и схемы.</Empty>}
      {catalog && <>
        <div className="adm-catalog-toolbar">
          <input aria-label="Поиск по каталогу" placeholder="Найти модель или endpoint" value={filter} onChange={event => setFilter(event.target.value)} />
          <span className="sub">{filtered.length} из {catalog.entries.length}</span>
        </div>
        {catalog.entries.length > 0 && <p className="sub">Источник: {catalog.sourceUrls.map((url, index) => <span key={url}>{index > 0 && ' · '}<a href={url.replace(/\.md$/, '')} target="_blank" rel="noreferrer">официальный {index === 0 ? 'видео' : 'фото'}-каталог</a></span>)}</p>}
        <div className="adm-catalog-list">
          {filtered.map(entry => {
            const exists = configuredIds.has(entry.endpointId);
            return <details className="adm-catalog-entry" key={entry.endpointId} data-testid={`higgsfield-catalog-entry-${entry.endpointId}`}>
              <summary>
                <input type="checkbox" aria-label={`${exists ? 'Обновить схему' : 'Выбрать'} ${entry.displayName}`} checked={selected.includes(entry.endpointId)} disabled={catalog.status === 'stale' || importModels.isPending} onClick={event => event.stopPropagation()} onChange={() => toggleSelected(entry.endpointId)} />
                <span><strong>{entry.displayName}</strong><small className="mono">{entry.endpointId}</small></span>
                <small>{kinds[entry.kind]}{exists ? ' · уже настроена; можно обновить схему' : ''}</small>
              </summary>
              <div className="adm-catalog-detail">
                <p>{entry.category} · <a href={entry.docsUrl.replace(/\.md$/, '')} target="_blank" rel="noreferrer">официальная схема</a></p>
                <p className="mono">{entry.endpointUrl}</p>
                {entry.schemaAvailable ? <ul>{entry.parameters.map(renderHiggsfieldParameter)}</ul> : <p className="sub">Схема параметров не опубликована или не удалось её прочитать. Проверь официальную страницу модели.</p>}
              </div>
            </details>;
          })}
        </div>
        {catalog.entries.length > 0 && <div className="adm-actions adm-catalog-actions">
          <span className="sub">{selected.length} выбрано · новые модели будут выключены; у существующих обновится только схема</span>
          <button className="adm-btn primary sm" onClick={importSelected} disabled={selected.length === 0 || catalog.status === 'stale' || importModels.isPending} data-testid="button-higgsfield-catalog-import">
            {importModels.isPending ? 'Обновляем…' : 'Импортировать / обновить схему'}
          </button>
        </div>}
      </>}
    </div>
  </Panel>;
}

export default function ConfigSection() {
  const channelsQ = useListAdminChannels({ request: adminQueryRequest });
  const modelsQ = useListAdminModels({ request: adminQueryRequest });
  const channels = asArray<AdminChannel>(channelsQ.data); const models = asArray<AdminModel>(modelsQ.data);
  const [chDialog, setChDialog] = useState<AdminChannel | null | 'new'>(null);
  const [mdDialog, setMdDialog] = useState<AdminModel | null | 'new'>(null);
  const [delCh, setDelCh] = useState<AdminChannel | null>(null); const [delMd, setDelMd] = useState<AdminModel | null>(null);
  const { msg, flash } = useFlash(); const invalidate = useInvalidateConfig();
  const delChannel = useDeleteAdminChannel(req); const delModel = useDeleteAdminModel(req);
  const updChannel = useUpdateAdminChannel(req); const updModel = useUpdateAdminModel(req);
  const [toggleErr, setToggleErr] = useState<unknown>(null);
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const selectedChannel = channels.find(c => c.id === selectedChannelId);
  const channelModels = models.filter(m => m.channelId === selectedChannelId);
  const toggleChannel = (c: AdminChannel, v: boolean) => { setToggleErr(null); updChannel.mutate({ channelId: c.id, data: { enabled: v } }, { onSuccess: () => { invalidate(c.id); flash(`Канал «${c.name}» ${v ? 'включён' : 'выключен'}`); }, onError: setToggleErr }); };
  const toggleModel = (x: AdminModel, v: boolean) => { setToggleErr(null); updModel.mutate({ modelId: x.id, data: { enabled: v } }, { onSuccess: () => { invalidate(); flash(`Модель «${x.displayName}» ${v ? 'включена' : 'выключена'}`); }, onError: setToggleErr }); };
  const chName = (id: string) => channels.find(c => c.id === id)?.name ?? 'неизвестный канал';
  return <div className="adm-section">
    <PageHead kicker="Конфигурация" title="Каналы и модели">Выбери канал, чтобы увидеть настроенные модели и, для Higgsfield, обновить официальный документированный каталог. Включение не запускает генерацию и не проверяет подключение.</PageHead>
    <Feedback ok={msg} error={toggleErr} />
    <div style={{ height: 12 }} />
    <div className="adm-channel-layout">
    <Panel title="Каналы" meta={channelsQ.data ? `${channels.length} в конфигурации` : undefined} actions={<button className="adm-btn primary sm" onClick={() => setChDialog('new')} data-testid="button-channel-new"><Plus size={14} />Канал</button>}>
      {channelsQ.isLoading ? <Skeleton rows={4} /> : channelsQ.isError ? <ErrorBox error={channelsQ.error} onRetry={() => void channelsQ.refetch()} /> : channels.length === 0 ? <Empty title="Каналов пока нет">Добавь первый канал: адрес, адаптер и лимиты. Он будет выключен, пока ты его явно не включишь.</Empty> :
        <div className="adm-table-wrap"><table className="adm-table"><thead><tr><th>Канал</th><th>Адаптер</th><th className="r">Приоритет</th><th className="r">Параллельно</th><th className="r">Лимит/день</th><th>Включён</th><th /></tr></thead><tbody>
          {channels.map(c => <tr key={c.id} className={selectedChannelId === c.id ? 'adm-channel-selected' : ''} data-testid={`row-channel-${c.id}`}><td><button className="adm-btn sm" aria-pressed={selectedChannelId === c.id} onClick={() => setSelectedChannelId(c.id)} data-testid={`button-channel-select-${c.id}`}>{c.name}</button><span className="sub mono adm-clip">{c.baseUrl}</span></td><td className="mono">{c.adapter}</td><td className="r num">{fmtInt(c.priority)}</td><td className="r num">{fmtInt(c.concurrencyLimit)}</td><td className="r num">{fmtInt(c.dailyCreditLimit)}</td>
            <td><Switch checked={Boolean(c.enabled)} label={`Включить канал ${c.name}`} disabled={updChannel.isPending} onChange={v => toggleChannel(c, v)} /></td>
            <td><div className="adm-actions"><button className="adm-btn sm" onClick={() => setChDialog(c)} data-testid={`button-channel-edit-${c.id}`}><Pencil size={12} />Изменить</button><button className="adm-btn sm danger" onClick={() => { delChannel.reset(); setDelCh(c); }} data-testid={`button-channel-delete-${c.id}`}><Trash2 size={12} /></button></div></td></tr>)}
        </tbody></table></div>}
    </Panel>
    <aside aria-label="Модели выбранного канала" aria-live="polite">
      <Panel title={selectedChannel ? `Модели · ${selectedChannel.name}` : 'Модели канала'} meta={selectedChannel ? `${channelModels.length} в проекте` : undefined}>
        <div className="adm-panel-body">
        {!selectedChannel ? <Empty title="Выбери канал">Нажми на название канала слева.</Empty> :
          modelsQ.isLoading ? <Skeleton rows={3} /> : modelsQ.isError ? <ErrorBox error={modelsQ.error} onRetry={() => void modelsQ.refetch()} /> :
          channelModels.length === 0 ? <Empty title="Нет настроенных моделей">Добавь модель и укажи этот канал.</Empty> :
          channelModels.map(model => <div key={model.id} className="adm-channel-model" data-testid={`channel-model-${model.id}`}>
            <strong>{model.displayName}</strong>
            <span className="mono sub">{model.upstreamId}</span>
            <p>{kinds[model.kind]} · {model.enabled ? 'Включена' : 'Выключена'}</p>
            {selectedChannel.adapter === 'higgsfield' && model.upstreamId === 'bytedance/seedance-2.5/text-to-video' && <p>4–30 сек · 480p / 720p / 1080p<br />16:9 · 4:3 · 1:1 · 3:4 · 9:16 · 21:9</p>}
            {selectedChannel.adapter.toLowerCase() === 'higgsfield' && model.providerSchemaUrl && <details className="adm-catalog-entry" data-testid={`saved-higgsfield-schema-${model.id}`}>
              <summary><strong>Сохранённая схема параметров</strong></summary>
              <div className="adm-catalog-detail">
                <p><a href={model.providerSchemaUrl.replace(/\.md$/, '')} target="_blank" rel="noreferrer">Официальный источник схемы</a></p>
                {model.providerSchema?.schemaAvailable
                  ? <ul>{model.providerSchema.parameters.map(renderHiggsfieldParameter)}</ul>
                  : <p className="sub">На официальной странице схема параметров не опубликована.</p>}
              </div>
            </details>}
            <button className="adm-btn sm" onClick={() => setMdDialog(model)}><Pencil size={12} />Настроить</button>
          </div>)}
        {selectedChannel?.adapter === 'higgsfield' && <p className="sub">Секрет хранится только на сервере. Тариф и лимиты настраиваются отдельно. Успешная SDK-проба не включает модель для пользователей.</p>}
        </div>
        {selectedChannel?.adapter.toLowerCase() === 'higgsfield' && <HiggsfieldCatalogPanel channel={selectedChannel} models={channelModels} onImported={message => { invalidate(); flash(message); }} />}
      </Panel>
    </aside>
    </div>
    <Panel title="Модели" meta={modelsQ.data ? `${models.length} в конфигурации` : undefined} actions={<button className="adm-btn primary sm" disabled={channels.length === 0} title={channels.length === 0 ? 'Сначала добавь канал' : undefined} onClick={() => setMdDialog('new')} data-testid="button-model-new"><Plus size={14} />Модель</button>}>
      {modelsQ.isLoading ? <Skeleton rows={4} /> : modelsQ.isError ? <ErrorBox error={modelsQ.error} onRetry={() => void modelsQ.refetch()} /> : models.length === 0 ? <Empty title="Моделей пока нет">{channels.length === 0 ? 'Модель привязывается к каналу — начни с канала.' : 'Добавь модель с ценой в кредитах и лимитами.'}</Empty> :
        <div className="adm-table-wrap"><table className="adm-table"><thead><tr><th>Модель</th><th>Тип</th><th>Канал</th><th className="r">Цена</th><th>Тариф Genjutsu</th><th className="r">Себест.</th><th>Лимиты</th><th>Включена</th><th /></tr></thead><tbody>
          {models.map(x => <tr key={x.id} data-testid={`row-model-${x.id}`}><td><strong>{x.displayName}</strong><span className="sub mono adm-clip">{x.upstreamId}</span></td><td>{kinds[x.kind] ?? x.kind}</td><td>{chName(x.channelId)}</td><td className="r num">{fmtInt(x.creditPrice)}</td><td>{x.genjutsuPricing?.length ? `${x.genjutsuPricing.length} сочетаний` : 'Фиксированная цена'}</td><td className="r num">{x.estimatedCost == null ? '—' : x.estimatedCost}</td>
            <td className="mono" style={{ fontSize: 11.5 }}>{limitsToText(x.limits).split('\n').filter(Boolean).map(l => <div key={l}>{l}</div>)}{!limitsToText(x.limits) && '—'}</td>
            <td><Switch checked={Boolean(x.enabled)} label={`Включить модель ${x.displayName}`} disabled={updModel.isPending} onChange={v => toggleModel(x, v)} /></td>
            <td><div className="adm-actions"><button className="adm-btn sm" onClick={() => setMdDialog(x)} data-testid={`button-model-edit-${x.id}`}><Pencil size={12} />Изменить</button><button className="adm-btn sm danger" onClick={() => { delModel.reset(); setDelMd(x); }} data-testid={`button-model-delete-${x.id}`}><Trash2 size={12} /></button></div></td></tr>)}
        </tbody></table></div>}
    </Panel>
    {chDialog && <ChannelDialog channel={chDialog === 'new' ? null : chDialog} onClose={() => setChDialog(null)} onDone={flash} />}
    {mdDialog && <ModelDialog model={mdDialog === 'new' ? null : mdDialog} channels={channels} onClose={() => setMdDialog(null)} onDone={flash} />}
    {delCh && <Confirm title="Удалить канал" danger confirmLabel="Удалить" pending={delChannel.isPending} error={delChannel.error} onClose={() => setDelCh(null)} onConfirm={() => delChannel.mutate({ channelId: delCh.id }, { onSuccess: () => { invalidate(); flash(`Канал «${delCh.name}» удалён`); setDelCh(null); } })}>
      <p style={{ margin: 0 }}>Канал <strong>{delCh.name}</strong> будет удалён из конфигурации. Если к нему привязаны модели, сервер может отклонить удаление.</p></Confirm>}
    {delMd && <Confirm title="Удалить модель" danger confirmLabel="Удалить" pending={delModel.isPending} error={delModel.error} onClose={() => setDelMd(null)} onConfirm={() => delModel.mutate({ modelId: delMd.id }, { onSuccess: () => { invalidate(); flash(`Модель «${delMd.displayName}» удалена`); setDelMd(null); } })}>
      <p style={{ margin: 0 }}>Модель <strong>{delMd.displayName}</strong> будет удалена из конфигурации.</p></Confirm>}
  </div>;
}
