import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, FileImage, Film, ImagePlus, Save, X } from 'lucide-react';
import { Link, useSearch } from 'wouter';
import { Frame, useToast } from '../shared';
import { loadDrafts, saveDrafts, useDraftList, type Draft } from '../studio';
import { useMeduhaSession } from '../session';
import type { VideoScenario } from './scenarios';
import { isScenarioImage, isScenarioVideo, missingRequiredScenarioMedia, scenarioInputSpecs, scenarioMediaError, scenarioReferenceMetadata } from './scenarioMedia';
import SeedanceGenerationPanel from './SeedanceGenerationPanel';
import ExamplePreview from './genjutsu/ExamplePreview';
import './genjutsu/genjutsu.css';
import './scenario-workspace.css';

type ContentPlan = { platform: string; count: string; format: string };
type ScenarioGuide = { requirements: string; explanation: string };
const planMarker = /\n\nПараметры контент-плана Meduha:\nПлощадка: (.*)\nИдей: (\d+)\nФормат: (.*)$/;
const examples = new Set(['ai-blogger', 'text-to-video', 'cinema']);
const publicGuides: Record<string, ScenarioGuide> = {
  'ai-blogger': {
    requirements: 'Опиши внешность и характер персонажа. Фото лица необязательно — используй его только с разрешением. Для видео потребуется отдельный этап.',
    explanation: 'Можно подготовить описание персонажа и сохранить идею. Создание изображения или видео пока не подключено.',
  },
  katana: {
    requirements: 'Одно видео-референс с разрешением на использование и до пяти фото героев или предметов.',
    explanation: 'Здесь можно подготовить бриф монтажа. Запуск сценария пока не подключён.',
  },
  'content-factory': {
    requirements: 'Укажи продукт, аудиторию, площадку, количество идей и формат публикаций.',
    explanation: 'Можно подготовить контент-план. Пакетное создание материалов и автопубликация пока не подключены.',
  },
  'text-to-video': {
    requirements: 'Текстовое описание сцены. Длительность — от 4 до 30 секунд.',
    explanation: 'Проверь доступность, стоимость и ограничения в панели запуска ниже.',
  },
  'image-to-video': {
    requirements: 'Исходное изображение и описание движения в кадре.',
    explanation: 'Можно подготовить идею по исходному кадру. Создание видео пока не подключено.',
  },
  cinema: {
    requirements: 'Описание сцены. Фото-референсы и дополнительные настройки — по желанию.',
    explanation: 'Можно подготовить описание сцены и сохранить идею. Создание видео пока не подключено.',
  },
};

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
  const spec = scenarioInputSpecs[scenario.id];
  const guide = publicGuides[scenario.id] ?? {
    requirements: scenario.subtitle,
    explanation: 'Можно подготовить описание сценария и сохранить его как черновик. Создание результата пока не подключено.',
  };
  const title = scenario.id === 'ai-blogger' ? 'ИИ блогер'
    : scenario.id === 'content-factory' ? 'Контент-завод'
      : scenario.id === 'text-to-video' ? 'Видео из текста' : scenario.title;

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

  const addFiles = (selected: FileList | null) => {
    if (!selected?.length || !spec) return;
    const next = [...files, ...Array.from(selected)];
    const error = scenarioMediaError(spec, next);
    if (error) {
      notify(error);
      return;
    }
    setFiles(next);
    setReferenceName(scenarioReferenceMetadata(next).referenceName ?? '');
  };

  const removeFile = (index: number) => {
    const next = files.filter((_, i) => i !== index);
    setFiles(next);
    setReferenceName(scenarioReferenceMetadata(next).referenceName ?? '');
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
      model: title,
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
  const promptLabel = scenario.id === 'katana' ? 'Как должен выглядеть монтаж?'
    : scenario.id === 'content-factory' ? 'Что будем продвигать?'
      : scenario.id === 'ai-blogger' ? 'Опиши персонажа'
        : scenario.id === 'cinema' ? 'Расскажи о сцене'
          : scenario.id === 'image-to-video' ? 'Как оживить этот кадр?'
            : scenario.id === 'object-swap' ? 'Что заменить в видео?'
              : scenario.id === 'restyle' ? 'Как изменить визуальный стиль?' : 'Опиши результат';
  const photosCount = files.filter(isScenarioImage).length;
  const videoCount = files.filter(isScenarioVideo).length;
  const uploadHint = scenario.id === 'katana'
    ? 'Одно видео и до пяти фото · файлы остаются на устройстве'
    : scenario.id === 'image-to-video'
      ? 'Исходный кадр обязателен · изображение не покидает устройство'
      : scenario.id === 'object-swap'
        ? 'Видео и минимум одно фото объекта обязательны'
        : scenario.id === 'restyle'
          ? 'Видео обязательно · до пяти фото-референсов по желанию'
          : scenario.id === 'ai-blogger'
            ? 'Фото лица по желанию · только с разрешением на использование'
            : 'Референсы сцены по желанию · только локальный предпросмотр';
  const accept = spec?.video ? 'video/mp4,video/webm,image/*' : 'image/*';
  const canAddMore = Boolean(spec && (spec.video && videoCount === 0 || photosCount < spec.photos));
  const missingRequiredMedia = Boolean(spec && missingRequiredScenarioMedia(spec, files));

  return <Frame active="Create">
    <main className="gj-page gj-scenario-page">
      <Link className="gj-back" href="/create?type=video&ideas=1" data-testid="link-back-scenarios"><ArrowLeft size={13}/>Все сценарии</Link>
      <header className="gj-scenario-heading">
        <div className="gj-top"><h1>{title}</h1></div>
        <p className="gj-lead">{scenario.subtitle}</p>
        <span className={`gj-scenario-provider ${textToVideo ? 'available' : ''}`} data-testid="status-scenario-availability">
          {textToVideo ? 'Можно запустить в студии' : 'Подготовка сценария'}
        </span>
      </header>

      <ExamplePreview scenario={scenario.id} showDemo={examples.has(scenario.id)}/>

      <section className="gj-scenario-form gj-input" aria-label={`Настройки: ${title}`}>
        <div className="gj-label">{promptLabel}<small>{prompt.length}/10000</small></div>
        <div className="m-prompt gj-scenario-prompt">
          <textarea data-testid="input-scenario-prompt" aria-label="Описание сценария" value={prompt} onChange={event => setPrompt(event.target.value)} maxLength={10000} placeholder={scenario.prompt}/>
        </div>

        {scenario.id === 'content-factory' && <div className="gj-scenario-settings">
          <label className="gj-scenario-control">Площадка
            <select data-testid="select-content-platform" aria-label="Площадка контент-плана" value={plan.platform} onChange={event => setPlan(current => ({ ...current, platform: event.target.value }))}>
              {['Instagram', 'TikTok', 'YouTube Shorts', 'VK'].map(value => <option key={value}>{value}</option>)}
            </select>
          </label>
          <label className="gj-scenario-control">Идей
            <select data-testid="select-content-count" aria-label="Количество идей" value={plan.count} onChange={event => setPlan(current => ({ ...current, count: event.target.value }))}>
              {['1', '3', '5', '10'].map(value => <option key={value}>{value}</option>)}
            </select>
          </label>
          <label className="gj-scenario-control">Формат
            <select data-testid="select-content-format" aria-label="Формат публикаций" value={plan.format} onChange={event => setPlan(current => ({ ...current, format: event.target.value }))}>
              {['Короткое видео', 'Stories', 'Пост'].map(value => <option key={value}>{value}</option>)}
            </select>
          </label>
        </div>}

        {spec && <>
          <div className="gj-scenario-upload">
            <input ref={inputRef} type="file" hidden accept={accept} multiple={spec.photos > 1 || spec.video} onChange={event => { addFiles(event.target.files); event.currentTarget.value = ''; }}/>
            {canAddMore && <button type="button" className="gj-drop" onClick={() => inputRef.current?.click()} data-testid="button-add-scenario-media">
              {spec.video && videoCount === 0 ? <Film size={19}/> : <ImagePlus size={19}/>}
              <span><strong>{files.length ? 'Добавить материалы' : spec.video ? 'Видеореференс и до пяти фото' : spec.photoLabel}</strong>
                <small>Локальный предпросмотр · файлы не загружаются и не сохраняются</small></span>
            </button>}
            {!!files.length && <div className="gj-scenario-file-list" aria-label="Выбранные локальные файлы">
              {files.map((file, index) => <div className="gj-scenario-file" key={`${file.name}-${index}`}>
                {isScenarioVideo(file) ? <Film size={15}/> : <FileImage size={15}/>}
                <span><strong>{file.name}</strong><small>{isScenarioVideo(file) ? 'Видеореференс' : 'Изображение'} · только на этом устройстве</small></span>
                <button type="button" aria-label={`Убрать ${file.name}`} data-testid={`button-remove-scenario-media-${index}`} onClick={() => removeFile(index)}><X size={14}/></button>
              </div>)}
              <p className="gj-muted">Файлы не загружаются и не сохраняются в черновике. При повторном открытии их нужно прикрепить снова.</p>
            </div>}
            {referenceName && !files.length && <p className="gj-muted">Ранее выбраны: {referenceName}. Файлы не сохранены — прикрепи их ещё раз.</p>}
          </div>
        </>}

        {scenario.id !== 'content-factory' && <>
          <div className="gj-label sub">Кадр</div>
          <div className="m-options gj-scenario-options">{['16:9', '9:16', '1:1'].map(value => <button key={value} type="button" className={`m-option ${ratio === value ? 'selected' : ''}`} aria-pressed={ratio === value} onClick={() => setRatio(value)}>{value}</button>)}</div>
          {scenario.id !== 'image-to-video' && <label className="gj-scenario-control gj-scenario-duration">Длительность
            <select data-testid="select-scenario-duration" aria-label="Длительность видео" value={duration} onChange={event => setDuration(event.target.value)}>
              {(textToVideo ? [4, 5, 6, 8, 10, 15, 20, 25, 30] : [5, 8, 10, 15, 20, 30]).map(value => <option key={value} value={`${value} сек`}>{value} сек</option>)}
            </select>
          </label>}
        </>}

        <details className="gj-scenario-help" data-testid="details-scenario-requirements">
          <summary>Требования к материалам</summary>
          <p>{guide.requirements} {spec ? uploadHint : ''}</p>
        </details>

        {textToVideo
          ? <SeedanceGenerationPanel authenticated={meduha.phase === 'authenticated'} userId={meduha.account?.id} prompt={prompt.trim()} duration={duration} ratio={ratio}
              balance={meduha.bootstrap?.account.credits ?? meduha.account?.credits} refreshBootstrap={meduha.refreshBootstrap} notify={notify}/>
          : <div className="gj-scenario-unavailable" role="status" data-testid={`status-generation-${scenario.id}`}>
              <strong><span className="gj-status-dot"/>Запуск из Meduha пока не подключён</strong>
              <span>{missingRequiredMedia ? 'Для этого сценария нужны исходные материалы. ' : ''}{guide.explanation} Сохранение идеи не запускает генерацию и не списывает кредиты.</span>
            </div>}

        {scenario.id === 'image-to-video' && missingRequiredMedia && <p className="gj-warn">Добавь исходное фото: одного описания недостаточно, чтобы подготовить этот сценарий.</p>}
        {scenario.id === 'katana' && missingRequiredMedia && <p className="gj-warn">Для брифа Катаны нужен видеореференс. Можно добавить к нему до пяти фото.</p>}
        {scenario.id === 'object-swap' && missingRequiredMedia && <p className="gj-warn">Нужны исходное видео и хотя бы одно фото объекта для замены.</p>}
        <button type="button" className="gj-scenario-save" onClick={() => void save()} disabled={saving} data-testid="button-save-scenario-draft"><Save size={15}/>{saving ? 'Сохраняем…' : currentDraftId ? 'Сохранить черновик' : 'Сохранить идею'}</button>
        <p className="gj-muted">{meduha.phase === 'authenticated' ? 'Черновик сохранится в аккаунте.' : 'Черновик сохранится в этом браузере.'}</p>
      </section>
      {toast}
    </main>
  </Frame>;
}
