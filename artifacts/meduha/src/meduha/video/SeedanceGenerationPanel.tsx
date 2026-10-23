import { useCallback, useEffect, useMemo, useState } from 'react';
import { ExternalLink, LoaderCircle, RefreshCw, Sparkles, Video } from 'lucide-react';

type GenerationModel = { id: string; name: string; creditPrice: number; limits: Record<string, number> };
type GenerationJob = {
  id: string; idempotencyKey: string; modelId: string; modelName: string; prompt: string; duration: number; aspectRatio: string;
  status: 'awaiting_reservation' | 'queued' | 'submitting' | 'unknown' | 'in_progress' | 'finalizing' | 'completed' | 'failed';
  requestId: string | null; resultUrl: string | null; error: string | null; createdAt: number; updatedAt: number; creditPrice: number;
};
type Props = {
  authenticated: boolean;
  prompt: string;
  duration: string;
  ratio: string;
  userId: string | undefined;
  balance: number | undefined;
  refreshBootstrap: () => Promise<void>;
  notify: (message: string) => void;
};

const requestOptions = { credentials: 'same-origin' as const, headers: { 'X-Meduha-Request': '1', 'Content-Type': 'application/json' } };
const running = new Set<GenerationJob['status']>(['awaiting_reservation', 'queued', 'submitting', 'in_progress', 'finalizing']);
const statusLabel: Record<GenerationJob['status'], string> = {
  awaiting_reservation: 'Резервируем кредиты…',
  queued: 'В очереди',
  submitting: 'Отправляем запрос провайдеру…',
  unknown: 'Не удалось подтвердить отправку',
  in_progress: 'Видео создаётся',
  finalizing: 'Завершаем списание и сохраняем результат…',
  completed: 'Видео готово',
  failed: 'Генерация не завершилась',
};

async function readResponse<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(typeof data.error === 'string' ? data.error : 'Не удалось связаться с сервисом генерации.') as Error & { status: number; code?: string };
    error.status = response.status;
    error.code = data.code;
    throw error;
  }
  return data as T;
}

async function fetchModels() {
  const response = await fetch('/api/meduha/generations/models', requestOptions);
  return readResponse<{ spendingEnabled: boolean; models: GenerationModel[] }>(response);
}
async function fetchJobs() {
  const response = await fetch('/api/meduha/generations', { credentials: 'same-origin' });
  return readResponse<{ items: GenerationJob[] }>(response);
}

