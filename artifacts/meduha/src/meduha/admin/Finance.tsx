import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Power } from 'lucide-react';
import { getGetAdminFinanceSettingsQueryKey, useGetAdminFinanceSettings, useListAdminLedger, useUpdateAdminFinanceSettings } from '@workspace/api-client-react';
import type { FinanceLedgerEntry, FinanceSettings } from '@workspace/api-client-react';
import { Confirm, Empty, ErrorBox, Feedback, PageHead, Pager, Panel, Skeleton, adminQueryRequest, adminRequest, asArray, fmtDate, fmtInt, fmtSigned, shortId, useFlash } from './ui';

export const ledgerKindLabel: Record<string, string> = { adjustment: 'Корректировка', reserve: 'Резерв', settlement: 'Списание', release: 'Освобождение', refund: 'Возврат' };
const PAGE = 50;

export function LedgerTable({ items, hideAccount }: { items: FinanceLedgerEntry[]; hideAccount?: boolean }) {
  return <div className="adm-table-wrap"><table className="adm-table"><thead><tr><th>Время</th><th>Тип</th>{!hideAccount && <th>Аккаунт</th>}<th className="r">Баланс</th><th className="r">Удержание</th><th>Основание</th><th>Автор</th></tr></thead><tbody>
    {items.map(e => <tr key={e.id} data-testid={`row-ledger-${e.id}`}><td className="num">{fmtDate(e.createdAt)}</td><td>{ledgerKindLabel[e.kind] ?? e.kind}{e.reservationId && <span className="sub mono">рез. {shortId(e.reservationId)}</span>}</td>{!hideAccount && <td className="mono">{e.accountId}</td>}
      <td className={`r num ${e.delta > 0 ? 'adm-pos' : e.delta < 0 ? 'adm-neg' : ''}`}>{e.delta === 0 ? '0' : fmtSigned(e.delta)}</td><td className="r num">{e.reservedDelta === 0 ? '0' : fmtSigned(e.reservedDelta)}</td><td><span className="adm-clip" title={e.reason}>{e.reason}</span></td><td className="mono">{shortId(e.actorId)}</td></tr>)}
  </tbody></table></div>;
}

function useInvalidateSettings() {
  const qc = useQueryClient();
  return () => { void qc.invalidateQueries({ predicate: q => ['/api/meduha/admin/finance', '/api/meduha/admin/statistics', '/api/meduha/admin/audit'].some(p => String(q.queryKey[0]).startsWith(p)) }); void qc.invalidateQueries({ queryKey: getGetAdminFinanceSettingsQueryKey() }); };
}

function SettingsForm({ s, onDone }: { s: FinanceSettings; onDone: (m: string) => void }) {
  const upd = useUpdateAdminFinanceSettings({ request: adminRequest }); const invalidate = useInvalidateSettings();
  const [daily, setDaily] = useState(String(s.dailyCreditLimit)); const [maxActive, setMaxActive] = useState(String(s.maxActiveReservations));
  const [accountDaily, setAccountDaily] = useState(String(s.perAccountDailyCreditLimit));
  const synced = useRef(s.updatedAt);
  useEffect(() => { if (synced.current !== s.updatedAt) { synced.current = s.updatedAt; setDaily(String(s.dailyCreditLimit)); setAccountDaily(String(s.perAccountDailyCreditLimit)); setMaxActive(String(s.maxActiveReservations)); } }, [s]);
  const ok = (v: string) => /^\d+$/.test(v.trim()) && Number(v) <= 2147483647;
  const valid = ok(daily) && ok(accountDaily) && ok(maxActive);
  const dirty = Number(daily) !== s.dailyCreditLimit || Number(accountDaily) !== s.perAccountDailyCreditLimit || Number(maxActive) !== s.maxActiveReservations;
  const submit = (e: FormEvent) => { e.preventDefault(); if (!valid || !dirty) return; upd.mutate({ data: { dailyCreditLimit: Number(daily), perAccountDailyCreditLimit: Number(accountDaily), maxActiveReservations: Number(maxActive) } }, { onSuccess: () => { invalidate(); onDone('Лимиты сохранены'); } }); };
  return <form className="adm-form adm-panel-body" onSubmit={submit} noValidate>
    <div className="adm-fields">
      <label className="adm-field"><span>Дневной лимит, кредиты</span><input type="number" min={0} value={daily} onChange={e => setDaily(e.target.value)} data-testid="input-finance-daily" /><small>Глобально за сутки UTC. 0 — расход невозможен.</small></label>
      <label className="adm-field"><span>Дневной лимит на аккаунт, кредиты</span><input type="number" min={0} max={2147483647} step={1} value={accountDaily} onChange={e => setAccountDaily(e.target.value)} data-testid="input-finance-account-daily" /><small>Отдельно для каждого аккаунта: активные резервы и списания за сутки UTC. 0 — новые резервы запрещены. Сутки начинаются в 00:00 UTC; незавершённые резервы переносятся. Снижение лимита не отменяет уже разрешённые операции.</small></label>
      <label className="adm-field"><span>Макс. активных резервов</span><input type="number" min={0} value={maxActive} onChange={e => setMaxActive(e.target.value)} data-testid="input-finance-active" /><small>0 — резервы запрещены.</small></label>
    </div>
    {!valid && <div className="adm-feedback bad">Нужны целые числа от 0 до 2 147 483 647.</div>}
    <Feedback error={upd.error} />
    <div className="adm-actions" style={{ justifyContent: 'space-between', alignItems: 'center' }}><small style={{ color: 'var(--ink-3)' }}>Изменено {fmtDate(s.updatedAt)}{s.updatedBy ? ` · ${shortId(s.updatedBy)}` : ''}</small><button className="adm-btn primary" disabled={!dirty || upd.isPending || !valid} data-testid="button-finance-save">{upd.isPending ? 'Сохраняем…' : upd.error ? 'Повторить' : 'Сохранить лимиты'}</button></div>
  </form>;
}

