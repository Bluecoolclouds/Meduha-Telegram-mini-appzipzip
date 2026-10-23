import { useEffect, useRef, useState, type ReactNode } from "react";
import { BellRing, Camera, Check, Clapperboard, Image as ImageIcon, Mic, Music2, Paperclip, Send, Sparkles, Zap } from "lucide-react";
import { Balance, Frame, Mascot, asset, deep, route, type Emotion } from "./_shared";
import "./_group.css";

const STYLES = [
  { id: "neon", label: "Неоновый дождь", src: deep("neon-rain") },
  { id: "abyss", label: "Биолюм", src: deep("abyss") },
  { id: "dune", label: "Editorial", src: deep("dune-silk") },
  { id: "ballet", label: "Театр света", src: deep("ballet") },
  { id: "city", label: "Город", src: asset("city") },
];
const STEPS = ["Понимаю идею", "Рисую кадры", "Оживляю", "Полирую"];

type Turn = { who: "bot" | "me"; emotion?: Emotion; time: string; body: ReactNode };

/* Each bot line carries the mood of what it says:
   hello -> greeting, curious -> asking, surprise -> reacting to the reference,
   wink -> tips on format/price, thinking -> generating, joy -> offering the result,
   flight -> "sent it along" when the user adds a note mid-render. */
function Bot({ emotion, time, children }: { emotion: Emotion; time: string; children: ReactNode }) {
  return <div className="md-turn"><Mascot emotion={emotion} size={40} /><div><div className="md-bubble">{children}</div><div className="time">{time}</div></div></div>;
}
function Me({ time, children }: { time: string; children: ReactNode }) {
  return <div className="md-turn me"><div><div className="md-bubble">{children}</div><div className="time">{time}</div></div></div>;
}

