import { useEffect, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Activity, Boxes, FileClock, Flag, KeyRound, LogOut, Megaphone, MonitorCog, Users, Wallet, Video } from 'lucide-react';
import { getGetMeduhaAdminStatusQueryKey, getListAdminReportsQueryKey, useGetMeduhaAdminStatus, useListAdminReports, useLoginMeduhaAdminPairing, useLogoutMeduhaAdmin, loginMeduhaAdminPassword } from '@workspace/api-client-react';
import type { AdminReport } from '@workspace/api-client-react';
import { ErrorBox, Feedback, Skeleton, adminQueryRequest, adminRequest, asArray, clearAdminQueries, errStatus, isAdminKey } from './ui';
import ConfigSection from './Config';
import PeopleSection from './People';
import FinanceSection from './Finance';
import SeedanceSection from './Seedance';
import { AuditSection, ModerationSection, OverviewSection } from './Ops';
import SessionsSection from './Sessions';
import BroadcastsSection from './Broadcasts';
import './admin.css';

type Tab = 'overview' | 'config' | 'users' | 'finance' | 'seedance' | 'moderation' | 'audit' | 'sessions' | 'broadcasts';
const tabs: { id: Tab; label: string; icon: typeof Activity }[] = [
  { id: 'overview', label: 'Пульт', icon: Activity }, { id: 'config', label: 'Каналы и модели', icon: Boxes },
  { id: 'users', label: 'Пользователи', icon: Users }, { id: 'finance', label: 'Финансы', icon: Wallet },
  { id: 'seedance', label: 'Seedance', icon: Video },
  { id: 'broadcasts', label: 'Рассылки', icon: Megaphone },
  { id: 'moderation', label: 'Модерация', icon: Flag }, { id: 'audit', label: 'Аудит', icon: FileClock },
  { id: 'sessions', label: 'Сеансы', icon: MonitorCog },
];

function PasswordLogin() {
  const qc = useQueryClient();
  const [name, setName] = useState('admin');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending || !name || !password) return;
    setPending(true); setError(null);
    // Call directly: React Query mutations retain their variables in the cache.
    // Credentials must never enter the shared mutation cache or storage.
    const request = loginMeduhaAdminPassword({ login: name, password }, adminRequest);
    setPassword('');
    try {
      await request;
      await clearAdminQueries(qc);
      await qc.invalidateQueries({ queryKey: getGetMeduhaAdminStatusQueryKey() });
    } catch (caught) { setError(caught); }
    finally { setPending(false); }
  };
  return <form className="adm-form" onSubmit={event => void submit(event)} autoComplete="off">
    <h2>Вход по паролю</h2>
    <p className="adm-login-help">Временный доступ владельца без Telegram. Пароль не сохраняется приложением.</p>
    <label className="adm-field"><span>Логин</span>
      <input type="text" value={name} onChange={e => setName(e.target.value)} autoComplete="off" maxLength={80} required disabled={pending} data-testid="input-admin-login" />
    </label>
    <label className="adm-field"><span>Пароль</span>
      <input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="off" maxLength={1024} required disabled={pending} data-testid="input-admin-password" />
    </label>
    <Feedback error={error} />
    <button className="adm-btn primary" disabled={pending || !name || !password} data-testid="button-password-login">{pending ? 'Проверяем…' : 'Войти в пульт'}</button>
  </form>;
}

