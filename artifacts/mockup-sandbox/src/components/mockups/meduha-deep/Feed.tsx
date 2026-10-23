import { useCallback, useEffect, useRef, useState } from "react";
import { Bookmark, ChevronsUp, Clapperboard, Heart, Image as ImageIcon, Music2, Send, Sparkles, Zap } from "lucide-react";
import { Balance, Frame, Mascot, Sheet, asset, deep, route, shareWork, useFlight, useToast } from "./_shared";
import "./_group.css";

type Kind = "video" | "photo" | "music";
type Item = { id: string; src: string; author: string; handle: string; initials: string; tone: string; title: string; prompt: string; preset: string; model: string; kind: Kind; seconds?: number; cost: number; likes: number };

const ITEMS: Item[] = [
  { id: "abyss", src: deep("abyss"), author: "Лена Вишнёва", handle: "@lena.visions", initials: "ЛВ", tone: "", title: "Свечение на глубине", prompt: "Дайвер в чёрной воде, вокруг — сотни оранжевых медуз, лучи света сверху, плёночное зерно", preset: "Эффект · Биолюм", model: "Kling 2.1", kind: "video", seconds: 8, cost: 12, likes: 2314 },
  { id: "neon", src: deep("neon-rain"), author: "Миша Крылов", handle: "@misha.creates", initials: "МК", tone: "warm", title: "Токио после дождя", prompt: "Портрет под прозрачным зонтом, мокрый асфальт отражает неон, анаморфные блики", preset: "Пресет · Неоновый дождь", model: "Flux 1.1 Pro", kind: "photo", cost: 4, likes: 1870 },
  { id: "dune", src: deep("dune-silk"), author: "Софи Ар", handle: "@sofi.ai", initials: "СА", tone: "plum", title: "Шёлк на ветру", prompt: "Модель в оранжевом шёлке на тёмных дюнах, синий час, ткань летит", preset: "AI-фотосессия · Editorial", model: "Flux 1.1 Pro", kind: "photo", cost: 6, likes: 3402 },
  { id: "ballet", src: deep("ballet"), author: "Артём Небо", handle: "@artem.sky", initials: "АН", tone: "teal", title: "Прыжок в пыли света", prompt: "Балерина в заброшенном театре, один тёплый луч, пыль в воздухе, живописно", preset: "Эффект · Оживить фото", model: "Kling 2.1", kind: "video", seconds: 5, cost: 9, likes: 980 },
  { id: "islands", src: deep("sky-islands"), author: "Ника Ом", handle: "@nika.om", initials: "НО", tone: "", title: "Острова над облаками", prompt: "Парящие острова с водопадами в облака, закат, крошечные фонари", preset: "Пресет · Другая вселенная", model: "Suno v4 + Flux", kind: "music", seconds: 30, cost: 8, likes: 1204 },
];

const KIND_ICON = { video: Clapperboard, photo: ImageIcon, music: Music2 };
const KIND_LABEL = (it: Item) => it.kind === "video" ? `Видео · ${it.seconds} с` : it.kind === "music" ? `Трек · ${it.seconds} с` : "Фото · 9:16";

