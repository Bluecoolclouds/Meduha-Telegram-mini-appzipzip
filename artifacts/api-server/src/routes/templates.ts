import { Router } from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { and, count, desc, eq, gt, ilike, inArray, lt, notInArray, or, sql } from 'drizzle-orm';
import { db, meduhaAccounts, meduhaTemplates, meduhaUploads, meduhaTemplateLikes, meduhaTemplateSaves } from '@workspace/db';
import seedCatalog from '../../../meduha/public/templates/catalog.json';
import {
  ListTemplatesQueryParams, ListTemplatesResponse, CreateTemplateBody, CreateTemplateResponse,
  GetTemplateParams, GetTemplateResponse,
  UpdateTemplateBody, UpdateTemplateParams, UpdateTemplateResponse, GetTemplateAccessResponse,
  SetTemplatePublicationBody, SetTemplatePublicationParams, SetTemplatePublicationResponse,
  RequestTemplateUploadBody, RequestTemplateUploadResponse,
  CompleteTemplateUploadParams, CompleteTemplateUploadResponse,
  GetTemplateMediaParams,
  SetTemplateLikeParams, SetTemplateLikeBody, SetTemplateLikeResponse,
  SetTemplateSaveParams, SetTemplateSaveBody, SetTemplateSaveResponse,
} from '@workspace/api-zod';
import { currentAccount, requireAccount } from './meduha';
import { isTemplateAdmin } from '../lib/template-admin';
import { templateFile, templateUploadUrl } from '../lib/objectStorage';
import { finalizeMedia, InvalidMediaError } from '../lib/template-files';
import { pipeStorageReadStream } from '../lib/storage-stream';
import { validateOwnedRecipe, RecipeError } from '../lib/template-recipes';