function Login({ setupRequired, passwordAvailable }: { setupRequired: boolean; passwordAvailable: boolean }) {
  const qc = useQueryClient(); const login = useLoginMeduhaAdminPairing({ request: adminRequest });
  const [method, setMethod] = useState<'password' | 'code'>(passwordAvailable ? 'password' : 'code');
  const [code, setCode] = useState(''); const [touched, setTouched] = useState(false);
  const clean = code.trim().toLowerCase(); const valid = /^[a-f0-9]{64}$/.test(clean);
  const submit = (e: FormEvent) => {
    e.preventDefault(); setTouched(true); if (!valid || setupRequired) return;
    login.mutate({ data: { code: clean } }, { onSuccess: async () => { setCode(''); await clearAdminQueries(qc); await qc.invalidateQueries({ queryKey: getGetMeduhaAdminStatusQueryKey() }); }, onError: () => setCode('') });
  };
  return <div className="adm adm-login">
    <div className="adm-login-art">
      <div><span className="adm-kicker">meduha · пульт</span><h1>Управление<br />студией<i>.</i></h1><p>Каналы, модели, кредиты и модерация. Вход владельца по паролю или одноразовому коду из Mini App.</p></div>
      <ol>
        <li>Открой meduha в Telegram под аккаунтом администратора.</li>
        <li>Профиль → «Вход в пульт» → «Выпустить код». Код действует несколько минут и работает один раз.</li>
        <li>Скопируй код и вставь его здесь, в браузере на компьютере.</li>
      </ol>
    </div>
    <div className="adm-login-form">
      {passwordAvailable && <div className="adm-tabs adm-login-methods" aria-label="Способ входа">
        <button type="button" aria-pressed={method === 'password'} onClick={() => { setMethod('password'); setCode(''); login.reset(); }}>Логин и пароль</button>
        <button type="button" aria-pressed={method === 'code'} onClick={() => setMethod('code')}>Одноразовый код</button>
      </div>}
      {passwordAvailable && method === 'password' ? <PasswordLogin /> : setupRequired ? <>
        <span className="adm-kicker">Требуется настройка</span>
        <h2>Администратор не назначен</h2>
        <p>Сейчас на сервере нет назначенного Telegram-администратора, поэтому вход по коду закрыт. Права нельзя получить, просто открыв эту страницу первым.{passwordAvailable && ' Вход по паролю доступен на соседней вкладке.'}</p>
        <div className="adm-note"><KeyRound size={15} /><span>Владелец должен явно задать переменную окружения <strong className="mono">MEDUHA_ADMIN_TELEGRAM_ID</strong> — числовой Telegram ID своего аккаунта. Его можно скопировать в Mini App: Профиль → «Telegram ID». После перезапуска сервера выпусти код в Mini App и вернись сюда.</span></div>
        <button className="adm-btn" onClick={() => void qc.invalidateQueries({ queryKey: getGetMeduhaAdminStatusQueryKey() })} data-testid="button-status-recheck">Проверить снова</button>
      </> : <form className="adm-form" onSubmit={submit} noValidate>
        <h2>Вход по коду</h2>
        <p style={{ margin: 0, color: 'var(--ink-2)' }}>Вставь 64-символьный код, выпущенный в Mini App. Код не сохраняется в браузере.</p>
        <label className="adm-field"><span>Одноразовый код</span>
          <input type="password" className="mono" autoComplete="off" spellCheck={false} value={code} onChange={e => setCode(e.target.value)} maxLength={80} aria-invalid={touched && !valid} data-testid="input-pairing-code" />
          <small>{touched && !valid ? 'Код состоит из 64 символов 0–9 и a–f.' : `${clean.length}/64`}</small>
        </label>
        <Feedback error={login.error} />
        <button className="adm-btn primary" disabled={login.isPending} data-testid="button-admin-login">{login.isPending ? 'Проверяем…' : 'Войти в пульт'}</button>
      </form>}
    </div>
  </div>;
}

