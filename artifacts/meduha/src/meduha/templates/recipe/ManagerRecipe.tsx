import { useQuery } from '@tanstack/react-query';
import { Layers, X } from 'lucide-react';
import { templateMediaUrl } from '../catalog';
import { fetchTemplateRecipe, fetchTemplateRepeat } from './api';
import { genjutsuModeOf, type Recipe } from './model';
import './recipe.css';

export const useRecipeDraft = (id: string | null, account: string | undefined) => useQuery({
  queryKey: ['meduha-template-repeat', account ?? '', id], enabled: !!id && !!account, retry: false, staleTime: Infinity,
  queryFn: ({ signal }) => fetchTemplateRepeat(id!, signal),
});

/** Source files of the recipe (not the published result) plus explicit removal. */
export function ManagerRecipe({ recipe, viewId, templateId, onClear, consent, onConsent }: { recipe: Recipe; viewId: string | null; templateId: string | null; onClear: () => void; consent: boolean; onConsent: (v: boolean) => void }) {
  const files = useQuery({
    queryKey: ['meduha-template-recipe-files', viewId ?? templateId],
    enabled: !!(viewId || templateId), retry: false, staleTime: 60_000,
    queryFn: ({ signal }) => viewId ? fetchTemplateRepeat(viewId, signal) : fetchTemplateRecipe(templateId!, signal),
  });
  const count = Object.values(recipe.references).reduce((n, l) => n + l.length, 0);
  const gj = genjutsuModeOf(recipe.catalogId);
  return <div className="rc-card" data-testid="section-template-recipe">
    <span className="rc-kicker"><Layers size={12}/>Рецепт для повтора</span>
    <strong data-testid="text-recipe-model">{gj ? `Genjutsu · ${gj}` : recipe.catalogId}</strong>
    <p>Модель, настройки и {count} исходных файлов. Это не результат: результат и обложку загрузи выше. По кнопке «Повторить» другие получат копию этих исходных файлов.</p>
    {files.data && <div className="rc-files">{Object.entries(files.data.files).flatMap(([ptr, list]) => list.map((f, i) => <figure key={`${ptr}-${f.id}`} className="rc-file">
      {f.contentType.startsWith('video/') ? <video src={templateMediaUrl(f.url)} muted preload="metadata"/> : <img src={templateMediaUrl(f.url)} alt="" loading="lazy"/>}
      <figcaption>{ptr.replace(/^\//, '')} {i + 1}</figcaption></figure>))}</div>}
    {files.isError && <p className="rc-note">Превью исходных файлов не загрузилось — рецепт всё равно сохранится.</p>}
    <label className="tm-consent" style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12.5 }}>
      <input type="checkbox" checked={consent} onChange={e => onConsent(e.target.checked)} data-testid="checkbox-recipe-consent"/>
      <span>Я понимаю: после публикации исходные файлы рецепта (фото, видео) смогут копировать и использовать другие пользователи.</span></label>
    <button type="button" className="tm-btn" onClick={onClear} data-testid="button-clear-recipe"><X size={12}/>Убрать рецепт — оставить только промпт</button>
  </div>;
}
