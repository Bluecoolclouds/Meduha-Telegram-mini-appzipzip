import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Info } from 'lucide-react';
import {
  getGetAdminStatisticsQueryKey, getListAdminJobsQueryKey, getListTemplatesQueryKey, useGetAdminStatistics, useListAdminAudit, useListAdminJobs, useListAdminReports, useListAdminTemplates,
  useModerateAdminTemplate, useResolveAdminReport,
} from '@workspace/api-client-react';
import type { AdminAuditEvent, AdminReport, AdminTemplate, AdminTemplateModerationInputStatus, MeduhaWork } from '@workspace/api-client-react';
import { ArrayPager, Confirm, Empty, ErrorBox, Feedback, PageHead, Pager, Panel, Skeleton, adminQueryRequest, adminRequest, asArray, fmtDate, fmtInt, shortId, useFlash } from './ui';

const LIST = 50;
const jobStatus: Record<string, [string, string]> = { queued: ['В очереди', 'warn'], processing: ['Обработка', 'sig'], completed: ['Готово', 'ok'], failed: ['Ошибка', 'bad'] };

export function OverviewSection() {
  const [jOff, setJOff] = useState(0); const jp = { limit: LIST, offset: jOff };
  const s = useGetAdminStatistics({ request: adminQueryRequest, query: { queryKey: getGetAdminStatisticsQueryKey(), refetchInterval: 30_000 } });
  const j = useListAdminJobs(jp, { request: adminQueryRequest, query: { queryKey: getListAdminJobsQueryKey(jp), refetchInterval: 30_000 } });
  const d = s.data; const jobs = asArray<MeduhaWork>(j.data);
  const fig = (label: string, v: unknown, sub?: string, alert?: boolean) => <div className={`adm-figure ${alert ? 'alert' : ''}`}><span>{label}</span><strong className="num">{fmtInt(v)}</strong>{sub && <em>{sub}</em>}</div>;
  return <div className="adm-section">
    <PageHead kicker={d ? `Сутки UTC ${d.utcDay}` : 'Обзор'} title="Пульт">Реальные агрегаты из финансового сервиса и базы. Обновляется каждые 30 секунд.</PageHead>
    <div className="adm-note info"><Info size={15} /><span>AI-генерация не подключена. Список задач ниже — фактические записи работ, они не запускаются и не обрабатываются провайдерами.</span></div>
    {s.isLoading ? <Panel title="Показатели"><Skeleton rows={4} /></Panel> : s.isError || !d ? <Panel title="Показатели"><ErrorBox error={s.error ?? new Error('Нет данных')} onRetry={() => void s.refetch()} /></Panel> : <>
      <div className="adm-figures">
        {fig('Аккаунтов', d.accounts)}{fig('Баланс всего', d.balance, 'кредитов')}{fig('Удержано', d.reserved)}{fig('Доступно', d.available)}
        {fig('Активных резервов', d.activeReservations)}{fig('Списано сегодня', d.settledToday)}{fig('Возвращено сегодня', d.refundedToday)}
        {fig('Бюджет дня', d.dailyBudgetUsed, `из ${fmtInt(d.dailyCreditLimit)}`, d.dailyCreditLimit > 0 && d.dailyBudgetUsed >= d.dailyCreditLimit)}
        <div className={`adm-figure ${d.spendingEnabled ? '' : 'alert'}`}><span>Расход</span><strong style={{ fontSize: 17, marginTop: 9 }}>{d.spendingEnabled ? 'Разрешён' : 'Остановлен'}</strong></div>
        {fig('Шаблонов', d.templates)}{fig('Опубликовано', d.publishedTemplates)}{fig('Работ', d.works)}
      </div>
    </>}
    <Panel title="Задачи" meta="meduha_works">
      {j.isLoading ? <Skeleton rows={6} /> : j.isError ? <ErrorBox error={j.error} onRetry={() => void j.refetch()} /> : jobs.length === 0 ? <Empty title="Задач нет">Работы появятся здесь, когда пользователи их создадут.</Empty> :
        <div className="adm-table-wrap"><table className="adm-table"><thead><tr><th>Создана</th><th>Название</th><th>Тип</th><th>Статус</th><th>ID</th></tr></thead><tbody>
          {jobs.map(x => { const [l, c] = jobStatus[x.status] ?? [x.status, '']; return <tr key={x.id}><td className="num">{fmtDate(x.createdAt)}</td><td>{x.title}{'userId' in x && <span className="sub mono">польз. {String((x as { userId?: unknown }).userId)}</span>}</td><td>{x.type}</td><td><span className={`adm-tag ${c}`}>{l}</span></td><td className="mono">{shortId(x.id)}</td></tr>; })}
        </tbody></table></div>}
      {!j.isLoading && !j.isError && <ArrayPager count={jobs.length} limit={LIST} offset={jOff} onChange={setJOff} />}
    </Panel>
  </div>;
}

