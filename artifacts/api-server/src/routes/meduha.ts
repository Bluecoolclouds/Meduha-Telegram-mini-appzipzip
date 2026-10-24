import { Router, type Request, type Response, type NextFunction } from 'express';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { and, desc, eq, gt, lt } from 'drizzle-orm';
import { db, meduhaAccounts, meduhaDrafts, meduhaReports, meduhaSessions, meduhaWorks, meduhaTemplates, type MeduhaAccountRow } from '@workspace/db';
import {
  AuthenticateMeduhaTelegramBody, DeleteMeduhaDraftParams, ImportMeduhaDraftsBody,
  SaveMeduhaDraftBody, SaveMeduhaDraftParams, SaveMeduhaSettingsBody,
  GetMeduhaBootstrapResponse, GetMeduhaSessionResponse,
  SubmitMeduhaReportBody, SubmitMeduhaReportResponse, GetMeduhaWalletQueryParams, GetMeduhaWalletResponse,
} from '@workspace/api-zod';
import { TelegramAuthError, validateTelegramInitData } from '../lib/telegram-init-data';
import { resolveTelegramBotUsername } from '../lib/telegram-bot';
import templatesRouter from './templates';
import templateRecipesRouter from './template-recipes';
import { currentAccount, requireAccount } from './meduha-auth';
export { currentAccount, requireAccount } from './meduha-auth';
import { initializeTemplateAdmin } from '../lib/template-admin';
import { createMeduhaAdminRouter } from './meduha-admin';
import { temporaryAdminConfig } from '../lib/temporary-admin';
import { getWallet } from '../lib/finance';
import { isTemplateAdmin } from '../lib/template-admin';
import { createMeduhaGenerationsRouter } from './meduha-generations';
import { createPhotoRouter } from './meduha-photo';
import { createVideoRouter } from './meduha-video';
import { createGenjutsuRouter, type GenjutsuDependencies } from './meduha-genjutsu';
import { getHiggsfieldRequestStatus } from '../lib/higgsfield';
import type { GenerationVideoStore } from '../lib/generation-worker';

const COOKIE='meduha_session';
const SESSION_MS=7*24*60*60*1000;
const digest=(raw:string)=>createHash('sha256').update(raw).digest('hex');
const fail=(res:Response,status:number,code:string,error:string)=>{res.status(status).json({code,error})};
const publicAccount=(row:MeduhaAccountRow)=>({
  id:row.id,firstName:row.firstName,lastName:row.lastName,username:row.username,
  photoUrl:row.photoUrl,languageCode:row.languageCode,credits:row.credits,
  subscription:row.subscription as 'none'|'plus',
});
const preferences=(row:MeduhaAccountRow)=>({notifications:row.notifications,quality:row.quality});
function cookieOptions(req:Request) {
  return {httpOnly:true,secure:req.secure || process.env.NODE_ENV==='production',sameSite:'lax' as const,path:'/api/meduha'};
}
function readCookie(req:Request):string|null {
  const raw:unknown=req.cookies?.[COOKIE];
  return typeof raw==='string' && /^[a-f0-9]{64}$/.test(raw)?raw:null;
}
async function allDrafts(userId:string){
  const rows=await db.select().from(meduhaDrafts).where(eq(meduhaDrafts.userId,userId)).orderBy(desc(meduhaDrafts.updatedAt));
  return rows.map(row=>({...row.payload,id:row.id,updatedAt:row.updatedAt.getTime()}));
}

