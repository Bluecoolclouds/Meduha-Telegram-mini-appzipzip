import { useState } from "react";
import { Bell, Check, ChevronRight, Clapperboard, Crown, Globe, Image as ImageIcon, LifeBuoy, Music2, Shield, Star, Zap } from "lucide-react";
import { Frame, LiveMascot, Mascot, Sheet, asset, deep, route, useToast } from "./_shared";
import "./_group.css";

const PACKS = [
  { id: "s", credits: 300, stars: 150 },
  { id: "m", credits: 1000, stars: 450, best: true },
  { id: "l", credits: 3000, stars: 1200 },
];
const WORKS = [
  { src: deep("neon-rain"), label: "Токио после дождя", kind: Clapperboard },
  { src: deep("cosmic-cat"), label: "Кот на орбите", kind: ImageIcon },
  { src: asset("perfume"), label: "Тёплый свет", kind: ImageIcon },
  { src: asset("wave"), label: "Сила океана", kind: Music2 },
  { src: asset("astronaut"), label: "Другая вселенная", kind: Clapperboard },
];
const DAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

/* Mood map for this screen:
   hello -> header greeting · glossy/joy/surprise -> live balance hero · tired -> streak nag
   thinking -> render in progress · flight -> meduha+ speed · wink -> referral · curious -> top-up sheet */
