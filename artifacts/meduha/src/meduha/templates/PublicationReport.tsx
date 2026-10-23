import { useState, type FormEvent } from 'react';
import { LoaderCircle } from 'lucide-react';
import { useSubmitMeduhaReport } from '@workspace/api-client-react';
import { Sheet } from '../shared';
import { useMeduhaSession } from '../session';

type Props = { templateId: string; onClose: () => void; onSubmitted: () => void };

export function PublicationReport({ templateId, onClose, onSubmitted }: Props) {
  const session = useMeduhaSession();
  const mutation = useSubmitMeduhaReport({
    request: { credentials: 'same-origin', headers: { 'X-Meduha-Request': '1' } },
  });
  const [category, setCategory] = useState('Спам или реклама');
  const [details, setDetails] = useState('');
  const [error, setError] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (mutation.isPending) return;
    setError('');
    try {
      await mutation.mutateAsync({
        data: { templateId, reason: `${category}${details.trim() ? `: ${details.trim()}` : ''}` },
      });
      onSubmitted();
    } catch {
      setError('Не удалось отправить жалобу. Проверь подключение и попробуй ещё раз.');
    }
  }

  return <Sheet title="Пожаловаться на работу" className="mw-prompt-sheet" onClose={onClose}>
    {session.phase !== 'authenticated' ? <>
      <p>Отправить жалобу можно из подтверждённого аккаунта. Открой миниапп через Telegram и войди в свой аккаунт.</p>
      <button className="mw-detail-copy" onClick={onClose}>Понятно</button>
    </> : <form className="mw-report-form" onSubmit={submit}>
      <p>Жалоба попадёт модератору. Автор публикации не увидит, кто её отправил.</p>
      <label>Причина
        <select value={category} onChange={event => setCategory(event.target.value)} disabled={mutation.isPending}>
          <option>Спам или реклама</option>
          <option>Опасный или запрещённый контент</option>
          <option>Нарушение авторских прав</option>
          <option>Другое</option>
        </select>
      </label>
      <label>Подробности, если нужно
        <textarea value={details} onChange={event => setDetails(event.target.value)} maxLength={800} rows={4}
          placeholder="Что не так с публикацией?" disabled={mutation.isPending}/>
      </label>
      {error && <p role="alert">{error}</p>}
      <button className="mw-detail-copy" type="submit" disabled={mutation.isPending}>
        {mutation.isPending && <LoaderCircle size={15} className="mt-spin"/>}
        {mutation.isPending ? 'Отправляем…' : 'Отправить жалобу'}
      </button>
    </form>}
  </Sheet>;
}
