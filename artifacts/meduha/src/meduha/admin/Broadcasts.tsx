import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ImagePlus, Plus, Send, TestTube2, Trash2, X } from 'lucide-react';
import { getListAdminBroadcastsQueryKey, uploadAdminBroadcastMedia, useActionAdminBroadcast, useCreateAdminBroadcast, useListAdminBroadcasts } from '@workspace/api-client-react';
import type { Broadcast, BroadcastButton } from '@workspace/api-client-react';
import { Confirm, Empty, ErrorBox, Feedback, PageHead, Panel, Skeleton, adminQueryRequest, adminRequest, fmtDate, fmtInt, useFlash } from './ui';
import './broadcasts.css';

const PHOTO_MAX = 10 * 1024 * 1024; const VIDEO_MAX = 50 * 1024 * 1024;
const statusText: Record<string, [string, string]> = { draft: ['Черновик', ''], queued: ['Идёт рассылка', 'sig'], completed: ['Завершена', 'ok'], canceled: ['Остановлена', 'bad'] };
const countLabels: [keyof Broadcast['counts'], string][] = [['pending', 'в очереди'], ['sending', 'отправляется'], ['sent', 'доставлено'], ['failed', 'ошибка'], ['unknown', 'неизвестно'], ['skipped', 'пропущено'], ['canceled', 'отменено']];
const fmtSize = (n: number) => `${(n / 1024 / 1024).toFixed(1)} МБ`;
const isHttps = (u: string) => { try { return new URL(u).protocol === 'https:'; } catch { return false; } };

type Media = { file: File; url: string; kind: 'photo' | 'video'; id: string | null };

function Preview({ text, buttons, media }: { text: string; buttons: BroadcastButton[]; media?: { kind: string; url?: string } | null }) {
  return <div className="bc-phone" data-testid="preview-broadcast">
    <div className="bc-bubble">
      {media && (media.url ? (media.kind === 'video' ? <video src={media.url} muted controls playsInline /> : <img src={media.url} alt="Предпросмотр вложения" />) : <div className="bc-media-ph">{media.kind === 'video' ? 'Видео' : 'Фото'}</div>)}
      <p>{text || <span className="bc-dim">Текст сообщения появится здесь</span>}</p>
    </div>
    {buttons.length > 0 && <div className="bc-kb">{buttons.map((b, i) => <span key={i} title={b.url}>{b.text || 'Кнопка'}{b.kind === 'web_app' && <small>Mini App</small>}</span>)}</div>}
  </div>;
}

