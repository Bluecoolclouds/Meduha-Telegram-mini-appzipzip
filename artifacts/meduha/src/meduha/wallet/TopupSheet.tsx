import { useState } from 'react';
import { ArrowLeft, Check, CircleSlash, Zap } from 'lucide-react';
import { Sheet } from '../shared';
import './topup.css';

/* Preliminary TEST packages. Edit freely: nothing here is a live offer,
   nothing is sent to a server and the wallet is never touched. */
export type TopupPackage = { id: string; credits: number; rub: number; note?: string };
export const TOPUP_PACKAGES: TopupPackage[] = [
  { id: 'p100', credits: 100, rub: 199 },
  { id: 'p300', credits: 300, rub: 499, note: 'Для новых идей' },
  { id: 'p1000', credits: 1000, rub: 1490 },
];
const rub = (n: number) => `${n.toLocaleString('ru-RU')} ₽`;
const num = (n: number) => n.toLocaleString('ru-RU');
type Step = 'choose' | 'review' | 'done';

export function TopupSheet({ onClose, authenticated, balance }: { onClose: () => void; authenticated: boolean; balance: number | null }) {
  const [step, setStep] = useState<Step>('choose');
  const [picked, setPicked] = useState<string>(TOPUP_PACKAGES[1].id);
  const pkg = TOPUP_PACKAGES.find(p => p.id === picked) ?? TOPUP_PACKAGES[0];
  const title = step === 'done' ? 'Тест завершён' : step === 'review' ? 'Проверка заказа' : 'Пополнение кредитов';
  return <Sheet title={title} onClose={onClose} className="mt-sheet">
    <div className="mt-flag" data-testid="status-topup-demo"><CircleSlash size={13} />Тестовый режим · цены и пакеты предварительные, не действующее предложение</div>
    {step === 'choose' && <div className="mt-step" key="choose">
      <p className="mt-lead">Разовые пакеты кредитов. Не подписка: без автопродления и без активации plus.</p>
      <div className="mt-packs" role="radiogroup" aria-label="Пакет кредитов">
        {TOPUP_PACKAGES.map(p => <label key={p.id} className={`mt-pack${p.id === picked ? ' on' : ''}`} data-testid={`radio-topup-${p.id}`}>
          <input type="radio" name="topup-pack" value={p.id} checked={p.id === picked} onChange={() => setPicked(p.id)} />
          <span className="mt-dot" aria-hidden="true"><Check size={11} strokeWidth={3} /></span>
          <span className="mt-pack-main"><strong><Zap size={13} fill="currentColor" />{num(p.credits)} кредитов</strong>{p.note && <small>{p.note}</small>}</span>
          <b>{rub(p.rub)}</b>
        </label>)}
      </div>
      <div className="mt-actions"><button className="m-startup-action" onClick={() => setStep('review')} data-testid="button-topup-continue">Продолжить · {rub(pkg.rub)}</button><button className="m-startup-guest" onClick={onClose} data-testid="button-topup-cancel">Отмена</button></div>
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
