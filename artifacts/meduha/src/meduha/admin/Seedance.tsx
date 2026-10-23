import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, RefreshCw } from 'lucide-react';
import { ErrorBox, Empty, Feedback, Modal, PageHead, Panel, Skeleton, adminQueryRequest, adminRequest, fmtDate, fmtInt } from './ui';
import { formatSeedanceReservationAge, isLongHeldSeedanceReservation } from './seedanceAge';

const endpoint = '/api/meduha/admin/generations/seedance';
type Job = {
  id: string;
  accountId: string;
  status: 'submitting' | 'unknown' | 'in_progress' | 'finalizing';
  requestId: string | null;
  providerStatus: string | null;
  input: { prompt: string; duration: number; aspect_ratio: string };
  creditPrice: number;
  reservationId: string | null;
  reservationStatus: string | null;
  reservedAmount: number | null;
  reservedAt: string | null;
  reservationAgeSeconds: number | null;
  createdAt: string;
  updatedAt: string;
  resolutionOutcome: 'completed' | 'failed' | null;
  resolutionBy: string | null;
  resolutionReason: string | null;
  resolvedAt: string | null;
};
type Resolution = { job: Job; outcome: 'completed' | 'failed'; reason: string };

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, { credentials: 'same-origin', ...init });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(typeof data.error === 'string' ? data.error : 'Не удалось выполнить операцию.') as Error & { status: number };
    error.status = response.status;
    throw error;
  }
  return data as T;
}

const statusLabel: Record<Job['status'], string> = {
  submitting: 'Передаём провайдеру',
  unknown: 'Не подтверждён',
  in_progress: 'В работе',
  finalizing: 'Завершаем операцию',
};

