import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { BatteryFull, Check, ChevronDown, Ellipsis, Send, Signal, Sparkles, UserRound, Waves, Wifi, X, Zap } from "lucide-react";

export const asset = (name: string) => `/__mockup/images/meduha/${name}.png`;
export const deep = (name: string) => `/__mockup/images/meduha-deep/${name}.png`;
export const route = (name: string) => `/__mockup/preview/meduha-deep/${name}`;

/* ───────── mascot library ───────── */
export type Emotion = "glossy" | "hello" | "joy" | "curious" | "thinking" | "surprise" | "wink" | "sleep" | "tired" | "flight";
export const mascot = (e: Emotion) => `/__mockup/images/brand/mascot-${e}.png`;
export const heroMascot = mascot("glossy");
/** Tight bounding box of the jellyfish inside each PNG (437x341; glossy is 1254 square), so bubbles frame the subject, not the empty canvas. */
const BOX: Record<Emotion, { iw: number; ih: number; x: number; y: number; w: number; h: number }> = {
  glossy: { iw: 1254, ih: 1254, x: 60, y: 60, w: 1134, h: 1134 },
  hello: { iw: 437, ih: 341, x: 89, y: 21, w: 278, h: 276 },
  joy: { iw: 437, ih: 341, x: 55, y: 22, w: 337, h: 272 },
  curious: { iw: 437, ih: 341, x: 42, y: 64, w: 354, h: 245 },
  thinking: { iw: 437, ih: 341, x: 71, y: 58, w: 274, h: 260 },
  surprise: { iw: 437, ih: 341, x: 66, y: 0, w: 306, h: 283 },
  wink: { iw: 437, ih: 341, x: 64, y: 33, w: 309, h: 283 },
  sleep: { iw: 437, ih: 341, x: 47, y: 81, w: 345, h: 216 },
  tired: { iw: 437, ih: 341, x: 42, y: 74, w: 334, h: 207 },
  flight: { iw: 437, ih: 341, x: 126, y: 1, w: 252, h: 237 },
};
const RATIO: Record<Emotion, number> = Object.fromEntries(Object.entries(BOX).map(([k, b]) => [k, b.ih / b.iw])) as Record<Emotion, number>;

