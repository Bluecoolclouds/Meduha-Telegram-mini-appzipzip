import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import express from 'express';
import cookieParser from 'cookie-parser';
import { pool } from '@workspace/db';
import { createTemplateRecipeRouter } from './template-recipes';
import { meduhaAiModels, meduhaAiChannels, meduhaAccounts, meduhaSessions } from '@workspace/db';
import { db, meduhaTemplates, meduhaUploads, meduhaDrafts } from '@workspace/db';
import { eq, inArray } from 'drizzle-orm';
const MOTION_TRANSFER = 'higgsfield/genjutsu/motion-transfer/v1.0';

test('Community recipes preserve mode, prompt and ordered private files in an account-owned, idempotent repeat', async () => {
  const owner = `recipe-owner-${randomUUID()}`, viewer = `recipe-viewer-${randomUUID()}`;
  const token = createHash('sha256').update(randomUUID()).digest('hex');
  const sessionHash = createHash('sha256').update(token).digest('hex');
  const cookie = { cookie: `meduha_session=${token}` };
  const sourceId = randomUUID(), channelId = randomUUID(), modelId = randomUUID();
  const originalFiles = [randomUUID(), randomUUID(), randomUUID()];
  const copies: { from: string; to: string }[] = [], removed: string[] = [];
  const recipe = {
    version: 1 as const, kind: 'video' as const, catalogId: MOTION_TRANSFER,
    parameters: { prompt: 'exact @[Image 1] @[Image 2] @[Video 1]', resolution: '720p' },
    references: { '/video_url': [originalFiles[0]], '/image_urls': [originalFiles[1], originalFiles[2]] },
  };
  const serverApp = express();
  serverApp.use(express.json(), cookieParser(), (req, _res, next) => {
    req.log = { error() {}, warn() {} } as any; next();
  });
  serverApp.use('/api/meduha', createTemplateRecipeRouter(
    async (from, to) => { copies.push({ from, to }); },
    async id => { removed.push(id); },
  ));
  const server = serverApp.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const addr = server.address(); assert(addr && typeof addr !== 'string');
  const root = `http://127.0.0.1:${addr.port}/api/meduha`;
  const request = (path: string, body?: object, auth = true) => fetch(`${root}${path}`, {
    ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}),
    headers: { 'Content-Type': 'application/json', ...(auth ? cookie : {}) },
  });
  try {
    await db.insert(meduhaAccounts).values([
      { id: owner, firstName: 'Recipe author', credits: 50 },
      { id: viewer, firstName: 'Recipe viewer', credits: 7 },
    ]);
    await db.insert(meduhaSessions).values({ tokenHash: sessionHash, userId: viewer, expiresAt: new Date(Date.now() + 3600_000) });
    await db.insert(meduhaAiChannels).values({
      id: channelId, name: 'Recipe fixture', baseUrl: 'https://api.higgsfield.ai',
      adapter: 'higgsfield', enabled: false, concurrencyLimit: 1, dailyCreditLimit: 0,
    });
    await db.insert(meduhaAiModels).values({
      id: modelId, channelId, upstreamId: recipe.catalogId, displayName: 'Recipe fixture',
      kind: 'video', enabled: false, creditPrice: 0, limits: {},
    });
    await db.insert(meduhaUploads).values(originalFiles.map((id, i) => ({
      id, ownerId: owner, contentType: i === 0 ? 'video/mp4' : 'image/webp', size: 100 + i, finalized: true,
    })));
    await db.insert(meduhaTemplates).values({
      id: sourceId, ownerId: owner, title: 'Motion example', description: 'Test fixture',
      kind: 'video', poster: 'images/meduha/portrait.png', videoUrl: `/api/meduha/media/${originalFiles[0]}`,
      audioUrl: null, width: 720, height: 1280, prompt: recipe.parameters.prompt, tags: ['Genjutsu'],
      sourceUrl: null, credit: null, parameters: { model: 'Genjutsu', style: '', ratio: '9:16', duration: '11' },
      recipe, status: 'published',
    });
    const publicView = await request(`/template-recipes/${sourceId}`, undefined, false);
    assert.equal(publicView.status, 200);
    const exposed = await publicView.json() as { recipe: typeof recipe; files: Record<string, { id: string }[]> };
    assert.deepEqual(exposed.recipe, recipe);
    assert.deepEqual(exposed.files['/image_urls'].map(f => f.id), originalFiles.slice(1));
    const requestId = randomUUID(), route = `/templates/${sourceId}/repeat`;
    const body = { requestId };
    assert.equal((await request(route, body, false)).status, 401);
    const [first, concurrent] = await Promise.all([request(route, body), request(route, body)]);
    assert.equal(first.status, 201); assert.equal(concurrent.status, 201);
    const [copied, repeated] = await Promise.all([first.json(), concurrent.json()]) as any[];
    assert.equal(copied.id, `repeat-${requestId}`);
    assert.equal(repeated.id, copied.id);
    assert.equal(copies.length, 3, 'concurrent retries clone each source only once');
    const clonedVideo = copied.recipe.references['/video_url'][0];
    assert.notEqual(clonedVideo, originalFiles[0]);
    assert.deepEqual(copied.recipe.references['/image_urls'].map((id: string) => id), copies.filter(c => c.from !== originalFiles[0]).map(c => c.to));
    const saved = await request(`/template-repeats/${copied.id}`);
    assert.equal(saved.status, 200);
    assert.equal((await request(`/template-repeats/${copied.id}`, undefined, false)).status, 401);
    assert.equal((await db.select().from(meduhaDrafts).where(eq(meduhaDrafts.userId, viewer))).length, 1);
    assert.equal((await db.select().from(meduhaUploads).where(inArray(meduhaUploads.id, copies.map(c => c.to)))).length, 3);

    await db.update(meduhaTemplates).set({ status: 'draft' }).where(eq(meduhaTemplates.id, sourceId));
    assert.equal((await request(`/template-recipes/${sourceId}`, undefined, false)).status, 404);
    assert.equal((await request(`/templates/${sourceId}/repeat`, { requestId: randomUUID() })).status, 404);
    assert.equal((await request(`/template-repeats/${copied.id}`)).status, 200, 'the private copy survives source unpublishing');
    assert.equal((await request(`/template-repeats/${copied.id}`, undefined, false)).status, 401);
    assert.equal((await request('/template-recipe-drafts', {
      title: 'Wrong owner', recipe: { ...recipe, references: { '/video_url': [originalFiles[0]], '/image_urls': [originalFiles[1], originalFiles[2]] } },
    })).status, 403);

    const failedId = randomUUID(), beforeFailed = copies.length;
    await assert.rejects(async () => {
      await import('../lib/template-recipes').then(({ repeatRecipe }) => repeatRecipe(sourceId, failedId, viewer,
        async (from, to) => { copies.push({ from, to }); if (copies.length === beforeFailed + 2) throw new Error('simulated storage copy failure'); },
        async id => { removed.push(id); },
      ));
    });
    assert.equal(removed.length, 2, 'copied objects are removed when saving the copy fails');
    assert.equal((await db.select().from(meduhaDrafts).where(eq(meduhaDrafts.id, `repeat-${failedId}`))).length, 0);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await db.delete(meduhaTemplates).where(eq(meduhaTemplates.id, sourceId));
    await db.delete(meduhaDrafts).where(eq(meduhaDrafts.userId, viewer));
    await db.delete(meduhaUploads).where(inArray(meduhaUploads.id, [...originalFiles, ...copies.map(c => c.to)]));
    await db.delete(meduhaSessions).where(eq(meduhaSessions.tokenHash, sessionHash));
    await db.delete(meduhaAiModels).where(eq(meduhaAiModels.id, modelId));
    await db.delete(meduhaAiChannels).where(eq(meduhaAiChannels.id, channelId));
    await db.delete(meduhaAccounts).where(inArray(meduhaAccounts.id, [owner, viewer]));
  }
});
