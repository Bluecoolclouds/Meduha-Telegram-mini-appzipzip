import { and, eq } from 'drizzle-orm';
import { db, meduhaAccounts, meduhaTemplateAdmin } from '@workspace/db';

const configuredAdminId = () => {
  const value = process.env.MEDUHA_ADMIN_TELEGRAM_ID;
  if (value === undefined || value === '') return { configured: false, id: null };
  return { configured: true, id: /^\d+$/.test(value) ? value : null };
};

/**
 * Legacy call site retained for compatibility. No account is ever selected
 * implicitly. An explicit owner pin can bind only after that verified
 * Telegram account exists in meduha_accounts.
 */
export async function initializeTemplateAdmin(verifiedTelegramId: string) {
  const { id: pinnedId } = configuredAdminId();
  if (!pinnedId || verifiedTelegramId !== pinnedId) return;
  await db.transaction(async tx => {
    const [account] = await tx.select({ id: meduhaAccounts.id }).from(meduhaAccounts)
      .where(and(eq(meduhaAccounts.id, pinnedId), eq(meduhaAccounts.blocked, false))).limit(1);
    if (!account) return;
    await tx.insert(meduhaTemplateAdmin).values({ slot: 1, telegramId: pinnedId })
      .onConflictDoUpdate({ target: meduhaTemplateAdmin.slot, set: { telegramId: pinnedId } });
  });
}

export async function designatedAdminId(): Promise<string | null> {
  const { configured, id: pinnedId } = configuredAdminId();
  const [row] = await db.select().from(meduhaTemplateAdmin).where(eq(meduhaTemplateAdmin.slot, 1)).limit(1);
  if (configured && !pinnedId) return null;
  const id = configured ? pinnedId : row?.telegramId ?? null;
  // An explicit owner pin is authoritative once its verified account exists.
  // Existing Telegram sessions need not log in again just to sync the legacy row.
  if (!id) return null;
  const [account] = await db.select({ id: meduhaAccounts.id }).from(meduhaAccounts)
    .where(and(eq(meduhaAccounts.id, id), eq(meduhaAccounts.blocked, false))).limit(1);
  return account ? id : null;
}

export async function isTemplateAdmin(id: string) {
  return (await designatedAdminId()) === id;
}

export async function isAdminSetupRequired() {
  return !(await designatedAdminId());
}