export default function SeedanceSection() {
  const qc = useQueryClient();
  const [resolution, setResolution] = useState<Resolution | null>(null);
  const [reason, setReason] = useState('');
  const jobsQuery = useQuery({
    queryKey: [endpoint],
    queryFn: () => request<{ items: Job[] }>(endpoint),
    ...adminQueryRequest,
    refetchInterval: 30_000,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: [endpoint] });
  const check = useMutation({
    mutationFn: (jobId: string) => request(`${endpoint}/${encodeURIComponent(jobId)}/check`, {
      method: 'POST', headers: adminRequest.headers, body: '{}',
    }),
    onSuccess: refresh,
  });
  const resolve = useMutation({
    mutationFn: (value: Resolution) => request(`${endpoint}/${encodeURIComponent(value.job.id)}/resolve`, {
      method: 'POST',
      headers: { ...adminRequest.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ outcome: value.outcome, reason: value.reason.trim() }),
    }),
    onSuccess: async () => {
      setResolution(null);
      setReason('');
      await refresh();
      await qc.invalidateQueries({ queryKey: ['/api/meduha/admin/audit'] });
      await qc.invalidateQueries({ queryKey: ['/api/meduha/admin/finance'] });
      await qc.invalidateQueries({ queryKey: ['/api/meduha/admin/statistics'] });
    },
  });
  const jobs = jobsQuery.data?.items ?? [];

  return <div className="adm-section">
    <PageHead kicker="Операции" title="Seedance">Проверяй состояние по ID в Higgsfield. Запросы без ID нельзя отправить повторно: ручное решение обязательно содержит исход и причину, которые попадут в аудит.</PageHead>
    <Feedback error={check.error || resolve.error} />
    <div style={{ height: 12 }} />
    <Panel title="Незавершённые запросы" meta="Обновление каждые 30 секунд · сигнал после 15 минут">
      <div className="adm-note info"><AlertTriangle size={15} /><span>Удержание дольше 15 минут выделяется для внимания. Сигнал не запускает повторную проверку и не списывает или не возвращает кредиты.</span></div>
      <div style={{ height: 12 }} />
      {jobsQuery.isLoading ? <Skeleton rows={7} /> : jobsQuery.isError ? <ErrorBox error={jobsQuery.error} onRetry={() => void jobsQuery.refetch()} /> : jobs.length === 0
        ? <Empty title="Незавершённых запросов нет">Здесь появятся запросы с неразрешённым статусом.</Empty>
        : <div className="adm-table-wrap"><table className="adm-table"><thead><tr>
          <th>Обновлён</th><th>Запрос</th><th>Состояние</th><th>Резерв</th><th>Действия</th>
        </tr></thead><tbody>
          {jobs.map(job => <tr key={job.id} data-testid={`row-seedance-${job.id}`}>
            <td className="num">{fmtDate(job.updatedAt)}<span className="sub">создан {fmtDate(job.createdAt)}</span></td>
            <td style={{ minWidth: 230, maxWidth: 380 }}>
              <strong>{job.input.duration} сек · {job.input.aspect_ratio}</strong>
              <span className="sub mono">Аккаунт: {job.accountId}</span>
              <span className="sub adm-clip" title={job.input.prompt}>{job.input.prompt}</span>
              <span className="sub mono">Job: {job.id}</span>
              {job.requestId && <span className="sub mono">Higgsfield: {job.requestId}</span>}
              {job.resolutionReason && <span className="sub">Решение: {job.resolutionReason}</span>}
            </td>
            <td><span className={`adm-tag ${job.status === 'finalizing' ? 'sig' : 'warn'}`}>{statusLabel[job.status]}</span>
              {job.providerStatus && <span className="sub">Провайдер: {job.providerStatus}</span>}
            </td>
            <td>{job.reservationStatus ? <><span className={`adm-tag ${job.reservationStatus === 'held' ? 'warn' : job.reservationStatus === 'settled' ? 'ok' : ''}`}>{job.reservationStatus}</span>
              <span className="sub">{fmtInt(job.reservedAmount ?? job.creditPrice)} кредитов</span>
              {job.reservationStatus === 'held' && job.reservationAgeSeconds !== null && <>
                <span className="sub" data-testid={`seedance-hold-age-${job.id}`}>Удерживается {formatSeedanceReservationAge(job.reservationAgeSeconds)}</span>
                {isLongHeldSeedanceReservation(job.reservationStatus, job.reservationAgeSeconds) && <span className="adm-tag bad" data-testid={`seedance-hold-alert-${job.id}`}><AlertTriangle size={12} />Дольше 15 минут</span>}
              </>}
              {job.reservedAt && <span className="sub">с {fmtDate(job.reservedAt)}</span>}</> : <span className="adm-tag bad">резерв не найден</span>}
            </td>
            <td>
              {job.status === 'finalizing' ? <span className="sub">Операция будет восстановлена автоматически</span>
                : job.status === 'submitting' ? <span className="sub">Проверка станет доступна, если отправка зависнет</span>
                : job.requestId
                  ? <button className="adm-btn sm" disabled={check.isPending} onClick={() => check.mutate(job.id)} data-testid={`button-seedance-check-${job.id}`}>
                    <RefreshCw size={13} />{check.isPending && check.variables === job.id ? 'Проверяем…' : 'Проверить в Higgsfield'}
                  </button>
                  : <button className="adm-btn sm danger" disabled={job.status !== 'unknown' || job.reservationStatus !== 'held'}
                    onClick={() => { setReason(''); resolve.reset(); setResolution({ job, outcome: 'failed', reason: '' }); }}
                    data-testid={`button-seedance-resolve-${job.id}`}>
                    <AlertTriangle size={13} />Решить вручную
                  </button>}
            </td>
          </tr>)}
        </tbody></table></div>}
    </Panel>
    {resolution && <Modal title="Ручное решение без ID провайдера" busy={resolve.isPending}
      onClose={() => { setResolution(null); setReason(''); }}
      footer={<>
        <button className="adm-btn" disabled={resolve.isPending} onClick={() => setResolution(null)}>Отмена</button>
        <button className={`adm-btn ${resolution.outcome === 'failed' ? 'danger solid' : 'primary'}`}
          disabled={resolve.isPending || reason.trim().length < 10}
          onClick={() => resolve.mutate({ ...resolution, reason })} data-testid="button-seedance-resolve-confirm">
          {resolve.isPending ? 'Выполняется…' : resolution.outcome === 'completed' ? 'Подтвердить и списать' : 'Подтвердить и вернуть резерв'}
        </button>
      </>}>
      <div className="adm-note"><AlertTriangle size={15} /><span>Higgsfield не выдал ID — автоматически проверить результат нельзя. Выбери только исход, который ты подтвердил вне сервиса. Повторная отправка отключена. Решение и причина будут сохранены в журнале аудита.</span></div>
      <dl className="adm-review"><dt>Job</dt><dd className="mono">{resolution.job.id}</dd>
        <dt>Резерв</dt><dd>{fmtInt(resolution.job.reservedAmount ?? resolution.job.creditPrice)} кредитов · {resolution.job.reservationStatus}</dd>
      </dl>
      <label className="adm-field"><span>Подтверждённый исход</span>
        <select value={resolution.outcome} onChange={e => setResolution({ ...resolution, outcome: e.target.value as Resolution['outcome'] })}>
          <option value="failed">Запрос не выполнен — вернуть резерв</option>
          <option value="completed">Видео готово — списать резерв</option>
        </select>
      </label>
      <label className="adm-field"><span>Причина решения (обязательно, минимум 10 символов)</span>
        <textarea value={reason} maxLength={1000} onChange={e => setReason(e.target.value)} placeholder="Что именно подтвердили и на основании чего?" />
      </label>
      <small>{reason.trim().length}/1000</small>
      <Feedback error={resolve.error} />
    </Modal>}
  </div>;
}
