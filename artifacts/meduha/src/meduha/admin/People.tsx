import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Ban, MinusCircle, PlusCircle, Search, ShieldCheck } from 'lucide-react';
import {
  getGetAdminUserQueryKey, getGetAdminWalletQueryKey, getGetMeduhaAdminStatusQueryKey, getGetMeduhaBootstrapQueryKey, getGetMeduhaWalletQueryKey, getListAdminChannelsQueryKey, getListAdminModelsQueryKey,
  useAdjustAdminCredits, useGetAdminUser, useGetAdminWallet, useGetMeduhaAdminStatus, useListAdminChannels, useListAdminModels, useListAdminUsers, useRefundAdminCredits,
  useReleaseAdminCredits, useReserveAdminCredits, useSetAdminUserBlocked, useSettleAdminCredits,
} from '@workspace/api-client-react';
import type { AdminChannel, AdminJob, AdminModel, AdminUser, FinanceLedgerEntry, FinanceMutationResult, FinanceReservation } from '@workspace/api-client-react';
import { Confirm, Empty, ErrorBox, Feedback, Modal, PageHead, Pager, Panel, Skeleton, adminQueryRequest, adminRequest, asArray, fmtDate, fmtInt, fmtSigned, shortId, useFlash, useIntentKey } from './ui';
import { LedgerTable } from './Finance';

const req = { request: adminRequest };
const PAGE = 25;
const WPAGE = 25;
export const resStatus: Record<string, [string, string]> = { held: ['Удержан', 'warn'], settled: ['Списан', 'ok'], released: ['Освобождён', ''], refunded: ['Возвращён', 'sig'] };

export function useInvalidateFinance() {
  const qc = useQueryClient();
  return (userId?: string) => {
    const prefixes = ['/api/meduha/admin/users', '/api/meduha/admin/ledger', '/api/meduha/admin/statistics', '/api/meduha/admin/audit', '/api/meduha/admin/finance'];
    void qc.invalidateQueries({ predicate: q => prefixes.some(p => String(q.queryKey[0]).startsWith(p)) });
    if (userId) void qc.invalidateQueries({ queryKey: getGetAdminUserQueryKey(userId) });
    void qc.invalidateQueries({ predicate: q => ([getGetAdminWalletQueryKey()[0], getGetMeduhaWalletQueryKey()[0]] as string[]).includes(q.queryKey[0] as string) });
    void qc.invalidateQueries({ queryKey: getGetMeduhaBootstrapQueryKey() });
  };
}

type OpMode = 'adjust' | 'reserve' | 'settle' | 'release' | 'refund';
const opTitle: Record<OpMode, string> = { adjust: 'Ручная корректировка', reserve: 'Ручной резерв', settle: 'Списать резерв', release: 'Освободить резерв', refund: 'Вернуть списание' };
const opHint: Record<OpMode, string> = {
  adjust: 'Положительное число начисляет, отрицательное — снимает кредиты. Доступный остаток не может стать отрицательным.',
  reserve: 'Удерживает кредиты без изменения баланса. Это ручная учётная операция: AI-задачи не подключены. Требует включённого расхода и свободного дневного лимита.',
  settle: 'Списывает удержанную сумму с баланса. Действие необратимо, кроме полного возврата.',
  release: 'Снимает удержание без изменения баланса.',
  refund: 'Полностью возвращает списанную сумму на баланс. Возможно один раз.',
};

