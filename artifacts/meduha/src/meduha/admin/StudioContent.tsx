import { useMemo, useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { EyeOff, ImageUp, Pencil, RotateCcw, Search, ShieldAlert } from 'lucide-react';
import {
  getListAdminStudioContentQueryKey, getListStudioContentQueryKey, uploadAdminStudioContentMedia,
  useListAdminStudioContent, useSaveAdminStudioContent,
} from '@workspace/api-client-react';
import type { StudioContent } from '@workspace/api-client-react';
import { photoIdeas } from '../photo/ideas';
import { videoScenarios } from '../video/scenarios';
import previewManifest from '../photo/model-preview-media.json' with { type: 'json' };
import { photoIdeaCover, photoModelCover, videoScenarioCover } from '../scenarioCovers';
import { coverProblem, photoExampleKey, photoIdeaKey, resolveContentUrl, toContentMap, videoScenarioKey } from '../studioContent';
import { Empty, ErrorBox, Feedback, Modal, PageHead, Skeleton, Switch, adminQueryRequest, adminRequest, errStatus, errText, fmtDate, useFlash } from './ui';
import './studio-content.css';

type Kind = 'photo-idea' | 'video-scenario' | 'photo-example';
type Item = { key: string; kind: Kind; id: string; title: string; description: string; cover: string; note?: string };
const kindLabel: Record<Kind, string> = { 'photo-idea': 'Фотоидеи', 'video-scenario': 'Видеосценарии', 'photo-example': 'Примеры фотомоделей' };
const base = import.meta.env?.BASE_URL ?? '/';
const MAX_UPLOAD = 2 * 1024 * 1024;

type ManifestEntry = { source: string; image?: string; unavailable?: string };
const manifestModels = (previewManifest as { models: Record<string, ManifestEntry> }).models;

/** Defaults come from the existing catalogues only; nothing is invented. */
const defaults: Item[] = [
  ...photoIdeas.map(i => ({ key: photoIdeaKey(i.id), kind: 'photo-idea' as const, id: i.id, title: i.title, description: i.subtitle, cover: photoIdeaCover(i) })),
  ...videoScenarios.map(s => ({ key: videoScenarioKey(s.id), kind: 'video-scenario' as const, id: s.id, title: s.title, description: s.subtitle, cover: videoScenarioCover(s.id) })),
  ...Object.entries(manifestModels).map(([id, e]) => ({ key: photoExampleKey(id), kind: 'photo-example' as const, id, title: id, description: '', cover: photoModelCover(id), note: e.image ? undefined : 'нет исходного примера' })),
];

const shownCover = (url: string) => resolveContentUrl(url, base);

async function optimizeImage(file: File): Promise<Blob> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('Подходят только JPEG, PNG или WebP.');
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Браузер не смог обработать изображение.');
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/webp', 0.85));
    if (!blob || blob.type !== 'image/webp') throw new Error('Браузер не поддерживает сжатие в WebP. Открой пульт в другом браузере.');
    if (blob.size > MAX_UPLOAD) throw new Error('Даже после сжатия файл больше 2 МБ. Выбери изображение попроще.');
    return blob;
  } finally { bitmap.close(); }
}