export default function Studio() {
  const [style, setStyle] = useState("neon");
  const [format, setFormat] = useState("9:16");
  const [seconds, setSeconds] = useState(8);
  const [pct, setPct] = useState(23);
  const [extra, setExtra] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const [notify, setNotify] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) { setPct(68); return; }
    const id = setInterval(() => setPct((p) => (p >= 84 ? 84 : p + (p < 40 ? 1.4 : p < 70 ? 0.6 : 0.18))), 90);
    return () => clearInterval(id);
  }, []);

  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" }); }, [extra.length]);

  const cost = seconds === 5 ? 9 : 12;
  const stepIdx = pct < 25 ? 0 : pct < 55 ? 1 : pct < 80 ? 2 : 3;
  const r = 31, circ = 2 * Math.PI * r;

  const send = () => {
    const t = text.trim();
    if (!t) return;
    setText("");
    setExtra((e) => [...e, { who: "me", time: "сейчас", body: t }, { who: "bot", emotion: "flight", time: "сейчас", body: <>Записала: «{t}». Улетело в следующий дубль — он будет бесплатным.</> }]);
  };

  return (
    <Frame active="Studio" head={<><span className="md-chip"><Sparkles size={12} />Студия · видео</span><Balance /></>}>
      <div className="md-chat" ref={scroller}>
        <div className="md-day">Сегодня</div>

        <Bot emotion="hello" time="14:02">
          <span className="lead">Привет, Артём.</span>
          Что сегодня делаем? Выбери — или просто кинь фото, я сама пойму.
          <div className="md-chips">
            <span className="md-chip"><ImageIcon size={13} />Фото</span>
            <span className="md-chip on"><Clapperboard size={13} />Видео</span>
            <span className="md-chip"><Music2 size={13} />Музыку</span>
          </div>
        </Bot>
        <Me time="14:02">Видео</Me>

        <Bot emotion="curious" time="14:02">Про что оно? Опиши двумя фразами или прикрепи референс — так получится точнее.</Bot>
        <Me time="14:04">
          Я иду под дождём в Токио, вокруг неон, камера медленно облетает, мокрый асфальт отражает свет
          <div className="md-attach"><img src={deep("selfie")} alt="Референс" /><div><b>Референс · селфи</b><small>Лицо сохраню один в один</small></div></div>
        </Me>

        <Bot emotion="surprise" time="14:04">
          Ого, вижу. Под такое фото просится один из этих стилей:
          <div className="md-stylerow" role="radiogroup" aria-label="Стиль">
            {STYLES.map((s) => (
              <button key={s.id} role="radio" aria-checked={style === s.id} className={`md-style ${style === s.id ? "on" : ""}`} onClick={() => setStyle(s.id)}>
                <img src={s.src} alt="" /><span>{s.label}</span>{style === s.id && <span className="chk"><Check size={11} strokeWidth={3} /></span>}
              </button>
            ))}
          </div>
        </Bot>
        <Me time="14:05">{STYLES.find((s) => s.id === style)?.label}</Me>

        <Bot emotion="wink" time="14:05">
          Формат и длина. Для сторис беру вертикаль.
          <div className="md-chips" role="radiogroup" aria-label="Формат">
            {["9:16", "1:1", "16:9"].map((f) => <button key={f} role="radio" aria-checked={format === f} className={`md-chip ${format === f ? "on" : ""}`} onClick={() => setFormat(f)}>{f}</button>)}
            {[5, 8].map((s) => <button key={s} role="radio" aria-checked={seconds === s} className={`md-chip ${seconds === s ? "on" : ""}`} onClick={() => setSeconds(s)}>{s} сек</button>)}
          </div>
          <div className="md-chips" style={{ marginTop: 8 }}><span className="md-chip solid"><Zap size={12} fill="currentColor" />{cost} кредитов · останется {1250 - cost}</span></div>
        </Bot>
        <Me time="14:05">Поехали, {format}, {seconds} сек</Me>

        <div className="md-turn">
          <Mascot emotion="thinking" size={40} float />
          <div>
            <div className="md-gen" aria-live="polite">
              <div className="md-gen-row">
                <div className="md-ring">
                  <svg width="72" height="72" viewBox="0 0 72 72"><circle cx="36" cy="36" r={r} stroke="rgba(255,255,255,.12)" strokeWidth="5" fill="none" /><circle cx="36" cy="36" r={r} stroke="url(#mdg)" strokeWidth="5" fill="none" strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={circ * (1 - pct / 100)} style={{ transition: "stroke-dashoffset .4s ease" }} /><defs><linearGradient id="mdg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#ffb27a" /><stop offset="1" stopColor="#ff6a1a" /></linearGradient></defs></svg>
                  <span className="pct">{Math.round(pct)}%</span>
                </div>
                <div>
                  <h3>{STEPS[stepIdx]}…</h3>
                  <p>Kling 2.1 · {format} · {seconds} с. Обычно это 2–3 минуты.</p>
                </div>
              </div>
              <div className="md-gen-steps" aria-hidden="true">{STEPS.map((s, i) => <i key={s} className={i < stepIdx ? "done" : i === stepIdx ? "live" : ""} />)}</div>
              <button className="note" onClick={() => setNotify((n) => !n)} aria-pressed={notify}>
                <BellRing size={13} />{notify ? "Пришлю в чат, как закончу. Можно сворачивать." : "Можно свернуть — пришлю в чат"}
              </button>
            </div>
            <div className="time">14:06</div>
          </div>
        </div>

        {extra.map((t, i) => t.who === "me" ? <Me key={i} time={t.time}>{t.body}</Me> : <Bot key={i} emotion={t.emotion ?? "flight"} time={t.time}>{t.body}</Bot>)}

        {pct >= 84 && (
          <Bot emotion="joy" time="14:08">
            Почти готово. Хочешь — посмотри превью, пока я полирую последние кадры.
            <div className="md-chips"><a className="md-chip solid press" href={route("Result")}><Sparkles size={12} />Открыть результат</a></div>
          </Bot>
        )}
      </div>

      <form className="md-composer" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <button type="button" className="tool" aria-label="Прикрепить фото"><Paperclip size={19} /></button>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Напиши Медухе…" aria-label="Сообщение" />
        <button type="button" className="tool" aria-label="Камера"><Camera size={19} /></button>
        {text ? <button type="submit" className="send" aria-label="Отправить"><Send size={18} /></button> : <button type="button" className="tool" aria-label="Голосом"><Mic size={19} /></button>}
      </form>
    </Frame>
  );
}
