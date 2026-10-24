import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, CircleSlash, Zap, Repeat, Layers, Image as ImageIcon, Clapperboard } from 'lucide-react';
import { useGetPhotoCatalog } from '@workspace/api-client-react';
import { useVideoCatalog } from '../video/videoApi';
import { cheapestAvailable, generationsFor, type Cheapest } from './yield';
import { Sheet } from '../shared';
import './topup.css';

/* Preliminary TEST packages. Edit freely: nothing here is a live offer,
   nothing is sent to a server and the wallet is never touched. */
export type TopupLevel = { credits: number; rub: number };
/* The first level is the default. Extra levels keep the tier's price per
   credit; replace them with final prices before launch. */
export type TopupTier = { id: string; levels: TopupLevel[]; note?: string };
export type TopupPackage = TopupLevel & { id: string; note?: string };
export const TOPUP_PACKAGES: TopupTier[] = [
  { id: 'p100', levels: [{ credits: 100, rub: 199 }] },
  { id: 'p300', levels: [{ credits: 300, rub: 499 }, { credits: 600, rub: 998 }, { credits: 900, rub: 1497 }], note: 'Для новых идей' },
  { id: 'p1000', levels: [{ credits: 1000, rub: 1490 }, { credits: 2000, rub: 2980 }, { credits: 3000, rub: 4470 }] },
];
type LevelPicks = Record<string, number>;
const levelOf = (t: TopupTier, picks: LevelPicks) => Math.min(Math.max(0, picks[t.id] ?? 0), t.levels.length - 1);
const resolve = (t: TopupTier, picks: LevelPicks): TopupPackage => ({ id: t.id, note: t.note, ...t.levels[levelOf(t, picks)] });
const rub = (n: number) => `${n.toLocaleString('ru-RU')} ₽`;
const num = (n: number) => n.toLocaleString('ru-RU');
type Step = 'choose' | 'review' | 'done';

export function TopupSheet({ onClose, authenticated, balance }: { onClose: () => void; authenticated: boolean; balance: number | null }) {
  const [step, setStep] = useState<Step>('choose');
  const [picked, setPicked] = useState<string>(TOPUP_PACKAGES[1].id);
  const [levels, setLevels] = useState<LevelPicks>({});
  const pkg = resolve(TOPUP_PACKAGES.find(p => p.id === picked) ?? TOPUP_PACKAGES[0], levels);
  const title = step === 'done' ? 'Тест завершён' : step === 'review' ? 'Проверка заказа' : 'Пополнение кредитов';
  return <Sheet title={title} onClose={onClose} className="mt-sheet">
    <div className="mt-flag" data-testid="status-topup-demo"><CircleSlash size={13} />Тестовый режим · цены и пакеты предварительные, не действующее предложение</div>
    {step === 'choose' && <div className="mt-step" key="choose">
      <p className="mt-lead">Разовые пакеты кредитов. Не подписка: без автопродления и без активации plus.</p>
      <TopupCarousel picked={picked} onPick={setPicked} levels={levels} onLevel={(id, i) => { setLevels(v => ({ ...v, [id]: i })); setPicked(id); }} onProceed={id => { setPicked(id); setStep('review'); }} />
      <div className="mt-actions"><button className="m-startup-action" onClick={() => setStep('review')} data-testid="button-topup-continue">Продолжить · {num(pkg.credits)} кр. · {rub(pkg.rub)}</button><button className="m-startup-guest" onClick={onClose} data-testid="button-topup-cancel">Отмена</button></div>
    </div>}
    {step === 'review' && <div className="mt-step" key="review">
      <dl className="mt-review" data-testid="text-topup-review">
        <div><dt>Пакет</dt><dd>{num(pkg.credits)} кредитов</dd></div>
        <div><dt>К оплате</dt><dd>{rub(pkg.rub)}</dd></div>
        <div><dt>Способ</dt><dd>СБП · тест</dd></div>
        <div><dt>Тип</dt><dd>Разовая покупка</dd></div>
      </dl>
      <p className="mt-lead">Это демонстрация. Банк не откроется, деньги не спишутся, баланс не изменится.</p>
      <div className="mt-actions"><button className="m-startup-action" onClick={() => setStep('done')} data-testid="button-topup-sbp-test">Тестовая оплата через СБП</button><button className="m-startup-guest" onClick={() => setStep('choose')} data-testid="button-topup-change"><ArrowLeft size={14} />Изменить пакет</button></div>
    </div>}
    {step === 'done' && <div className="mt-step" key="done" role="status">
      <div className="mt-done"><Check size={20} /><div><strong>Тестовый сценарий пройден</strong><small>{num(pkg.credits)} кредитов · {rub(pkg.rub)} · СБП</small></div></div>
      <ul className="mt-facts" data-testid="text-topup-result">
        <li>Деньги не списаны — платёжный провайдер не подключён.</li>
        <li>Кредиты не начислены, запись в истории не создана.</li>
        <li>{authenticated ? `Баланс аккаунта без изменений: ${balance == null ? '—' : num(balance)} кредитов.` : 'Гостевой режим: баланса нет, демо ничего не сохраняет.'}</li>
      </ul>
      <div className="mt-actions"><button className="m-startup-action" onClick={onClose} data-testid="button-topup-close">Понятно</button><button className="m-startup-guest" onClick={() => setStep('choose')} data-testid="button-topup-restart">Выбрать другой пакет</button></div>
    </div>}
  </Sheet>;
}