function Composer({ disabled, onCreated }: { disabled: boolean; onCreated: (b: Broadcast) => void }) {
  const qc = useQueryClient();
  const create = useCreateAdminBroadcast({ request: adminRequest });
  const [title, setTitle] = useState(''); const [text, setText] = useState('');
  const [buttons, setButtons] = useState<BroadcastButton[]>([]);
  const [media, setMedia] = useState<Media | null>(null);
  const [uploading, setUploading] = useState(false); const [uploadErr, setUploadErr] = useState<unknown>(null);
  const fileRef = useRef<HTMLInputElement>(null); const urlRef = useRef<string | null>(null);
  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);
  const clearMedia = () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); urlRef.current = null; setMedia(null); setUploadErr(null); setUploading(false); if (fileRef.current) fileRef.current.value = ''; };

  const pick = async (file: File | undefined) => {
    clearMedia(); if (!file) return;
    const kind = file.type === 'video/mp4' ? 'video' : (file.type === 'image/jpeg' || file.type === 'image/png') ? 'photo' : null;
    if (!kind) { setUploadErr(new Error('Подходят только JPEG, PNG или MP4.')); return; }
    if (file.size > (kind === 'photo' ? PHOTO_MAX : VIDEO_MAX)) { setUploadErr(new Error(kind === 'photo' ? 'Фото больше 10 МБ.' : 'Видео больше 50 МБ.')); return; }
    const url = URL.createObjectURL(file); urlRef.current = url;
    setMedia({ file, url, kind, id: null }); setUploading(true);
    try {
      const res = await uploadAdminBroadcastMedia(file, { ...adminRequest, headers: { ...adminRequest.headers, 'X-Media-Type': file.type } });
      if (urlRef.current === url) setMedia(m => m && m.url === url ? { ...m, id: res.id } : m);
    } catch (e) { if (urlRef.current === url) setUploadErr(e); }
    finally { if (urlRef.current === url) setUploading(false); }
  };

  const limit = media ? 1024 : 4096;
  const btnErrors = buttons.map(b => !b.text.trim() ? 'Нет подписи' : b.text.length > 64 ? 'Подпись длиннее 64' : !isHttps(b.url.trim()) ? 'Нужна ссылка https://' : null);
  const problems = [!title.trim() && 'Название', !text.trim() && 'Текст', text.length > limit && `Текст длиннее ${limit}`, btnErrors.some(Boolean) && 'Кнопки', media && !media.id && 'Вложение не загружено'].filter(Boolean) as string[];
  const canSave = !disabled && !uploading && !create.isPending && problems.length === 0;

  const reset = () => { setTitle(''); setText(''); setButtons([]); clearMedia(); create.reset(); };
  const save = () => {
    if (!canSave) return;
    create.mutate({ data: { title: title.trim(), text, mediaId: media?.id ?? null, buttons: buttons.map(b => ({ text: b.text.trim(), url: b.url.trim(), kind: b.kind })) } }, {
      onSuccess: b => { void qc.invalidateQueries({ queryKey: getListAdminBroadcastsQueryKey() }); reset(); onCreated(b); },
    });
  };
  const setBtn = (i: number, patch: Partial<BroadcastButton>) => setButtons(bs => bs.map((b, j) => j === i ? { ...b, ...patch } : b));

  return <Panel title="Новый черновик" meta="Сохранённый черновик не меняется. Чтобы поправить, создай новый.">
    <div className="bc-compose">
      <div className="adm-form bc-form">
        <label className="adm-field"><span>Название (видно только в пульте)</span>
          <input value={title} onChange={e => setTitle(e.target.value)} maxLength={100} data-testid="input-broadcast-title" /></label>
        <label className="adm-field"><span>Текст, без форматирования</span>
          <textarea rows={7} value={text} onChange={e => setText(e.target.value)} maxLength={4096} data-testid="input-broadcast-text" />
          <small className={text.length > limit ? 'bc-over' : ''}>{text.length}/{limit}{media ? ' — лимит подписи к медиа' : ''}</small></label>
        <div className="adm-field"><span>Вложение: JPEG/PNG до 10 МБ или MP4 до 50 МБ</span>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,video/mp4" hidden onChange={e => void pick(e.target.files?.[0])} data-testid="input-broadcast-file" />
          {media ? <div className="bc-file"><span className="mono">{media.file.name}</span><span>{fmtSize(media.file.size)}</span>
            <span className={`adm-tag ${media.id ? 'ok' : uploadErr ? 'bad' : 'warn'}`}>{media.id ? 'загружено' : uploadErr ? 'ошибка' : 'загрузка…'}</span>
            <button type="button" className="adm-btn ghost sm" onClick={clearMedia} aria-label="Убрать вложение" data-testid="button-media-remove"><X size={14} /></button></div>
            : <button type="button" className="adm-btn sm" onClick={() => fileRef.current?.click()} disabled={disabled} data-testid="button-media-pick"><ImagePlus size={14} />Выбрать файл</button>}
          <Feedback error={uploadErr} />
        </div>
        <div className="adm-field"><span>Кнопки ({buttons.length}/6), только HTTPS</span>
          {buttons.map((b, i) => <div className="bc-btnrow" key={i}>
            <input placeholder="Подпись" value={b.text} maxLength={64} onChange={e => setBtn(i, { text: e.target.value })} data-testid={`input-button-text-${i}`} />
            <input placeholder="https://" value={b.url} onChange={e => setBtn(i, { url: e.target.value })} aria-invalid={Boolean(btnErrors[i])} data-testid={`input-button-url-${i}`} />
            <select value={b.kind} onChange={e => setBtn(i, { kind: e.target.value as BroadcastButton['kind'] })} data-testid={`select-button-kind-${i}`}><option value="url">Ссылка</option><option value="web_app">Mini App</option></select>
            <button type="button" className="adm-btn ghost sm" onClick={() => setButtons(bs => bs.filter((_, j) => j !== i))} aria-label="Удалить кнопку" data-testid={`button-button-remove-${i}`}><Trash2 size={14} /></button>
            {btnErrors[i] && <small className="bc-over">{btnErrors[i]}</small>}
          </div>)}
          {buttons.length < 6 && <button type="button" className="adm-btn sm" onClick={() => setButtons(bs => [...bs, { text: '', url: 'https://', kind: 'url' }])} data-testid="button-add-button"><Plus size={14} />Добавить кнопку</button>}
        </div>
        <Feedback error={create.error} />
        <div className="adm-actions">
          <button className="adm-btn primary" disabled={!canSave} onClick={save} data-testid="button-broadcast-save">{create.isPending ? 'Сохраняем…' : 'Сохранить черновик'}</button>
          <button className="adm-btn ghost" onClick={reset} disabled={create.isPending} data-testid="button-broadcast-reset">Очистить</button>
          {problems.length > 0 && (title || text) && <small className="bc-dim">Не готово: {problems.join(', ')}</small>}
        </div>
      </div>
      <div><span className="adm-kicker">Так увидит подписчик</span><Preview text={text} buttons={buttons} media={media ? { kind: media.kind, url: media.url } : null} /></div>
    </div>
  </Panel>;
}