const router = Router();
const error = (res: import('express').Response, status: number, message: string) => {
  res.status(status).json({ code: 'TEMPLATE_ERROR', error: message });
};
const mediaPath = (id: string) => `/api/meduha/media/${id}`;
const publicAuthorName = (name: string | null | undefined) => {
  const normalized = name?.normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, '').trim().replace(/\s+/g, ' ').slice(0, 80);
  return normalized || 'Автор сообщества';
};
const publicAvatarUrl = (value: string | null | undefined) => {
  if (!value || value.length > 2048) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
};
const seededTemplateId = (id: string) => {
  const hex = createHash('sha256').update(`meduha-template-seed:${id}`).digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20)}`;
};

// Old starter references may already be imported in some databases. Keep them
// manageable, but never represent them as work shared by people.
const starterTemplateIds = seedCatalog.map(item => seededTemplateId(item.id));

router.get('/templates/access', async (req, res): Promise<void> => {
  const account = await requireAccount(req, res); if (!account) return;
  res.json(GetTemplateAccessResponse.parse({ isAdmin: await isTemplateAdmin(account.id) }));
});

router.get('/templates', async (req, res): Promise<void> => {
  const parsed = ListTemplatesQueryParams.safeParse(req.query);
  if (!parsed.success) { error(res, 400, 'Некорректные параметры поиска.'); return; }
  const { query, tag, kind, scope, cursor, limit } = parsed.data;
  const normalizedTag = tag?.normalize('NFKC').trim().replace(/^#/, '').trim().toLocaleLowerCase();
  if (tag !== undefined && !normalizedTag) { error(res, 400, 'Укажи непустой тег.'); return; }
  const viewer = scope === 'public' ? await currentAccount(req) : await requireAccount(req, res);
  if (scope !== 'public' && !viewer) return;
  const publicScope = scope === 'public' || scope === 'liked' || scope === 'saved';
  const likedByViewer = sql<boolean>`exists(select 1 from ${meduhaTemplateLikes} where ${meduhaTemplateLikes.templateId} = ${meduhaTemplates.id} and ${meduhaTemplateLikes.userId} = ${viewer?.id ?? ''})`;
  const savedByViewer = sql<boolean>`exists(select 1 from ${meduhaTemplateSaves} where ${meduhaTemplateSaves.templateId} = ${meduhaTemplates.id} and ${meduhaTemplateSaves.userId} = ${viewer?.id ?? ''})`;
  let ownerFilter;
  if (scope !== 'public') {
    const account = viewer!;
    if (scope === 'moderation' && !await isTemplateAdmin(account.id)) {
      error(res, 403, 'Модерация доступна только администратору.'); return;
    }
    if (scope === 'mine') ownerFilter = eq(meduhaTemplates.ownerId, account.id);
  }
  const title = query?.normalize('NFKC').trim().replace(/\s+/g, ' ');
  const filter = and(
    publicScope ? eq(meduhaTemplates.status, 'published') : undefined,
    publicScope ? notInArray(meduhaTemplates.id, starterTemplateIds) : undefined,
    scope === 'liked' ? likedByViewer : undefined,
    scope === 'saved' ? savedByViewer : undefined,
    ownerFilter,
    kind === 'all' ? undefined : eq(meduhaTemplates.kind, kind),
    normalizedTag ? sql`exists(select 1 from jsonb_array_elements_text(${meduhaTemplates.tags}) as scenario_tag(value) where lower(btrim(regexp_replace(btrim(scenario_tag.value), '^#', ''))) = ${normalizedTag})` : undefined,
    title ? ilike(meduhaTemplates.title, `%${title.replace(/[\\%_]/g, '\\$&')}%`) : undefined,
  );
  const [rows, totals] = await Promise.all([
    db.select({
      template: meduhaTemplates,
      author: { firstName: meduhaAccounts.firstName, photoUrl: meduhaAccounts.photoUrl },
      likeCount: sql<number>`(select count(*)::integer from ${meduhaTemplateLikes} where ${meduhaTemplateLikes.templateId} = ${meduhaTemplates.id})`,
      likedByMe: likedByViewer,
      savedByMe: savedByViewer,
    }).from(meduhaTemplates).innerJoin(meduhaAccounts, eq(meduhaAccounts.id, meduhaTemplates.ownerId))
      .where(and(filter, cursor ? lt(meduhaTemplates.sequence, cursor) : undefined))
      .orderBy(desc(meduhaTemplates.sequence)).limit(limit + 1),
    db.select({ total: count() }).from(meduhaTemplates).where(filter),
  ]);
  const page = rows.slice(0, limit);
  res.setHeader('Cache-Control', 'private, no-store');
  res.json(ListTemplatesResponse.parse({
    items: page.map(({ template, author, likeCount, likedByMe, savedByMe }) => {
      if (!publicScope) return template;
      const { ownerId: _privateOwnerId, ...publicTemplate } = template;
      return {
        ...publicTemplate,
        authorName: publicAuthorName(author.firstName),
        authorAvatarUrl: publicAvatarUrl(author.photoUrl),
        likeCount, likedByMe, savedByMe,
      };
    }),
    total: totals[0].total,
    nextCursor: rows.length > limit ? page[page.length - 1].template.sequence : null,
  }));
});

router.get('/templates/:id', async (req, res): Promise<void> => {
  const params = GetTemplateParams.safeParse(req.params);
  if (!params.success) { error(res, 404, 'Работа не найдена или больше не опубликована.'); return; }
  const viewer = await currentAccount(req);
  const [row] = await db.select({
    template: meduhaTemplates,
    author: { firstName: meduhaAccounts.firstName, photoUrl: meduhaAccounts.photoUrl },
    likeCount: sql<number>`(select count(*)::integer from ${meduhaTemplateLikes} where ${meduhaTemplateLikes.templateId} = ${meduhaTemplates.id})`,
    likedByMe: sql<boolean>`exists(select 1 from ${meduhaTemplateLikes} where ${meduhaTemplateLikes.templateId} = ${meduhaTemplates.id} and ${meduhaTemplateLikes.userId} = ${viewer?.id ?? ''})`,
    savedByMe: sql<boolean>`exists(select 1 from ${meduhaTemplateSaves} where ${meduhaTemplateSaves.templateId} = ${meduhaTemplates.id} and ${meduhaTemplateSaves.userId} = ${viewer?.id ?? ''})`,
  }).from(meduhaTemplates).innerJoin(meduhaAccounts, eq(meduhaAccounts.id, meduhaTemplates.ownerId))
    .where(and(
      eq(meduhaTemplates.id, params.data.id),
      eq(meduhaTemplates.status, 'published'),
      notInArray(meduhaTemplates.id, starterTemplateIds),
    )).limit(1);
  if (!row) { error(res, 404, 'Работа не найдена или больше не опубликована.'); return; }
  const { ownerId: _privateOwnerId, ...publicTemplate } = row.template;
  res.setHeader('Cache-Control', 'private, no-store');
  res.json(GetTemplateResponse.parse({
    ...publicTemplate,
    authorName: publicAuthorName(row.author.firstName),
    authorAvatarUrl: publicAvatarUrl(row.author.photoUrl),
    likeCount: row.likeCount,
    likedByMe: row.likedByMe,
    savedByMe: row.savedByMe,
  }));
});

router.put('/templates/:id/like', async (req, res): Promise<void> => {
  const account = await requireAccount(req, res); if (!account) return;
  const params = SetTemplateLikeParams.safeParse(req.params), body = SetTemplateLikeBody.safeParse(req.body);
  if (!params.success || !body.success) { error(res, 400, 'Некорректный лайк.'); return; }
  const saved = await db.transaction(async tx => {
    const [publication] = await tx.select({ id: meduhaTemplates.id }).from(meduhaTemplates)
      .where(and(eq(meduhaTemplates.id, params.data.id), eq(meduhaTemplates.status, 'published'))).for('update');
    if (!publication || starterTemplateIds.includes(publication.id)) return null;
    if (body.data.liked) await tx.insert(meduhaTemplateLikes).values({ userId: account.id, templateId: publication.id }).onConflictDoNothing();
    else await tx.delete(meduhaTemplateLikes).where(and(eq(meduhaTemplateLikes.userId, account.id), eq(meduhaTemplateLikes.templateId, publication.id)));
    const [total] = await tx.select({ total: count() }).from(meduhaTemplateLikes).where(eq(meduhaTemplateLikes.templateId, publication.id));
    return { likeCount: total.total, likedByMe: body.data.liked };
  });
  if (!saved) { error(res, 404, 'Публикация недоступна.'); return; }
  res.json(SetTemplateLikeResponse.parse(saved));
});

router.put('/templates/:id/save', async (req, res): Promise<void> => {
  const account = await requireAccount(req, res); if (!account) return;
  const params = SetTemplateSaveParams.safeParse(req.params), body = SetTemplateSaveBody.safeParse(req.body);
  if (!params.success || !body.success) { error(res, 400, 'Некорректное сохранение.'); return; }
  const saved = await db.transaction(async tx => {
    const [publication] = await tx.select({ id: meduhaTemplates.id }).from(meduhaTemplates)
      .where(and(eq(meduhaTemplates.id, params.data.id), eq(meduhaTemplates.status, 'published'))).for('update');
    if (!publication || starterTemplateIds.includes(publication.id)) return null;
    if (body.data.saved) await tx.insert(meduhaTemplateSaves).values({ userId: account.id, templateId: publication.id }).onConflictDoNothing();
    else await tx.delete(meduhaTemplateSaves).where(and(eq(meduhaTemplateSaves.userId, account.id), eq(meduhaTemplateSaves.templateId, publication.id)));
    return { savedByMe: body.data.saved };
  });
  if (!saved) { error(res, 404, 'Публикация недоступна.'); return; }
  res.setHeader('Cache-Control', 'private, no-store');
  res.json(SetTemplateSaveResponse.parse(saved));
});

async function validFiles(input: typeof CreateTemplateBody._output, ownerId: string, existing?: typeof meduhaTemplates.$inferSelect) {
  const posterId = input.poster.split('/').pop()!;
  const videoId = input.videoUrl?.split('/').pop();
  const audioId = input.audioUrl?.split('/').pop();
  if (!input.title.trim() || !input.prompt.trim() || (input.kind === 'video' && !videoId) || (input.kind === 'audio' && !audioId)) return false;
  // Files may only be referenced by their uploader. Admin edits check against
  // the template owner's files as well as their own below.
  const check = async (id: string, prefix: string) => {
    const [upload] = await db.select().from(meduhaUploads).where(and(
      eq(meduhaUploads.id, id), eq(meduhaUploads.finalized, true),
    ));
    return !!upload && upload.ownerId === ownerId && upload.contentType.startsWith(prefix);
  };
  const posterValid = input.poster.startsWith('images/') || (
    input.poster.startsWith('https://') && input.poster === existing?.poster
  )
    || await check(posterId, 'image/');
  const videoValid = input.kind !== 'video' || !!videoId && (
    input.videoUrl?.startsWith('https://') && input.videoUrl === existing?.videoUrl || await check(videoId, 'video/')
  );
  const audioValid = input.kind !== 'audio' || !!audioId && (
    input.audioUrl?.startsWith('https://') && input.audioUrl === existing?.audioUrl || await check(audioId, 'audio/')
  );
  return posterValid && !!videoValid && !!audioValid;
}

router.post('/templates', async (req, res): Promise<void> => {
  const account = await requireAccount(req, res); if (!account) return;
  const parsed = CreateTemplateBody.safeParse(req.body);
  if (!parsed.success || !await validFiles(parsed.data, account.id)) {
    error(res, 400, 'Проверь название, описание создания и загрузку файлов.'); return;
  }
  try {
    parsed.data.recipe = await validateOwnedRecipe(parsed.data.recipe, [account.id], parsed.data.kind, parsed.data.prompt);
  } catch (e) {
    if (e instanceof RecipeError) { error(res, e.status, e.message); return; }
    throw e;
  }
  const [row] = await db.insert(meduhaTemplates).values({
    ...parsed.data, title: parsed.data.title.normalize('NFKC').trim().replace(/\s+/g, ' '),
      description: parsed.data.description ?? '',
      sourceUrl: parsed.data.sourceUrl ?? null,
      credit: parsed.data.credit ?? null,
    videoUrl: parsed.data.kind === 'video' ? parsed.data.videoUrl : null,
    audioUrl: parsed.data.kind === 'audio' ? parsed.data.audioUrl : null,
    id: randomUUID(), ownerId: account.id,
  }).returning();
  res.status(201).json(CreateTemplateResponse.parse(row));
});

router.put('/templates/:id', async (req, res): Promise<void> => {
  const account = await requireAccount(req, res); if (!account) return;
  const params = UpdateTemplateParams.safeParse(req.params), body = UpdateTemplateBody.safeParse(req.body);
  if (!params.success || !body.success) { error(res, 400, 'Проверь поля шаблона.'); return; }
  const saved = await db.transaction(async tx => {
    const [existing] = await tx.select().from(meduhaTemplates).where(eq(meduhaTemplates.id, params.data.id)).for('update');
    if (!existing) { error(res, 404, 'Шаблон не найден.'); return; }
    const admin = await isTemplateAdmin(account.id);
    if (existing.ownerId !== account.id && !admin) { error(res, 403, 'Это шаблон другого автора.'); return; }
    try {
      const value = body.data.recipe === undefined ? existing.recipe : body.data.recipe;
      body.data.recipe = await validateOwnedRecipe(value, admin ? [existing.ownerId, account.id] : [account.id], body.data.kind, body.data.prompt);
    } catch (e) {
      if (e instanceof RecipeError) { error(res, e.status, e.message); return; }
      throw e;
    }
    // Admin may preserve author files, but newly uploaded files belong to admin.
    const validForAuthor = await validFiles(body.data, existing.ownerId, existing);
    const checkMixed = admin && await validFiles(body.data, account.id);
    // A mix of retained author cover and new admin video (or vice versa).
    const playbackUrl = body.data.kind === 'audio' ? body.data.audioUrl : body.data.kind === 'video' ? body.data.videoUrl : null;
    const files = [body.data.poster, ...(playbackUrl ? [playbackUrl] : [])];
    const mixedValid = admin && body.data.title.trim() && body.data.prompt.trim() &&
      (body.data.kind === 'photo' || !!playbackUrl) &&
      (await Promise.all(files.map(async (path, index) => {
        const [file] = await tx.select().from(meduhaUploads).where(eq(meduhaUploads.id, path.split('/').pop()!));
        return file?.finalized && [account.id, existing.ownerId].includes(file.ownerId)
          && file.contentType.startsWith(index === 0 ? 'image/' : body.data.kind === 'audio' ? 'audio/' : 'video/');
      }))).every(Boolean);
    if (!validForAuthor && !checkMixed && !mixedValid) { error(res, 400, 'Загрузи корректные файлы шаблона.'); return; }
    const [row] = await tx.update(meduhaTemplates).set({
      ...body.data, title: body.data.title.normalize('NFKC').trim().replace(/\s+/g, ' '),
      description: body.data.description ?? '',
      sourceUrl: body.data.sourceUrl ?? null,
      credit: body.data.credit ?? null,
      videoUrl: body.data.kind === 'video' ? body.data.videoUrl : null,
      audioUrl: body.data.kind === 'audio' ? body.data.audioUrl : null,
      status: 'draft', updatedAt: new Date(),
    }).where(eq(meduhaTemplates.id, existing.id)).returning();
    return row;
  });
  if (saved) res.json(UpdateTemplateResponse.parse(saved));
});

router.post('/templates/:id/publication', async (req, res): Promise<void> => {
  const account = await requireAccount(req, res); if (!account) return;
  const params = SetTemplatePublicationParams.safeParse(req.params), body = SetTemplatePublicationBody.safeParse(req.body);
  if (!params.success || !body.success) { error(res, 400, 'Некорректное действие.'); return; }
  const admin = await isTemplateAdmin(account.id);
  const saved = await db.transaction(async tx => {
    const [existing] = await tx.select().from(meduhaTemplates).where(eq(meduhaTemplates.id, params.data.id)).for('update');
    if (!existing) { error(res, 404, 'Шаблон не найден.'); return; }
    if ((!admin && existing.ownerId !== account.id) || (body.data.action === 'publish' && !admin)) {
      error(res, 403, 'Недостаточно прав для этого действия.'); return;
    }
    const status = body.data.action === 'publish' ? 'published' : body.data.action === 'submit' ? 'pending' : 'draft';
    const [row] = await tx.update(meduhaTemplates).set({ status, updatedAt: new Date() })
      .where(eq(meduhaTemplates.id, existing.id)).returning();
    return row;
  });
  if (saved) res.json(SetTemplatePublicationResponse.parse(saved));
});

router.post('/uploads', async (req, res): Promise<void> => {
  const account = await requireAccount(req, res); if (!account) return;
  const parsed = RequestTemplateUploadBody.safeParse(req.body);
  if (!parsed.success || (!parsed.data.contentType.startsWith('video/') && !parsed.data.contentType.startsWith('audio/') && parsed.data.size > 10 * 1024 * 1024)) {
    error(res, 400, 'Фото и документы — до 10 МБ, видео и аудио — до 100 МБ.'); return;
  }
  const id = randomUUID();
  // Persistent per-user quota also works across server instances.
  const accepted = await db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${account.id}))`);
    const [recent] = await tx.select({ total: count() }).from(meduhaUploads)
      .where(and(eq(meduhaUploads.ownerId, account.id), gt(meduhaUploads.createdAt, new Date(Date.now() - 3_600_000))));
    if (recent.total >= 30) return false;
    await tx.insert(meduhaUploads).values({ id, ownerId: account.id, ...parsed.data });
    return true;
  });
  if (!accepted) { error(res, 429, 'Лимит загрузок: 30 файлов в час. Попробуй позже.'); return; }
  res.json(RequestTemplateUploadResponse.parse({ id, uploadUrl: await templateUploadUrl(id) }));
});