const TIERS: Record<string, { name: string; tone: string; sub: string }> = {
  p100: { name: 'Старт', tone: 'starter', sub: 'Малый разовый пакет' },
  p300: { name: 'Плюс', tone: 'plus', sub: 'Средний разовый пакет' },
  p1000: { name: 'Ультра', tone: 'ultra', sub: 'Большой разовый пакет' },
};
const read = { credentials: 'same-origin' as const };
type Yields = { loading: boolean; error: boolean; photo: Cheapest | null; video: Cheapest | null };
function useYields(): Yields {
  const photo = useGetPhotoCatalog({ request: read });
  const video = useVideoCatalog();
  return { loading: photo.isLoading || video.isLoading, error: photo.isError || video.isError,
    photo: cheapestAvailable(photo.data?.models), video: cheapestAvailable(video.data?.models) };
}
function YieldRows({ credits, y }: { credits: number; y: Yields }) {
  if (y.loading) return <div className="mtp-inset-row">Считаем, сколько это генераций…</div>;
  if (y.error) return <div className="mtp-inset-row">Не удалось загрузить цены генераций</div>;
  const rows = ([['photo', 'фото', ImageIcon, y.photo], ['video', 'видео', Clapperboard, y.video]] as const)
    .map(([key, label, Icon, c]) => { const n = generationsFor(credits, c); return c && n !== null
      ? <div key={key} className="mtp-yield" data-testid={`text-yield-${key}-${credits}`}><Icon size={12} /><span>≈ {num(n)} {label}</span><small>{c.name} · {num(c.price)} кр.</small></div> : null; })
    .filter(Boolean);
  return rows.length ? <>{rows}</> : <div className="mtp-inset-row" data-testid={`text-yield-none-${credits}`}>Цены моделей ещё не настроены — количество генераций появится после настройки</div>;
}
const perCredit = (p: TopupPackage) => (p.rub / p.credits).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function TopupCarousel({ picked, onPick, onProceed, levels, onLevel }: { picked: string; onPick: (id: string) => void; onProceed: (id: string) => void; levels: LevelPicks; onLevel: (id: string, i: number) => void }) {
  const track = useRef<HTMLDivElement>(null);
  const radios = useRef<(HTMLButtonElement | null)[]>([]);
  const timer = useRef<number | undefined>(undefined);
  const pickRef = useRef(onPick); pickRef.current = onPick;
  const yields = useYields();
  const idx = Math.max(0, TOPUP_PACKAGES.findIndex(p => p.id === picked));
  const snapTo = (i: number, smooth: boolean) => {
    const t = track.current; const card = t?.children[i] as HTMLElement | undefined;
    if (!t || !card || t.scrollWidth <= t.clientWidth + 2) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    t.scrollTo({ left: card.offsetLeft - (t.clientWidth - card.offsetWidth) / 2, behavior: smooth && !reduce ? 'smooth' : 'auto' });
  };
  const idxRef = useRef(idx); idxRef.current = idx;
  useLayoutEffect(() => { snapTo(idx, false); }, []); // align initial / restored card on mount
  useEffect(() => {
    const t = track.current;
    let previousWidth = t?.clientWidth;
    const ro = t && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => {
      if (t.clientWidth === previousWidth) return;
      previousWidth = t.clientWidth;
      snapTo(idxRef.current, false);
    }) : null;
    if (t && ro) ro.observe(t);
    return () => { ro?.disconnect(); window.clearTimeout(timer.current); };
  }, []);
  const select = (i: number, focus = false) => {
    const p = TOPUP_PACKAGES[(i + TOPUP_PACKAGES.length) % TOPUP_PACKAGES.length];
    const j = TOPUP_PACKAGES.indexOf(p);
    onPick(p.id); snapTo(j, true); if (focus) radios.current[j]?.focus({ preventScroll: true });
  };
  const onScroll = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const t = track.current; if (!t || t.scrollWidth <= t.clientWidth + 2) return;
      const mid = t.scrollLeft + t.clientWidth / 2; let best = 0, dist = Infinity;
      [...t.children].forEach((c, i) => { const el = c as HTMLElement; const d = Math.abs(el.offsetLeft + el.offsetWidth / 2 - mid); if (d < dist) { dist = d; best = i; } });
      const id = TOPUP_PACKAGES[best].id; if (id !== picked) pickRef.current(id);
    }, 90);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); select(idx + 1, true); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); select(idx - 1, true); }
    else if (e.key === 'Home') { e.preventDefault(); select(0, true); }
    else if (e.key === 'End') { e.preventDefault(); select(TOPUP_PACKAGES.length - 1, true); }
  };
  return <div className="mtp-carousel">
    <div className="mtp-track" ref={track} onScroll={onScroll} role="radiogroup" aria-label="Пакет кредитов" onKeyDown={onKey} data-testid="carousel-topup">
      {TOPUP_PACKAGES.map((tier, i) => { const p = resolve(tier, levels); const t = TIERS[p.id] ?? { name: 'Пакет', tone: 'starter', sub: 'Разовый пакет' }; const on = p.id === picked; const li = levelOf(tier, levels);
        return <article key={p.id} className={`mtp-card mtp-${t.tone}${on ? ' on' : ''}`} data-testid={`card-topup-${p.id}`}>
          <button type="button" role="radio" aria-checked={on} tabIndex={on ? 0 : -1} ref={el => { radios.current[i] = el; }} className="mtp-card-head" onClick={() => select(i)} data-testid={`radio-topup-${p.id}`} aria-label={`${t.name}: ${num(p.credits)} кредитов за ${rub(p.rub)}, разовый пакет`}>
            <span className="mtp-card-title"><strong>{t.name}</strong><span className="mtp-radio" aria-hidden="true"><Check size={11} strokeWidth={3} /></span></span>
            <small>{t.sub} · не подписка</small>
          </button>
          <div className="mtp-inset">
            <div className="mtp-inset-big"><Zap size={14} fill="currentColor" />{num(p.credits)} кредитов</div>
            <YieldRows credits={p.credits} y={yields} />
            {tier.levels.length > 1 && <div className="mtp-levels" role="radiogroup" aria-label={`Количество кредитов в пакете ${t.name}`} style={{ ['--pos' as string]: tier.levels.length > 1 ? li / (tier.levels.length - 1) : 0 }}>
              <span className="mtp-levels-track" aria-hidden="true"><i /></span>
              {tier.levels.map((l, k) => <button key={l.credits} type="button" role="radio" aria-checked={k === li} className={k === li ? 'on' : ''} onClick={() => onLevel(tier.id, k)} data-testid={`button-topup-level-${tier.id}-${l.credits}`}><Zap size={10} fill="currentColor" />{num(l.credits)}</button>)}
            </div>}
            <div className="mtp-inset-row mtp-inset-foot">{perCredit(p)} ₽ за кредит</div>
            {p.note && <div className="mtp-inset-row">{p.note}</div>}
          </div>
          <div className="mtp-price"><b>{rub(p.rub)}</b><span>разово</span></div>
          <button type="button" className="mtp-cta" onClick={() => { window.clearTimeout(timer.current); onProceed(p.id); }} data-testid={`button-topup-select-${p.id}`}>Выбрать · {num(p.credits)} кр.</button>
          <ul className="mtp-benefits">
            <li><Layers size={12} />Начисление один раз</li>
            <li><Repeat size={12} />Без автопродления</li>
            <li><CircleSlash size={12} />Plus не активируется</li>
          </ul>
        </article>; })}
    </div>
    <p className="mtp-yield-note">Количество — по самой дешёвой доступной модели каждого типа, округлено вниз. Дорогие модели и длинные видео расходуют больше.</p>
    <div className="mtp-dots" aria-hidden="true">
      {TOPUP_PACKAGES.map((p, i) => <span key={p.id} className={i === idx ? 'on' : ''} data-testid={`indicator-topup-${p.id}`} onClick={() => select(i)} />)}
    </div>
  </div>;
}
