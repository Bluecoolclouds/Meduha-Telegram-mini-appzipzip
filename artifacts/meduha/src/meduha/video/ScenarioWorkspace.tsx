import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ExternalLink, ImagePlus, Save, Video } from 'lucide-react';
import { Link, useSearch } from 'wouter';
import { Frame, useToast } from '../shared';
import { loadDrafts, saveDrafts, useDraftList, type Draft } from '../studio';
import { useMeduhaSession } from '../session';
import type { VideoScenario } from './scenarios';
import SeedanceGenerationPanel from './SeedanceGenerationPanel';
import ExamplePreview from './genjutsu/ExamplePreview';
import './genjutsu/genjutsu.css';
import './scenario-workspace.css';

type ContentPlan = { platform: string; count: string; format: string };
const planMarker = /\n\nПараметры контент-плана Meduha:\nПлощадка: (.*)\nИдей: (\d+)\nФормат: (.*)$/;

function unpackPrompt(value: string): { prompt: string; plan: ContentPlan } {
  const match = planMarker.exec(value);
  return match
    ? { prompt: value.slice(0, match.index), plan: { platform: match[1], count: match[2], format: match[3] } }
    : { prompt: value, plan: { platform: 'Instagram', count: '3', format: 'Короткое видео' } };
}

function packPrompt(prompt: string, scenario: VideoScenario, plan: ContentPlan) {
  if (scenario.id !== 'content-factory') return prompt.trim();
  return `${prompt.trim()}\n\nПараметры контент-плана Meduha:\nПлощадка: ${plan.platform}\nИдей: ${plan.count}\nФормат: ${plan.format}`;
}

function isImage(file: File) { return file.type.startsWith('image/'); }