export default function Feed() {
  const [index, setIndex] = useState(0);
  const [liked, setLiked] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [followed, setFollowed] = useState<Record<string, boolean>>({});
  const [detail, setDetail] = useState(false);
  const [coach, setCoach] = useState(true);
  const toast = useToast();
  const flight = useFlight();
  const lock = useRef(false);
  const touchY = useRef<number | null>(null);

  const go = useCallback((dir: 1 | -1) => {
    if (lock.current) return;
    lock.current = true;
    setCoach(false);
    setIndex((i) => Math.min(ITEMS.length - 1, Math.max(0, i + dir)));
    setTimeout(() => { lock.current = false; }, 650);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "ArrowDown" || e.key === "j") go(1); if (e.key === "ArrowUp" || e.key === "k") go(-1); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  const item = ITEMS[index];
  const next = ITEMS[index + 1];
  const Icon = KIND_ICON[item.kind];

  return (
    <Frame active="Feed" immersive sea={false}>
      <div
        className="md-feed"
        onWheel={(e) => { if (Math.abs(e.deltaY) > 24) go(e.deltaY > 0 ? 1 : -1); }}
        onTouchStart={(e) => { touchY.current = e.touches[0].clientY; }}
        onTouchEnd={(e) => { if (touchY.current === null) return; const d = touchY.current - e.changedTouches[0].clientY; if (Math.abs(d) > 50) go(d > 0 ? 1 : -1); touchY.current = null; }}
      >
        {ITEMS.map((it, i) => (
          <section key={it.id} className={`md-slide ${i < index ? "prev" : i > index ? "next" : ""}`} aria-hidden={i !== index}>
            <img className="bg" src={it.src} alt={it.title} />
            <div className="scrim" />
          </section>
        ))}

        <div className="md-feed-top">
          <Balance />
          <span className="md-live"><i />Для тебя · {index + 1}/{ITEMS.length}</span>
        </div>

        <div className="md-progress-rail" aria-hidden="true">{ITEMS.map((it, i) => <i key={it.id} className={i === index ? "on" : ""} />)}</div>

        {/* first-visit coach: wink = tip */}
        <button className={`md-coach ${coach ? "" : "off"}`} onClick={() => setCoach(false)} aria-hidden={!coach} tabIndex={coach ? 0 : -1}>
          <Mascot emotion="wink" size={44} float />
          <span className="say">Листай вверх — там глубже.<small>Понравилось — жми «Сделать так же»</small></span>
        </button>

        <div className="md-rail">
          <button className={liked[item.id] ? "on" : ""} onClick={() => setLiked((s) => ({ ...s, [item.id]: !s[item.id] }))} aria-pressed={!!liked[item.id]} aria-label="Нравится">
            <span className={`md-icon-btn ${liked[item.id] ? "on" : ""}`}><Heart size={21} /></span>
            {(item.likes + (liked[item.id] ? 1 : 0)).toLocaleString("ru-RU")}
          </button>
          <button onClick={() => { setSaved((s) => ({ ...s, [item.id]: !s[item.id] })); toast.show(saved[item.id] ? "Убрано из сохранённых" : "Сохранено в «Мою студию»"); }} aria-pressed={!!saved[item.id]} aria-label="Сохранить">
            <span className={`md-icon-btn ${saved[item.id] ? "on" : ""}`}><Bookmark size={20} /></span>
            Сохранить
          </button>
          <button onClick={async () => { flight.fly(); toast.show(await shareWork(item.title)); }} aria-label="Поделиться">
            <span className="md-icon-btn"><Send size={19} /></span>
            В чат
          </button>
        </div>

        <div className="md-feed-body" key={item.id}>
          <div className="md-author">
            <span className={`md-avatar ${item.tone}`}>{item.initials}</span>
            <div><div className="nm">{item.author}</div><div className="sub">{item.handle} · {item.model}</div></div>
            <button className="follow" onClick={() => setFollowed((s) => ({ ...s, [item.handle]: !s[item.handle] }))}>{followed[item.handle] ? "Вы подписаны" : "Подписаться"}</button>
          </div>
          <h1 className="md-feed-title">{item.title}</h1>
          <p className="md-feed-prompt" onClick={() => setDetail(true)}>{item.prompt}</p>
          <div className="md-feed-meta">
            <span className="md-chip on"><Sparkles size={12} />{item.preset}</span>
            <span className="md-chip"><Icon size={12} />{KIND_LABEL(item)}</span>
            <span className="md-chip"><Zap size={12} fill="currentColor" />{item.cost} кр.</span>
          </div>
          <div className="md-feed-cta">
            <a className="md-btn primary press" href={`${route("Studio")}?remix=${item.id}`}><Sparkles size={17} />Сделать так же<small>· {item.cost} кр.</small></a>
          </div>
        </div>

        {next ? (
          <button className="md-next" onClick={() => go(1)} aria-label={`Дальше: ${next.title}`}>
            <img src={next.src} alt="" />
            <div><div className="t">{next.title}</div><div className="s">{next.handle} · следующее</div></div>
            <span className="hint"><ChevronsUp size={18} />листай</span>
          </button>
        ) : (
          <a className="md-end" href={route("Studio")}>
            <Mascot emotion="sleep" size={40} />
            <div><div className="t">Дно ленты. Медуха спит.</div><div className="s">Новое всплывёт утром — а пока сделай своё</div></div>
            <span className="up"><Sparkles size={12} />в студию</span>
          </a>
        )}
      </div>

      {detail && (
        <Sheet title={item.title} onClose={() => setDetail(false)}>
          <div className="md-sheet-row"><Mascot emotion="curious" size={64} /><p>{item.prompt}</p></div>
          <div className="md-feed-meta"><span className="md-chip on"><Sparkles size={12} />{item.preset}</span><span className="md-chip">{item.model}</span><span className="md-chip"><Zap size={12} fill="currentColor" />{item.cost} кредитов</span></div>
          <a className="md-btn primary" href={`${route("Studio")}?remix=${item.id}`}><Sparkles size={16} />Сделать так же</a>
          <div style={{ display: "flex", gap: 8, marginTop: 14, overflow: "auto" }}>
            {["city", "fashion", "car", "mountain"].map((n) => <img key={n} src={asset(n)} alt="" style={{ width: 70, height: 92, objectFit: "cover", borderRadius: 12, flexShrink: 0 }} />)}
          </div>
          <p style={{ marginTop: 10, marginBottom: 0 }}>Ещё 48 работ с этим пресетом</p>
        </Sheet>
      )}
      {flight.node}
      {toast.node}
    </Frame>
  );
}
