import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  authenticateMeduhaTelegram, deleteMeduhaDraft, getGetMeduhaBootstrapQueryKey,
  getGetMeduhaSessionQueryKey, getMeduhaBootstrap, importMeduhaDrafts, logoutMeduha,
  saveMeduhaDraft, saveMeduhaSettings, useGetMeduhaBootstrap, useGetMeduhaSession,
} from '@workspace/api-client-react';
import type { MeduhaAccount, MeduhaBootstrap, MeduhaDraft, MeduhaDraftInput, MeduhaPreferences } from '@workspace/api-client-react';
import type { Draft, Settings } from './studio';

const mutationOptions = { credentials: 'same-origin' as const, headers: { 'X-Meduha-Request': '1' } };
type Phase = 'checking' | 'authenticating' | 'loading-account' | 'guest' | 'authenticated' | 'error' | 'expired';
type ContextValue = {
  phase: Phase; account: MeduhaAccount | null; bootstrap: MeduhaBootstrap | undefined;
  telegram: boolean; telegramConfigured: boolean | undefined; telegramBotUrl: string | null; error: unknown;
  continueGuest: () => void; retry: () => void; reauthenticate: () => void;
  saveDraft: (draft: Draft) => Promise<void>; deleteDraft: (id: string) => Promise<void>;
  importDrafts: (drafts: MeduhaDraft[]) => Promise<MeduhaDraft[]>; saveSettings: (settings: Settings) => Promise<void>;
  refreshBootstrap: () => Promise<void>;
};
const SessionContext = createContext<ContextValue | null>(null);

