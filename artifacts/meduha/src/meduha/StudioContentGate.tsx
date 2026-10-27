import { RotateCw } from 'lucide-react';
import { Link } from 'wouter';
import { mood } from './shared';
import { meduhaErrorMessage } from './session';
import type { StudioContentState } from './useStudioContent';
import './studio-content.css';

/** Loading/error surface shown before curated content is known, so disabled items never flash. */
export function StudioContentPending({ content }: { content: StudioContentState }) {
  if (content.error) return <div className="sc-state" role="alert" data-testid="status-studio-content-error">
    <img src={mood('curious')} alt=""/>
    <strong>Подборка не загрузилась</strong>
    <p>{meduhaErrorMessage(content.error)}</p>
    <button type="button" onClick={content.retry} data-testid="button-studio-content-retry"><RotateCw size={14}/>Повторить</button>
  </div>;
  return <div className="sc-skel" aria-busy="true" aria-label="Загружаем подборку" data-testid="status-studio-content-loading">
    <i className="hero"/><i/><i/><i/><i/>
  </div>;
}

export function ScenarioUnavailable({ backHref, label }: { backHref: string; label: string }) {
  return <div className="sc-state" data-testid="status-scenario-unavailable">
    <img src={mood('curious')} alt=""/>
    <strong>Сценарий сейчас недоступен</strong>
    <p>Его временно убрали из подборки. Сохранённые черновики остаются в истории.</p>
    <Link href={backHref} data-testid="link-scenario-unavailable-back">{label}</Link>
  </div>;
}
