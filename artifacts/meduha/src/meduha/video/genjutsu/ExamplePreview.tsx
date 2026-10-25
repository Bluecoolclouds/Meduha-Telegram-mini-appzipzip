import { useEffect, useRef, useState } from 'react';
import { ChevronRight, Film, Play, RotateCw, Users } from 'lucide-react';
import { Link } from 'wouter';
import { videoScenarios } from '../scenarios';
import { videoModelPreview, type VideoPreviewMedia } from '../modelPreviews';

const CDN = 'https://d28lhcrx5qdowv.cloudfront.net/media/explore/media/';
const examples: Record<string, VideoPreviewMedia | null> = {
  genjutsu: videoModelPreview('higgsfield/genjutsu/motion-transfer/v1.0'),
  'object-swap': videoModelPreview('higgsfield/genjutsu/object-swap/v1.0'),
  restyle: videoModelPreview('higgsfield/genjutsu/restyle/v1.0'),
  'ai-blogger': { image: `${CDN}51a4efd07b9718780330b44fd6fcb36fc8bc31656100b72a15627ff2205debf0-image.webp` },
  'text-to-video': videoModelPreview('bytedance/seedance-2.5/text-to-video'),
  'image-to-video': videoModelPreview('bytedance/seedance-2.5/image-to-video'),
  cinema: videoModelPreview('higgsfield/cinema-studio/4.0'),
};

export default function ExamplePreview({ scenario, showDemo = true, heading, media, communityHref, emptyText }: {
  scenario: string; showDemo?: boolean; heading?: string; media?: VideoPreviewMedia | null; communityHref?: string; emptyText?: string;
}) {
  const item = videoScenarios.find(value => value.id === scenario);
  const ex = showDemo ? (media === undefined ? examples[scenario] : media) : undefined;
  const hasGenjutsuLibrary = scenario === 'genjutsu' || scenario === 'object-swap' || scenario === 'restyle';
  const video = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(false);
  const [failed, setFailed] = useState(false);
  const isStill = Boolean(ex?.image);
  const legacyTestIds = hasGenjutsuLibrary;
  const title = heading ?? item?.title ?? 'Видео';

  useEffect(() => {
    const element = video.current;
    if (!element) return;
    const pauseWhenHidden = () => { if (document.hidden) element.pause(); };
    document.addEventListener('visibilitychange', pauseWhenHidden);
    const observer = typeof IntersectionObserver === 'undefined' ? undefined : new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) element.pause();
    });
    observer?.observe(element);
    return () => {
      document.removeEventListener('visibilitychange', pauseWhenHidden);
      observer?.disconnect();
      element.pause();
    };
  }, []);

  const play = () => {
    const element = video.current;
    if (!element) return;
    setFailed(false);
    setStarted(true);
    if (element.error) element.load();
    void element.play().catch((error: unknown) => {
      if (!(error instanceof DOMException && error.name === 'AbortError')) setFailed(true);
    });
  };

  return <section className="gj-ex" data-testid={hasGenjutsuLibrary ? 'card-genjutsu-example' : 'card-scenario-example'}>
    <div className="gj-ex-head">{heading ? <h1 className="gj-ex-title">{heading}</h1> : <strong>{isStill ? 'Пример образа' : 'Пример результата'}</strong>}<small>{ex ? 'Демо' : 'Пока без демо'}</small></div>
    <div className={`gj-ex-media${isStill ? ' still' : ''}${!ex ? ' unavailable' : ''}`}>
      {ex?.video && <video ref={video} src={ex.video} poster={ex.thumb} preload="none" playsInline muted controls={started && !failed}
        aria-label={`Демо ${title}`} data-testid={legacyTestIds ? 'video-genjutsu-example' : `video-example-${scenario}`} onError={() => setFailed(true)}/>}
      {ex?.image && <img src={ex.image} alt={`Официальный пример образа для сценария «${title}»`} loading="lazy"/>}
      {!ex && <div className="gj-ex-fallback"><Film size={18}/><span>{emptyText ?? 'Пример появится после подключения сценария'}</span></div>}
      {ex?.video && !started && !failed && <button type="button" className="gj-ex-play" onClick={play} aria-label="Воспроизвести пример" data-testid={legacyTestIds ? 'button-play-example' : `button-play-example-${scenario}`}><Play size={25} fill="currentColor"/></button>}
      {failed && <div className="gj-ex-error" role="alert">
        <Film size={18}/><span>Не удалось загрузить видео</span>
        <div><button type="button" onClick={play} data-testid={legacyTestIds ? 'button-retry-example' : `button-retry-example-${scenario}`}><RotateCw size={12}/>Повторить</button>
          <span>Оригинал временно недоступен</span></div>
      </div>}
    </div>
    <Link href={communityHref ?? `/community?kind=video&tag=${encodeURIComponent(scenario)}`} className="gj-ex-link" data-testid="link-community-videos">
      <Users size={16}/><span><strong>Работы других</strong><small>{hasGenjutsuLibrary ? 'Начните с движения из библиотеки' : `Публикации сообщества · ${title}`}</small></span><ChevronRight size={15}/>
    </Link>
  </section>;
}
