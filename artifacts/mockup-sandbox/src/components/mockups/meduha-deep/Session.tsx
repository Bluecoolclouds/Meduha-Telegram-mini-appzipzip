import { useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  Check,
  CircleCheck,
  Images,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  WalletCards,
} from "lucide-react";
import { Frame, Mascot, type Emotion } from "./_shared";
import "./_group.css";
import "./session.css";

type Scenario = "checking" | "offline" | "ready";

const stages = [
  "Подтверждаем вход через Telegram",
  "Находим личную студию",
  "Загружаем идеи и баланс",
];

const scenarioTabs: { id: Scenario; label: string }[] = [
  { id: "checking", label: "Входим" },
  { id: "offline", label: "Нет связи" },
  { id: "ready", label: "Студия" },
];

const moodByScenario: Record<Scenario, Emotion> = {
  checking: "thinking",
  offline: "tired",
  ready: "hello",
};

export default function Session() {
  const [scenario, setScenario] = useState<Scenario>(() => {
    const requested = new URLSearchParams(window.location.search).get("state");
    return requested === "ready" || requested === "offline" ? requested : "checking";
  });

  return (
    <Frame active="Feed">
      <div className="md-scroll md-auth-screen">
        <div className="md-auth-demo" role="tablist" aria-label="Состояние демонстрации">
          {scenarioTabs.map((tab) => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={scenario === tab.id}
              className={scenario === tab.id ? "selected" : ""}
              onClick={() => setScenario(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {scenario === "checking" && (
          <section className="md-auth-state" aria-labelledby="md-auth-title" aria-live="polite">
            <div className="md-auth-orbit md-auth-orbit-checking" aria-hidden="true">
              <span /><span /><span /><span />
            </div>
            <Mascot className="md-auth-mascot" emotion="thinking" size={112} float />
            <span className="md-auth-eyebrow"><i />СНОВА В ГЛУБИНЕ</span>
            <h1 id="md-auth-title">Вернёмся<br /><span>к твоим мирам.</span></h1>
            <p className="md-auth-lead">
              Telegram уже знает тебя. Подгружаем студию, которую ты оставил здесь.
            </p>

            <ol className="md-auth-stages">
              {stages.map((label, index) => (
                <li className={index === 0 ? "current" : ""} key={label}>
                  <span className="md-auth-stage-icon">
                    {index === 0
                      ? <LoaderCircle className="md-auth-spinner" size={15} />
                      : <span>{`0${index + 1}`}</span>}
                  </span>
                  <span>{label}</span>
                  {index === 0 && <small>СЕЙЧАС</small>}
                </li>
              ))}
            </ol>

            <div className="md-auth-security md-glass">
              <span className="md-auth-security-icon"><ShieldCheck size={17} /></span>
              <span>
                <strong>Без паролей и форм</strong>
                <small>Данные появятся только после проверки твоего входа.</small>
              </span>
            </div>
            <p className="md-auth-disclaimer">
              ДЕМО · пример загрузки, не настоящая проверка аккаунта.
            </p>
          </section>
        )}

        {scenario === "offline" && (
          <section className="md-auth-state md-auth-error" aria-labelledby="md-auth-error-title" aria-live="polite">
            <div className="md-auth-orbit md-auth-orbit-error" aria-hidden="true">
              <span /><span /><span /><span />
            </div>
            <Mascot className="md-auth-mascot" emotion="tired" size={112} float />
            <span className="md-auth-eyebrow md-auth-eyebrow-error"><i />ТИХАЯ ВОДА</span>
            <h1 id="md-auth-error-title">Связь<br /><span>потерялась.</span></h1>
            <p className="md-auth-lead">
              Твоя студия пока вне досягаемости. Проверим соединение ещё раз?
            </p>

            <div className="md-auth-error-card md-glass">
              <span className="md-auth-security-icon"><LockKeyhole size={17} /></span>
              <span>
                <strong>Профиль пока закрыт</strong>
                <small>Сначала нужно подтвердить вход, чтобы показать твои работы и баланс.</small>
              </span>
              <AlertCircle className="md-auth-error-mark" size={16} />
            </div>

            <button className="md-btn primary md-auth-primary" onClick={() => setScenario("checking")}>
              <RefreshCw size={16} /> Попробовать снова <ArrowRight size={15} />
            </button>
            <p className="md-auth-disclaimer">
              ДЕМО · личные данные остаются скрыты до подтверждения.
            </p>
          </section>
        )}

        {scenario === "ready" && (
          <section className="md-auth-state md-auth-ready" aria-labelledby="md-auth-ready-title" aria-live="polite">
            <div className="md-auth-orbit md-auth-orbit-ready" aria-hidden="true">
              <span /><span /><span />
            </div>
            <Mascot className="md-auth-mascot" emotion="joy" size={112} float />
            <span className="md-auth-eyebrow md-auth-eyebrow-ready"><i /><CircleCheck size={13} />НА СВОЁМ МЕСТЕ</span>
            <h1 id="md-auth-ready-title">Всё твоё<br /><span>на глубине.</span></h1>
            <p className="md-auth-lead">
              Твоя студия снова рядом. Продолжим создавать?
            </p>

            <div className="md-auth-user md-glass">
              <span className="md-auth-avatar">А</span>
              <span className="md-auth-user-copy">
                <small>ТВОЯ СТУДИЯ</small>
                <strong>Александра</strong>
                <span>Пример имени · не настоящий профиль</span>
              </span>
              <Check className="md-auth-user-check" size={17} />
            </div>

            <div className="md-auth-data">
              <article className="md-glass">
                <span className="md-auth-data-icon"><WalletCards size={16} /></span>
                <small>БАЛАНС</small>
                <strong>1 247 <i>кредитов</i></strong>
              </article>
              <article className="md-glass">
                <span className="md-auth-data-icon"><Images size={16} /></span>
                <small>МОИ РАБОТЫ</small>
                <strong>12 <i>идей</i></strong>
              </article>
            </div>

            <div className="md-auth-loaded">
              <Check size={14} />
              <span>Пример профиля · значения вымышлены</span>
            </div>
            <button className="md-btn ghost md-auth-again" onClick={() => setScenario("checking")}>
              <Sparkles size={15} /> Снова показать вход
            </button>
            <p className="md-auth-disclaimer">
              ДЕМО · экран иллюстрирует загрузку, не содержит аккаунтов пользователей.
            </p>
          </section>
        )}

        <div className="md-auth-footer" role="status">
          <i className={scenario === "offline" ? "offline" : ""} />
          <span>
            {scenario === "offline"
              ? "Пробуем восстановить связь"
              : scenario === "ready"
                ? "Демо · твоя студия загружена"
                : "Соединяемся с твоей студией"}
          </span>
          <ArrowRight size={13} />
        </div>
      </div>
    </Frame>
  );
}