function telegramApp() {
  return (window as Window & { Telegram?: { WebApp?: { initData?: string; platform?: string; initDataUnsafe?: { user?: { id?: number | string } }; ready?: () => void; expand?: () => void } } }).Telegram?.WebApp;
}
function apiErrorStatus(error: unknown) { return (error as { status?: number } | null)?.status; }
export function meduhaErrorMessage(error: unknown): string {
  const apiError = error as { data?: { error?: unknown; code?: unknown; message?: unknown }; message?: string } | null;
  const data = apiError?.data;
  if (data && typeof data === 'object') {
    if (typeof data.code === 'string' && data.code === 'TELEGRAM_NOT_CONFIGURED') return 'Проверка аккаунтов Telegram пока не настроена на сервере.';
    if (typeof data.error === 'string' && data.error.trim()) return data.error;
    if (typeof data.message === 'string' && data.message.trim()) return data.message;
    if (typeof data.code === 'string' && data.code.trim()) return `Ошибка сервиса: ${data.code}`;
  }
  return typeof apiError?.message === 'string' && apiError.message.trim() ? apiError.message : 'Проверь соединение и попробуй ещё раз.';
}
function asInput(draft: Draft): MeduhaDraftInput {
  return { title: draft.title.slice(0, 100), type: draft.type, prompt: draft.prompt, style: draft.style.slice(0, 100), model: draft.model.slice(0, 100), ratio: draft.ratio.slice(0, 30), duration: draft.duration.slice(0, 30), ...(draft.referenceName ? { referenceName: draft.referenceName.slice(0, 255) } : {}) };
}
function mergeDrafts(current: MeduhaDraft[], additions: MeduhaDraft[]) {
  const rows = new Map(current.map(row => [row.id, row]));
  additions.forEach(row => rows.set(row.id, row));
  return [...rows.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

export function MeduhaSessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const sessionQuery = useGetMeduhaSession({ query: { queryKey: getGetMeduhaSessionQueryKey(), staleTime: 0, refetchOnWindowFocus: true, retry: false } });
  const session = sessionQuery.data;
  const [phase, setPhase] = useState<Phase>('checking');
  const [error, setError] = useState<unknown>(null);
  const manualGuest = useRef(false);
  const expiredRef = useRef(false);
  const authInFlight = useRef(false);
  const attemptKey = useRef('');
  const sessionEpoch = useRef(0);
  const verifiedAccountId = useRef<string | null>(null);
  const tg = telegramApp();
  // The official SDK is injected in ordinary browsers too. Only initData or a
  // non-unknown Telegram platform indicates a real Mini App environment.
  const telegram = Boolean(tg?.initData?.trim() || (tg?.platform && tg.platform !== 'unknown'));
  const bootstrapQuery = useGetMeduhaBootstrap({ query: { queryKey: getGetMeduhaBootstrapQueryKey(), enabled: phase === 'authenticated', staleTime: 15_000, refetchOnWindowFocus: true, refetchOnMount: 'always', retry: false } });
  const account = phase === 'authenticated' ? (bootstrapQuery.data?.account ?? session?.account ?? null) : null;

  const privateQueryPredicate = (query: { queryKey: readonly unknown[] }) => {
    const path = query.queryKey[0];
    return typeof path === 'string' && path.startsWith('/api/meduha/') && path !== '/api/meduha/session';
  };
  const clearPrivateQueries = async () => {
    sessionEpoch.current += 1;
    await queryClient.cancelQueries({ predicate: privateQueryPredicate });
    await queryClient.cancelQueries({ queryKey: getGetMeduhaSessionQueryKey() });
    queryClient.removeQueries({ predicate: privateQueryPredicate });
    verifiedAccountId.current = null;
  };
  const expireSession = async (reason: unknown, configured = session?.telegramConfigured ?? true) => {
    if (expiredRef.current) return;
    expiredRef.current = true;
    manualGuest.current = true;
    setError(reason);
    setPhase('expired');
    await clearPrivateQueries();
    queryClient.setQueryData(getGetMeduhaSessionQueryKey(), { account: null, telegramConfigured: configured, telegramBotUsername: session?.telegramBotUsername ?? null });
  };
  const invalidateBootstrapLater = () => {
    void queryClient.invalidateQueries({ queryKey: getGetMeduhaBootstrapQueryKey() });
  };
  const runPrivateMutation = async <T,>(operation: () => Promise<T>): Promise<T> => {
    const epoch = sessionEpoch.current;
    try {
      return await operation();
    } catch (caught) {
      if (epoch === sessionEpoch.current && apiErrorStatus(caught) === 401) await expireSession(caught);
      throw caught;
    }
  };

  const beginAuth = async (initData: string) => {
    if (authInFlight.current) return;
    authInFlight.current = true;
    const epoch = sessionEpoch.current + 1;
    sessionEpoch.current = epoch;
    setPhase('authenticating'); setError(null); verifiedAccountId.current = null;
    await queryClient.cancelQueries({ predicate: privateQueryPredicate });
    queryClient.removeQueries({ predicate: privateQueryPredicate });
    try {
      const result = await authenticateMeduhaTelegram({ initData }, mutationOptions);
      if (epoch !== sessionEpoch.current) return;
      if (!result.account) throw new Error('Telegram не подтвердил аккаунт.');
      attemptKey.current = `existing:${result.account.id}`;
      queryClient.setQueryData(getGetMeduhaSessionQueryKey(), result);
      manualGuest.current = false;
      setPhase('loading-account');
      const data = await getMeduhaBootstrap({ credentials: 'same-origin' });
      if (epoch !== sessionEpoch.current) return;
      queryClient.setQueryData(getGetMeduhaBootstrapQueryKey(), data);
      verifiedAccountId.current = result.account.id;
      setPhase('authenticated');
    } catch (caught) {
      if (epoch === sessionEpoch.current) { setError(caught); setPhase('error'); }
    } finally {
      authInFlight.current = false;
    }
  };

  useEffect(() => {
    if (expiredRef.current || authInFlight.current) return;
    if (manualGuest.current && phase === 'guest') return;
    if (sessionQuery.isLoading || sessionQuery.isFetching) return;
    if (sessionQuery.isError) {
      setError(sessionQuery.error);
      if (apiErrorStatus(sessionQuery.error) === 401) void expireSession(sessionQuery.error);
      else setPhase('error');
      return;
    }
    if (!session) return;
    if (manualGuest.current) { setPhase('guest'); return; }
    if (!telegram) {
      if (verifiedAccountId.current || phase === 'authenticated') void expireSession(new Error('Открыта локальная гостевая студия.'));
      else setPhase('guest');
      return;
    }
    if (session.account === null && (phase === 'authenticated' || verifiedAccountId.current !== null)) {
      void expireSession(new Error('Аккаунт больше не подтверждён. Подтверди вход заново.'), session.telegramConfigured);
      return;
    }
    if (!tg?.initData?.trim()) {
      setError(new Error('Telegram initData недоступен. Закрой и заново открой Mini App из Telegram.'));
      setPhase('error');
      return;
    }
    const displayedId = tg.initDataUnsafe?.user?.id;
    const matches = displayedId !== undefined && session.account?.id === String(displayedId);
    if (session.account && matches) {
      const existingKey = `existing:${session.account.id}`;
      if (attemptKey.current === existingKey) return;
      attemptKey.current = existingKey;
      setPhase('loading-account'); setError(null);
      const epoch = sessionEpoch.current;
      getMeduhaBootstrap({ credentials: 'same-origin' }).then(data => {
        if (epoch !== sessionEpoch.current) return;
        queryClient.setQueryData(getGetMeduhaBootstrapQueryKey(), data);
        verifiedAccountId.current = session.account!.id;
        setPhase('authenticated');
      }).catch(caught => {
        if (epoch !== sessionEpoch.current) return;
        if (apiErrorStatus(caught) === 401) void expireSession(caught, session.telegramConfigured);
        else { setError(caught); setPhase('error'); }
      });
      return;
    }
    const key = `auth:${session.account?.id ?? 'anonymous'}:${tg.initData.slice(0, 24)}`;
    if (attemptKey.current === key) return;
    attemptKey.current = key;
    void beginAuth(tg.initData);
  }, [session, sessionQuery.isLoading, sessionQuery.isFetching, sessionQuery.isError, sessionQuery.error, telegram, tg, queryClient, phase]);

  useEffect(() => {
    if (phase === 'authenticated' && bootstrapQuery.isError) {
      if (apiErrorStatus(bootstrapQuery.error) === 401) void expireSession(bootstrapQuery.error);
      else { setError(bootstrapQuery.error); setPhase('error'); }
    }
  }, [phase, bootstrapQuery.isError, bootstrapQuery.error]);
  useEffect(() => { if (telegram) { tg?.ready?.(); tg?.expand?.(); } }, [telegram, tg]);

  const saveDraftForAccount = async (draft: Draft) => {
    const epoch = sessionEpoch.current;
    const saved = await runPrivateMutation(() => saveMeduhaDraft(draft.id, asInput(draft), mutationOptions));
    if (epoch === sessionEpoch.current) {
      queryClient.setQueryData<MeduhaBootstrap>(getGetMeduhaBootstrapQueryKey(), old => old ? { ...old, drafts: mergeDrafts(old.drafts, [saved]) } : old);
      invalidateBootstrapLater();
    }
  };
  const deleteDraftForAccount = async (id: string) => {
    const epoch = sessionEpoch.current;
    await runPrivateMutation(() => deleteMeduhaDraft(id, mutationOptions));
    if (epoch === sessionEpoch.current) {
      queryClient.setQueryData<MeduhaBootstrap>(getGetMeduhaBootstrapQueryKey(), old => old ? { ...old, drafts: old.drafts.filter(row => row.id !== id) } : old);
      invalidateBootstrapLater();
    }
  };
  const importDraftsForAccount = async (drafts: MeduhaDraft[]) => {
    const epoch = sessionEpoch.current;
    let imported: MeduhaDraft[] = [];
    for (let index = 0; index < drafts.length; index += 100) {
      const chunk = drafts.slice(index, index + 100);
      const result = await runPrivateMutation(() => importMeduhaDrafts({ drafts: chunk }, mutationOptions));
      if (epoch !== sessionEpoch.current) throw new Error('Сеанс изменился во время импорта.');
      imported = result;
      queryClient.setQueryData<MeduhaBootstrap>(getGetMeduhaBootstrapQueryKey(), old => old ? { ...old, drafts: mergeDrafts(old.drafts, result) } : old);
      invalidateBootstrapLater();
    }
    return imported;
  };
  const saveSettingsForAccount = async (settings: Settings) => {
    const epoch = sessionEpoch.current;
    const saved = await runPrivateMutation(() => saveMeduhaSettings(settings as MeduhaPreferences, mutationOptions));
    if (epoch === sessionEpoch.current) {
      queryClient.setQueryData<MeduhaBootstrap>(getGetMeduhaBootstrapQueryKey(), old => old ? { ...old, settings: saved } : old);
      invalidateBootstrapLater();
    }
  };

  const value: ContextValue = {
    phase, account, bootstrap: bootstrapQuery.data, telegram, telegramConfigured: session?.telegramConfigured,
    telegramBotUrl: session?.telegramBotUsername ? `https://t.me/${encodeURIComponent(session.telegramBotUsername)}` : null, error,
    continueGuest: () => {
      manualGuest.current = true; expiredRef.current = false; setError(null);
      if (session?.account) void logoutMeduha(mutationOptions).catch(() => undefined);
      void clearPrivateQueries().then(() => {
        queryClient.setQueryData(getGetMeduhaSessionQueryKey(), { account: null, telegramConfigured: session?.telegramConfigured ?? true, telegramBotUsername: session?.telegramBotUsername ?? null });
        setPhase('guest');
      });
    },
    retry: () => { expiredRef.current = false; setError(null); attemptKey.current = ''; void sessionQuery.refetch(); },
    reauthenticate: () => {
      expiredRef.current = false; manualGuest.current = false; attemptKey.current = '';
      if (tg?.initData?.trim()) void beginAuth(tg.initData);
      else { setPhase('error'); setError(new Error('Telegram initData недоступен. Закрой и заново открой Mini App из Telegram.')); }
    },
    saveDraft: saveDraftForAccount,
    deleteDraft: deleteDraftForAccount,
    importDrafts: importDraftsForAccount,
    saveSettings: saveSettingsForAccount,
    refreshBootstrap: async () => { await bootstrapQuery.refetch(); },
  };
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
export function useMeduhaSession() { const value = useContext(SessionContext); if (!value) throw new Error('MeduhaSessionProvider is required'); return value; }
