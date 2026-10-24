import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, RotateCw, X } from 'lucide-react';
import { meduhaErrorMessage } from '../session';
import { createIntentStore, sessionStorageOrNull } from './intent';
export { clearAdminQueries, isAdminKey } from './cache';

/** Request options for every admin mutation: same-origin cookie + CSRF header. */
export const adminRequest = { credentials: 'same-origin' as const, headers: { 'X-Meduha-Request': '1' } };
export const adminQueryRequest = { credentials: 'same-origin' as const };

export const errStatus = (e: unknown) => (e as { status?: number } | null)?.status;
const codeText: Record<string, string> = {
  ADMIN_CREDENTIALS_INVALID: 'Неверный логин или пароль, либо временный вход отключён.',
  ADMIN_LOGIN_RATE_LIMIT: 'Слишком много попыток входа. Повтори через 15 минут.',
  INSUFFICIENT_CREDITS: 'Недостаточно доступных кредитов на счёте.',
  SPENDING_DISABLED: 'Расход отключён аварийным выключателем. Новые резервы запрещены.',
  DAILY_LIMIT_EXCEEDED: 'Превышен глобальный дневной лимит кредитов.',
  ACTIVE_RESERVATION_LIMIT: 'Достигнут лимит активных резервов.',
  INVALID_RESERVATION_STATE: 'Резерв уже находится в другом состоянии.',
  IDEMPOTENCY_CONFLICT: 'Ключ операции уже использован для других данных. Начни операцию заново.',
  ACCOUNT_NOT_FOUND: 'Аккаунт не найден.',
  RESERVATION_NOT_FOUND: 'Резерв не найден.',
  INVALID_INPUT: 'Сервер отклонил данные формы.',
};
export function errText(e: unknown) {
  const code = (e as { data?: { code?: unknown } } | null)?.data?.code;
  if (typeof code === 'string' && codeText[code]) return codeText[code];
  const s = errStatus(e);
  if (s === 401) return 'Сессия администратора истекла. Войди заново.';
  if (s === 403) return 'Действие запрещено для этой учётной записи.';
  return meduhaErrorMessage(e);
}

export const fmtInt = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? n.toLocaleString('ru-RU') : '—');
export const fmtSigned = (n: number) => (n > 0 ? `+${fmtInt(n)}` : fmtInt(n));
export function fmtDate(v: unknown) {
  if (typeof v !== 'string' && typeof v !== 'number') return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}
export const asArray = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
export const shortId = (id: unknown) => (typeof id === 'string' ? (id.length > 12 ? `${id.slice(0, 8)}…` : id) : '—');
export function newIdempotencyKey() {
  const c = globalThis.crypto;
  if (c?.randomUUID) return `adm-${c.randomUUID()}`;
  const b = new Uint8Array(16); c.getRandomValues(b);
  return `adm-${Array.from(b, x => x.toString(16).padStart(2, '0')).join('')}`;
}

let intentStore: ReturnType<typeof createIntentStore> | null = null;
/**
 * Stable idempotency key per intent, persisted (hashed index only) in sessionStorage
 * so a same-tab refresh after a lost response reuses the key. Cleared only on success.
 */
export function useIntentKey() {
  if (!intentStore) intentStore = createIntentStore(newIdempotencyKey, sessionStorageOrNull());
  const store = intentStore;
  return { keyFor: (sig: string) => store.keyFor(sig), pending: (sig: string) => store.pending(sig), settle: (sig: string) => store.settle(sig), durable: store.durable };
}

