import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation, useSearch } from 'wouter';
import { useMeduhaSession, meduhaErrorMessage } from '../../session';
import { fetchTemplateRecipe, fetchTemplateRepeat, postTemplateRepeat } from './api';
import { intentStorageKey, isRepeatId, recipeHref, repeatStoreSuffix, type RecipeView } from './model';

export type RecipeSource = {
  active: boolean;
  phase: 'none' | 'loading' | 'error' | 'ready';
  view: RecipeView | null;
  /** true once the view is the account's own immutable copy (files owned). */
  own: boolean;
  guest: boolean;
  repeatId: string | null;
  templateId: string | null;
  error: string;
  retry: () => void;
  /** Local-draft scope: account + repeat id. null when nothing should be persisted. */
  storeSuffix: string | null;
  /** Query fragment to carry when linking to another editor of the same recipe. */
  carry: string;
};

function stableRequestId(account: string, templateId: string): string {
  const key = intentStorageKey(account, templateId);
  try { const v = localStorage.getItem(key); if (v && /^[0-9a-f-]{36}$/i.test(v)) return v; } catch { /* storage blocked */ }
  const id = crypto.randomUUID();
  try { localStorage.setItem(key, id); } catch { /* storage blocked */ }
  return id;
}

/** Shared gate: public preview for guests, own idempotent copy for accounts. Never generates or spends. */
export function useRecipeSource(): RecipeSource {
  const search = useSearch();
  const [, navigate] = useLocation();
  const session = useMeduhaSession();
  const q = new URLSearchParams(search);
  const draft = q.get('draft');
  const repeatId = isRepeatId(q.get('repeat')) ? q.get('repeat') : isRepeatId(draft) ? draft : null;
  const templateId = repeatId ? null : q.get('template');
  const account = session.phase === 'authenticated' ? session.account?.id ?? '' : '';
  const checking = session.phase === 'checking' || (session.phase === 'authenticated' && !account);
  const guest = !checking && !account;
  const active = !!(repeatId || templateId);

  const requestId = useMemo(() => account && templateId ? stableRequestId(account, templateId) : '', [account, templateId]);
  const own = useQuery({
    queryKey: ['meduha-template-repeat', account, repeatId],
    enabled: !!account && !!repeatId, retry: false, staleTime: Infinity,
    queryFn: ({ signal }) => fetchTemplateRepeat(repeatId!, signal),
  });
  const copy = useQuery({
    queryKey: ['meduha-template-repeat-create', account, templateId, requestId],
    enabled: !!account && !!templateId && !!requestId, retry: false, staleTime: Infinity, gcTime: Infinity,
    queryFn: () => postTemplateRepeat(templateId!, requestId),
  });
  const preview = useQuery({
    queryKey: ['meduha-template-recipe', templateId],
    enabled: guest && !!templateId, retry: false, staleTime: 60_000,
    queryFn: ({ signal }) => fetchTemplateRecipe(templateId!, signal),
  });

  useEffect(() => {
    if (!copy.data || !templateId) return;
    navigate(recipeHref(copy.data.recipe, { repeat: copy.data.id }), { replace: true });
  }, [copy.data, templateId, navigate]);

  const base = { active, guest, repeatId, templateId, carry: repeatId ? `&repeat=${encodeURIComponent(repeatId)}` : templateId ? `&template=${encodeURIComponent(templateId)}` : '' };
  const none: RecipeSource = { ...base, phase: 'none', view: null, own: false, error: '', retry: () => undefined, storeSuffix: null };
  if (!active) return none;
  if (checking) return { ...none, phase: 'loading' };
  const query = repeatId ? (account ? own : null) : account ? copy : preview;
  if (!query) return { ...none, phase: 'error', error: 'Свой повтор шаблона открывается только после входа через Telegram.' };
  if (query.isError) return { ...none, phase: 'error', error: meduhaErrorMessage(query.error), retry: () => void query.refetch() };
  if (!query.data || (!!account && !!templateId)) return { ...none, phase: 'loading' };
  return { ...none, phase: 'ready', view: query.data, own: !!account && !!repeatId, storeSuffix: account && repeatId ? repeatStoreSuffix(account, repeatId) : null };
}
