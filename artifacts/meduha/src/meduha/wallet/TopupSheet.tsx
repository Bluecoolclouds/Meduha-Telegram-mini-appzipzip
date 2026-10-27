import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, CircleSlash, Zap, Repeat, Layers, Image as ImageIcon, Clapperboard } from 'lucide-react';
import { useGetMeduhaBillingCatalog, useGetPhotoCatalog } from '@workspace/api-client-react';
import { useVideoCatalog } from '../video/videoApi';
import { cheapestAvailable, generationsFor, type Cheapest } from './yield';
import { BILLING_PERIODS, discountPercent, groupBillingPlans, planTierId, priceInRubles, type BillingMonths, type BillingTier } from './pricing';
import { PaymentMethods } from './PaymentMethods';
import { Sheet } from '../shared';
import './topup.css';

const num = (n: number) => n.toLocaleString('ru-RU');
type Step = 'choose' | 'pay';

export function TopupSheet({ onClose }: { onClose: () => void; authenticated: boolean; balance: number | null }) {
  const [step, setStep] = useState<Step>('choose');
  const [picked, setPicked] = useState<string>('p300-1200');
  const [months, setMonths] = useState<BillingMonths>(1);
  const catalog = useGetMeduhaBillingCatalog({ request: { credentials: 'same-origin' } });
  const tiers = groupBillingPlans(catalog.data?.plans);
  const plans = tiers.flatMap(tier => tier.levels);
  const plan = plans.find(item => item.id === picked) ?? plans[0];
  const quote = plan?.termPrices.find(item => item.months === months);
  const period = BILLING_PERIODS.find(p => p.months === months)!;
  const title = step === 'pay' ? 'Способ оплаты' : 'Тарифы и кредиты';

  useEffect(() => {
    if (plans.length && !plans.some(item => item.id === picked)) setPicked(plans[0].id);
  }, [plans, picked]);

  return <Sheet title={title} onClose={onClose} className="mt-sheet">
    {step === 'choose' && <div className="mt-flag" data-testid="status-topup-payments"><CircleSlash size={13} />Демо-режим оплаты: деньги не списываются. За срок — один платёж без автопродления, кредиты начисляются раз в месяц.</div>}
    {catalog.isLoading && <p className="mt-lead" role="status">Загружаем тарифы…</p>}
    {catalog.isError && <p className="mt-lead" role="alert">Не удалось загрузить цены. <button type="button" onClick={() => void catalog.refetch()}>Повторить</button></p>}
    {step === 'choose' && <div className="mt-step" key="choose">
      <div className="mt-periods" role="group" aria-label="Срок тарифа">
        {BILLING_PERIODS.map(p => {
          const term = plan?.termPrices.find(item => item.months === p.months);
          const discount = term && plan ? discountPercent(plan.monthlyAmountMinor, p.months, term.savingsMinor) : 0;
          return <button key={p.months} type="button" aria-pressed={months === p.months} className={months === p.months ? 'on' : ''} onClick={() => setMonths(p.months)} data-testid={`button-topup-period-${p.months}`}><strong>{p.label}</strong>{p.months > 1 && discount > 0 && <small>−{discount}%</small>}</button>;
        })}
      </div>
      {tiers.length > 0 && <TopupCarousel picked={picked} onPick={setPicked} tiers={tiers} months={months} onProceed={id => { setPicked(id); setStep('pay'); }} />}
      {plan && quote && <div className="mt-actions"><button type="button" className="m-startup-action" onClick={() => setStep('pay')} data-testid="button-topup-continue">Продолжить · {priceInRubles(quote.totalAmountMinor)} за {period.label}</button><button type="button" className="m-startup-guest" onClick={onClose} data-testid="button-topup-cancel">Отмена</button></div>}
    </div>}
    {step === 'pay' && plan && quote && <PaymentMethods key="pay" plan={plan} quote={quote} months={months} tierName={TIERS[planTierId(plan.id)]?.name ?? plan.name} onBack={() => setStep('choose')} />}
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

function TopupCarousel({ picked, onPick, onProceed, tiers, months }: { picked: string; onPick: (id: string) => void; onProceed: (id: string) => void; tiers: BillingTier[]; months: BillingMonths }) {
  const track = useRef<HTMLDivElement>(null);
  const radios = useRef<(HTMLButtonElement | null)[]>([]);
  const timer = useRef<number | undefined>(undefined);
  const drag = useRef<{ x: number; y: number; left: number; active: boolean } | null>(null);
  const suppressClick = useRef(false);
  const [dragging, setDragging] = useState(false);
  const pickRef = useRef(onPick); pickRef.current = onPick;
  const yields = useYields();
  const idx = Math.max(0, tiers.findIndex(tier => tier.levels.some(plan => plan.id === picked)));
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
    const j = (i + tiers.length) % tiers.length;
    const tier = tiers[j];
    if (!tier) return;
    const nextPlan = tier.levels.find(plan => plan.id === picked) ?? tier.levels[0];
    if (nextPlan) onPick(nextPlan.id);
    snapTo(j, true); if (focus) radios.current[j]?.focus({ preventScroll: true });
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
    else if (e.key === 'End') { e.preventDefault(); select(tiers.length - 1, true); }
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
    const tier = tiers[best];
    const selected = tier?.levels.find(plan => plan.id === picked) ?? tier?.levels[0];
    if (selected) pickRef.current(selected.id);
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
       {tiers.map((tier, i) => {
         const p = tier.levels.find(plan => plan.id === picked) ?? tier.levels[0];
         if (!p) return null;
         const q = p.termPrices.find(price => price.months === months);
         if (!q) return null;
         const term = BILLING_PERIODS.find(x => x.months === months)!;
         const tierId = planTierId(p.id);
         const t = TIERS[tierId] ?? { name: p.name, tone: 'starter', sub: 'Тариф' };
         const on = p.id === picked;
         const li = Math.max(0, tier.levels.findIndex(level => level.id === p.id));
         const discount = discountPercent(p.monthlyAmountMinor, months, q.savingsMinor);
         const perCreditRub = (p.monthlyAmountMinor / 100 / p.credits).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
         return <article key={tier.id} className={`mtp-card mtp-${t.tone}${on ? ' on' : ''}`} data-testid={`card-topup-${tier.id}`} onClick={e => {
           if ((e.target as HTMLElement).closest('.mtp-levels, .mtp-cta')) return;
           window.clearTimeout(timer.current); onProceed(p.id);
         }}>
           <button type="button" role="radio" aria-checked={on} tabIndex={on ? 0 : -1} ref={el => { radios.current[i] = el; }} className="mtp-card-head" data-testid={`radio-topup-${tier.id}`} aria-label={`${t.name}: ${num(p.credits)} кредитов в месяц, ${priceInRubles(q.totalAmountMinor)} за ${term.label}`}>
            <span className="mtp-card-title"><strong>{t.name}</strong><span className="mtp-radio" aria-hidden="true"><Check size={11} strokeWidth={3} /></span></span>
            <small>{t.sub}</small>
          </button>
          <div className="mtp-inset">
            <div className="mtp-inset-big"><Zap size={14} fill="currentColor" />{num(p.credits)} кр./мес.</div>
            <YieldRows credits={p.credits} y={yields} />
             {tier.levels.length > 1 && <div className="mtp-levels" role="radiogroup" aria-label={`Количество кредитов в пакете ${t.name}`} style={{ ['--pos' as string]: tier.levels.length > 1 ? li / (tier.levels.length - 1) : 0 }}>
              <span className="mtp-levels-track" aria-hidden="true"><i /></span>
               {tier.levels.map((level, k) => <button key={level.id} type="button" role="radio" aria-checked={k === li} className={k === li ? 'on' : ''} onClick={e => { e.stopPropagation(); onPick(level.id); }} data-testid={`button-topup-level-${tier.id}-${level.credits}`}><Zap size={10} fill="currentColor" />{num(level.credits)}</button>)}
            </div>}
             <div className="mtp-inset-row mtp-inset-foot">{perCreditRub} ₽ за кредит</div>
          </div>
           <div className="mtp-price" data-testid={`text-topup-price-${tier.id}`}>{q.savingsMinor > 0 && <del>{priceInRubles(p.monthlyAmountMinor)}</del>}<b>{priceInRubles(q.monthlyAmountMinor)}</b><span>в месяц · RUB</span>{discount > 0 && <em>−{discount}%</em>}</div>
           <div className="mtp-billing" data-testid={`text-topup-total-${tier.id}`} aria-live="polite"><strong>Всего {priceInRubles(q.totalAmountMinor)} за {term.label}</strong><small>{q.savingsMinor > 0 ? `Экономия ${priceInRubles(q.savingsMinor)} за срок` : 'Без скидки за срок'}</small></div>
           <button type="button" className="mtp-cta" onClick={e => { e.stopPropagation(); window.clearTimeout(timer.current); onProceed(p.id); }} data-testid={`button-topup-select-${tier.id}`}>Выбрать · {num(p.credits)} кр.</button>
          <ul className="mtp-benefits">
             <li><Layers size={12} />{num(p.credits)} кредитов в месяц</li>
             <li><Repeat size={12} />Оплата за срок одним платежом</li>
             <li><CircleSlash size={12} />Ежемесячное начисление, без автопродления</li>
          </ul>
        </article>; })}
    </div>
     <button type="button" className="mtp-arrow mtp-arrow-next" aria-label="Следующий тариф" disabled={idx === tiers.length - 1} onClick={() => select(idx + 1)} data-testid="button-topup-next"><ChevronRight size={20}/></button>
    </div>
    <div className="mtp-dots" role="group" aria-label="Перейти к тарифу">
      {tiers.map((tier, i) => <button key={tier.id} type="button" className={i === idx ? 'on' : ''} aria-label={`Тариф ${TIERS[tier.id]?.name ?? tier.levels[0]?.name}`} aria-current={i === idx ? 'true' : undefined} data-testid={`indicator-topup-${tier.id}`} onClick={() => select(i)} />)}
    </div>
    <span className="vs-sr" aria-live="polite">Выбран тариф {TIERS[planTierId(picked)]?.name}, {idx + 1} из {tiers.length}</span>
    <p className="mtp-yield-note">Фото или видео — альтернативные варианты расходования кредитов meduha, не оба сразу. Расчёт по самой дешёвой доступной модели, округлён вниз. Дорогие модели и длинные видео расходуют больше. Дополнительные безлимиты и бонусы в тариф не включены.</p>
  </div>;
}
