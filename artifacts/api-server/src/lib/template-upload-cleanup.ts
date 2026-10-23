import { and, asc, eq, lt } from 'drizzle-orm';
import { db, meduhaUploads } from '@workspace/db';
import { templateFile } from './objectStorage';

export const ABANDONED_UPLOAD_RETENTION_MS = 24 * 60 * 60 * 1000;
export const TEMPLATE_UPLOAD_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const CLEANUP_BATCH_SIZE = 100;

type CleanupOptions = {
  now?: Date;
  ownerId?: string;
  batchSize?: number;
};

/**
 * Remove expired, unfinished uploads. The row lock serializes cleanup with
 * upload completion, which also locks the upload row before touching storage.
 */
export async function cleanupAbandonedTemplateUploads({
  now = new Date(),
  ownerId,
  batchSize = CLEANUP_BATCH_SIZE,
}: CleanupOptions = {}) {
  const cutoff = new Date(now.getTime() - ABANDONED_UPLOAD_RETENTION_MS);
  let removed = 0;

  for (let i = 0; i < batchSize; i++) {
    const removedOne = await db.transaction(async tx => {
      const [upload] = await tx.select({ id: meduhaUploads.id }).from(meduhaUploads)
        .where(and(
          eq(meduhaUploads.finalized, false),
          lt(meduhaUploads.createdAt, cutoff),
          ownerId ? eq(meduhaUploads.ownerId, ownerId) : undefined,
        ))
        .orderBy(asc(meduhaUploads.createdAt))
        .limit(1)
        .for('update', { skipLocked: true });

      if (!upload) return false;

      await templateFile(upload.id, true).delete({ ignoreNotFound: true });
      await tx.delete(meduhaUploads).where(and(
        eq(meduhaUploads.id, upload.id),
        eq(meduhaUploads.finalized, false),
        lt(meduhaUploads.createdAt, cutoff),
      ));
      return true;
    });

    if (!removedOne) break;
    removed++;
  }

  return removed;
}
