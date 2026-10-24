import { useEffect, useRef, useState } from 'react';
import { ChevronRight, Film, Play, RotateCw, Users } from 'lucide-react';
import { Link } from 'wouter';
import { videoScenarios } from '../scenarios';

const CDN = 'https://d28lhcrx5qdowv.cloudfront.net/media/explore/media/';
const motionThumb = `${CDN}e88805fcb31442389587a2953675fd723ee8d4cb5a317e6280b5d1cca979e152-thumbnail.webp`;
const motionVideo = `${CDN}478325c2a854b75ffc4d59b5704be94f4db14c810039f5d3aa11bcca31c56894-video.mp4`;
const seedanceThumb = `${CDN}74c63b88a889cb7f0f4389b8ae945592ff66d7cbcf41b48f9132fa341803a090-thumbnail.webp`;
const seedanceVideo = `${CDN}e49233cbd94028feaafc895fc1350b276278a66ab9672b5a9cf7045c2b2fd239-video.mp4`;
const examples: Record<string, { thumb?: string; video?: string; image?: string }> = {
  genjutsu: { thumb: motionThumb, video: motionVideo },
  'object-swap': { thumb: `${CDN}06e2dd26db64fd455b6bf9e0eb4ef71d3857e7db4fa0d190a51510ea08a97f61-thumbnail.webp`, video: `${CDN}c173ad701aac89bc22c0464a059f71720eb4134b1b44fc7909bd98d1b117e708-video.mp4` },
  restyle: { thumb: motionThumb, video: motionVideo },
  'ai-blogger': { image: `${CDN}51a4efd07b9718780330b44fd6fcb36fc8bc31656100b72a15627ff2205debf0-image.webp` },
  'text-to-video': { thumb: seedanceThumb, video: seedanceVideo },
  'image-to-video': { thumb: seedanceThumb, video: seedanceVideo },
  cinema: { thumb: `${CDN}24fc2ccb2207a9d37b094f6da28c9055d73e98a02dddfa8d3b1c7d17b05865d8-thumbnail.webp`, video: `${CDN}cf76b0c05e5ac8154b16bd24238d7527c837452db713691fa6d9db4bea7a7b3d-video.mp4` },
};

export default function ExamplePreview({ scenario, showDemo = true }: { scenario: string; showDemo?: boolean }) {
  const item = videoScenarios.find(value => value.id === scenario);
  const ex = showDemo ? examples[scenario] : undefined;
  const hasGenjutsuLibrary = scenario === 'genjutsu' || scenario === 'object-swap' || scenario === 'restyle';
  const video = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(false);
  const [failed, setFailed] = useState(false);
  const isStill = Boolean(ex?.image);
  const legacyTestIds = hasGenjutsuLibrary;
  const title = item?.title ?? 'Видео';

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
    <div className="gj-ex-head"><strong>{isStill ? 'Пример образа' : 'Пример результата'}</strong><small>{ex ? 'Демо' : 'Пока без демо'}</small></div>
    <div className={`gj-ex-media${isStill ? ' still' : ''}${!ex ? ' unavailable' : ''}`}>
      {ex?.video && <video ref={video} src={ex.video} poster={ex.thumb} preload="none" playsInline muted controls={started && !failed}
        aria-label={`Демо ${title}`} data-testid={legacyTestIds ? 'video-genjutsu-example' : `video-example-${scenario}`} onError={() => setFailed(true)}/>}
      {ex?.image && <img src={ex.image} alt={`Официальный пример образа для сценария «${title}»`} loading="lazy"/>}
      {!ex && <div className="gj-ex-fallback"><Film size={18}/><span>Пример появится после подключения сценария</span></div>}
      {ex?.video && !started && !failed && <button type="button" className="gj-ex-play" onClick={play} aria-label="Воспроизвести пример" data-testid={legacyTestIds ? 'button-play-example' : `button-play-example-${scenario}`}><Play size={25} fill="currentColor"/></button>}
      {failed && <div className="gj-ex-error" role="alert">
        <Film size={18}/><span>Не удалось загрузить видео</span>
        <div><button type="button" onClick={play} data-testid={legacyTestIds ? 'button-retry-example' : `button-retry-example-${scenario}`}><RotateCw size={12}/>Повторить</button>
          <span>Оригинал временно недоступен</span></div>
      </div>}
    </div>
    <Link href={`/community?kind=video&tag=${encodeURIComponent(scenario)}`} className="gj-ex-link" data-testid="link-community-videos">
      <Users size={16}/><span><strong>Работы других</strong><small>{hasGenjutsuLibrary ? 'Начните с движения из библиотеки' : `Публикации сообщества · ${title}`}</small></span><ChevronRight size={15}/>
    </Link>
  </section>;
}