export default function SeedanceGenerationPanel({ authenticated, prompt, duration, ratio, userId, balance, refreshBootstrap, notify }: Props) {
  const [models, setModels] = useState<GenerationModel[]>([]);
  const [spendingEnabled, setSpendingEnabled] = useState(false);
  const [jobs, setJobs] = useState<GenerationJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const selectedModel = models[0];
  const parsedDuration = useMemo(() => Number.parseInt(duration, 10) || 5, [duration]);

  const refresh = useCallback(async () => {
    if (!authenticated) { setLoading(false); return; }
    try {
      const [config, history] = await Promise.all([fetchModels(), fetchJobs()]);
      setModels(config.models);
      setSpendingEnabled(config.spendingEnabled);
      setJobs(history.items);
      setError('');
    } catch (caught) {
      const error = caught as Error;
      if ((error as Error & { status?: number }).status === 401) return;
      setError(error.message);
    } finally {
      setLoading(false);
    }
  }, [authenticated]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    setModels([]);
    setJobs([]);
    setError('');
  }, [userId]);
  useEffect(() => {
    const hasPending = jobs.some(item => running.has(item.status) || item.status === 'unknown');
    if (!authenticated || !hasPending) return;
    const timer = window.setInterval(() => { void refresh(); }, 5000);
    return () => window.clearInterval(timer);
  }, [authenticated, jobs, refresh]);

  const pendingReservation = jobs.find(item => item.status === 'awaiting_reservation');
  const submit = async () => {
    if (submitting || (!selectedModel && !pendingReservation) || !authenticated || (!pendingReservation && !prompt.trim())) return;
    setSubmitting(true);
    setError('');
    let key = pendingReservation?.idempotencyKey ?? sessionStorage.getItem('meduha-generation-idempotency-key');
    if (!key) {
      key = crypto.randomUUID();
      sessionStorage.setItem('meduha-generation-idempotency-key', key);
    }
    try {
      const response = await fetch('/api/meduha/generations', {
        ...requestOptions,
        method: 'POST',
        body: JSON.stringify({
          idempotencyKey: key,
          modelId: pendingReservation?.modelId ?? selectedModel?.id,
          prompt: pendingReservation?.prompt ?? prompt,
          duration: pendingReservation?.duration ?? parsedDuration,
          aspectRatio: pendingReservation?.aspectRatio ?? ratio,
        }),
      });
      const result = await readResponse<{ job: GenerationJob }>(response);
      sessionStorage.removeItem('meduha-generation-idempotency-key');
      setJobs(items => [result.job, ...items.filter(item => item.id !== result.job.id)]);
      await refreshBootstrap();
      notify(`Кредиты зарезервированы: ${result.job.creditPrice}. Запрос принят в очередь.`);
    } catch (caught) {
      const error = caught as Error & { status?: number; code?: string };
      if (error.status && (error.status < 500 || ['MODEL_UNAVAILABLE', 'IDEMPOTENCY_CONFLICT'].includes(error.code ?? ''))) {
        sessionStorage.removeItem('meduha-generation-idempotency-key');
      }
      setError(error.message);
    } finally {
      setSubmitting(false);
    }
  };

  const costLabel = selectedModel ? `${selectedModel.creditPrice} кредитов` : pendingReservation ? `${pendingReservation.creditPrice} кредитов` : 'цена не задана';
  const job = jobs.find(item => running.has(item.status) || item.status === 'unknown') ?? jobs[0] ?? null;
  const activeJob = job && running.has(job.status);
  const hasUnresolvedJob = jobs.some(item => item.status !== 'awaiting_reservation' && (running.has(item.status) || item.status === 'unknown'));
  return <section className="seedance-panel" aria-live="polite">
    <div className="seedance-panel-heading">
      <span className="seedance-icon"><Video size={17}/></span>
      <span><strong>Seedance 2.5</strong><small>Видео из текста · оплата кредитами</small></span>
      {selectedModel && <b>{costLabel}</b>}
    </div>
    {!authenticated
      ? <p className="seedance-hint">Войди через Telegram, чтобы проверить доступность модели и запустить генерацию.</p>
      : loading
        ? <p className="seedance-hint"><LoaderCircle className="seedance-spin" size={14}/> Проверяем модель и настройки…</p>
        : pendingReservation
          ? <button className="m-generate seedance-submit" disabled={submitting || hasUnresolvedJob} onClick={() => void submit()}>
              {submitting ? <LoaderCircle className="seedance-spin" size={16}/> : <RefreshCw size={15}/>}Продолжить тот же запрос
            </button>
        : models.length === 0
          ? <p className="seedance-hint">{spendingEnabled
            ? 'Seedance пока отключён в настройках модели или канала.'
            : 'Запуск пока недоступен: администратор должен включить расходы и задать цену и лимиты.'}</p>
          : !spendingEnabled
            ? <p className="seedance-hint">Показываем модель, но новые расходы отключены в настройках.</p>
            : <button className="m-generate seedance-submit" disabled={submitting || hasUnresolvedJob || (!pendingReservation && (!prompt.trim() || parsedDuration < 4 || parsedDuration > 30))} onClick={() => void submit()}>
              {submitting ? <LoaderCircle className="seedance-spin" size={16}/> : <Sparkles size={16}/>}
              {pendingReservation ? 'Продолжить отправку' : `Создать видео · ${costLabel}`}
            </button>}
    {authenticated && selectedModel && balance !== undefined && <p className="seedance-hint">Баланс: {balance} кредитов{balance < selectedModel.creditPrice ? ' · не хватает кредитов' : ''}</p>}
    {error && <div className="seedance-error" role="alert">{error}
      {sessionStorage.getItem('meduha-generation-idempotency-key') && <small>Повторная проверка использует тот же ключ и не отправит второй платный запрос.</small>}
    </div>}
    {job && <div className={`seedance-job ${activeJob ? 'is-active' : ''}`}>
      <div className="seedance-job-line">
        {activeJob && <LoaderCircle className="seedance-spin" size={14}/>}
        <strong>{statusLabel[job.status] ?? 'Статус обновляется'}</strong>
        <button className="seedance-refresh" onClick={() => void refresh()} aria-label="Обновить статус"><RefreshCw size={13}/></button>
      </div>
      <p>{job.duration} сек · {job.aspectRatio} · {job.creditPrice} кредитов</p>
      {job.status === 'unknown' && <p className="seedance-warning">{job.requestId
        ? 'Есть ID запроса. Мы проверяем его статус без повторной отправки; кредит остаётся зарезервирован.'
        : 'Мы не получили ID запроса от провайдера. Кредит остаётся зарезервирован; повторная отправка отключена. Администратор может проверить этот запрос вручную.'}</p>}
      {job.status === 'awaiting_reservation' && <p className="seedance-warning">Операция не завершилась. Продолжение использует тот же запрос и не создаст новый платный заказ.</p>}
      {job.status === 'failed' && <p className="seedance-warning">{job.error || 'Провайдер не завершил генерацию. Резерв кредитов снят.'}</p>}
      {job.status === 'completed' && job.resultUrl && <a className="seedance-result" href={job.resultUrl} target="_blank" rel="noreferrer"><Video size={15}/>Открыть готовое видео<ExternalLink size={13}/></a>}
      {job.requestId && <small className="seedance-request-id">ID запроса: {job.requestId}</small>}
    </div>}
  </section>;
}
