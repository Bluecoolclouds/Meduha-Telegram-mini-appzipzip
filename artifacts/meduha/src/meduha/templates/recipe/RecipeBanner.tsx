import { Lock, RefreshCw, Copy } from 'lucide-react';
import { Link } from 'wouter';
import { useMeduhaSession } from '../../session';
import { templateMediaUrl } from '../catalog';
import type { RecipeSource } from './useRecipeSource';
import './recipe.css';

/** Status + bound source files for an editor opened from a Community template. */
export default function RecipeBanner({ source, mismatch }: { source: RecipeSource; mismatch?: boolean }) {
  const session = useMeduhaSession();
  if (!source.active) return null;
  if (source.phase === 'loading') return <div className="rc-card rc-skel" data-testid="status-recipe-loading" aria-busy="true"><span/><span/></div>;
  if (source.phase === 'error') return <div className="rc-card rc-err" role="alert" data-testid="status-recipe-error"><strong>Шаблон не открылся</strong><p>{source.error}</p>
    <div className="rc-row"><button type="button" onClick={source.retry} data-testid="button-recipe-retry"><RefreshCw size={12}/>Повторить</button><Link href="/community" data-testid="link-recipe-community">В комьюнити</Link></div></div>;
  const view = source.view!;
  const files = Object.entries(view.files);
  return <div className="rc-card" data-testid="banner-recipe">
    <span className="rc-kicker"><Copy size={12}/>{source.own ? 'Твоя копия шаблона' : 'Шаблон сообщества'}</span>
    <strong data-testid="text-recipe-title">{view.title}</strong>
    <p>{mismatch ? 'Этот режим не совпадает с моделью шаблона — настройки шаблона здесь не применены.' : source.own
      ? 'Промпт, настройки и файлы скопированы в твой аккаунт. Правки меняют только твою копию, оригинал не меняется. Генерация не запускается сама.'
      : 'Предпросмотр: промпт, настройки и файлы шаблона подставлены ниже.'}</p>
    {files.length > 0 && <div className="rc-files" data-testid="list-recipe-files">{files.flatMap(([ptr, list]) => list.map((f, i) => <figure key={`${ptr}-${f.id}`} className="rc-file">
      {f.contentType.startsWith('video/') ? <video src={templateMediaUrl(f.url)} muted playsInline controls preload="metadata" aria-label={`Предпросмотр ${ptr.replace(/^\//, '')}`}/> : f.contentType.startsWith('image/') ? <img src={templateMediaUrl(f.url)} alt="" loading="lazy"/> : <span className="rc-doc">{f.contentType.split('/')[1] || 'файл'}</span>}
      <figcaption>{ptr.replace(/^\//, '')}{list.length > 1 ? ` ${i + 1}` : ''}</figcaption></figure>))}</div>}
    {source.guest && <div className="rc-login" data-testid="status-recipe-login"><Lock size={14}/><span><strong>Нужен вход через Telegram</strong>Чтобы повторить шаблон, мы скопируем файлы в твой аккаунт. Это доступно только после входа через Mini App в Telegram. Без входа — только просмотр.{session.telegramBotUrl && <> <a href={session.telegramBotUrl} target="_blank" rel="noreferrer" data-testid="link-recipe-bot">Открыть бота</a></>}</span></div>}
  </div>;
}
