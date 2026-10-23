import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { setTemplateSave, type TemplateSaveState } from '@workspace/api-client-react';
import { meduhaErrorMessage, useMeduhaSession } from '../session';
import { isExampleTemplate, type InspirationTemplate } from './catalog';

export function usePublicationSave(template: InspirationTemplate) {
  const session = useMeduhaSession();
  const userId = session.phase === 'authenticated' ? session.account?.id : undefined;
  const queryClient = useQueryClient();
  const [confirmed, setConfirmed] = useState<{ id: string; userId: string; state: TemplateSaveState } | null>(null);
  useEffect(() => { setConfirmed(null); }, [template.id, userId]);

  const mutation = useMutation({
    mutationFn: ({ id, saved }: { id: string; userId: string; saved: boolean }) =>
      setTemplateSave(id, { saved }, { credentials: 'same-origin', headers: { 'X-Meduha-Request': '1' } }),
    onSuccess: async (state, variables) => {
      setConfirmed({ id: variables.id, userId: variables.userId, state });
      await queryClient.invalidateQueries({ queryKey: ['meduha-template-feed'] });
      await queryClient.invalidateQueries({ queryKey: ['meduha-public-template'] });
    },
  });
  const savedByMe = confirmed?.id === template.id && confirmed.userId === userId
    ? confirmed.state.savedByMe
    : !!userId && (template.savedByMe ?? false);

  async function toggle(): Promise<string | null> {
    if (isExampleTemplate(template)) return 'Сохранять можно только публикации участников.';
    if (!userId) return 'Войди в аккаунт через Telegram, чтобы сохранять работы.';
    if (mutation.isPending) return null;
    try {
      await mutation.mutateAsync({ id: template.id, userId, saved: !savedByMe });
      return null;
    } catch (error) {
      return meduhaErrorMessage(error);
    }
  }

  return { savedByMe, pending: mutation.isPending, toggle };
}