export function CreditOp({ mode, user, reservation, onClose, onDone }: { mode: OpMode; user: AdminUser; reservation?: FinanceReservation; onClose: () => void; onDone: (m: string) => void }) {
  const invalidate = useInvalidateFinance(); const intents = useIntentKey();
  const [amount, setAmount] = useState(''); const [reason, setReason] = useState('');
  const [modelId, setModelId] = useState(''); const [channelId, setChannelId] = useState('');
  const [step, setStep] = useState<'form' | 'review'>('form'); const [touched, setTouched] = useState(false);
  const adjust = useAdjustAdminCredits(req); const reserve = useReserveAdminCredits(req);
  const settle = useSettleAdminCredits(req); const release = useReleaseAdminCredits(req); const refund = useRefundAdminCredits(req);
  const m = { adjust, reserve, settle, release, refund }[mode];
  const models = useListAdminModels({ query: { enabled: mode === 'reserve', queryKey: getListAdminModelsQueryKey() }, request: adminQueryRequest });
  const channels = useListAdminChannels({ query: { enabled: mode === 'reserve', queryKey: getListAdminChannelsQueryKey() }, request: adminQueryRequest });
  const status = useGetMeduhaAdminStatus({ request: adminQueryRequest, query: { queryKey: getGetMeduhaAdminStatusQueryKey() } });
  const actor = status.data?.adminId ?? null;
  const n = Number(amount); const needsAmount = mode === 'adjust' || mode === 'reserve';
  const amountOk = !needsAmount || (/^-?\d+$/.test(amount.trim()) && Number.isSafeInteger(n) && (mode === 'adjust' ? n !== 0 : n >= 1) && Math.abs(n) <= 2147483647);
  const reasonOk = reason.trim().length >= 1 && reason.trim().length <= 1000;
  const signature = JSON.stringify([actor, mode, user.id, reservation?.id ?? null, needsAmount ? n : null, reason.trim(), mode === 'reserve' ? [modelId, channelId] : null]);
  const run = () => {
    if (!actor || !status.data?.authenticated || !status.data.isAdmin) return;
    const idempotencyKey = intents.keyFor(signature); const r = reason.trim();
    const ok = (res: FinanceMutationResult) => { intents.settle(signature); invalidate(user.id); onDone(`${opTitle[mode]}: выполнено${res?.replayed ? ' (повтор подтверждён сервером, без двойного проведения)' : ''}`); onClose(); };
    const uncertain = () => invalidate(user.id);
    if (mode === 'adjust') adjust.mutate({ data: { userId: user.id, delta: n, reason: r, idempotencyKey } }, { onSuccess: ok, onError: uncertain });
    else if (mode === 'reserve') reserve.mutate({ data: { userId: user.id, amount: n, reason: r, idempotencyKey, modelId: modelId || null, channelId: channelId || null } }, { onSuccess: ok, onError: uncertain });
    else if (reservation) ({ settle, release, refund }[mode]).mutate({ reservationId: reservation.id, data: { reason: r, idempotencyKey } }, { onSuccess: ok, onError: uncertain });
  };
  const submit = (e: FormEvent) => { e.preventDefault(); setTouched(true); if (amountOk && reasonOk) { m.reset(); setStep('review'); } };
  const who = `${user.firstName} ${user.lastName ?? ''}`.trim();
  return <Modal title={opTitle[mode]} onClose={onClose} busy={m.isPending}>
    {step === 'form' ? <form className="adm-form" onSubmit={submit} noValidate>
      <p style={{ margin: 0, color: 'var(--ink-2)', fontSize: 13 }}>{opHint[mode]}</p>
      {needsAmount && <label className="adm-field"><span>{mode === 'adjust' ? 'Изменение, кредиты (со знаком)' : 'Сумма резерва, кредиты'}</span><input className="mono" inputMode="numeric" value={amount} onChange={e => setAmount(e.target.value)} placeholder={mode === 'adjust' ? 'например 120 или -40' : 'например 30'} data-testid="input-credit-amount" />{touched && !amountOk && <small style={{ color: 'var(--bad)' }}>{mode === 'adjust' ? 'Целое ненулевое число.' : 'Целое число от 1.'}</small>}</label>}
      {reservation && <dl className="adm-review"><dt>Резерв</dt><dd className="mono">{reservation.id}</dd><dt>Сумма</dt><dd className="num">{fmtInt(reservation.amount)} кр.</dd><dt>Основание</dt><dd>{reservation.reason}</dd></dl>}
      {mode === 'reserve' && <div className="adm-fields">
        <label className="adm-field"><span>Модель (необязательно)</span><select value={modelId} onChange={e => setModelId(e.target.value)} data-testid="select-reserve-model"><option value="">Не указана</option>{asArray<AdminModel>(models.data).map(x => <option key={x.id} value={x.id}>{x.displayName}</option>)}</select></label>
        <label className="adm-field"><span>Канал (необязательно)</span><select value={channelId} onChange={e => setChannelId(e.target.value)} data-testid="select-reserve-channel"><option value="">Не указан</option>{asArray<AdminChannel>(channels.data).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
      </div>}
      <label className="adm-field"><span>Основание (обязательно)</span><textarea value={reason} onChange={e => setReason(e.target.value)} maxLength={1000} placeholder="Почему выполняется операция — попадёт в журнал" data-testid="input-credit-reason" />{touched && !reasonOk && <small style={{ color: 'var(--bad)' }}>Укажи основание.</small>}</label>
      <div className="adm-actions" style={{ justifyContent: 'flex-end' }}><button type="button" className="adm-btn" onClick={onClose}>Отмена</button><button className="adm-btn primary" data-testid="button-credit-review">Проверить</button></div>
    </form> : <div className="adm-form">
      <dl className="adm-review">
        <dt>Операция</dt><dd>{opTitle[mode]}</dd><dt>Пользователь</dt><dd>{who} <span className="adm-detail-id">{user.id}</span></dd>
        {needsAmount && <><dt>{mode === 'adjust' ? 'Изменение' : 'Сумма'}</dt><dd className={`num ${mode === 'adjust' ? (n > 0 ? 'adm-pos' : 'adm-neg') : ''}`}>{mode === 'adjust' ? fmtSigned(n) : fmtInt(n)} кр.</dd></>}
        {reservation && <><dt>Резерв</dt><dd className="num">{fmtInt(reservation.amount)} кр. · {shortId(reservation.id)}</dd></>}
        <dt>Основание</dt><dd>{reason.trim()}</dd>
        <dt>Ключ операции</dt><dd className="mono" style={{ fontSize: 11 }}>{intents.pending(signature) ?? 'будет создан при отправке'}</dd>
      </dl>
      <p style={{ margin: 0, fontSize: 12, color: 'var(--ink-3)' }}>Кредиты — внутренние единицы, не рубли. Повтор после ошибки отправит тот же ключ, и сервер не проведёт операцию дважды.{intents.durable && actor ? ' Ключ сохраняется в этой вкладке до подтверждения, даже после перезагрузки.' : ' Хранилище вкладки недоступно: после перезагрузки страницы ключ не восстановится — сначала проверь журнал, прежде чем повторять.'}</p>{intents.pending(signature) && m.status === 'idle' && <div className="adm-feedback bad" role="status">Эта операция уже отправлялась, но результат не подтверждён. Подтверждение отправит тот же ключ — сервер не проведёт её повторно.</div>}
      <Feedback error={m.error} />
      <div className="adm-actions" style={{ justifyContent: 'flex-end' }}>
        <button className="adm-btn" onClick={() => setStep('form')} disabled={m.isPending}>Изменить</button>
        <button className={`adm-btn ${mode === 'adjust' && n < 0 ? 'danger solid' : 'primary'}`} onClick={run} disabled={m.isPending || status.isLoading || !actor || !status.data?.authenticated || !status.data.isAdmin} data-testid="button-credit-confirm">{m.isPending ? 'Проводим…' : m.error ? 'Повторить с тем же ключом' : 'Подтвердить операцию'}</button>
      </div>
    </div>}
  </Modal>;
}

function UserDetail({ userId, onDone }: { userId: string; onDone: (m: string) => void }) {
  const q = useGetAdminUser(userId, { query: { enabled: !!userId, queryKey: getGetAdminUserQueryKey(userId) }, request: adminQueryRequest });
  const block = useSetAdminUserBlocked(req); const invalidate = useInvalidateFinance();
  const [op, setOp] = useState<{ mode: OpMode; reservation?: FinanceReservation } | null>(null);
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [wOffset, setWOffset] = useState(0);
  const wParams = { userId, limit: WPAGE, offset: wOffset };
  const wq = useGetAdminWallet(wParams, { query: { enabled: !!userId, queryKey: getGetAdminWalletQueryKey(wParams) }, request: adminQueryRequest });
  const status = useGetMeduhaAdminStatus({ request: adminQueryRequest, query: { queryKey: getGetMeduhaAdminStatusQueryKey() } });
  if (q.isLoading) return <Panel title="Пользователь"><Skeleton rows={8} /></Panel>;
  if (q.isError || !q.data) return <Panel title="Пользователь"><ErrorBox error={q.error ?? new Error('Нет данных')} onRetry={() => void q.refetch()} /></Panel>;
  const u = q.data; const w = wq.data ?? u.wallet; const reservations = asArray<FinanceReservation>(w?.reservations); const ledger = asArray<FinanceLedgerEntry>(w?.ledger); const isSelf = !!status.data?.adminId && status.data.adminId === u.id; const wTotal = Math.max(w?.pagination?.totalLedger ?? 0, w?.pagination?.totalReservations ?? 0); const works = asArray<AdminJob>(u.works);
  return <div>
    <Panel title={`${u.firstName} ${u.lastName ?? ''}`.trim()} meta={<span className="mono">{u.username ? `@${u.username} · ` : ''}ID {u.id}</span>} actions={<span className={`adm-tag ${u.blocked ? 'bad' : 'ok'}`}>{u.blocked ? 'Заблокирован' : 'Активен'}</span>}>
      <div className="adm-figures" style={{ margin: 16, marginBottom: 12 }}>
        <div className="adm-figure"><span>Баланс</span><strong data-testid="text-user-balance">{fmtInt(w?.balance)}</strong><em>кредитов</em></div>
        <div className="adm-figure"><span>Удержано</span><strong>{fmtInt(w?.reserved)}</strong></div>
        <div className="adm-figure"><span>Доступно</span><strong>{fmtInt(w?.available)}</strong></div>
      </div>
      <div className="adm-panel-body" style={{ paddingTop: 0 }}>
        <div className="adm-actions">
          <button className="adm-btn primary sm" onClick={() => setOp({ mode: 'adjust' })} data-testid="button-user-adjust"><PlusCircle size={13} />Корректировка</button>
          <button className="adm-btn sm" onClick={() => setOp({ mode: 'reserve' })} data-testid="button-user-reserve"><MinusCircle size={13} />Резерв</button>
          {isSelf ? <span className="adm-tag sig">Это ваш аккаунт администратора</span> : <button className={`adm-btn sm ${u.blocked ? '' : 'danger'}`} onClick={() => { block.reset(); setConfirmBlock(true); }} data-testid="button-user-block">{u.blocked ? <><ShieldCheck size={13} />Разблокировать</> : <><Ban size={13} />Заблокировать</>}</button>}
        </div>
        <p style={{ fontSize: 12, color: 'var(--ink-3)', margin: '10px 0 0' }}>Создан {fmtDate(u.createdAt)} · подписка {u.subscription || '—'}. Сервер не позволяет заблокировать себя или администратора.</p>
      </div>
    </Panel>
    <Panel title="Резервы" meta={`${fmtInt(w?.pagination?.totalReservations)} всего`}>
      {reservations.length === 0 ? <Empty title="Резервов нет" /> : <div className="adm-table-wrap"><table className="adm-table"><thead><tr><th>Создан</th><th className="r">Сумма</th><th>Статус</th><th>Основание</th><th /></tr></thead><tbody>
        {reservations.map(r => { const [l, c] = resStatus[r.status] ?? [r.status, '']; return <tr key={r.id} data-testid={`row-reservation-${r.id}`}><td className="num">{fmtDate(r.createdAt)}</td><td className="r num">{fmtInt(r.amount)}</td><td><span className={`adm-tag ${c}`}>{l}</span></td><td><span className="adm-clip">{r.reason}</span></td>
          <td><div className="adm-actions">{r.status === 'held' && <><button className="adm-btn sm" onClick={() => setOp({ mode: 'settle', reservation: r })} data-testid={`button-settle-${r.id}`}>Списать</button><button className="adm-btn sm" onClick={() => setOp({ mode: 'release', reservation: r })} data-testid={`button-release-${r.id}`}>Освободить</button></>}{r.status === 'settled' && <button className="adm-btn sm" onClick={() => setOp({ mode: 'refund', reservation: r })} data-testid={`button-refund-${r.id}`}>Вернуть</button>}</div></td></tr>; })}
      </tbody></table></div>}
    </Panel>
    <Panel title="Операции пользователя" meta={`${fmtInt(w?.pagination?.totalLedger)} всего`}>{ledger.length === 0 ? <Empty title="Операций нет">Текущий баланс — начальный, журнал ведётся с первой операции.</Empty> : <LedgerTable items={ledger} hideAccount />}</Panel>
    {wq.isError && <ErrorBox error={wq.error} onRetry={() => void wq.refetch()} />}
    {wTotal > WPAGE && <div className="adm-panel"><Pager total={wTotal} limit={WPAGE} offset={wOffset} onChange={setWOffset} /></div>}
    <Panel title="Работы" meta="Записи meduha_works, генерация не подключена">{works.length === 0 ? <Empty title="Работ нет" /> : <div className="adm-table-wrap"><table className="adm-table"><tbody>{works.map(j => <tr key={j.id}><td>{j.title}</td><td>{j.type}</td><td>{j.status}</td><td className="num">{fmtDate(j.createdAt)}</td></tr>)}</tbody></table></div>}</Panel>
    {op && <CreditOp mode={op.mode} reservation={op.reservation} user={u} onClose={() => setOp(null)} onDone={onDone} />}
    {confirmBlock && <Confirm title={u.blocked ? 'Разблокировать пользователя' : 'Заблокировать пользователя'} danger={!u.blocked} confirmLabel={u.blocked ? 'Разблокировать' : 'Заблокировать'} pending={block.isPending} error={block.error} onClose={() => setConfirmBlock(false)}
      onConfirm={() => block.mutate({ userId: u.id, data: { blocked: !u.blocked } }, { onSuccess: s => { invalidate(u.id); onDone(s.blocked ? 'Пользователь заблокирован' : 'Пользователь разблокирован'); setConfirmBlock(false); } })}>
      <p style={{ margin: 0 }}>{u.blocked ? 'Пользователь снова сможет входить в Mini App.' : 'Пользователь потеряет доступ к аккаунту в Mini App до разблокировки.'}</p></Confirm>}
  </div>;
}

export default function PeopleSection() {
  const [input, setInput] = useState(''); const [query, setQuery] = useState(''); const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<string | null>(null); const { msg, flash } = useFlash(); const t = useRef<number | undefined>(undefined);
  useEffect(() => { window.clearTimeout(t.current); t.current = window.setTimeout(() => { setQuery(input.trim()); setOffset(0); }, 300); return () => window.clearTimeout(t.current); }, [input]);
  const params = { ...(query ? { query } : {}), limit: PAGE, offset };
  const q = useListAdminUsers(params, { request: adminQueryRequest });
  const items = asArray<AdminUser>(q.data?.items);
  return <div className="adm-section">
    <PageHead kicker="Пользователи" title="Аккаунты и кошельки">Поиск по имени, username или Telegram ID. Здесь же ручные учётные операции с кредитами — каждая с обязательным основанием и подтверждением.</PageHead>
    <Feedback ok={msg} />
    <div className="adm-grid2" style={{ marginTop: 12 }}>
      <Panel title="Список" meta={q.data ? `${fmtInt(q.data.total)} найдено` : undefined} actions={<label style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 220 }}><Search size={14} aria-hidden /><input type="search" value={input} onChange={e => setInput(e.target.value)} maxLength={100} placeholder="Поиск" aria-label="Поиск пользователей" data-testid="input-user-search" /></label>}>
        {q.isLoading ? <Skeleton rows={8} /> : q.isError ? <ErrorBox error={q.error} onRetry={() => void q.refetch()} /> : items.length === 0 ? <Empty title={query ? 'Никого не нашли' : 'Пользователей пока нет'}>{query ? 'Проверь написание или поищи по числовому ID.' : 'Аккаунты появятся после первого входа через Telegram.'}</Empty> : <>
          <div className="adm-table-wrap"><table className="adm-table"><thead><tr><th>Пользователь</th><th className="r">Баланс</th><th>Статус</th></tr></thead><tbody>
            {items.map(u => <tr key={u.id} className={selected === u.id ? 'sel' : ''}><td><button className="adm-row-btn" onClick={() => setSelected(u.id)} aria-pressed={selected === u.id} data-testid={`button-user-${u.id}`}><strong>{`${u.firstName} ${u.lastName ?? ''}`.trim()}</strong><span className="sub mono">{u.username ? `@${u.username} · ` : ''}{u.id}</span></button></td><td className="r num">{fmtInt(u.credits)}</td><td><span className={`adm-tag ${u.blocked ? 'bad' : 'ok'}`}>{u.blocked ? 'Блок' : 'Активен'}</span></td></tr>)}
          </tbody></table></div>
          <Pager total={q.data?.total ?? 0} limit={PAGE} offset={offset} onChange={setOffset} /></>}
      </Panel>
      {selected ? <UserDetail key={selected} userId={selected} onDone={flash} /> : <Panel title="Пользователь"><Empty title="Выбери пользователя">Откроются кошелёк, резервы, журнал операций и управление доступом.</Empty></Panel>}
    </div>
  </div>;
}