export default function FinanceSection() {
  const sQ = useGetAdminFinanceSettings({ request: adminQueryRequest });
  const [offset, setOffset] = useState(0);
  const lQ = useListAdminLedger({ limit: PAGE, offset }, { request: adminQueryRequest });
  const kill = useUpdateAdminFinanceSettings({ request: adminRequest }); const invalidate = useInvalidateSettings();
  const [confirm, setConfirm] = useState<boolean | null>(null); const { msg, flash } = useFlash();
  const s = sQ.data;
  return <div className="adm-section">
    <PageHead kicker="Финансы" title="Кредиты и лимиты">Кредиты — внутренние целые единицы, не рубли и не доллары. Оплата не подключена; все изменения — ручные учётные операции с записью в журнал.</PageHead>
    <Feedback ok={msg} />
    <div style={{ height: 12 }} />
    {sQ.isLoading ? <Panel title="Настройки расхода"><Skeleton rows={4} /></Panel> : sQ.isError || !s ? <Panel title="Настройки расхода"><ErrorBox error={sQ.error ?? new Error('Нет данных')} onRetry={() => void sQ.refetch()} /></Panel> : <>
      <div className={`adm-kill ${s.spendingEnabled ? 'on' : ''}`}>
        <Power size={22} aria-hidden style={{ color: s.spendingEnabled ? 'var(--ok)' : 'var(--signal)' }} />
        <div><strong data-testid="status-spending">{s.spendingEnabled ? 'Расход кредитов разрешён' : 'Расход кредитов остановлен'}</strong><small>{s.spendingEnabled ? 'Новые резервы принимаются в пределах лимитов.' : 'Аварийный выключатель: новые резервы отклоняются. Корректировки и завершение существующих резервов работают.'}</small></div>
        <button className={`adm-btn ${s.spendingEnabled ? 'danger solid' : 'primary'}`} onClick={() => { kill.reset(); setConfirm(!s.spendingEnabled); }} data-testid="button-spending-toggle">{s.spendingEnabled ? 'Остановить расход' : 'Разрешить расход'}</button>
      </div>
      <Panel title="Лимиты"><SettingsForm s={s} onDone={flash} /></Panel>
    </>}
    <Panel title="Общий журнал операций" meta={lQ.data ? `${fmtInt(lQ.data.total)} записей` : undefined}>
      {lQ.isLoading ? <Skeleton rows={8} /> : lQ.isError ? <ErrorBox error={lQ.error} onRetry={() => void lQ.refetch()} /> : asArray<FinanceLedgerEntry>(lQ.data?.items).length === 0 ? <Empty title="Журнал пуст">Существующие балансы — начальные. Записи появятся после первой ручной операции.</Empty> : <>
        <LedgerTable items={asArray<FinanceLedgerEntry>(lQ.data?.items)} /><Pager total={lQ.data?.total ?? 0} limit={PAGE} offset={offset} onChange={setOffset} /></>}
    </Panel>
    {confirm !== null && <Confirm title={confirm ? 'Разрешить расход' : 'Остановить расход'} danger={!confirm} confirmLabel={confirm ? 'Разрешить' : 'Остановить'} pending={kill.isPending} error={kill.error} onClose={() => setConfirm(null)}
      onConfirm={() => kill.mutate({ data: { spendingEnabled: confirm } }, { onSuccess: () => { invalidate(); flash(confirm ? 'Расход разрешён' : 'Расход остановлен'); setConfirm(null); } })}>
      <p style={{ margin: 0 }}>{confirm ? 'Новые резервы снова будут приниматься в пределах дневного лимита и лимита активных резервов.' : 'Все новые резервы будут отклоняться до повторного включения.'}</p></Confirm>}
  </div>;
}
