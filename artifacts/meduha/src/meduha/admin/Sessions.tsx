import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { MonitorCog, RotateCw, ShieldCheck, ShieldX } from 'lucide-react';
import {
  getListAdminSessionsQueryKey,
  useListAdminSessions,
  useRevokeAdminSession,
  useRevokeOtherAdminSessions,
} from '@workspace/api-client-react';
import type { AdminSessionInfo } from '@workspace/api-client-react';
import { Confirm, Empty, ErrorBox, PageHead, Panel, Skeleton, adminQueryRequest, adminRequest, fmtDate } from './ui';

type Confirmation =
  | { kind: 'one'; session: AdminSessionInfo }
  | { kind: 'others' }
  | null;

export default function SessionsSection() {
  const qc = useQueryClient();
  const queryKey = getListAdminSessionsQueryKey();
  const sessions = useListAdminSessions({
    request: adminQueryRequest,
    query: { queryKey, refetchOnMount: 'always', refetchOnWindowFocus: true },
  });
  const revokeOne = useRevokeAdminSession({ request: adminRequest });
  const revokeOthers = useRevokeOtherAdminSessions({ request: adminRequest });
  const [confirmation, setConfirmation] = useState<Confirmation>(null);
  const mutation = confirmation?.kind === 'one' ? revokeOne : revokeOthers;
  const confirm = () => {
    if (!confirmation) return;
    if (confirmation.kind === 'one') {
      revokeOne.mutate({ sessionId: confirmation.session.id }, {
        onSuccess: async () => {
          setConfirmation(null);
          await qc.invalidateQueries({ queryKey });
        },
      });
      return;
    }
    revokeOthers.mutate(undefined, {
      onSuccess: async () => {
        setConfirmation(null);
        await qc.invalidateQueries({ queryKey });
      },
    });
  };
  const rows = sessions.data ?? [];
  const otherCount = rows.filter(session => !session.current).length;

  return <section className="adm-section">
    <PageHead
      kicker="Доступ"
      title="Сеансы администратора"
      actions={<button className="adm-btn" onClick={() => void sessions.refetch()} disabled={sessions.isFetching}>
        <RotateCw size={14} />Обновить
      </button>}
    >
      Проверь способ входа и срок действия каждого активного сеанса. Токены и параметры серверной конфигурации здесь не отображаются.
    </PageHead>
    <Panel
      title="Активные сеансы"
      meta={`${rows.length} сеансов`}
      actions={<button
        className="adm-btn danger"
        onClick={() => { revokeOthers.reset(); setConfirmation({ kind: 'others' }); }}
        disabled={otherCount === 0 || revokeOthers.isPending}
        data-testid="button-revoke-other-admin-sessions"
      >Завершить остальные</button>}
    >
      {sessions.isLoading ? <Skeleton rows={4} /> : sessions.isError ? <ErrorBox error={sessions.error} onRetry={() => void sessions.refetch()} /> : rows.length === 0
        ? <Empty title="Активных сеансов нет">Истёкшие сеансы не отображаются.</Empty>
        : <div className="adm-table-wrap">
          <table className="adm-table">
            <thead><tr><th>Способ входа</th><th>Создан</th><th>Истекает</th><th>Состояние</th><th className="r">Действие</th></tr></thead>
            <tbody>{rows.map(session => <tr key={session.id}>
              <td>{session.authMethod === 'temporary' ? 'Логин и пароль' : 'Telegram'}</td>
              <td className="num">{fmtDate(session.createdAt)}</td>
              <td className="num">{fmtDate(session.expiresAt)}</td>
              <td><span className={`adm-tag ${session.current ? 'ok' : 'warn'}`}>
                {session.current ? <><ShieldCheck size={12} />Этот браузер</> : <><MonitorCog size={12} />Другой сеанс</>}
              </span></td>
              <td className="r">{session.current
                ? <span className="sub">Текущий сеанс</span>
                : <button
                  className="adm-btn danger sm"
                  onClick={() => { revokeOne.reset(); setConfirmation({ kind: 'one', session }); }}
                  disabled={revokeOne.isPending}
                  data-testid={`button-revoke-admin-session-${session.id}`}
                ><ShieldX size={13} />Завершить</button>}</td>
            </tr>)}</tbody>
          </table>
        </div>}
    </Panel>
    {confirmation && <Confirm
      title={confirmation.kind === 'one' ? 'Завершить сеанс?' : 'Завершить остальные сеансы?'}
      confirmLabel={confirmation.kind === 'one' ? 'Завершить сеанс' : 'Завершить остальные'}
      danger
      pending={mutation.isPending}
      error={mutation.error}
      onClose={() => { setConfirmation(null); revokeOne.reset(); revokeOthers.reset(); }}
      onConfirm={confirm}
    >
      {confirmation.kind === 'one'
        ? <>Выход произойдёт на устройстве с сеансом «{confirmation.session.authMethod === 'temporary' ? 'Логин и пароль' : 'Telegram'}». Текущий браузер останется в пульте.</>
        : <>Будут завершены {otherCount} других активных сеансов администратора. Текущий браузер останется в пульте.</>}
    </Confirm>}
  </section>;
}
