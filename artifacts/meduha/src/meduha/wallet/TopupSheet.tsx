import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, ChevronLeft, ChevronRight, CircleSlash, Zap, Repeat, Layers, Image as ImageIcon, Clapperboard } from 'lucide-react';
import { useGetPhotoCatalog } from '@workspace/api-client-react';
import { useVideoCatalog } from '../video/videoApi';
import { cheapestAvailable, generationsFor, type Cheapest } from './yield';
import { TOPUP_PACKAGES, BILLING_PERIODS, billingQuote, discountLabel, levelOf, resolvePackage as resolve, usd, perCredit, type LevelPicks, type BillingMonths } from './pricing';
import { Sheet } from '../shared';
import './topup.css';

const num = (n: number) => n.toLocaleString('ru-RU');
type Step = 'choose' | 'review' | 'done';

export function TopupSheet({ onClose, authenticated, balance }: { onClose: () => void; authenticated: boolean; balance: number | null }) {
  const [step, setStep] = useState<Step>('choose');
  const [picked, setPicked] = useState<string>(TOPUP_PACKAGES[1].id);
  const [levels, setLevels] = useState<LevelPicks>({});
  const [months, setMonths] = useState<BillingMonths>(1);
  const pkg = resolve(TOPUP_PACKAGES.find(p => p.id === picked) ?? TOPUP_PACKAGES[0], levels);
  const quote = billingQuote(pkg, months);
  const period = BILLING_PERIODS.find(p => p.months === months)!;
  const title = step === 'done' ? 'Тест завершён' : step === 'review' ? 'Проверка выбора' : 'Тарифы и кредиты';
  return <Sheet title={title} onClose={onClose} className="mt-sheet">
    <div className="mt-flag" data-testid="status-topup-demo"><CircleSlash size={13} />Тестовый режим · оплата, подписка и начисление кредитов не подключены</div>
    {step === 'choose' && <div className="mt-step" key="choose">
      <p className="mt-lead">Цены в USD. На 3 месяца действует половина годовой скидки. Кредиты указаны за каждый месяц, полная сумма — за выбранный срок.</p>
      <div className="mt-periods" role="group" aria-label="Срок тарифа">
        {BILLING_PERIODS.map(p => <button key={p.months} type="button" aria-pressed={months === p.months} className={months === p.months ? 'on' : ''} onClick={() => setMonths(p.months)} data-testid={`button-topup-period-${p.months}`}><strong>{p.label}</strong>{p.months > 1 && <small>до −{discountLabel(billingQuote(resolve(TOPUP_PACKAGES[2], {}), p.months).discount)}</small>}</button>)}
      </div>
      <TopupCarousel picked={picked} onPick={setPicked} levels={levels} months={months} onLevel={(id, i) => { setLevels(v => ({ ...v, [id]: i })); setPicked(id); }} onProceed={id => { setPicked(id); setStep('review'); }} />
      <div className="mt-actions"><button className="m-startup-action" onClick={() => setStep('review')} data-testid="button-topup-continue">Продолжить · {usd(quote.totalUsd)} за {period.label}</button><button className="m-startup-guest" onClick={onClose} data-testid="button-topup-cancel">Отмена</button></div>
    </div>}
    {step === 'review' && <div className="mt-step" key="review">
      <dl className="mt-review" data-testid="text-topup-review">
        <div><dt>Кредиты в месяц</dt><dd>{num(pkg.credits)}</dd></div>
        <div><dt>Срок</dt><dd>{period.label}</dd></div>
        <div><dt>В пересчёте на месяц</dt><dd>{usd(quote.monthlyUsd)}/мес.</dd></div>
        <div><dt>Скидка</dt><dd>{quote.discount > 0 ? `−${discountLabel(quote.discount)}` : 'Без скидки'}</dd></div>
        <div><dt>Всего за срок · USD</dt><dd>{usd(quote.totalUsd)}</dd></div>
        {quote.savingsUsd > 0 && <div><dt>Экономия за срок</dt><dd>{usd(quote.savingsUsd)}</dd></div>}
        <div><dt>Оплата сейчас</dt><dd>Недоступна · тест</dd></div>
        <div><dt>Тип</dt><dd>Месячный тариф · макет</dd></div>
      </dl>
      {quote.volumeCalculated && <p className="mt-lead">Скидка для этого объёма Ultra рассчитана по базовой цене тарифа и может отличаться от итогового предложения.</p>}
      <p className="mt-lead">Это демонстрация. Подписка не оформится, деньги не спишутся, баланс не изменится.</p>
      <div className="mt-actions"><button className="m-startup-action" onClick={() => setStep('done')} data-testid="button-topup-sbp-test">Проверить выбор · без оплаты</button><button className="m-startup-guest" onClick={() => setStep('choose')} data-testid="button-topup-change"><ArrowLeft size={14} />Изменить тариф</button></div>
    </div>}
    {step === 'done' && <div className="mt-step" key="done" role="status">
      <div className="mt-done"><Check size={20} /><div><strong>Тестовый сценарий пройден</strong><small>{period.label} · {num(pkg.credits)} кр./мес. · всего {usd(quote.totalUsd)}</small></div></div>
      <ul className="mt-facts" data-testid="text-topup-result">
        <li>Деньги не списаны — платёжный провайдер не подключён.</li>
        <li>Кредиты не начислены, запись в истории не создана.</li>
        <li>Подписка и автопродление не активированы.</li>
        <li>{authenticated ? `Баланс аккаунта без изменений: ${balance == null ? '—' : num(balance)} кредитов.` : 'Гостевой режим: баланса нет, демо ничего не сохраняет.'}</li>
      </ul>
      <div className="mt-actions"><button className="m-startup-action" onClick={onClose} data-testid="button-topup-close">Понятно</button><button className="m-startup-guest" onClick={() => setStep('choose')} data-testid="button-topup-restart">Выбрать другой пакет</button></div>
    </div>}
  </Sheet>;
}