function Shell({ onLogout, loggingOut, logoutError }: { onLogout: () => void; loggingOut: boolean; logoutError: unknown }) {
  const [tab, setTab] = useState<Tab>('overview');
  const reports = useListAdminReports({ limit: 100, offset: 0 }, { request: adminQueryRequest, query: { queryKey: getListAdminReportsQueryKey({ limit: 100, offset: 0 }), refetchInterval: 60_000 } });
  const pending = asArray<AdminReport>(reports.data).filter(r => r.status === 'pending').length;
  useEffect(() => { window.scrollTo(0, 0); }, [tab]);
  return <div className="adm adm-shell">
    <aside className="adm-side">
      <div className="adm-brand"><strong>meduha<i>.</i></strong><small>пульт</small></div>
      <nav className="adm-nav" aria-label="Разделы пульта">{tabs.map(({ id, label, icon: Icon }) => <button key={id} aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)} data-testid={`nav-admin-${id}`}><Icon size={16} />{label}{id === 'moderation' && pending > 0 && <span className="count" title="Неразобранные жалобы среди последних 100 записей">{reports.data?.length === 100 ? '≥' : ''}{pending}</span>}</button>)}</nav>
       <div className="adm-side-foot"><span>Сеанс администратора в этом браузере. Здесь доступна сверка запросов Seedance.</span>{Boolean(logoutError) && <span style={{ color: 'hsl(354 70% 75%)' }}>Не удалось выйти. Повтори.</span>}<button onClick={onLogout} disabled={loggingOut} data-testid="button-admin-logout"><LogOut size={14} />{loggingOut ? 'Выходим…' : 'Выйти'}</button></div>
    </aside>
    <div className="adm-topbar"><strong>meduha<span style={{ color: 'var(--signal)' }}>.</span></strong><select value={tab} onChange={e => setTab(e.target.value as Tab)} aria-label="Раздел">{tabs.map(t => <option key={t.id} value={t.id}>{t.label}{t.id === 'moderation' && pending ? ` (${pending})` : ''}</option>)}</select><button onClick={onLogout} disabled={loggingOut} aria-label="Выйти"><LogOut size={15} /></button></div>
    <main className="adm-main">
      {tab === 'overview' && <OverviewSection />}{tab === 'config' && <ConfigSection />}{tab === 'users' && <PeopleSection />}
      {tab === 'finance' && <FinanceSection />}{tab === 'seedance' && <SeedanceSection />}
      {tab === 'moderation' && <ModerationSection />}{tab === 'audit' && <AuditSection />}
      {tab === 'sessions' && <SessionsSection />}{tab === 'broadcasts' && <BroadcastsSection />}
    </main>
  </div>;
}

export default function AdminApp() {
  const qc = useQueryClient();
  const status = useGetMeduhaAdminStatus({ request: adminQueryRequest, query: { queryKey: getGetMeduhaAdminStatusQueryKey(), staleTime: 0, refetchOnWindowFocus: true, refetchInterval: 120_000, retry: false } });
  const logout = useLogoutMeduhaAdmin({ request: adminRequest });
  const authed = Boolean(status.data?.authenticated && status.data?.isAdmin);

  // Drop admin data whenever the admin session is not confirmed.
  useEffect(() => { if (status.data && !authed) void clearAdminQueries(qc); }, [status.data, authed, qc]);
  // Any admin query answering 401/403 means the cookie is gone: clear and recheck.
  useEffect(() => qc.getQueryCache().subscribe(ev => {
    if (ev.type !== 'updated' || ev.action.type !== 'error') return;
    if (!isAdminKey(ev.query.queryKey)) return;
    const s = errStatus(ev.action.error);
    if (s === 401 || s === 403) { void clearAdminQueries(qc).then(() => qc.invalidateQueries({ queryKey: getGetMeduhaAdminStatusQueryKey() })); }
  }), [qc]);
  useEffect(() => { const prev = document.title; document.title = 'Пульт — meduha'; return () => { document.title = prev; }; }, []);

  const doLogout = () => logout.mutate(undefined, { onSettled: async (_d, e) => {
    if (e && errStatus(e) !== 401) return;
    await clearAdminQueries(qc); qc.setQueryData(getGetMeduhaAdminStatusQueryKey(), { ...status.data, authenticated: false, isAdmin: false, adminId: undefined, authMethod: undefined });
    void qc.invalidateQueries({ queryKey: getGetMeduhaAdminStatusQueryKey() });
  } });

  if (status.isLoading) return <div className="adm" style={{ padding: 40 }}><Skeleton rows={6} /></div>;
  if (status.isError || !status.data) return <div className="adm" style={{ padding: 40, maxWidth: 640 }}><h1 style={{ letterSpacing: '-.02em' }}>Пульт недоступен</h1><ErrorBox error={status.error ?? new Error('Сервер не ответил')} onRetry={() => void status.refetch()} /></div>;
  if (status.data.authenticated && !status.data.isAdmin) return <div className="adm" style={{ padding: 40, maxWidth: 640 }}><span className="adm-kicker">Доступ закрыт</span><h1>Нет прав администратора</h1><p>Этот сеанс не принадлежит назначенному администратору.</p><button className="adm-btn" onClick={doLogout} data-testid="button-admin-logout">Выйти</button></div>;
   if (!authed) return <Login setupRequired={status.data.setupRequired} passwordAvailable={status.data.passwordLoginAvailable} />;
  return <Shell onLogout={doLogout} loggingOut={logout.isPending} logoutError={logout.error} />;
}