export function useReducedMotion() {
  const [reduce] = useState(() => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  return reduce;
}

/** Transparent jellyfish on a glowing glass bubble. `size` is the bubble diameter; the character is scaled so it fills ~115% of it and overflows a touch. */
export function Mascot({ emotion, size = 44, float = false, bubble = true, className = "", style }: { emotion: Emotion; size?: number; float?: boolean; bubble?: boolean; className?: string; style?: CSSProperties }) {
  const b = BOX[emotion];
  const fill = emotion === "glossy" ? 0.98 : 1.18;
  const scale = (size * fill) / Math.max(b.w, b.h);
  const w = b.iw * scale, h = b.ih * scale;
  // put the subject's centre at the bubble's centre (a hair above, so wide low poses like sleep/tired don't sink)
  const cx = (b.x + b.w / 2) * scale, cy = (b.y + b.h / 2) * scale;
  const left = size / 2 - cx, top = size * 0.5 - cy;
  return (
    <span className={`md-mascot ${bubble ? "bubble" : ""} ${float ? "float" : ""} ${className}`} style={{ width: size, height: size, ...style }} aria-hidden="true">
      <img src={mascot(emotion)} alt="" style={{ width: w, height: h, left, top }} />
    </span>
  );
}

/** Hero mascot that cycles through 2-3 moods with a soft crossfade. Static on prefers-reduced-motion. */
export function LiveMascot({ emotions, width, height, every = 4000, float = true, className = "", style }: { emotions: Emotion[]; width: number; height?: number; every?: number; float?: boolean; className?: string; style?: CSSProperties }) {
  const [i, setI] = useState(0);
  const reduce = useReducedMotion();
  const count = emotions.length;
  useEffect(() => {
    if (reduce || count < 2) return;
    const id = setInterval(() => setI((n) => (n + 1) % count), every);
    return () => clearInterval(id);
  }, [reduce, count, every]);
  const h = height ?? width * RATIO[emotions[0]];
  return (
    <span className={`md-live-mascot ${float ? "float" : ""} ${className}`} style={{ width, height: h, ...style }} aria-hidden="true">
      {(reduce ? [emotions[0]] : emotions).map((e, k) => <img key={e} src={mascot(e)} alt="" className={k === i ? "on" : ""} />)}
    </span>
  );
}

/** One-shot "flight" burst: the jellyfish zooms off toward the chat. */
export function useFlight() {
  const [on, setOn] = useState(false);
  const reduce = useReducedMotion();
  useEffect(() => { if (!on) return; const t = setTimeout(() => setOn(false), reduce ? 400 : 1250); return () => clearTimeout(t); }, [on, reduce]);
  const node = on ? <img className="md-flight" src={mascot("flight")} alt="" aria-hidden="true" /> : null;
  return { fly: () => setOn(true), node };
}

export function Sea({ motes = true }: { motes?: boolean }) {
  return <><div className="md-sea" />{motes && <div className="md-motes"><i /><i /><i /><i /><i /><i /><i /></div>}</>;
}

export function Balance({ amount = "1 250", onClick }: { amount?: string; onClick?: () => void }) {
  return <a className="md-pill press" href={route("Profile")} onClick={onClick} aria-label={`Баланс ${amount} кредитов`}><Zap size={13} fill="currentColor" />{amount}<span className="plus"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg></span></a>;
}

export function Dock({ active }: { active: "Feed" | "Studio" | "Profile" }) {
  return (
    <>
      <nav className="md-dock" aria-label="Навигация">
        <a className={active === "Feed" ? "on" : ""} href={route("Feed")}><Waves size={20} /><span>Глубина</span></a>
        <a className={`orb ${active === "Studio" ? "on" : ""}`} href={route("Studio")} aria-label="Студия"><Sparkles size={24} strokeWidth={2.2} /></a>
        <a className={active === "Profile" ? "on" : ""} href={route("Profile")}><UserRound size={20} /><span>Моя студия</span></a>
      </nav>
      <div className="md-home" aria-hidden="true" />
    </>
  );
}

export function Frame({ active, children, head, immersive = false, sea = true }: { active: "Feed" | "Studio" | "Profile"; children: ReactNode; head?: ReactNode; immersive?: boolean; sea?: boolean }) {
  const [menu, setMenu] = useState(false);
  const [closed, setClosed] = useState(false);
  return (
    <div className={`mdeep ${immersive ? "immersive" : ""}`}>
      {sea && <Sea />}
      <main className="md-main">{children}</main>
      <div className="md-scrim-top" />
      <div className="md-status"><span>9:41</span><div className="ic"><Signal size={14} fill="currentColor" /><Wifi size={15} /><BatteryFull size={22} /></div></div>
      <header className="md-tg">
        <button className="close" onClick={() => setClosed(true)}>Закрыть</button>
        <div className="bot">meduha<small>мини-приложение</small></div>
        <div className="ic"><button aria-label="Свернуть" onClick={() => setClosed(true)}><ChevronDown size={18} /></button><button aria-label="Меню" onClick={() => setMenu(true)}><Ellipsis size={20} /></button></div>
      </header>
      {head && <div className="md-head">{head}</div>}
      <Dock active={active} />
      {menu && <Sheet title="Медуха живёт в Telegram" onClose={() => setMenu(false)}><div className="md-sheet-row"><Mascot emotion="flight" size={72} /><p>Фото, видео и музыка из твоих идей. Генерации приходят прямо в чат, даже если закрыть приложение.</p></div><a className="md-btn primary" href="https://t.me/meduha" target="_blank" rel="noreferrer"><Send size={16} />Открыть чат meduha</a></Sheet>}
      {closed && <Sheet title="Уплываешь?" onClose={() => setClosed(false)}><div className="md-sheet-row"><Mascot emotion="sleep" size={72} /><p>Всё, что ты начал, продолжит создаваться. Результат пришлю сообщением.</p></div><button className="md-btn primary" onClick={() => setClosed(false)}>Остаться в глубине</button></Sheet>}
    </div>
  );
}

export function Sheet({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <div className="md-overlay" onClick={onClose}>
      <section className="md-sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="md-sheet-handle" />
        <div className="md-sheet-head"><h2>{title}</h2><button className="x" aria-label="Закрыть" onClick={onClose}><X size={16} /></button></div>
        {children}
      </section>
    </div>
  );
}

export function Toast({ children, onDone, ms = 2200 }: { children: ReactNode; onDone: () => void; ms?: number }) {
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  useEffect(() => { const t = setTimeout(() => doneRef.current(), ms); return () => clearTimeout(t); }, [ms]);
  return <div className="md-toast" role="status"><Check size={16} />{children}</div>;
}

export function useToast() {
  const [msg, setMsg] = useState<string | null>(null);
  const node = msg ? <Toast onDone={() => setMsg(null)}>{msg}</Toast> : null;
  return { show: setMsg, node };
}

export async function shareWork(title: string): Promise<string> {
  try {
    if (navigator.share) { await navigator.share({ title, text: "Создано в meduha", url: window.location.href }); return "Отправлено"; }
    await navigator.clipboard.writeText(window.location.href);
    return "Ссылка скопирована";
  } catch { return "Поделиться можно из чата meduha"; }
}
