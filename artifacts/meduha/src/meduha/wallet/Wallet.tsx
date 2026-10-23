import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { ArrowLeft, RotateCw, ShieldCheck, Zap } from 'lucide-react';
import { TopupSheet } from './TopupSheet';
import { getGetMeduhaBootstrapQueryKey, getGetMeduhaWalletQueryKey, useGetMeduhaWallet } from '@workspace/api-client-react';
import type { FinanceLedgerEntry, FinanceReservation } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Frame } from '../shared';
import { meduhaErrorMessage, useMeduhaSession } from '../session';
import './wallet.css';

const PAGE = 30;
const kind: Record<string, string> = { adjustment: 'Корректировка', reserve: 'Резерв', settlement: 'Списание', release: 'Освобождение резерва', refund: 'Возврат' };
const resLabel: Record<string, string> = { held: 'удержано', settled: 'списано', released: 'освобождено', refunded: 'возвращено' };
const int = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? n.toLocaleString('ru-RU') : '—');
const date = (v: string) => { const d = new Date(v); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); };

export default function Wallet() {
  const session = useMeduhaSession(); const qc = useQueryClient();
  const authed = session.phase === 'authenticated';
  const [offset, setOffset] = useState(0); const [topup, setTopup] = useState(false); const params = { limit: PAGE, offset };
  const q = useGetMeduhaWallet(params, { request: { credentials: 'same-origin' }, query: { queryKey: getGetMeduhaWalletQueryKey(params), placeholderData: prev => prev, enabled: authed, staleTime: 10_000, refetchOnWindowFocus: true } });
  const w = q.data;
  // Keep the shell balance consistent with the authoritative wallet balance.
  useEffect(() => { if (w && session.account && w.balance !== session.account.credits) void qc.invalidateQueries({ queryKey: getGetMeduhaBootstrapQueryKey() }); }, [w, session.account, qc]);
  const ledger: FinanceLedgerEntry[] = Array.isArray(w?.ledger) ? w!.ledger : [];
  const reservations: FinanceReservation[] = Array.isArray(w?.reservations) ? w!.reservations : [];
  const total = Math.max(w?.pagination?.totalLedger ?? 0, w?.pagination?.totalReservations ?? 0);
  return <Frame active="Profile">
    <Link href="/profile" className="mw-back" data-testid="link-wallet-back"><ArrowLeft size={15} />Профиль</Link>
    <h1 className="mw-title">Кошелёк</h1>
    {!authed ? <div className="m-info-note" style={{ display: 'grid', gap: 10 }}><span><ShieldCheck size={14} style={{ verticalAlign: '-2px' }} /> История операций доступна только для подтверждённого аккаунта Telegram.</span>{session.phase === 'guest' && session.telegram && <button className="m-startup-action" onClick={session.reauthenticate}>Подтвердить аккаунт</button>}<button className="m-startup-guest" onClick={() => setTopup(true)} data-testid="button-wallet-topup-guest">Посмотреть пакеты · тест</button></div>
      : q.isLoading ? <div className="mw-skel" aria-busy="true"><i /><i /><i /><i /></div>
      : q.isError || !w ? <div className="m-info-note" role="alert">{meduhaErrorMessage(q.error)}<button className="m-startup-action" style={{ marginTop: 10 }} onClick={() => void q.refetch()}><RotateCw size={14} />Повторить</button></div>
      : <>
        <div className="mw-balance" data-testid="text-wallet-balance"><small>Баланс</small><strong>{int(w.balance)}</strong><span>кредитов</span>
          <div className="mw-split"><div><small>Доступно</small><b>{int(w.available)}</b></div><div><small>Удержано</small><b>{int(w.reserved)}</b></div></div>
        </div>
        <p className="mw-note">Кредиты — внутренние единицы студии, не рубли. Пополнение пока только тестовое: оплата не принимается, кредиты не начисляются.</p>
        <button className="m-startup-action" style={{ width: '100%', justifyContent: 'center', marginBottom: 14 }} onClick={() => setTopup(true)} data-testid="button-wallet-topup"><Zap size={14} fill="currentColor" />Пополнить · тест</button>
        {reservations.length > 0 && <><h2 className="mw-h2">Резервы <small>{int(w.pagination?.totalReservations)}</small></h2><div className="mw-list">{reservations.map(r => <div key={r.id} className="mw-row"><div><strong>{r.reason || 'Резерв'}</strong><small>{date(r.createdAt)} · {resLabel[r.status]}</small></div><b>{int(r.amount)}</b></div>)}</div></>}
        <h2 className="mw-h2">История операций <small>{int(w.pagination?.totalLedger)}</small></h2>
        {ledger.length === 0 ? <div className="m-info-note">Операций пока нет. Текущий баланс — начальный; история начнётся с первой операции.</div>
          : <div className="mw-list">{ledger.map(e => <div key={e.id} className="mw-row" data-testid={`row-wallet-${e.id}`}><div><strong>{kind[e.kind] ?? e.kind}</strong><small>{date(e.createdAt)}{e.reason ? ` · ${e.reason}` : ''}</small></div><b className={e.delta > 0 ? 'pos' : e.delta < 0 ? 'neg' : ''}>{e.delta === 0 ? (e.reservedDelta ? `${e.reservedDelta > 0 ? 'удерж.' : 'снято'} ${int(Math.abs(e.reservedDelta))}` : '0') : `${e.delta > 0 ? '+' : ''}${int(e.delta)}`}</b></div>)}</div>}
        {total > PAGE && <div className="mw-pager"><button disabled={offset === 0 || q.isFetching} onClick={() => setOffset(o => Math.max(0, o - PAGE))} data-testid="button-wallet-newer">Новее</button><span>{offset + 1}–{Math.min(offset + PAGE, total)} из {int(total)}</span><button disabled={offset + PAGE >= total || q.isFetching} onClick={() => setOffset(o => o + PAGE)} data-testid="button-wallet-older">Старее</button></div>}
      </>}
    {topup && <TopupSheet authenticated={authed} balance={authed ? (w?.balance ?? null) : null} onClose={() => setTopup(false)} />}
  </Frame>;
}
