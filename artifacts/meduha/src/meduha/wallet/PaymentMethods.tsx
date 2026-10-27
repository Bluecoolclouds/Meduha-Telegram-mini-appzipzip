import { useState } from 'react';
import { ArrowLeft, Check, CreditCard, Info, QrCode } from 'lucide-react';
import type { BillingPlan, BillingTermPrice } from '@workspace/api-client-react';
import { BILLING_PERIODS, discountPercent, priceInRubles, type BillingMonths } from './pricing';
import './payment-methods.css';

type Method = 'sbp' | 'card';
const METHODS: { id: Method; name: string; sub: string; Icon: typeof QrCode }[] = [
  { id: 'sbp', name: 'СБП', sub: 'Перевод через приложение банка по QR-коду', Icon: QrCode },
  { id: 'card', name: 'Банковская карта', sub: 'Данные карты вводятся только на странице платёжного сервиса', Icon: CreditCard },
];
const num = (n: number) => n.toLocaleString('ru-RU');

export function PaymentMethods({ plan, quote, months, tierName, onBack }: { plan: BillingPlan; quote: BillingTermPrice; months: BillingMonths; tierName: string; onBack: () => void }) {
  const [method, setMethod] = useState<Method | null>(null);
  const [notice, setNotice] = useState(false);
  const period = BILLING_PERIODS.find(p => p.months === months)!;
  const discount = discountPercent(plan.monthlyAmountMinor, months, quote.savingsMinor);
  const chosen = METHODS.find(m => m.id === method);
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const d = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const next = METHODS[(i + d + METHODS.length) % METHODS.length];
    setMethod(next.id); setNotice(false);
    (e.currentTarget.parentElement?.querySelector<HTMLElement>(`[data-method="${next.id}"]`))?.focus();
  };

  return <div className="mt-step mpm" data-testid="section-payment-methods">
    <button type="button" className="mpm-back" onClick={onBack} data-testid="button-topup-change"><ArrowLeft size={14} />Изменить тариф</button>
    <div className="mpm-demo" role="note" data-testid="status-payment-demo"><Info size={14} /><div><strong>Демо: деньги не списываются, баланс не изменится</strong><span>Это макет выбора способа оплаты. Приём платежей через FreeKassa ещё не подключён, доступность способов не гарантируется.</span></div></div>
    <section className="mpm-sum" aria-label="Выбранный тариф" data-testid="text-payment-summary">
      <div className="mpm-sum-head"><strong>{tierName}</strong><span>{period.label}</span></div>
      <div className="mpm-total"><b>{priceInRubles(quote.totalAmountMinor)}</b>{discount > 0 && <em>−{discount}%</em>}</div>
      <dl>
        <div><dt>Кредиты</dt><dd>{num(plan.credits)} в месяц</dd></div>
        <div><dt>В пересчёте</dt><dd>{priceInRubles(quote.monthlyAmountMinor)}/мес.</dd></div>
        {quote.savingsMinor > 0 && <div><dt>Экономия</dt><dd>{priceInRubles(quote.savingsMinor)}</dd></div>}
        <div><dt>Списание</dt><dd>Один раз за весь срок</dd></div>
        <div><dt>Автопродление</dt><dd>Нет</dd></div>
      </dl>
    </section>
    <div className="mpm-list" role="radiogroup" aria-label="Способ оплаты (демо)">
      {METHODS.map(({ id, name, sub, Icon }, i) => {
        const on = method === id;
        return <button key={id} type="button" role="radio" aria-checked={on} data-method={id} tabIndex={on || (!method && i === 0) ? 0 : -1}
          className={`mpm-opt${on ? ' on' : ''}`} onClick={() => { setMethod(id); setNotice(false); }} onKeyDown={e => onKey(e, i)} data-testid={`radio-payment-${id}`}>
          <span className="mpm-ico" aria-hidden="true"><Icon size={18} /></span>
          <span className="mpm-txt"><strong>{name}<small>демо</small></strong><span>{sub}</span></span>
          <span className="mpm-dot" aria-hidden="true"><Check size={11} strokeWidth={3} /></span>
        </button>;
      })}
    </div>
    {notice && chosen && <p className="mpm-notice" role="status" data-testid="status-payment-demo-result">Демо завершено: выбран способ «{chosen.name}». Оплата не создавалась, деньги не списаны, баланс без изменений.</p>}
    <div className="mt-actions">
      <button type="button" className="m-startup-action" disabled={!method} onClick={() => setNotice(true)} data-testid="button-topup-payment">{method ? `Демо-оплата ${priceInRubles(quote.totalAmountMinor)}` : 'Выбери способ оплаты'}</button>
    </div>
  </div>;
}