function Card({ b, eligible, botConfigured, highlight }: { b: Broadcast; eligible: number; botConfigured: boolean; highlight: boolean }) {
  const qc = useQueryClient(); const { msg, flash } = useFlash();
  const action = useActionAdminBroadcast({ request: adminRequest });
  const [chatId, setChatId] = useState(''); const [ask, setAsk] = useState<'send' | 'cancel' | null>(null);
  const validChat = /^[1-9][0-9]{0,15}$/.test(chatId.trim());
  const [s, cls] = statusText[b.status] ?? [b.status, ''];
  const total = countLabels.reduce((n, [k]) => n + (b.counts[k] ?? 0), 0);
  const run = (kind: 'test' | 'send' | 'cancel') => action.mutate({ id: b.id, action: kind, data: kind === 'test' ? { chatId: chatId.trim() } : kind === 'send' ? { confirm: b.id } : {} }, {
    onSuccess: () => { void qc.invalidateQueries({ queryKey: getListAdminBroadcastsQueryKey() }); setAsk(null); flash(kind === 'test' ? 'Тест отправлен. Проверь сообщение в Telegram.' : kind === 'send' ? 'Рассылка поставлена в очередь.' : 'Рассылка остановлена.'); },
  });
  const open = (k: 'send' | 'cancel') => { action.reset(); setAsk(k); };
  return <article className={`bc-card${highlight ? ' fresh' : ''}`} data-testid={`card-broadcast-${b.id}`}>
    <header><div><h3>{b.title}</h3><small className="bc-dim">{fmtDate(b.createdAt)}{b.testedAt ? ` · тест ${fmtDate(b.testedAt)}` : ' · без теста'}</small></div>
      <span className={`adm-tag ${cls}`} data-testid={`status-broadcast-${b.id}`}>{s}</span></header>
    <div className="bc-card-body">
      <Preview text={b.text} buttons={b.buttons} media={b.mediaKind ? { kind: b.mediaKind } : null} />
      <div className="bc-ops">
        {b.status === 'draft' && <>
          <label className="adm-field"><span>Тест в свой личный чат (числовой chat ID)</span>
            <div className="bc-inline"><input className="mono" inputMode="numeric" value={chatId} onChange={e => setChatId(e.target.value.replace(/\D/g, ''))} maxLength={16} placeholder="например 123456789" disabled={!botConfigured} data-testid={`input-test-chat-${b.id}`} />
              <button className="adm-btn sm" disabled={!botConfigured || !validChat || action.isPending} onClick={() => run('test')} data-testid={`button-test-${b.id}`}><TestTube2 size={14} />{action.isPending && action.variables?.action === 'test' ? 'Шлём…' : 'Тест'}</button></div>
            <small>Свой ID можно узнать в Mini App: Профиль, «Telegram ID». Чат должен быть открыт с ботом через /start.</small></label>
          <button className="adm-btn primary" disabled={!botConfigured || !b.testedAt || action.isPending} onClick={() => open('send')} title={!b.testedAt ? 'Сначала успешный тест' : undefined} data-testid={`button-send-${b.id}`}><Send size={14} />Разослать</button>
          {!b.testedAt && <small className="bc-dim">Отправка откроется после успешного теста.</small>}
        </>}
        {b.status !== 'draft' && <div className="bc-counts" data-testid={`counts-broadcast-${b.id}`}>
          {total > 0 && <div className="bc-bar">{countLabels.map(([k]) => b.counts[k] > 0 && <i key={k} className={`c-${k}`} style={{ flexGrow: b.counts[k] }} />)}</div>}
          <dl>{countLabels.map(([k, l]) => <div key={k} className={`c-${k}`}><dt>{l}</dt><dd className="num">{fmtInt(b.counts[k])}</dd></div>)}</dl>
          {b.counts.unknown > 0 && <small className="bc-dim">«Неизвестно» — Telegram не подтвердил доставку. Такие сообщения не повторяются автоматически, чтобы не прислать дубль.</small>}
        </div>}
        {b.status === 'queued' && <button className="adm-btn danger" disabled={action.isPending} onClick={() => open('cancel')} data-testid={`button-cancel-${b.id}`}>Остановить</button>}
        {!ask && <Feedback ok={msg} error={action.error} />}
      </div>
    </div>
    {ask === 'send' && <Confirm title="Запустить рассылку" confirmLabel={`Отправить ${fmtInt(eligible)}`} pending={action.isPending} error={action.error} onConfirm={() => run('send')} onClose={() => setAsk(null)}>
      <p>«{b.title}» получат <strong className="num" data-testid="text-confirm-audience">{fmtInt(eligible)}</strong> подписчиков — тех, кто нажал /start и /subscribe и не отключил уведомления.</p>
      <p className="bc-dim">Отменить уже доставленные сообщения нельзя. Остановка прерывает только ещё не отправленные.</p>
    </Confirm>}
    {ask === 'cancel' && <Confirm title="Остановить рассылку" danger confirmLabel="Остановить" pending={action.isPending} error={action.error} onConfirm={() => run('cancel')} onClose={() => setAsk(null)}>
      <p>Оставшиеся в очереди сообщения не уйдут. Те, что уже отправляются прямо сейчас, могут всё равно дойти.</p>
    </Confirm>}
  </article>;
}

