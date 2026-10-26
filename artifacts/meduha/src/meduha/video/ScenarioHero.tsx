import { useEffect, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { Link } from 'wouter';
import type { VideoScenario } from './scenarios';

export type CarouselItem = Pick<VideoScenario, 'id' | 'title' | 'subtitle' | 'image'> & Partial<Pick<VideoScenario, 'providerLabel'>>;
type Props<T extends CarouselItem = VideoScenario> = { items: T[]; image: (n: string) => string; cover?: (s: T) => string; thumbnail?: (s: T) => string; label: (s: T) => string; onOpen: (s: T) => void; paused?: boolean; eyebrow?: (s: T) => string };
const SLIDE_MS = 6500;

export function ScenarioCarousel<T extends CarouselItem>({ items, image, cover, thumbnail, label, onOpen, paused: externalPaused = false, eyebrow }: Props<T>) {
  const imageOf = (item: T) => cover ? cover(item) : image(item.image);
  const thumbOf = (item: T) => thumbnail ? thumbnail(item) : imageOf(item);
  const track = useRef<HTMLDivElement>(null);
  const [idx, setIdx] = useState(0);
  const [visited, setVisited] = useState<Set<string>>(() => new Set());
  const root = useRef<HTMLElement>(null);
  const [hover, setHover] = useState(false);
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(() => typeof document !== 'undefined' && document.hidden);
  const [offscreen, setOffscreen] = useState(false);
  useEffect(() => {
    const on = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', on);
    const el = root.current; let io: IntersectionObserver | undefined;
    if (el && 'IntersectionObserver' in window) { io = new IntersectionObserver(([e]) => setOffscreen(e.intersectionRatio < 0.25), { threshold: 0.25 }); io.observe(el); }
    return () => { document.removeEventListener('visibilitychange', on); io?.disconnect(); };
  }, []);
  const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const go = (i: number) => {
    const el = track.current; if (!el || !items.length) return;
    const n = (i + items.length) % items.length;
    el.scrollTo({ left: n * el.clientWidth, behavior: reduced ? 'auto' : 'smooth' });
    setIdx(n);
  };
  const paused = hover || focused || hidden || offscreen || externalPaused || reduced;
  useEffect(() => {
    const el = track.current; if (!el) return;
    let t = 0;
    const on = () => { window.clearTimeout(t); t = window.setTimeout(() => setIdx(Math.max(0, Math.min(items.length - 1, Math.round(el.scrollLeft / Math.max(1, el.clientWidth))))), 60); };
    el.addEventListener('scroll', on, { passive: true });
    return () => { el.removeEventListener('scroll', on); window.clearTimeout(t); };
  }, [items.length]);
  const cur = items[idx];
  useEffect(() => {
    if (cur) setVisited(previous => previous.has(cur.id) ? previous : new Set([...previous, cur.id]));
  }, [cur?.id]);

  return <section className="vs-hero" aria-roledescription="carousel" aria-label="Новые сценарии" ref={root}
    onPointerEnter={e => { if (e.pointerType === 'mouse') setHover(true); }} onPointerLeave={() => setHover(false)} onFocus={() => setFocused(true)} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false); }}>
    <div className="vs-hero-track" ref={track}>
      {items.map((s, i) => <article key={s.id} className={`vs-hero-slide${i === idx ? ' on' : ''}${s.id === 'bytedance/seedance-2.5/text-to-video' ? ' seedance-25' : ''}`} aria-hidden={i !== idx}>
        <div className="vs-hero-backdrop" style={{ backgroundImage: `url("${i === idx || visited.has(s.id) ? imageOf(s) : thumbOf(s)}")` }} aria-hidden="true" />
        <img src={i === idx || visited.has(s.id) ? imageOf(s) : thumbOf(s)} alt="" decoding="async" fetchPriority={i === idx ? 'high' : 'auto'}/>
        <div className="vs-hero-copy">
           <span className="vs-hero-brand">{eyebrow ? eyebrow(s) : `Новое · ${s.providerLabel ?? ''}`}</span>
          <h2>{s.title}</h2>
          <p>{s.subtitle}</p>
          <div className="vs-hero-row">
            <button data-testid={`button-hero-open-${s.id}`} tabIndex={i === idx ? 0 : -1} onClick={() => onOpen(s)}>Открыть</button>
            <span>{label(s)}</span>
          </div>
        </div>
      </article>)}
    </div>
    <div className="vs-hero-thumbs">
      {items.map((s, i) => <button key={s.id} data-testid={`button-hero-thumb-${s.id}`} aria-label={s.title} aria-current={i === idx} className={i === idx ? 'on' : ''} onClick={() => go(i)}>
        <img src={thumbOf(s)} alt="" decoding="async" width={96} height={54}/>
      </button>)}
    </div>
    <div className="vs-hero-bars" role="progressbar" aria-label="Позиция карусели" aria-valuemin={1} aria-valuemax={items.length} aria-valuenow={idx + 1} aria-valuetext={cur?.title}>
      {items.map((s, i) => <span key={s.id} className={i < idx ? 'done' : i === idx ? 'on' : ''}>
        <i key={i === idx ? `a${idx}` : 'x'} onAnimationEnd={() => { if (i === idx && !paused && items.length > 1) go(idx + 1); }} style={i === idx ? { animationDuration: `${SLIDE_MS}ms`, animationPlayState: paused ? 'paused' : 'running' } : undefined} />
      </span>)}
    </div>
  </section>;
}

export function PromoBanner() {
  return <Link href="/wallet" className="vs-promo" data-testid="link-promo-wallet">
    <span className="vs-promo-icon"><Sparkles size={17} strokeWidth={2.1} /></span>
    <span className="vs-promo-text"><strong>Больше возможностей</strong><small>Пакеты кредитов · тестовый режим</small></span>
    <span className="vs-promo-cta">Пакеты</span>
  </Link>;
}
