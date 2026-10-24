import { useState } from 'react';
import { BookmarkPlus, LoaderCircle } from 'lucide-react';
import { useLocation } from 'wouter';
import { meduhaErrorMessage } from '../../session';
import { postRecipeDraft } from './api';
import type { Recipe } from './model';
import './recipe.css';

/** Saves the current validated editor state as an own recipe snapshot, then hands off to the manager. */
export default function SaveAsTemplate({ recipe, title, disabledReason }: { recipe: Recipe; title: string; disabledReason: string | null }) {
  const [, navigate] = useLocation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async () => {
    if (busy || disabledReason) return;
    setBusy(true); setError('');
    try {
      const view = await postRecipeDraft(title.trim().slice(0, 100) || 'Мой шаблон', recipe);
      navigate(`/community/manage?recipeDraft=${encodeURIComponent(view.id)}`);
    } catch (e) { setError(meduhaErrorMessage(e)); setBusy(false); }
  };
  return <div>
    <button type="button" className="rc-save" disabled={busy || !!disabledReason} onClick={() => void run()} data-testid="button-save-as-template">
      {busy ? <LoaderCircle size={13} className="mt-spin"/> : <BookmarkPlus size={13}/>}Сохранить как шаблон</button>
    {disabledReason ? <p className="rc-note">{disabledReason}</p> : <p className="rc-note">Настройки и файлы станут рецептом для публикации. Генерация не запускается.</p>}
    {error && <p className="rc-note" role="alert" data-testid="text-save-template-error">{error}</p>}
  </div>;
}