const tplStatus: Record<string, [string, string]> = { pending: ['На проверке', 'warn'], published: ['Опубликован', 'ok'], draft: ['Черновик', ''] };
const repStatus: Record<string, [string, string]> = { pending: ['Новая', 'warn'], resolved: ['Решена', 'ok'], dismissed: ['Отклонена', ''] };

export function ModerationSection() {
  const qc = useQueryClient(); const { msg, flash } = useFlash();
  const [tOff, setTOff] = useState(0); const [rOff, setROff] = useState(0); const tp = { limit: LIST, offset: tOff }; const rp = { limit: LIST, offset: rOff };
  const t = useListAdminTemplates(tp, { request: adminQueryRequest }); const r = useListAdminReports(rp, { request: adminQueryRequest });
  const moderate = useModerateAdminTemplate({ request: adminRequest }); const resolve = useResolveAdminReport({ request: adminRequest });
  const [filter, setFilter] = useState<'pending' | 'published' | 'draft' | 'all'>('pending');
  const [repFilter, setRepFilter] = useState<'pending' | 'all'>('pending');
  const [pend, setPend] = useState<{ tpl: AdminTemplate; status: AdminTemplateModerationInputStatus } | null>(null);
  const [rep, setRep] = useState<{ report: AdminReport; status: 'resolved' | 'dismissed' } | null>(null);
  const refresh = () => { void qc.invalidateQueries({ predicate: q => ['/api/meduha/admin/templates', '/api/meduha/admin/reports', '/api/meduha/admin/statistics', '/api/meduha/admin/audit', getListTemplatesQueryKey()[0]].some(p => String(q.queryKey[0]).startsWith(p)) }); };
  const templates = asArray<AdminTemplate>(t.data); const reports = asArray<AdminReport>(r.data);
  const shown = templates.filter(x => filter === 'all' || x.status === filter); const shownRep = reports.filter(x => repFilter === 'all' || x.status === 'pending');
  const titleOf = (id: string) => templates.find(x => x.id === id)?.title;
  const actionLabel: Record<string, string> = { published: 'Опубликовать', pending: 'Вернуть на проверку', draft: 'Снять в черновик' };
  return <div className="adm-section">
    <PageHead kicker="Модерация" title="Публикации и жалобы">Публикации сообщества и входящие жалобы из просмотрщика.</PageHead>
    <Feedback ok={msg} />
    <div style={{ height: 12 }} />
    <Panel title="Жалобы" meta={r.data ? `${reports.filter(x => x.status === 'pending').length} новых на странице` : undefined} actions={<div className="adm-tabs">{(['pending', 'all'] as const).map(f => <button key={f} aria-pressed={repFilter === f} onClick={() => setRepFilter(f)}>{f === 'pending' ? 'Новые' : 'Все'}</button>)}</div>}>
      {r.isLoading ? <Skeleton rows={4} /> : r.isError ? <ErrorBox error={r.error} onRetry={() => void r.refetch()} /> : shownRep.length === 0 ? <Empty title={repFilter === 'pending' ? 'Новых жалоб нет' : 'Жалоб нет'} /> :
        <div className="adm-table-wrap"><table className="adm-table"><thead><tr><th>Получена</th><th>Публикация</th><th>Причина</th><th>Статус</th><th /></tr></thead><tbody>
          {shownRep.map(x => { const [l, c] = repStatus[x.status] ?? [x.status, '']; return <tr key={x.id} data-testid={`row-report-${x.id}`}><td className="num">{fmtDate(x.createdAt)}</td><td>{titleOf(x.templateId) ?? <span className="mono">{shortId(x.templateId)}</span>}<span className="sub mono">от {shortId(x.reporterId)}</span></td><td style={{ maxWidth: 360 }}>{x.reason}</td><td><span className={`adm-tag ${c}`}>{l}</span>{x.resolvedAt && <span className="sub">{fmtDate(x.resolvedAt)}</span>}</td>
            <td>{x.status === 'pending' && <div className="adm-actions"><button className="adm-btn sm primary" onClick={() => { resolve.reset(); setRep({ report: x, status: 'resolved' }); }} data-testid={`button-report-resolve-${x.id}`}>Решить</button><button className="adm-btn sm" onClick={() => { resolve.reset(); setRep({ report: x, status: 'dismissed' }); }} data-testid={`button-report-dismiss-${x.id}`}>Отклонить</button></div>}</td></tr>; })}
        </tbody></table></div>}
      {!r.isLoading && !r.isError && <ArrayPager count={reports.length} limit={LIST} offset={rOff} onChange={setROff} />}
    </Panel>
    <Panel title="Публикации" meta={t.data ? `${templates.length} на странице` : undefined} actions={<div className="adm-tabs">{(['pending', 'published', 'draft', 'all'] as const).map(f => <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)} data-testid={`filter-templates-${f}`}>{f === 'all' ? 'Все' : tplStatus[f][0]}</button>)}</div>}>
      {t.isLoading ? <Skeleton rows={5} /> : t.isError ? <ErrorBox error={t.error} onRetry={() => void t.refetch()} /> : shown.length === 0 ? <Empty title="Здесь пусто">Нет публикаций с этим статусом.</Empty> :
        <div className="adm-table-wrap"><table className="adm-table"><thead><tr><th>Публикация</th><th>Тип</th><th>Автор</th><th>Статус</th><th>Обновлена</th><th /></tr></thead><tbody>
          {shown.map(x => { const [l, c] = tplStatus[x.status] ?? [x.status, '']; return <tr key={x.id} data-testid={`row-template-${x.id}`}><td><strong>{x.title}</strong><span className="sub adm-clip">{x.prompt}</span></td><td>{x.kind}</td><td>{x.authorName ?? <span className="mono">{shortId(x.ownerId)}</span>}</td><td><span className={`adm-tag ${c}`}>{l}</span></td><td className="num">{fmtDate(x.updatedAt)}</td>
            <td><div className="adm-actions">{(['published', 'pending', 'draft'] as const).filter(st => st !== x.status).map(st => <button key={st} className={`adm-btn sm ${st === 'published' ? 'primary' : st === 'draft' ? 'danger' : ''}`} onClick={() => { moderate.reset(); setPend({ tpl: x, status: st }); }} data-testid={`button-template-${st}-${x.id}`}>{actionLabel[st]}</button>)}</div></td></tr>; })}
        </tbody></table></div>}
      {!t.isLoading && !t.isError && <ArrayPager count={templates.length} limit={LIST} offset={tOff} onChange={setTOff} />}
    </Panel>
    {pend && <Confirm title={actionLabel[pend.status]} danger={pend.status === 'draft'} confirmLabel={actionLabel[pend.status]} pending={moderate.isPending} error={moderate.error} onClose={() => setPend(null)}
      onConfirm={() => moderate.mutate({ templateId: pend.tpl.id, data: { status: pend.status } }, { onSuccess: () => { refresh(); flash(`«${pend.tpl.title}»: ${tplStatus[pend.status][0].toLowerCase()}`); setPend(null); } })}>
      <p style={{ margin: 0 }}>Публикация <strong>{pend.tpl.title}</strong> получит статус «{tplStatus[pend.status][0]}».{pend.status === 'published' ? ' Она станет видна всем в ленте.' : pend.tpl.status === 'published' ? ' Она исчезнет из публичной ленты.' : ''}</p></Confirm>}
    {rep && <Confirm title={rep.status === 'resolved' ? 'Отметить жалобу решённой' : 'Отклонить жалобу'} confirmLabel={rep.status === 'resolved' ? 'Решено' : 'Отклонить'} pending={resolve.isPending} error={resolve.error} onClose={() => setRep(null)}
      onConfirm={() => resolve.mutate({ reportId: rep.report.id, data: { status: rep.status } }, { onSuccess: () => { refresh(); flash(rep.status === 'resolved' ? 'Жалоба решена' : 'Жалоба отклонена'); setRep(null); } })}>
      <p style={{ margin: 0 }}>Статус жалобы изменится. Сама публикация не меняется — при необходимости сними её отдельно.</p></Confirm>}
  </div>;
}

