import { useState } from "react";
import { ArrowDownToLine, Clapperboard, Plus, RefreshCw, Send, Sparkles, WandSparkles, Zap } from "lucide-react";
import { Frame, LiveMascot, Mascot, Sheet, asset, deep, route, shareWork, useFlight, useToast } from "./_shared";
import "./_group.css";

const VARS = [
  { id: "v1", src: deep("neon-rain"), label: "Дубль 1" },
  { id: "v2", src: asset("city"), label: "Дубль 2" },
  { id: "v3", src: asset("portrait"), label: "Дубль 3" },
  { id: "v4", src: asset("fashion"), label: "Дубль 4" },
];
const PROMPT = "Я иду под дождём в Токио, вокруг неон, камера медленно облетает, мокрый асфальт отражает свет";

export default function Result() {
  const [active, setActive] = useState("v1");
  const [saved, setSaved] = useState(false);
  const [remix, setRemix] = useState(false);
  const [more, setMore] = useState(false);
  const toast = useToast();
  const flight = useFlight();
  const cur = VARS.find((v) => v.id === active) ?? VARS[0];

  const download = () => { const a = document.createElement("a"); a.href = cur.src; a.download = `meduha-${cur.id}.png`; a.click(); setSaved(true); toast.show("Сохранено в галерею"); };

  return (
    <Frame active="Studio" immersive sea={false}>
      <div className="md-result-bg" key={cur.id}><img src={cur.src} alt={cur.label} /><div className="scrim" /></div>

      <div className="md-result-tag"><span className="md-chip solid"><Clapperboard size={12} />Видео · 9:16 · 8 с</span><span className="md-chip"><Zap size={12} fill="currentColor" />−12 кр.</span></div>

      {/* reveal hero: surprise -> joy -> wink, crossfading every 4s */}
      <div className="md-result-mascot"><LiveMascot emotions={["surprise", "joy", "wink"]} width={150} /></div>
      <div className="md-speech">Ого. Это точно ты?</div>

      <section className="md-result-panel" aria-label="Результат">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Mascot emotion="glossy" size={34} />
          <div><h2>Токио после дождя</h2><div className="md-muted" style={{ fontSize: 11, marginTop: 2 }}>Kling 2.1 · Неоновый дождь · 2 мин 41 с</div></div>
        </div>
        <p className="md-prompt-quote">{PROMPT}</p>
        <div className="md-vars" role="radiogroup" aria-label="Варианты">
          {VARS.map((v) => <button key={v.id} role="radio" aria-checked={active === v.id} className={`md-var ${active === v.id ? "on" : ""}`} onClick={() => setActive(v.id)} aria-label={v.label}><img src={v.src} alt="" /></button>)}
          <button className="md-var more" onClick={() => setMore(true)}><Plus size={16} />ещё 4<br />8 кр.</button>
        </div>
        <div className="md-result-actions">
          <button className="md-btn primary" onClick={async () => { flight.fly(); toast.show(await shareWork("Токио после дождя")); }}><Send size={17} />Отправить в чат</button>
        </div>
        <div className="md-result-row">
          <button className={saved ? "on" : ""} onClick={download} aria-pressed={saved}><ArrowDownToLine size={18} />{saved ? "Сохранено" : "Сохранить"}</button>
          <button onClick={() => toast.show("Открываю редактор сторис…")}><Sparkles size={18} />В сторис</button>
          <button onClick={() => window.location.assign(route("Studio"))}><RefreshCw size={18} />Ещё раз</button>
          <button onClick={() => setRemix(true)}><WandSparkles size={18} />Ремикс</button>
        </div>
      </section>

      {remix && (
        <Sheet title="Ремикс" onClose={() => setRemix(false)}>
          <div className="md-sheet-row"><Mascot emotion="thinking" size={64} /><p>Тот же промпт и референс — но меняем одно. Медуха переснимет за 12 кредитов.</p></div>
          <div className="md-chips" style={{ marginBottom: 16 }}>
            {["Ночь → рассвет", "Добавить снег", "Камера ближе", "Чёрно-белое", "Под музыку"].map((c) => <button key={c} className="md-chip" onClick={() => { setRemix(false); window.location.assign(`${route("Studio")}?remix=${encodeURIComponent(c)}`); }}>{c}</button>)}
          </div>
          <a className="md-btn primary" href={route("Studio")}><WandSparkles size={16} />Открыть в студии</a>
        </Sheet>
      )}
      {more && (
        <Sheet title="Ещё 4 дубля" onClose={() => setMore(false)}>
          <div className="md-sheet-row"><Mascot emotion="curious" size={64} /><p>Сгенерирую четыре новых варианта с другим сидом. Лицо и стиль останутся те же.</p></div>
          <button className="md-btn primary" onClick={() => { setMore(false); toast.show("Четыре дубля в работе — пришлю в чат"); }}><Zap size={16} fill="currentColor" />Запустить за 8 кредитов</button>
        </Sheet>
      )}
      {flight.node}
      {toast.node}
    </Frame>
  );
}
