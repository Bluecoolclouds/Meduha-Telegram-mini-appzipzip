import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db, meduhaAccounts, meduhaUploads, pool } from '@workspace/db';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { objectStorageClient } from './objectStorage';
import {
  ABANDONED_UPLOAD_RETENTION_MS,
  cleanupAbandonedTemplateUploads,
} from './template-upload-cleanup';

test('cleanup removes only unfinished staging uploads older than the retention period', async t => {
  const ownerId = `cleanup-test-${randomUUID()}`;
  const previousObjectDir = process.env.PRIVATE_OBJECT_DIR;
  process.env.PRIVATE_OBJECT_DIR = 'test-bucket/template-upload-cleanup';
  const objects = new Set<string>();
  const bucketName = 'test-bucket';
  t.mock.method(objectStorageClient, 'bucket', (name: string) => ({
    file(objectName: string) {
      const key = `${name}/${objectName}`;
      return {
        delete: async () => { objects.delete(key); },
      };
    },
  }) as unknown as ReturnType<typeof objectStorageClient.bucket>);

  const now = new Date();
  const expiredId = randomUUID();
  const boundaryId = randomUUID();
  const recentId = randomUUID();
  const finalizedId = randomUUID();
  const rows = [
    { id: expiredId, finalized: false, createdAt: new Date(now.getTime() - ABANDONED_UPLOAD_RETENTION_MS - 1) },
    { id: boundaryId, finalized: false, createdAt: new Date(now.getTime() - ABANDONED_UPLOAD_RETENTION_MS) },
    { id: recentId, finalized: false, createdAt: new Date(now.getTime() - 1_000) },
    { id: finalizedId, finalized: true, createdAt: new Date(now.getTime() - ABANDONED_UPLOAD_RETENTION_MS - 1) },
  ];
  const stagingKey = (id: string) => `${bucketName}/template-upload-cleanup/templates/staging/${id}`;

  try {
    await db.insert(meduhaAccounts).values({ id: ownerId, firstName: 'Cleanup test' });
    await db.insert(meduhaUploads).values(rows.map(row => ({
      ...row, ownerId, size: 8, contentType: 'image/png',
    })));
    rows.forEach(row => objects.add(stagingKey(row.id)));

    assert.equal(await cleanupAbandonedTemplateUploads({ now, ownerId }), 1);

    const remaining = await db.select({
      id: meduhaUploads.id,
      finalized: meduhaUploads.finalized,
    }).from(meduhaUploads).where(eq(meduhaUploads.ownerId, ownerId));
    assert.deepEqual(new Set(remaining.map(row => row.id)), new Set([boundaryId, recentId, finalizedId]));
    assert.equal(objects.has(stagingKey(expiredId)), false, 'expired staging data should be deleted');
    assert.equal(objects.has(stagingKey(boundaryId)), true, 'uploads at the retention boundary should remain');
    assert.equal(objects.has(stagingKey(recentId)), true, 'recent uploads should remain completable');
    assert.equal(objects.has(stagingKey(finalizedId)), true, 'finalized uploads must not be touched');
  } finally {
    await db.delete(meduhaUploads).where(eq(meduhaUploads.ownerId, ownerId));
    await db.delete(meduhaAccounts).where(eq(meduhaAccounts.id, ownerId));
    if (previousObjectDir === undefined) delete process.env.PRIVATE_OBJECT_DIR;
    else process.env.PRIVATE_OBJECT_DIR = previousObjectDir;
    await pool.end();
  }
});