export function createMeduhaRouter(
  readBotToken:()=>string|undefined=()=>process.env.TELEGRAM_BOT_TOKEN,
  readBotUsername:(token:string|undefined)=>Promise<string|null>=resolveTelegramBotUsername,
  isAdminForTest:(id:string)=>Promise<boolean>=isTemplateAdmin,
  setupRequiredForTest:boolean=false,
  catalogFetcher:typeof fetch=fetch,
  providerStatusFetcher:typeof getHiggsfieldRequestStatus=getHiggsfieldRequestStatus,
  genjutsuDependencies:GenjutsuDependencies={},
  storeGenerationVideoForTest?:GenerationVideoStore,
  readTemporaryConfig=temporaryAdminConfig,
){
const router=Router();
const configured=()=>!!readBotToken();
router.use((_req,res,next)=>{
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Vary','Cookie');
  next();
});
// Cross-origin sites cannot send this header without a successful CORS preflight.
// The API intentionally does not grant credentialed CORS access.
router.use((req,res,next)=>{
  if(!['GET','HEAD','OPTIONS'].includes(req.method) && req.get('X-Meduha-Request')!=='1'){
    fail(res,403,'REQUEST_ORIGIN_REQUIRED','Запрос должен исходить из приложения meduha.');return;
  }
  if(!['GET','HEAD','OPTIONS'].includes(req.method) && req.get('Sec-Fetch-Site')==='cross-site'){
    fail(res,403,'CROSS_SITE_REQUEST','Межсайтовый запрос запрещён.');return;
  }
  next();
});
const authAttempts=new Map<string,{count:number;until:number}>();
router.post('/auth/telegram',async(req,res)=>{
  const now=Date.now(),key=req.ip||'unknown';
  for(const [ip,entry]of authAttempts)if(entry.until<now)authAttempts.delete(ip);
  const entry=authAttempts.get(key)||{count:0,until:now+60_000};
  if(entry.count>=20 || authAttempts.size>5000){fail(res,429,'TOO_MANY_ATTEMPTS','Слишком много попыток. Повтори через минуту.');return}
  entry.count++;authAttempts.set(key,entry);
  const parsed=AuthenticateMeduhaTelegramBody.safeParse(req.body);
  if(!parsed.success){fail(res,400,'INVALID_INPUT','Не удалось прочитать данные запуска Telegram.');return}
  const token=readBotToken();
  if(!token){fail(res,503,'TELEGRAM_NOT_CONFIGURED','Вход через Telegram ещё не подключён: нужен токен бота на сервере.');return}
  let telegram;
  try{telegram=validateTelegramInitData(parsed.data.initData,token)}
  catch(error){
    const code=error instanceof TelegramAuthError?error.code:'INVALID_TELEGRAM_DATA';
    fail(res,401,code,code==='EXPIRED_TELEGRAM_DATA'?'Данные входа устарели. Закрой и заново открой миниапп.':'Не удалось подтвердить пользователя Telegram.');return;
  }
  const raw=randomBytes(32).toString('hex'),expiresAt=new Date(now+SESSION_MS);
  const previous=readCookie(req);
  const account=await db.transaction(async(tx)=>{
    const [row]=await tx.insert(meduhaAccounts).values({...telegram,updatedAt:new Date()})
      .onConflictDoUpdate({target:meduhaAccounts.id,set:{
        firstName:telegram.firstName,lastName:telegram.lastName,username:telegram.username,
        photoUrl:telegram.photoUrl,languageCode:telegram.languageCode,updatedAt:new Date(),
      }}).returning();
    await tx.insert(meduhaSessions).values({tokenHash:digest(raw),userId:row.id,expiresAt});
    if(previous)await tx.delete(meduhaSessions).where(eq(meduhaSessions.tokenHash,digest(previous)));
    await tx.delete(meduhaSessions).where(lt(meduhaSessions.expiresAt,new Date()));
    return row;
  });
  await initializeTemplateAdmin(account.id);
  res.cookie(COOKIE,raw,{...cookieOptions(req),maxAge:SESSION_MS});
  res.json(GetMeduhaSessionResponse.parse({account:publicAccount(account),telegramConfigured:true,telegramBotUsername:await readBotUsername(token)}));
});
router.get('/session',async(req,res)=>{
  const [account,telegramBotUsername]=await Promise.all([currentAccount(req),readBotUsername(readBotToken())]);
  res.json(GetMeduhaSessionResponse.parse({account:account?publicAccount(account):null,telegramConfigured:configured(),telegramBotUsername}));
});
router.delete('/session',async(req,res)=>{
  const raw=readCookie(req);
  if(raw)await db.delete(meduhaSessions).where(eq(meduhaSessions.tokenHash,digest(raw)));
  res.clearCookie(COOKIE,cookieOptions(req));res.sendStatus(204);
});
router.get('/bootstrap',async(req,res)=>{
  const account=await requireAccount(req,res);if(!account)return;
  const [drafts,works]=await Promise.all([
    allDrafts(account.id),
    db.select({id:meduhaWorks.id,title:meduhaWorks.title,type:meduhaWorks.type,status:meduhaWorks.status,createdAt:meduhaWorks.createdAt})
      .from(meduhaWorks).where(eq(meduhaWorks.userId,account.id)).orderBy(desc(meduhaWorks.createdAt)),
  ]);
  res.json(GetMeduhaBootstrapResponse.parse({
    account:publicAccount(account),drafts,works:works.map(work=>({...work,createdAt:work.createdAt.getTime()})),
    settings:preferences(account),
  }));
});
router.put('/drafts/:id',async(req,res)=>{
  const account=await requireAccount(req,res);if(!account)return;
  const params=SaveMeduhaDraftParams.safeParse(req.params),body=SaveMeduhaDraftBody.safeParse(req.body);
  if(!params.success || !body.success || !body.data.prompt.trim() || !body.data.title.trim()){
    fail(res,400,'INVALID_INPUT','Проверь описание и параметры черновика.');return;
  }
  const [row]=await db.insert(meduhaDrafts).values({id:params.data.id,userId:account.id,payload:body.data})
    .onConflictDoUpdate({target:[meduhaDrafts.userId,meduhaDrafts.id],set:{payload:body.data,updatedAt:new Date()}}).returning();
  res.json({...row.payload,id:row.id,updatedAt:row.updatedAt.getTime()});
});
router.delete('/drafts/:id',async(req,res)=>{
  const account=await requireAccount(req,res);if(!account)return;
  const params=DeleteMeduhaDraftParams.safeParse(req.params);
  if(!params.success){fail(res,400,'INVALID_INPUT','Некорректный черновик.');return}
  const rows=await db.delete(meduhaDrafts).where(and(eq(meduhaDrafts.id,params.data.id),eq(meduhaDrafts.userId,account.id))).returning({id:meduhaDrafts.id});
  if(!rows.length){fail(res,404,'NOT_FOUND','Черновик не найден.');return}
  res.sendStatus(204);
});
router.post('/drafts/import',async(req,res)=>{
  const account=await requireAccount(req,res);if(!account)return;
  const parsed=ImportMeduhaDraftsBody.safeParse(req.body);
  if(!parsed.success){fail(res,400,'INVALID_INPUT','Не удалось прочитать черновики. За раз можно перенести до 100 идей.');return}
  const rows=parsed.data.drafts.map(({id,updatedAt,...payload})=>({
    id,userId:account.id,payload,updatedAt:new Date(Number.isFinite(updatedAt)&&updatedAt>0&&updatedAt<=Date.now()?updatedAt:Date.now()),
  }));
  if(rows.length)await db.insert(meduhaDrafts).values(rows).onConflictDoNothing({target:[meduhaDrafts.userId,meduhaDrafts.id]});
  res.json(await allDrafts(account.id));
});
router.patch('/settings',async(req,res)=>{
  const account=await requireAccount(req,res);if(!account)return;
  const body=SaveMeduhaSettingsBody.safeParse(req.body);
  if(!body.success){fail(res,400,'INVALID_INPUT','Не удалось сохранить настройки.');return}
  const [row]=await db.update(meduhaAccounts).set({...body.data,updatedAt:new Date()}).where(eq(meduhaAccounts.id,account.id)).returning();
  res.json(preferences(row));
});
router.get('/wallet',async(req,res)=>{
  const account=await requireAccount(req,res);if(!account)return;
  const params=GetMeduhaWalletQueryParams.safeParse(req.query);
  if(!params.success){fail(res,400,'INVALID_INPUT','Некорректные параметры кошелька.');return}
  const wallet=await getWallet(account.id,params.data.limit,params.data.offset);
  res.json(GetMeduhaWalletResponse.parse(wallet));
});
router.post('/reports',async(req,res)=>{
  const account=await requireAccount(req,res);if(!account)return;
  const body=SubmitMeduhaReportBody.safeParse(req.body);
  if(!body.success || !body.data.reason.trim()){fail(res,400,'INVALID_INPUT','Проверь данные жалобы.');return}
  const report=await db.transaction(async tx=>{
    const [publication]=await tx.select({id:meduhaTemplates.id}).from(meduhaTemplates)
      .where(and(eq(meduhaTemplates.id,body.data.templateId),eq(meduhaTemplates.status,'published'))).for('update');
    if(!publication)return null;
    const [created]=await tx.insert(meduhaReports).values({
      id:randomUUID(),reporterId:account.id,
      templateId:publication.id,reason:body.data.reason.trim(),
    }).onConflictDoNothing().returning({id:meduhaReports.id});
    return {id:created?.id??null};
  });
  if(!report){fail(res,404,'NOT_FOUND','Опубликованный шаблон не найден.');return}
  res.status(report.id?201:200).json(SubmitMeduhaReportResponse.parse({accepted:true}));
});
router.use(templatesRouter);
router.use(templateRecipesRouter);
router.use(createMeduhaGenerationsRouter());
router.use(createPhotoRouter());
router.use(createVideoRouter());
router.use(createGenjutsuRouter(genjutsuDependencies));
router.use(createMeduhaAdminRouter(isAdminForTest,setupRequiredForTest,catalogFetcher,providerStatusFetcher,storeGenerationVideoForTest,readTemporaryConfig));
router.use((error:unknown,req:Request,res:Response,_next:NextFunction)=>{
  req.log.error({ err: error }, 'Meduha request failed');
  if(!res.headersSent)fail(res,503,'ACCOUNT_SERVICE_UNAVAILABLE','Не удалось загрузить или сохранить данные аккаунта. Повтори попытку.');
});
return router;
}
export default createMeduhaRouter();