export default function Profile() {
  const [pack, setPack] = useState("m");
  const [topup, setTopup] = useState(false);
  const [plus, setPlus] = useState(false);
  const [notifs, setNotifs] = useState(true);
  const [nsfw, setNsfw] = useState(false);
  const toast = useToast();
  const chosen = PACKS.find((p) => p.id === pack) ?? PACKS[1];

  return (
    <Frame active="Profile">
      <div className="md-scroll">
        <div className="md-eyebrow">Моя студия</div>
        <div className="md-profile-head">
          <span className="md-avatar">АК</span>
          <div>
            <div className="nm">Артём Ковалёв</div>
            <div className="hd">@artem.sky <span className="md-prem"><Star size={9} fill="currentColor" />Premium</span></div>
          </div>
          <Mascot emotion="hello" size={48} float style={{ marginLeft: "auto", marginRight: 6 }} />
        </div>

        <section className="md-orbcard" aria-label="Баланс">
          <div className="md-ripples" aria-hidden="true"><i /><i /><i /></div>
          <div className="md-eyebrow" style={{ position: "relative" }}>Баланс</div>
          <div className="big">1 250<span>кредитов</span></div>
          <div className="sub">Хватит на ~100 видео или 310 фото</div>
          <LiveMascot emotions={["glossy", "joy", "surprise"]} width={104} height={96} />
          <button className="md-btn primary" onClick={() => setTopup(true)}><Star size={16} fill="currentColor" />Пополнить через Stars</button>
        </section>

        <div className="md-section"><h2>Ритм</h2><button onClick={() => toast.show("Серия: 7 дней. Рекорд — 19")}>История<ChevronRight size={14} /></button></div>
        <div className="md-streak">
          <Mascot emotion="tired" size={46} />
          <div><b>7 дней подряд</b><p>Сегодня ещё не создавал — не теряй серию</p></div>
          <div className="md-days" aria-label="Неделя">{DAYS.map((d, i) => <i key={d} className={i < 6 ? "on" : "now"} title={d} />)}</div>
        </div>
        <div className="md-stats">
          <div className="md-stat"><b>48</b><small>работ</small></div>
          <div className="md-stat"><b>12</b><small>видео</small></div>
          <div className="md-stat"><b>3</b><small>трека</small></div>
          <div className="md-stat"><b>2,3k</b><small>лайков</small></div>
        </div>

        <div className="md-section"><h2>Мои работы</h2><button onClick={() => toast.show("Все 48 работ — в чате meduha")}>Все 48<ChevronRight size={14} /></button></div>
        <div className="md-reel">
          <div className="md-reel-card busy"><Mascot emotion="thinking" size={58} float /><small>Полирую · 84%</small></div>
          {WORKS.map((w) => {
            const K = w.kind;
            return <a key={w.label} className="md-reel-card press" href={route("Result")}><img src={w.src} alt={w.label} /><span className="kind"><K size={13} /></span><span className="lbl">{w.label}</span></a>;
          })}
        </div>

        <div className="md-section"><h2>Подписка</h2></div>
        <section className="md-plus">
          <Mascot emotion="flight" size={52} bubble={false} />
          <div className="row"><span className="mark"><Crown size={22} /></span><div style={{ paddingRight: 64 }}><h3>meduha+</h3><p>Безлимитные фото, приоритет в очереди, без водяного знака</p></div></div>
          <ul>
            <li><Check size={14} />Очередь без ожидания — видео за ~40 с</li>
            <li><Check size={14} />500 кредитов каждый месяц</li>
            <li><Check size={14} />Ранний доступ к новым эффектам</li>
          </ul>
          <button className="md-btn ghost" onClick={() => setPlus(true)}><Crown size={16} />Попробовать · 7 дней бесплатно</button>
        </section>

        <button className="md-invite press" onClick={async () => { try { await navigator.clipboard.writeText("https://t.me/meduha?start=artem"); toast.show("Ссылка скопирована · +50 кредитов за друга"); } catch { toast.show("Ссылка: t.me/meduha?start=artem"); } }}>
          <Mascot emotion="wink" size={42} />
          <div><b>Позвать друга</b><small>+50 кредитов тебе и ему. 3 друга уже с тобой.</small></div>
          <ChevronRight size={16} />
        </button>

        <div className="md-section"><h2>Настройки</h2></div>
        <div className="md-settings">
          <button onClick={() => setNotifs((n) => !n)} aria-pressed={notifs}><Bell size={17} />Писать в чат, когда готово<span className={`md-switch ${notifs ? "on" : ""}`} /></button>
          <button onClick={() => setNsfw((n) => !n)} aria-pressed={nsfw}><Shield size={17} />Показывать всё в ленте<span className={`md-switch ${nsfw ? "on" : ""}`} /></button>
          <button onClick={() => toast.show("Пока только русский и English")}><Globe size={17} />Язык<small>Русский</small><ChevronRight size={16} /></button>
          <button onClick={() => window.open("https://t.me/meduha_support", "_blank", "noreferrer")}><LifeBuoy size={17} />Поддержка<small>отвечаем ~5 мин</small><ChevronRight size={16} /></button>
        </div>
        <p className="md-foot">meduha 2.4 · глубина<br />Аккаунт привязан к Telegram, пароль не нужен</p>
      </div>

      {topup && (
        <Sheet title="Пополнить баланс" onClose={() => setTopup(false)}>
          <div className="md-sheet-row"><Mascot emotion="curious" size={64} /><p>Оплата через Telegram Stars — без карт и переходов. Кредиты зачисляются мгновенно.</p></div>
          <div className="md-packs" role="radiogroup" aria-label="Пакеты">
            {PACKS.map((p) => <button key={p.id} role="radio" aria-checked={pack === p.id} className={`md-pack ${pack === p.id ? "on" : ""}`} onClick={() => setPack(p.id)}>{p.best && <span className="best">выгодно</span>}<b>{p.credits.toLocaleString("ru-RU")}</b><small>кредитов</small><span className="st"><Star size={11} />{p.stars}</span></button>)}
          </div>
          <button className="md-btn primary" style={{ marginTop: 16 }} onClick={() => { setTopup(false); toast.show(`+${chosen.credits.toLocaleString("ru-RU")} кредитов · списано ${chosen.stars} Stars`); }}><Zap size={16} fill="currentColor" />Купить за {chosen.stars} Stars</button>
          <p style={{ marginTop: 12, marginBottom: 0, fontSize: 11 }}>Stars можно купить в настройках Telegram. Возврат — в течение 24 часов.</p>
        </Sheet>
      )}
      {plus && (
        <Sheet title="meduha+" onClose={() => setPlus(false)}>
          <div className="md-sheet-row"><Mascot emotion="joy" size={64} /><p>7 дней бесплатно, потом 1 200 Stars в месяц. Отменить можно в любой момент — прямо здесь.</p></div>
          <button className="md-btn primary" onClick={() => { setPlus(false); toast.show("meduha+ активен до 21 июня"); }}><Crown size={16} />Начать 7 дней бесплатно</button>
        </Sheet>
      )}
      {toast.node}
    </Frame>
  );
}