function Editor({ item, row, onClose, onSaved, onConflict }: { item: Item; row?: StudioContent; onClose: () => void; onSaved: (saved: StudioContent) => void; onConflict: () => void }) {
  const qc = useQueryClient();
  const save = useSaveAdminStudioContent({ request: adminRequest });
  const [title, setTitle] = useState(row?.title ?? '');
  const [description, setDescription] = useState(row ? row.description : item.description);
  const [cover, setCover] = useState(row?.cover ?? '');
  const [enabled, setEnabled] = useState(row?.enabled ?? true);
  const [touched, setTouched] = useState(false);
  const [consent, setConsent] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const problem = coverProblem(cover);
  const busy = save.isPending || uploading;
  const conflict = errStatus(save.error) === 409;
  const preview = localPreview ?? (cover.trim() && !problem ? shownCover(cover.trim()) : item.cover);

  const upload = async (file?: File) => {
    if (!file || !consent) return;
    setUploading(true); setUploadError(null);
    try {
      const blob = await optimizeImage(file);
      const url = URL.createObjectURL(blob);
      setLocalPreview(old => { if (old) URL.revokeObjectURL(old); return url; });
      const res = await uploadAdminStudioContentMedia(blob, { ...adminRequest, headers: { ...adminRequest.headers, 'X-Media-Type': blob.type } });
      setCover(res.url);
    } catch (e) { setUploadError(e instanceof Error && errStatus(e) === undefined ? e.message : errText(e)); setLocalPreview(old => { if (old) URL.revokeObjectURL(old); return null; }); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ''; }
  };
  const close = () => { if (localPreview) URL.revokeObjectURL(localPreview); onClose(); };

  const submit = (e: FormEvent) => {
    e.preventDefault(); setTouched(true);
    if (problem || busy) return;
    save.mutate({ contentKey: encodeURIComponent(item.key), data: { title: title.trim() || item.title, description: description.trim(), cover: cover.trim() || null, enabled, revision: row?.revision ?? 0 } }, {
      onSuccess: saved => {
        qc.setQueryData<StudioContent[]>(getListAdminStudioContentQueryKey(), old => old ? [...old.filter(r => r.key !== saved.key), saved] : [saved]);
        void qc.invalidateQueries({ queryKey: getListAdminStudioContentQueryKey() });
        void qc.invalidateQueries({ queryKey: getListStudioContentQueryKey() });
        void qc.invalidateQueries({ predicate: q => String(q.queryKey[0]).startsWith('/api/meduha/admin/audit') });
        if (localPreview) URL.revokeObjectURL(localPreview);
        onSaved(saved);
      },
    });
  };

  return <Modal title={`${kindLabel[item.kind]} · ${item.id}`} onClose={close} busy={busy}>
    <form className="adm-form sc-editor" onSubmit={submit} noValidate>
      <div className="sc-editor-media">
        <img src={preview} alt="" data-testid="img-studio-content-preview"/>
        <small>{localPreview ? 'Загружено, ещё не сохранено' : cover.trim() ? 'Своя обложка' : 'Обложка по умолчанию'}</small>
      </div>
      <div className="adm-fields">
        <label className="adm-field full"><span>Название</span><input value={title} onChange={e => setTitle(e.target.value)} maxLength={120} placeholder={item.title} data-testid="input-studio-content-title"/><small>Пусто — «{item.title}».{item.kind === 'photo-example' && ' Видно только в карточке примера; название модели не меняется.'}</small></label>
        <label className="adm-field full"><span>Описание</span><textarea value={description} onChange={e => setDescription(e.target.value)} maxLength={500} placeholder={row ? 'Без описания' : item.description || 'Без описания'} data-testid="input-studio-content-description"/><small>Пустое описание сохраняется пустым. Промпт и настройки генерации не меняются.</small></label>
        <label className="adm-field full"><span>Адрес обложки</span><input className="mono" value={cover} onChange={e => { setCover(e.target.value); setLocalPreview(null); }} maxLength={2048} spellCheck={false} placeholder="пусто — обложка по умолчанию" aria-invalid={touched && Boolean(problem)} data-testid="input-studio-content-cover"/>
          <small>{problem ?? 'https://домен/…, /images/… или файл, загруженный ниже.'}</small></label>
      </div>
      <div className="sc-upload">
        <div className="sc-upload-warn"><ShieldAlert size={15}/><span>Загруженная обложка становится <strong>публичным файлом</strong>, доступным любому по ссылке. Используй только курированные изображения с правом на публикацию, не личные фото пользователей. Файл сжимается в браузере до 1200 px WebP.</span></div>
        <label className="adm-check"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} disabled={busy} data-testid="checkbox-studio-content-consent"/>Изображение можно публиковать</label>
        <div className="adm-actions">
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={e => void upload(e.target.files?.[0])} data-testid="input-studio-content-file"/>
          <button type="button" className="adm-btn sm" disabled={!consent || busy} onClick={() => fileRef.current?.click()} data-testid="button-studio-content-upload"><ImageUp size={13}/>{uploading ? 'Загружаем…' : 'Загрузить файл'}</button>
          <button type="button" className="adm-btn sm ghost" disabled={busy || (!cover && !localPreview)} onClick={() => { setCover(''); setLocalPreview(null); }} data-testid="button-studio-content-cover-reset"><RotateCcw size={13}/>Обложка по умолчанию</button>
        </div>
        {uploadError && <div className="adm-feedback bad" role="alert">{uploadError}</div>}
      </div>
      <div className="sc-toggle">
        <Switch checked={enabled} onChange={setEnabled} label="Показывать" disabled={busy}/>
        <span><strong>{enabled ? 'Показывается' : 'Скрыто'}</strong><small>{item.kind === 'photo-example' ? 'Скрытие убирает обложку и пример; модель остаётся доступной.' : 'Скрытие убирает из подборок, поиска и прямых ссылок. Генерация у провайдера не отключается, черновики сохраняются.'}</small></span>
      </div>
      {conflict ? <div className="adm-feedback bad" role="alert">Запись уже изменили в другом сеансе. Перезагрузи данные и внеси правку заново — перезаписи не будет.
        <div className="adm-actions" style={{ marginTop: 8 }}><button type="button" className="adm-btn sm" onClick={onConflict} data-testid="button-studio-content-reload">Перезагрузить</button></div></div>
        : <Feedback error={save.error}/>}
      <div className="adm-actions" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="adm-btn" onClick={close} disabled={busy}>Отмена</button>
        <button className="adm-btn primary" disabled={busy || conflict} data-testid="button-studio-content-save">{save.isPending ? 'Сохраняем…' : 'Сохранить'}</button>
      </div>
    </form>
  </Modal>;
}