export default function BroadcastsSection() {
  const list = useListAdminBroadcasts({ request: adminQueryRequest, query: { queryKey: getListAdminBroadcastsQueryKey(), refetchInterval: 5000 } });
  const [fresh, setFresh] = useState<string | null>(null);
  const items = useMemo(() => list.data?.items ?? [], [list.data]);
  const bot = list.data?.botConfigured ?? false;
  return <section className="adm-section">
    <PageHead kicker="связь с подписчиками" title="Рассылки">
      Сообщение получают только те, кто открыл бота командой /start и затем отправил /subscribe, не отключив уведомления в настройках. Команда /stop отписывает.
    </PageHead>
    {list.data && <div className="bc-strip">
      <div><small>Аудитория</small><strong className="num" data-testid="text-eligible">{fmtInt(list.data.eligible)}</strong></div>
      <div><small>Бот Telegram</small><span className={`adm-tag ${bot ? 'ok' : 'bad'}`} data-testid="status-bot">{bot ? 'настроен' : 'не настроен'}</span></div>
      <div className="bc-strip-note">Порядок: черновик, тест себе, подтверждение, отправка. Без расписания и сегментов.</div>
    </div>}
    {list.data && !bot && <div className="adm-note"><span>Telegram-бот не настроен на сервере: тесты и отправка недоступны. Черновики сохранять можно.</span></div>}
    <Composer disabled={false} onCreated={b => setFresh(b.id)} />
    <Panel title="Кампании" meta="Обновляется каждые 5 секунд">
      {list.isLoading ? <Skeleton rows={4} /> : list.isError && !list.data ? <ErrorBox error={list.error} onRetry={() => void list.refetch()} />
        : items.length === 0 ? <Empty title="Рассылок пока нет">Собери первый черновик выше и отправь его себе на тест.</Empty>
        : <div className="bc-list">{list.isError && <ErrorBox error={list.error} onRetry={() => void list.refetch()} />}{items.map(b => <Card key={b.id} b={b} eligible={list.data!.eligible} botConfigured={bot} highlight={b.id === fresh} />)}</div>}
    </Panel>
  </section>;
}