export function Skeleton({ rows = 5 }: { rows?: number }) {
  return <div className="adm-skel" aria-busy="true" aria-label="Загрузка">{Array.from({ length: rows }, (_, i) => <i key={i} />)}</div>;
}
export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return <div className="adm-error" role="alert"><AlertTriangle size={16} /><div>{errText(error)}</div>{onRetry && <button className="adm-btn sm" onClick={onRetry} data-testid="button-retry"><RotateCw size={13} />Повторить</button>}</div>;
}
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="adm-empty"><strong>{title}</strong>{children && <p>{children}</p>}</div>;
}
export function Feedback({ ok, error }: { ok?: string | null; error?: unknown }) {
  if (error) return <div className="adm-feedback bad" role="alert">{errText(error)}</div>;
  if (ok) return <div className="adm-feedback ok" role="status">{ok}</div>;
  return null;
}
export function Panel({ title, meta, actions, children }: { title: string; meta?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return <section className="adm-panel"><div className="adm-panel-head"><div><h2>{title}</h2>{meta && <small>{meta}</small>}</div>{actions}</div>{children}</section>;
}
export function PageHead({ kicker, title, children, actions }: { kicker: string; title: string; children?: ReactNode; actions?: ReactNode }) {
  return <div className="adm-head"><div><span className="adm-kicker">{kicker}</span><h1>{title}</h1>{children && <p>{children}</p>}</div>{actions}</div>;
}
export function Pager({ total, limit, offset, onChange }: { total: number; limit: number; offset: number; onChange: (o: number) => void }) {
  const from = total === 0 ? 0 : offset + 1; const to = Math.min(offset + limit, total);
  return <div className="adm-pager"><span className="num">{from}–{to} из {fmtInt(total)}</span><div className="adm-actions">
    <button className="adm-btn sm" disabled={offset <= 0} onClick={() => onChange(Math.max(0, offset - limit))} data-testid="button-page-prev">Назад</button>
    <button className="adm-btn sm" disabled={offset + limit >= total} onClick={() => onChange(offset + limit)} data-testid="button-page-next">Дальше</button>
  </div></div>;
}
/** Pager for array endpoints without totals: a full page means there may be more. */
export function ArrayPager({ count, limit, offset, onChange }: { count: number; limit: number; offset: number; onChange: (o: number) => void }) {
  if (offset === 0 && count < limit) return null;
  return <div className="adm-pager"><span className="num">{count ? `${offset + 1}–${offset + count}` : `с ${offset + 1}: пусто`}</span><div className="adm-actions">
    <button className="adm-btn sm" disabled={offset <= 0} onClick={() => onChange(Math.max(0, offset - limit))} data-testid="button-page-prev">Новее</button>
    <button className="adm-btn sm" disabled={count < limit} onClick={() => onChange(offset + limit)} data-testid="button-page-next">Старее</button>
  </div></div>;
}
export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} className="adm-switch" disabled={disabled} onClick={() => onChange(!checked)} />;
}

export function Modal({ title, onClose, children, footer, busy }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; busy?: boolean }) {
  const ref = useRef<HTMLDivElement>(null); const close = useRef(onClose); close.current = onClose;
  const busyRef = useRef(busy); busyRef.current = busy;
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null; const node = ref.current;
    const els = () => node ? [...node.querySelectorAll<HTMLElement>('button,input,select,textarea,a[href]')].filter(e => !e.hasAttribute('disabled')) : [];
    (node?.querySelector<HTMLElement>('input,select,textarea') ?? els()[0] ?? node)?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busyRef.current) { e.preventDefault(); close.current(); }
      if (e.key !== 'Tab') return; const list = els(); if (!list.length) return;
      if (e.shiftKey && document.activeElement === list[0]) { e.preventDefault(); list[list.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === list[list.length - 1]) { e.preventDefault(); list[0].focus(); }
    };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); if (prev?.isConnected) prev.focus(); };
  }, []);
  return <div className="adm-overlay" onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
    <div ref={ref} tabIndex={-1} className="adm-modal" role="dialog" aria-modal="true" aria-label={title}>
      <header><h2>{title}</h2><button className="adm-btn ghost sm" aria-label="Закрыть" onClick={onClose} disabled={busy} data-testid="button-modal-close"><X size={16} /></button></header>
      <div className="body">{children}</div>
      {footer && <footer>{footer}</footer>}
    </div>
  </div>;
}

/** Confirmation dialog for a single destructive or state-changing action. */
export function Confirm({ title, children, confirmLabel, danger, pending, error, onConfirm, onClose }: { title: string; children: ReactNode; confirmLabel: string; danger?: boolean; pending?: boolean; error?: unknown; onConfirm: () => void; onClose: () => void }) {
  return <Modal title={title} onClose={onClose} busy={pending} footer={<>
    <button className="adm-btn" onClick={onClose} disabled={pending} data-testid="button-confirm-cancel">Отмена</button>
    <button className={`adm-btn ${danger ? 'danger solid' : 'primary'}`} onClick={onConfirm} disabled={pending} data-testid="button-confirm">{pending ? 'Выполняется…' : error ? 'Повторить' : confirmLabel}</button>
  </>}>{children}<Feedback error={error} /></Modal>;
}

export function useFlash() {
  const [msg, setMsg] = useState<string | null>(null); const t = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(t.current), []);
  return { msg, flash: (m: string) => { setMsg(m); window.clearTimeout(t.current); t.current = window.setTimeout(() => setMsg(null), 4000); } };
}