export default function StudioContentSection() {
  const qc = useQueryClient();
  const list = useListAdminStudioContent({ request: { ...adminQueryRequest, cache: 'no-store' }, query: { queryKey: getListAdminStudioContentQueryKey(), staleTime: 0 } });
  const map = useMemo(() => toContentMap(list.data), [list.data]);
  const [kind, setKind] = useState<Kind>('photo-idea');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Item | null>(null);
  const { msg, flash } = useFlash();

  const term = q.trim().toLowerCase();
  const items = defaults.filter(i => i.kind === kind).filter(i => {
    if (!term) return true;
    const r = map.get(i.key);
    return `${i.id} ${i.title} ${i.description} ${r?.title ?? ''} ${r?.description ?? ''}`.toLowerCase().includes(term);
  });
  const counts = (k: Kind) => defaults.filter(i => i.kind === k && map.get(i.key)?.enabled === false).length;

  return <>
    <PageHead kicker="витрина" title="Контент студии">Названия, описания, обложки и видимость фотоидей, видеосценариев и примеров. Промпты, модели и цены не меняются.</PageHead>
    <Feedback ok={msg}/>
    <div className="sc-bar">
      <div className="adm-tabs" role="group" aria-label="Тип контента">{(Object.keys(kindLabel) as Kind[]).map(k => <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)} data-testid={`button-studio-kind-${k}`}>{kindLabel[k]}{counts(k) > 0 && <span className="sc-hidden-count">{counts(k)} скрыто</span>}</button>)}</div>
      <label className="sc-search"><Search size={14}/><input value={q} onChange={e => setQ(e.target.value)} placeholder="Найти по названию или ID" aria-label="Поиск" data-testid="input-studio-content-search"/></label>
    </div>
    {list.isLoading ? <Skeleton rows={7}/> : list.isError ? <ErrorBox error={list.error} onRetry={() => void list.refetch()}/> :
      items.length === 0 ? <Empty title="Ничего не найдено">Измени поиск или выбери другой тип.</Empty> :
      <ul className="sc-list">{items.map((item, i) => {
        const r = map.get(item.key);
        const off = r?.enabled === false;
        const cover = r?.cover ? shownCover(r.cover) : item.cover;
        return <li key={item.key} className={`sc-row${off ? ' off' : ''}`} style={{ animationDelay: `${Math.min(i, 12) * 22}ms` }} data-testid={`row-studio-content-${item.id}`}>
          <span className="sc-thumb"><img src={cover} alt="" loading="lazy"/>{off && <EyeOff size={16}/>}</span>
          <span className="sc-text">
            <strong>{r?.title.trim() || item.title}</strong>
            <small>{(r ? r.description.trim() : item.description) || 'Без описания'}</small>
            <span className="sc-meta"><code>{item.key}</code>{item.note && <em>{item.note}</em>}{r ? <em>изм. {fmtDate(r.updatedAt)} · ред. {r.revision}</em> : <em>по умолчанию</em>}{r?.cover && <em>своя обложка</em>}</span>
          </span>
          <span className={`sc-pill${off ? ' off' : ''}`}>{off ? 'Скрыто' : 'Показ'}</span>
          <button className="adm-btn sm" onClick={() => setEditing(item)} data-testid={`button-edit-studio-content-${item.id}`}><Pencil size={13}/>Изменить</button>
        </li>;
      })}</ul>}
    {editing && <Editor key={`${editing.key}:${map.get(editing.key)?.revision ?? 0}`} item={editing} row={map.get(editing.key)} onClose={() => setEditing(null)}
      onSaved={saved => { setEditing(null); flash(`Сохранено: ${saved.title.trim() || editing.title}${saved.enabled ? '' : ' (скрыто)'}`); }}
      onConflict={() => { setEditing(null); void qc.invalidateQueries({ queryKey: getListAdminStudioContentQueryKey() }).then(() => flash('Данные обновлены. Открой запись и повтори правку.')); }}/>}
  </>;
}