export default function ScenarioWorkspace({ scenario, draftId }: { scenario: VideoScenario; draftId: string }) {
  const meduha = useMeduhaSession();
  const localDrafts = useDraftList();
  const rows = meduha.phase === 'authenticated' ? (meduha.bootstrap?.drafts ?? []) : localDrafts;
  const existing = draftId ? rows.find(row => row.id === draftId) : undefined;
  const search = useSearch();
  const query = new URLSearchParams(search);
  const [prompt, setPrompt] = useState(() => unpackPrompt(query.get('prompt') ?? scenario.prompt).prompt);
  const [plan, setPlan] = useState<ContentPlan>(() => unpackPrompt(query.get('prompt') ?? '').plan);
  const [currentDraftId, setCurrentDraftId] = useState(draftId);
  const [ratio, setRatio] = useState('16:9');
  const [duration, setDuration] = useState('5 сек');
  const [referenceName, setReferenceName] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [loadedId, setLoadedId] = useState('');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast, notify } = useToast();

  useEffect(() => {
    if (!existing || existing.id === loadedId) return;
    const restored = unpackPrompt(existing.prompt);
    setPrompt(restored.prompt);
    setPlan(restored.plan);
    setRatio(existing.ratio);
    setDuration(existing.duration);
    setReferenceName(existing.referenceName ?? '');
      setCurrentDraftId(existing.id);
    setLoadedId(existing.id);
  }, [existing, loadedId]);

  const imageFiles = scenario.id === 'katana'
    ? files.filter(isImage)
    : files;
  const needsVideo = scenario.id === 'katana';
  const accept = needsVideo ? 'video/*,image/*' : 'image/*';
  const maxFiles = needsVideo ? 6 : 1;
  const filesHint = scenario.id === 'image-to-video'
    ? 'Исходный кадр · изображение не покидает устройство'
    : scenario.id === 'ai-blogger'
      ? 'Фото лица — только с разрешением на использование'
      : scenario.id === 'katana'
        ? 'Видеореференс и до пяти фото · только локальный предпросмотр'
        : scenario.id === 'cinema'
          ? 'Изображение-референс, если нужно'
          : 'Добавить изображение-референс';

  const addFiles = (selected: FileList | null) => {
    if (!selected?.length) return;
    const next = Array.from(selected);
    const invalid = next.find(file => needsVideo
      ? (!file.type.startsWith('video/') && !isImage(file)) || file.size > (file.type.startsWith('video/') ? 200 : 10) * 1024 * 1024
      : !isImage(file) || file.size > 10 * 1024 * 1024);
    if (invalid) {
      notify(needsVideo ? 'Видео — до 200 МиБ, изображение — до 10 МиБ' : 'Выбери изображение до 10 МиБ');
      return;
    }
    if (next.length > maxFiles) {
      notify(needsVideo ? 'Для Катаны можно выбрать одно видео и до пяти изображений' : 'Можно выбрать одно изображение');
      return;
    }
    const videoCount = next.filter(file => file.type.startsWith('video/')).length;
    const imageCount = next.filter(isImage).length;
    if (needsVideo && (videoCount > 1 || imageCount > 5 || next.length > 6)) {
      notify('Для Катаны можно выбрать одно видео и до пяти изображений');
      return;
    }
    setFiles(next);
    setReferenceName(next.map(file => file.name).join(', ').slice(0, 180));
  };

  const save = async () => {
    if (saving) return;
    if (!prompt.trim()) {
      notify('Добавь описание, чтобы сохранить черновик');
      return;
    }
    const now = Date.now();
    const savedPrompt = packPrompt(prompt, scenario, plan);
    const draft: Draft = {
      id: currentDraftId || `draft-${now}-${Math.random().toString(36).slice(2, 8)}`,
      title: prompt.trim().split(/[.!?]/)[0].slice(0, 52) || scenario.title,
      type: 'video',
      prompt: savedPrompt,
      style: 'Студия',
      model: scenario.providerLabel,
      ratio,
      duration,
      updatedAt: now,
      referenceName: referenceName || undefined,
    };
    setSaving(true);
    try {
      if (meduha.phase === 'authenticated') {
        await meduha.saveDraft(draft);
        notify('Черновик сохранён в аккаунте');
      } else {
        const all = loadDrafts();
        const updated = all.some(item => item.id === draft.id)
          ? all.map(item => item.id === draft.id ? draft : item)
          : [draft, ...all];
        if (!saveDrafts(updated)) throw new Error('local-save-failed');
        notify('Черновик сохранён на этом устройстве');
      }
      setCurrentDraftId(draft.id);
      window.history.replaceState(window.history.state, '', `${import.meta.env.BASE_URL.replace(/\/$/, '')}/create?type=video&scenario=${encodeURIComponent(scenario.id)}&draft=${encodeURIComponent(draft.id)}`);
    } catch {
      notify('Не удалось сохранить черновик. Попробуй ещё раз');
    } finally {
      setSaving(false);
    }
  };

  const textToVideo = scenario.id === 'text-to-video';
  const title = scenario.id === 'ai-blogger' ? 'ИИ блогер'
    : scenario.id === 'content-factory' ? 'Контент-завод'
      : scenario.id === 'text-to-video' ? 'Видео из текста'
        : scenario.title;
  const initialNeed = scenario.id === 'image-to-video' && files.length === 0;

  return <Frame active="Create">
    <main className="gj-page gj-scenario-page">
      <Link className="gj-back" href="/create?type=video&ideas=1" data-testid="link-back-scenarios"><ArrowLeft size={13}/>Все сценарии</Link>
      <header className="gj-scenario-heading">
        <div className="gj-top"><h1>{title}</h1></div>
        <p className="gj-lead">{scenario.subtitle}</p>
        <span className="gj-scenario-provider">{scenario.providerLabel}</span>
      </header>

      <ExamplePreview scenario={scenario.id}/>

      <section className="gj-scenario-form gj-input" aria-label={`Настройки: ${title}`}>
        <div className="gj-label">{scenario.id === 'katana' ? 'Как должен выглядеть монтаж?' : scenario.id === 'content-factory' ? 'Что будем продвигать?' : scenario.id === 'ai-blogger' ? 'Опиши персонажа' : scenario.id === 'cinema' ? 'Расскажи о сцене' : 'Опиши результат'}<small>{prompt.length}/10000</small></div>
        <div className="m-prompt gj-scenario-prompt">
          <textarea aria-label="Описание сценария" value={prompt} onChange={event => setPrompt(event.target.value)} maxLength={10000} placeholder={scenario.prompt}/>
        </div>

        {scenario.id === 'content-factory' && <div className="gj-scenario-settings">
          <label className="gj-scenario-control">Площадка
            <select aria-label="Площадка контент-плана" value={plan.platform} onChange={event => setPlan(current => ({ ...current, platform: event.target.value }))}>
              {['Instagram', 'TikTok', 'YouTube Shorts', 'VK'].map(value => <option key={value}>{value}</option>)}
            </select>
          </label>
          <label className="gj-scenario-control">Идей
            <select aria-label="Количество идей" value={plan.count} onChange={event => setPlan(current => ({ ...current, count: event.target.value }))}>
              {['1', '3', '5', '10'].map(value => <option key={value}>{value}</option>)}
            </select>
          </label>
          <label className="gj-scenario-control">Формат
            <select aria-label="Формат публикаций" value={plan.format} onChange={event => setPlan(current => ({ ...current, format: event.target.value }))}>
              {['Короткое видео', 'Stories', 'Пост'].map(value => <option key={value}>{value}</option>)}
            </select>
          </label>
        </div>}

        {scenario.id !== 'text-to-video' && <div className="gj-scenario-upload">
          <input
            ref={inputRef}
            type="file"
            hidden
            accept={accept}
            multiple={needsVideo}
            onChange={event => { addFiles(event.target.files); event.currentTarget.value = ''; }}
          />
          <button type="button" className="gj-drop" onClick={() => inputRef.current?.click()}>
            {needsVideo ? <Video size={19}/> : <ImagePlus size={19}/>}
            <span><strong>{files.length ? `Выбрано: ${files.length}` : filesHint}</strong><small>
              {files.length ? files.map(file => file.name).join(' · ') : 'Локальный предпросмотр · файлы не загружаются и не сохраняются'}
            </small></span>
          </button>
          {referenceName && !files.length && <p className="gj-muted">Ранее выбранные файлы: {referenceName}. Они не сохранены — прикрепи их ещё раз перед использованием.</p>}
        </div>}

        {scenario.id !== 'content-factory' && <>
          <div className="gj-label sub">Кадр</div>
          <div className="m-options gj-scenario-options">{['16:9', '9:16', '1:1'].map(value => <button key={value} type="button" className={`m-option ${ratio === value ? 'selected' : ''}`} aria-pressed={ratio === value} onClick={() => setRatio(value)}>{value}</button>)}</div>
          {scenario.id !== 'image-to-video' && <label className="gj-scenario-control gj-scenario-duration">Длительность
            <select aria-label="Длительность видео" value={duration} onChange={event => setDuration(event.target.value)}>
              {(textToVideo ? [4, 5, 6, 8, 10, 15, 20, 25, 30] : [5, 8, 10, 15, 20, 30]).map(value => <option key={value} value={`${value} сек`}>{value} сек</option>)}
            </select>
          </label>}
        </>}

        {textToVideo
          ? <SeedanceGenerationPanel
              authenticated={meduha.phase === 'authenticated'}
              userId={meduha.account?.id}
              prompt={prompt.trim()}
              duration={duration}
              ratio={ratio}
              balance={meduha.bootstrap?.account.credits ?? meduha.account?.credits}
              refreshBootstrap={meduha.refreshBootstrap}
              notify={notify}
            />
          : <div className="gj-scenario-unavailable" role="status" data-testid={`status-generation-${scenario.id}`}>
              <strong>Запуск из Meduha пока не подключён</strong>
              <span>{scenario.explanation} Сохранение идеи не запускает генерацию и не списывает кредиты.</span>
              <a href={scenario.source} target="_blank" rel="noopener noreferrer">О сценарии у поставщика <ExternalLink size={12}/></a>
            </div>}

        {initialNeed && <p className="gj-warn">Чтобы оживить фото, нужен исходный кадр. Пока файл останется только на этом устройстве.</p>}
        <button type="button" className="gj-scenario-save" onClick={() => void save()} disabled={saving} data-testid="button-save-scenario-draft"><Save size={15}/>{saving ? 'Сохраняем…' : currentDraftId ? 'Сохранить черновик' : 'Сохранить идею'}</button>
        <p className="gj-muted">{meduha.phase === 'authenticated' ? 'Черновик сохранится в аккаунте.' : 'Черновик сохранится в этом браузере.'}</p>
      </section>
      {toast}
    </main>
  </Frame>;
}
