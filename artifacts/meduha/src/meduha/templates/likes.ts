import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { setTemplateLike, type TemplateLikeState } from '@workspace/api-client-react';
import { meduhaErrorMessage, useMeduhaSession } from '../session';
import { isExampleTemplate, type InspirationTemplate } from './catalog';

export function usePublicationLike(template: InspirationTemplate) {
  const session = useMeduhaSession();
  const userId = session.phase === 'authenticated' ? session.account?.id : undefined;
  const queryClient = useQueryClient();
  const [confirmed, setConfirmed] = useState<{ id: string; userId: string; state: TemplateLikeState } | null>(null);
  useEffect(() => { setConfirmed(null); }, [template]);
  const mutation = useMutation({
    mutationFn: ({ id, liked }: { id: string; userId: string; liked: boolean }) =>
      setTemplateLike(id, { liked }, { credentials: 'same-origin', headers: { 'X-Meduha-Request': '1' } }),
    onSuccess: async (state, variables) => {
      setConfirmed({ id: variables.id, userId: variables.userId, state });
      await queryClient.invalidateQueries({ queryKey: ['meduha-template-feed'] });
    },
  });
  const state = confirmed?.id === template.id && confirmed.userId === userId
    ? confirmed.state : { likeCount: template.likeCount ?? 0, likedByMe: !!userId && (template.likedByMe ?? false) };

  async function toggle(): Promise<string | null> {
    if (isExampleTemplate(template)) return 'Это пример. Лайки доступны у публикаций участников.';
    if (!userId) return 'Войди в аккаунт через Telegram, чтобы ставить лайки.';
    if (mutation.isPending) return null;
    try {
      await mutation.mutateAsync({ id: template.id, userId, liked: !state.likedByMe });
      return null;
    } catch (error) {
      return meduhaErrorMessage(error);
    }
  }
  return { ...state, pending: mutation.isPending, toggle };
}