router.post('/uploads/:id/complete', async (req, res): Promise<void> => {
  const account = await requireAccount(req, res); if (!account) return;
  const params = CompleteTemplateUploadParams.safeParse(req.params);
  if (!params.success) { error(res, 400, 'Некорректный файл.'); return; }
  try {
    const objectPath = await db.transaction(async tx => {
      const [file] = await tx.select().from(meduhaUploads).where(and(
        eq(meduhaUploads.id, params.data.id), eq(meduhaUploads.ownerId, account.id),
      )).for('update');
      if (!file) return null;
      if (!file.finalized) {
        await finalizeMedia(file.id, file.size, file.contentType);
        await tx.update(meduhaUploads).set({ finalized: true }).where(eq(meduhaUploads.id, file.id));
      }
      return mediaPath(file.id);
    });
    if (!objectPath) { error(res, 404, 'Файл не найден.'); return; }
    res.json(CompleteTemplateUploadResponse.parse({ objectPath }));
  } catch (caught) {
    if (caught instanceof InvalidMediaError) { error(res, 400, caught.message); return; }
    throw caught;
  }
});

router.get('/media/:id', async (req, res): Promise<void> => {
  const params = GetTemplateMediaParams.safeParse(req.params);
  if (!params.success) { res.sendStatus(404); return; }
  const [upload] = await db.select().from(meduhaUploads).where(and(
    eq(meduhaUploads.id, params.data.id), eq(meduhaUploads.finalized, true),
  ));
  if (!upload) { res.sendStatus(404); return; }
  const [published] = await db.select({ id: meduhaTemplates.id }).from(meduhaTemplates).where(and(
    eq(meduhaTemplates.status, 'published'),
    or(eq(meduhaTemplates.poster, mediaPath(upload.id)), eq(meduhaTemplates.videoUrl, mediaPath(upload.id)), eq(meduhaTemplates.audioUrl, mediaPath(upload.id)),
      sql`exists(select 1 from jsonb_each(coalesce(${meduhaTemplates.recipe}->'references', '{}'::jsonb)) as ref where ref.value @> ${JSON.stringify([upload.id])}::jsonb)`),
  )).limit(1);
  if (!published) {
    const account = await currentAccount(req);
    if (!account || (account.id !== upload.ownerId && !await isTemplateAdmin(account.id))) { res.sendStatus(404); return; }
  }
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Type', upload.contentType);
  res.setHeader('Accept-Ranges', 'bytes');
  if (req.query.download === 'true' || !/^(image|video|audio)\//.test(upload.contentType)) {
    const extensions: Record<string, string> = {
      'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
      'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
      'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav',
      'application/pdf': 'pdf', 'text/markdown': 'md', 'text/plain': 'md',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
    };
    const extension = extensions[upload.contentType] ?? 'bin';
    const requestedName = typeof req.query.filename === 'string' ? req.query.filename : '';
    const base = requestedName.normalize('NFKC').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/^\.+/, '').trim().replace(/\s+/g, '-').slice(0, 80) || `meduha-${upload.id.slice(0, 8)}`;
    const filename = `${base}.${extension}`;
    const encodedFilename = encodeURIComponent(filename).replace(/['()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
    res.setHeader('Content-Disposition', `attachment; filename="meduha-${upload.id.slice(0, 8)}.${extension}"; filename*=UTF-8''${encodedFilename}`);
  }
  let start = 0, end = upload.size - 1;
  if (req.headers.range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
    if (!match || (!match[1] && !match[2])) { res.status(416).set('Content-Range', `bytes */${upload.size}`).end(); return; }
    start = match[1] ? Number(match[1]) : Math.max(0, upload.size - Number(match[2]));
    end = match[1] && match[2] ? Math.min(Number(match[2]), end) : end;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= upload.size) {
      res.status(416).set('Content-Range', `bytes */${upload.size}`).end(); return;
    }
    res.status(206).set('Content-Range', `bytes ${start}-${end}/${upload.size}`);
  }
  res.setHeader('Content-Length', end - start + 1);
  const stream = templateFile(upload.id).createReadStream({ start, end });
  pipeStorageReadStream(stream, res, err => { req.log.error({ err }, 'Media stream failed'); });
});

export default router;