const AUDIT_PAGE = 50;
const authMethodLabel = (method: unknown) => method === 'temporary' ? 'логин и пароль' : method === 'telegram' ? 'Telegram' : 'не указан';
const auditActionLabel = (action: string) => action === 'auth.session.revoke' ? 'Завершён один сеанс'
  : action === 'auth.sessions.revoke_others' ? 'Завершены остальные сеансы'
    : action;
export function AuditSection() {
  const [offset, setOffset] = useState(0);
  const q = useListAdminAudit({ limit: AUDIT_PAGE, offset }, { request: adminQueryRequest });
  const items = asArray<AdminAuditEvent>(q.data?.items);
  const details = (d: unknown) => d && typeof d === 'object' ? Object.entries(d as Record<string, unknown>).slice(0, 6).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`).join(' · ') : '';
  const auditDetails = (event: AdminAuditEvent) => {
    const eventDetails = event.details as Record<string, unknown>;
    if (event.action === 'auth.session.revoke') return `Способ входа: ${authMethodLabel(eventDetails.authMethod)}`;
    if (event.action === 'auth.sessions.revoke_others') {
      const count = eventDetails.revokedCount;
      const countLabel = Number.isSafeInteger(count) && Number(count) >= 0 ? fmtInt(Number(count)) : 'неизвестно';
      return `Способ входа администратора: ${authMethodLabel(eventDetails.authMethod)} · Завершено сеансов: ${countLabel}`;
    }
    return details(event.details);
  };
  return <div className="adm-section">
    <PageHead kicker="Аудит" title="Журнал действий">Каждое административное действие фиксируется сервером. Записи неизменяемы.</PageHead>
    <Panel title="События" meta={q.data ? `${fmtInt(q.data.total)} записей` : undefined}>
      {q.isLoading ? <Skeleton rows={10} /> : q.isError ? <ErrorBox error={q.error} onRetry={() => void q.refetch()} /> : items.length === 0 ? <Empty title="Событий пока нет" /> : <>
        <div className="adm-table-wrap"><table className="adm-table"><thead><tr><th>Время</th><th>Действие</th><th>Объект</th><th>Автор</th><th>Детали</th></tr></thead><tbody>
          {items.map(e => <tr key={e.id}><td className="num">{fmtDate(e.createdAt)}</td><td>{auditActionLabel(e.action)}</td><td>{e.entityType === 'admin-session' ? 'Административный сеанс' : e.entityType}<span className="sub mono">{e.entityType === 'admin-session' ? '' : e.entityId ? shortId(e.entityId) : '—'}</span></td><td className="mono">{shortId(e.actorId)}</td><td className="mono" style={{ fontSize: 11.5, maxWidth: 420, wordBreak: 'break-word' }}>{auditDetails(e)}</td></tr>)}
        </tbody></table></div>
        <Pager total={q.data?.total ?? 0} limit={AUDIT_PAGE} offset={offset} onChange={setOffset} /></>}
    </Panel>
  </div>;
}