const TIERS: Record<string, { name: string; tone: string; sub: string }> = {
  p100: { name: 'Starter', tone: 'starter', sub: 'Для первых идей' },
  p300: { name: 'Plus', tone: 'plus', sub: 'Для ежедневного творчества' },
  p1000: { name: 'Ultra', tone: 'ultra', sub: 'Для больших проектов' },
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

function TopupCarousel({ picked, onPick, onProceed, levels, onLevel, months }: { picked: string; onPick: (id: string) => void; onProceed: (id: string) => void; levels: LevelPicks; onLevel: (id: string, i: number) => void; months: BillingMonths }) {
  const track = useRef<HTMLDivElement>(null);
  const radios = useRef<(HTMLButtonElement | null)[]>([]);
  const timer = useRef<number | undefined>(undefined);
  const drag = useRef<{ x: number; y: number; left: number; active: boolean } | null>(null);
  const suppressClick = useRef(false);
  const [dragging, setDragging] = useState(false);
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
    window.clearTimeout(timer.current);
    const p = TOPUP_PACKAGES[(i + TOPUP_PACKAGES.length) % TOPUP_PACKAGES.length];
    const j = TOPUP_PACKAGES.indexOf(p);
    onPick(p.id); snapTo(j, true); if (focus) radios.current[j]?.focus({ preventScroll: true });
  };
  const onScroll = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(syncSelection, 120);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest('.mtp-levels')) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); select(idx + 1, true); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); select(idx - 1, true); }
    else if (e.key === 'Home') { e.preventDefault(); select(0, true); }
    else if (e.key === 'End') { e.preventDefault(); select(TOPUP_PACKAGES.length - 1, true); }
  };
  const syncSelection = () => {
    const t = track.current;
    if (!t || t.scrollWidth <= t.clientWidth + 2) return;
    const mid = t.scrollLeft + t.clientWidth / 2;
    let best = 0, distance = Infinity;
    [...t.children].forEach((c, i) => {
      const el = c as HTMLElement;
      const d = Math.abs(el.offsetLeft + el.offsetWidth / 2 - mid);
      if (d < distance) { distance = d; best = i; }
    });
    pickRef.current(TOPUP_PACKAGES[best].id);
  };
  const finishDrag = () => {
    const wasDragging = drag.current?.active;
    drag.current = null;
    setDragging(false);
    if (wasDragging) syncSelection();
  };
  return <div className="mtp-carousel">
    <div className="mtp-stage">
    <button type="button" className="mtp-arrow mtp-arrow-prev" aria-label="Предыдущий тариф" disabled={idx === 0} onClick={() => select(idx - 1)} data-testid="button-topup-prev"><ChevronLeft size={20}/></button>
    <div className={`mtp-track${dragging ? ' dragging' : ''}`} ref={track} onScroll={onScroll} onScrollEnd={syncSelection} role="radiogroup" aria-label="Пакет кредитов" onKeyDown={onKey} data-testid="carousel-topup"
      onPointerDown={e => {
        suppressClick.current = false;
        if (e.pointerType !== 'mouse' || e.button !== 0) return;
        drag.current = { x: e.clientX, y: e.clientY, left: e.currentTarget.scrollLeft, active: false };
      }}
      onDragStart={e => e.preventDefault()}
      onPointerMove={e => {
        const d = drag.current;
        if (!d) return;
        const dx = e.clientX - d.x;
        if (!d.active && Math.abs(e.clientY - d.y) > Math.abs(dx) + 8) { drag.current = null; return; }
        if (!d.active && Math.abs(dx) > 8) {
          d.active = true; suppressClick.current = true;
          e.currentTarget.setPointerCapture(e.pointerId); setDragging(true);
        }
        if (d.active) { e.preventDefault(); e.currentTarget.scrollLeft = d.left - dx; }
      }}
      onPointerUp={finishDrag} onPointerCancel={finishDrag} onLostPointerCapture={finishDrag}
      onClickCapture={e => { if (suppressClick.current) { e.preventDefault(); e.stopPropagation(); suppressClick.current = false; } }}
    >
      {TOPUP_PACKAGES.map((tier, i) => { const p = resolve(tier, levels); const q = billingQuote(p, months); const term = BILLING_PERIODS.find(x => x.months === months)!; const t = TIERS[p.id] ?? { name: 'Пакет', tone: 'starter', sub: 'Тариф' }; const on = p.id === picked; const li = levelOf(tier, levels);
        return <article key={p.id} className={`mtp-card mtp-${t.tone}${on ? ' on' : ''}`} data-testid={`card-topup-${p.id}`}>
          <button type="button" role="radio" aria-checked={on} tabIndex={on ? 0 : -1} ref={el => { radios.current[i] = el; }} className="mtp-card-head" onClick={() => select(i)} data-testid={`radio-topup-${p.id}`} aria-label={`${t.name}: ${num(p.credits)} кредитов в месяц, ${usd(q.totalUsd)} за ${term.label}, тестовый тариф`}>
            <span className="mtp-card-title"><strong>{t.name}</strong><span className="mtp-radio" aria-hidden="true"><Check size={11} strokeWidth={3} /></span></span>
            <small>{t.sub}</small>
          </button>
          <div className="mtp-inset">
            <div className="mtp-inset-big"><Zap size={14} fill="currentColor" />{num(p.credits)} кр./мес.</div>
            <YieldRows credits={p.credits} y={yields} />
            {tier.levels.length > 1 && <div className="mtp-levels" role="radiogroup" aria-label={`Количество кредитов в пакете ${t.name}`} style={{ ['--pos' as string]: tier.levels.length > 1 ? li / (tier.levels.length - 1) : 0 }}>
              <span className="mtp-levels-track" aria-hidden="true"><i /></span>
              {tier.levels.map((l, k) => <button key={l.credits} type="button" role="radio" aria-checked={k === li} className={k === li ? 'on' : ''} onClick={() => onLevel(tier.id, k)} data-testid={`button-topup-level-${tier.id}-${l.credits}`}><Zap size={10} fill="currentColor" />{num(l.credits)}</button>)}
            </div>}
            <div className="mtp-inset-row mtp-inset-foot">{perCredit({ ...p, usd: q.monthlyUsd })} за кредит</div>
            {p.note && <div className="mtp-inset-row">{p.note}</div>}
          </div>
          <div className="mtp-price" data-testid={`text-topup-price-${p.id}`}>{q.discount > 0 && <del>{usd(p.usd)}</del>}<b>{usd(q.monthlyUsd)}</b><span>в месяц · USD</span>{q.discount > 0 && <em>−{discountLabel(q.discount)}</em>}</div>
          <div className="mtp-billing" data-testid={`text-topup-total-${p.id}`} aria-live="polite"><strong>Всего {usd(q.totalUsd)} за {term.label}</strong><small>{q.savingsUsd > 0 ? `Экономия ${usd(q.savingsUsd)} за срок` : 'Без скидки за срок'}</small>{q.volumeCalculated && <small>Скидка по базовому Ultra · расчёт meduha</small>}</div>
          <button type="button" className="mtp-cta" onClick={() => { window.clearTimeout(timer.current); onProceed(p.id); }} data-testid={`button-topup-select-${p.id}`}>Выбрать · {num(p.credits)} кр.</button>
          <ul className="mtp-benefits">
            <li><Layers size={12} />{num(p.credits)} кредитов в месяц · макет</li>
            <li><Repeat size={12} />Подписка не активируется</li>
            <li><CircleSlash size={12} />Без списаний и начислений</li>
          </ul>
        </article>; })}
    </div>
    <button type="button" className="mtp-arrow mtp-arrow-next" aria-label="Следующий тариф" disabled={idx === TOPUP_PACKAGES.length - 1} onClick={() => select(idx + 1)} data-testid="button-topup-next"><ChevronRight size={20}/></button>
    </div>
    <div className="mtp-dots" role="group" aria-label="Перейти к тарифу">
      {TOPUP_PACKAGES.map((p, i) => <button key={p.id} type="button" className={i === idx ? 'on' : ''} aria-label={`Тариф ${TIERS[p.id].name}`} aria-current={i === idx ? 'true' : undefined} data-testid={`indicator-topup-${p.id}`} onClick={() => select(i)} />)}
    </div>
    <span className="vs-sr" aria-live="polite">Выбран тариф {TIERS[picked]?.name}, {idx + 1} из {TOPUP_PACKAGES.length}</span>
    <p className="mtp-yield-note">Фото или видео — альтернативные варианты расходования кредитов meduha, не оба сразу. Расчёт по самой дешёвой доступной модели, округлён вниз. Дорогие модели и длинные видео расходуют больше. Дополнительные безлимиты и бонусы в тариф не включены.</p>
  </div>;
}
