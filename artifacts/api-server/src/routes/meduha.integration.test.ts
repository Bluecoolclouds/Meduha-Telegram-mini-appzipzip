import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import cookieParser from 'cookie-parser';
import pino from 'pino';
import pinoHttp from 'pino-http';
import { createHmac, randomInt, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { Readable } from 'node:stream';
import { eq, inArray } from 'drizzle-orm';
import { db, meduhaAccounts, meduhaSessions, meduhaTemplates, meduhaTemplateSaves, meduhaUploads, pool } from '@workspace/db';
import { createMeduhaRouter } from './meduha';
import { GetMeduhaSessionResponse, GetMeduhaBootstrapResponse, ImportMeduhaDraftsResponse, ListTemplatesResponse, CreateTemplateResponse, GetTemplateResponse, SetTemplateLikeResponse, SetTemplateSaveResponse } from '@workspace/api-zod';
import { objectStorageClient } from '../lib/objectStorage';

const fixtureToken='123456:unit-test-only-not-real';
function signed(id:number,age=0){
  const params=new URLSearchParams({
    auth_date:String(Math.floor(Date.now()/1000)-age),
    user:JSON.stringify({id,first_name:'Integration fixture'}),
  });
  const key=createHmac('sha256','WebAppData').update(fixtureToken).digest();
  params.set('hash',createHmac('sha256',key).update([...params.entries()].sort(([a],[b])=>a<b?-1:1).map(([k,v])=>`${k}=${v}`).join('\n')).digest('hex'));
  return params.toString();
}

test('real API: verified login, session rotation, account isolation, drafts/settings/import/logout',async(t)=>{
  const ids=[4_503_599_000_000_000+randomInt(1_000_000),4_503_599_001_000_000+randomInt(1_000_000)];
  const previousObjectDir=process.env.PRIVATE_OBJECT_DIR;
  assert.equal((await db.select({id:meduhaAccounts.id}).from(meduhaAccounts).where(inArray(meduhaAccounts.id,ids.map(String)))).length,0);
  let server:Server;
  let call!:(path:string,method?:string,body?:unknown,cookie?:string,header?:boolean,extraHeaders?:Record<string,string>)=>Promise<Response>;
  const startApi=async()=>{
    const app=express();app.use(pinoHttp({logger:pino({level:'silent'})}));app.use(express.json());app.use(cookieParser());app.use('/api/meduha',createMeduhaRouter(()=>fixtureToken,async()=>'fixture_bot'));
    server=app.listen(0,'127.0.0.1');await once(server,'listening');
    const address=server.address();assert(address&&typeof address==='object');
    const url=`http://127.0.0.1:${address.port}/api/meduha`;
    call=(path,method='GET',body?,cookie?,header=true,extraHeaders={})=>fetch(url+path,{
      method,headers:{'content-type':'application/json',...(header?{'x-meduha-request':'1'}:{}),...(cookie?{cookie}:{}),...extraHeaders},
      ...(body===undefined?{}:{body:JSON.stringify(body)}),
    });
  };
  await startApi();
  const login=async(id:number)=>{
    const response=await call('/auth/telegram','POST',{initData:signed(id)});
    assert.equal(response.status,200);
    const cookie=response.headers.get('set-cookie')?.split(';')[0];assert(cookie);
    assert.match(response.headers.get('set-cookie')||'',/HttpOnly/);
    const body=GetMeduhaSessionResponse.parse(await response.json());
    assert(body.account);
    return {cookie,account:body.account};
  };
  const bootstrap=async(cookie:string)=>GetMeduhaBootstrapResponse.parse(await (await call('/bootstrap','GET',undefined,cookie)).json());
  try{
    assert.equal((await call('/bootstrap')).status,401);
    assert.equal((await call('/templates/access')).status,401);
    assert.equal((await call('/templates?scope=moderation')).status,401);
    assert.equal((await call('/templates','POST',{title:'No session'})).status,401);
    assert.equal((await call('/auth/telegram','POST',{initData:signed(ids[0])},undefined,false)).status,403);
    assert.equal((await call('/auth/telegram','POST',{initData:signed(ids[0],601)})).status,401);
    assert.equal((await call('/auth/telegram','POST',{initData:signed(ids[0]).replace('Integration','Forged')})).status,401);
    const a=await login(ids[0]),b=await login(ids[1]);
    assert.equal(a.account.id,String(ids[0]));assert.equal(a.account.credits,0);
    await db.update(meduhaAccounts).set({
      firstName:'  Public\n Name  ',lastName:'Private Surname',username:'private-handle',
      photoUrl:'https://images.example.test/author.png',
    }).where(eq(meduhaAccounts.id,a.account.id));
    const publicTemplateId=randomUUID(),draftTemplateId=randomUUID(),otherTemplateId=randomUUID();
    const templateFixture=(id:string,ownerId:string,status:'published'|'draft')=>({
      id,ownerId,title:'Author fixture',description:'',kind:'photo' as const,
      poster:'images/fixture.png',videoUrl:null,width:1,height:1,prompt:'  Fixture prompt \n',
      tags:[],sourceUrl:null,credit:null,
      parameters:{model:'',style:'',ratio:'1:1',duration:''},status,
    });
    await db.insert(meduhaTemplates).values([
      templateFixture(publicTemplateId,a.account.id,'published'),
      templateFixture(draftTemplateId,a.account.id,'draft'),
      templateFixture(otherTemplateId,b.account.id,'published'),
    ]);
    await t.test('scenario tags filter exact public matches before pagination and combine with search and kind', async () => {
      const tag = `scenario-${randomUUID()}`;
      await db.update(meduhaTemplates).set({ tags: [` #${tag.toUpperCase()} `] }).where(eq(meduhaTemplates.id, publicTemplateId));
      await db.update(meduhaTemplates).set({ tags: [tag] }).where(eq(meduhaTemplates.id, draftTemplateId));
      try {
        const page = ListTemplatesResponse.parse(await (await call(`/templates?tag=${tag}&limit=1`)).json());
        assert.equal(page.total, 1, 'private matches must not affect totals');
        assert.deepEqual(page.items.map(item => item.id), [publicTemplateId]);
        const hashed = ListTemplatesResponse.parse(await (await call(`/templates?tag=${encodeURIComponent(`#${tag.toUpperCase()}`)}`)).json());
        assert.deepEqual(hashed.items.map(item => item.id), [publicTemplateId]);
        for (const suffix of ['&kind=audio', '&query=nonexistent-title']) {
          const combined = ListTemplatesResponse.parse(await (await call(`/templates?tag=${tag}${suffix}`)).json());
          assert.equal(combined.total, 0);
          assert.deepEqual(combined.items, []);
        }
        const partial = ListTemplatesResponse.parse(await (await call(`/templates?tag=${tag.slice(0, -1)}`)).json());
        assert.equal(partial.total, 0, 'tags must match exactly, not as substrings');
        assert.equal((await call('/templates?tag=%23')).status, 400);
      } finally {
        await db.update(meduhaTemplates).set({ tags: [] }).where(inArray(meduhaTemplates.id, [publicTemplateId, draftTemplateId]));
      }
    });
      const publicPage = ListTemplatesResponse.parse(await (await call('/templates?kind=audio')).json());
    const publicFixture=publicPage.items.find(item=>item.id===publicTemplateId);

    const publicDetail=await call(`/templates/${publicTemplateId}`);
    assert.equal(publicDetail.status,200);
    const detail=GetTemplateResponse.parse(await publicDetail.json());
    assert.equal(detail.id,publicTemplateId);
    assert.equal(detail.prompt,'  Fixture prompt \n','the public detail route must preserve the exact prompt');
    assert.equal(Object.hasOwn(detail,'ownerId'),false,'public detail must not expose owner identity');
    assert.equal(detail.likeCount,0);assert.equal(detail.likedByMe,false);
    assert.equal((await call(`/templates/${draftTemplateId}`)).status,404,'private drafts must not be returned by public detail');
    const privatePage=ListTemplatesResponse.parse(await (await call('/templates?scope=mine','GET',undefined,a.cookie)).json());
    assert(privatePage.items.some(item=>item.id===draftTemplateId),'the owner should still see their private draft');
    assert.equal(privatePage.items.some(item=>item.id===otherTemplateId),false,'private results must exclude another account');
    assert.equal(privatePage.items.find(item=>item.id===publicTemplateId)?.ownerId,a.account.id,
      'private list responses should retain ownership data needed by the manager');
    await t.test('likes persist per account, remain idempotent, and exclude private publications', async () => {
      const endpoint = `/templates/${publicTemplateId}/like`;
      const likedPage = async (cookie: string) => ListTemplatesResponse.parse(await (await call('/templates?scope=liked', 'GET', undefined, cookie)).json());
      assert.equal((await call('/templates?scope=liked')).status, 401);
      assert.equal((await call(endpoint, 'PUT', { liked: true })).status, 401);
      assert.equal((await call(endpoint, 'PUT', { liked: true }, a.cookie, false)).status, 403);
      assert.equal((await call(endpoint, 'PUT', { liked: 'yes' }, a.cookie)).status, 400);
      assert.equal((await call(`/templates/${draftTemplateId}/like`, 'PUT', { liked: true }, a.cookie)).status, 404);
      const concurrent = await Promise.all([call(endpoint, 'PUT', { liked: true }, a.cookie), call(endpoint, 'PUT', { liked: true }, a.cookie)]);
      for (const response of concurrent) {
        assert.equal(response.status, 200);
        assert.deepEqual(SetTemplateLikeResponse.parse(await response.json()), { likeCount: 1, likedByMe: true });
      }
      const saved = (await likedPage(a.cookie)).items.find(item => item.id === publicTemplateId);
      assert(saved?.likedByMe); assert.equal(saved.likeCount, 1);
      assert.equal(Object.hasOwn(saved, 'ownerId'), false);
      assert.equal((await likedPage(b.cookie)).items.some(item => item.id === publicTemplateId), false);
      const bLike = await call(endpoint, 'PUT', { liked: true }, b.cookie);
      assert.deepEqual(SetTemplateLikeResponse.parse(await bLike.json()), { likeCount: 2, likedByMe: true });
      const removed = await call(endpoint, 'PUT', { liked: false }, a.cookie);
      assert.deepEqual(SetTemplateLikeResponse.parse(await removed.json()), { likeCount: 1, likedByMe: false });
      assert.equal((await likedPage(a.cookie)).items.some(item => item.id === publicTemplateId), false);
      assert((await likedPage(b.cookie)).items.some(item => item.id === publicTemplateId));
      const publicState = ListTemplatesResponse.parse(await (await call('/templates')).json()).items.find(item => item.id === publicTemplateId);
      assert.equal(publicState?.likeCount, 1); assert.equal(publicState?.likedByMe, false);
    const likedDetail=GetTemplateResponse.parse(await (await call(`/templates/${publicTemplateId}`,'GET',undefined,b.cookie)).json());
    assert.equal(likedDetail.likeCount,1);assert.equal(likedDetail.likedByMe,true);
      await db.update(meduhaTemplates).set({ status: 'draft' }).where(eq(meduhaTemplates.id, publicTemplateId));
      assert.equal((await likedPage(b.cookie)).items.some(item => item.id === publicTemplateId), false);
      assert.equal((await call(endpoint, 'PUT', { liked: true }, b.cookie)).status, 404);
      await db.update(meduhaTemplates).set({ status: 'published' }).where(eq(meduhaTemplates.id, publicTemplateId));
      assert.equal((await call(endpoint, 'PUT', { liked: false }, b.cookie)).status, 200);
    });
    await t.test('saves persist per account and appear only in that account collection', async () => {
      const endpoint = `/templates/${publicTemplateId}/save`;
      const savedPage = async (cookie: string) => ListTemplatesResponse.parse(await (await call('/templates?scope=saved', 'GET', undefined, cookie)).json());
      assert.equal((await call('/templates?scope=saved')).status, 401);
      assert.equal((await call(endpoint, 'PUT', { saved: true })).status, 401);
      assert.equal((await call(endpoint, 'PUT', { saved: true }, a.cookie, false)).status, 403);
      assert.equal((await call(endpoint, 'PUT', { saved: 'yes' }, a.cookie)).status, 400);
      assert.equal((await call(`/templates/${draftTemplateId}/save`, 'PUT', { saved: true }, a.cookie)).status, 404);
      const concurrent = await Promise.all([call(endpoint, 'PUT', { saved: true }, a.cookie), call(endpoint, 'PUT', { saved: true }, a.cookie)]);
      for (const response of concurrent) {
        assert.equal(response.status, 200);
        assert.deepEqual(SetTemplateSaveResponse.parse(await response.json()), { savedByMe: true });
      }
      assert((await savedPage(a.cookie)).items.some(item => item.id === publicTemplateId));
      assert.equal((await savedPage(b.cookie)).items.some(item => item.id === publicTemplateId), false);
      const savedDetail = GetTemplateResponse.parse(await (await call(`/templates/${publicTemplateId}`, 'GET', undefined, a.cookie)).json());
      assert.equal(savedDetail.savedByMe, true);
      const guestDetail = GetTemplateResponse.parse(await (await call(`/templates/${publicTemplateId}`)).json());
      assert.equal(guestDetail.savedByMe, false);
      const signedBackIn = await login(ids[0]);
      assert((await savedPage(signedBackIn.cookie)).items.some(item => item.id === publicTemplateId), 'saves should survive a new login session');
      assert.deepEqual(SetTemplateSaveResponse.parse(await (await call(endpoint, 'PUT', { saved: false }, signedBackIn.cookie)).json()), { savedByMe: false });
      assert.equal((await savedPage(signedBackIn.cookie)).items.some(item => item.id === publicTemplateId), false);
      assert.equal((await db.select().from(meduhaTemplateSaves).where(eq(meduhaTemplateSaves.templateId, publicTemplateId))).length, 0);
    });
    await db.update(meduhaAccounts).set({firstName:' \n ',photoUrl:'http://images.example.test/not-secure.png'})
      .where(eq(meduhaAccounts.id,a.account.id));
    const fallbackPage=ListTemplatesResponse.parse(await (await call('/templates?scope=public')).json());
    const fallbackAuthor=fallbackPage.items.find(item=>item.id===publicTemplateId);
    assert.equal(fallbackAuthor?.authorName,'Автор сообщества','blank names should use the neutral public label');
    assert.equal(fallbackAuthor?.authorAvatarUrl,null,'non-HTTPS avatar URLs must be omitted');
    const uploadRows=()=>db.select({
      contentType:meduhaUploads.contentType,size:meduhaUploads.size,
    }).from(meduhaUploads).where(eq(meduhaUploads.ownerId,a.account.id));
    const rejectedUploads=[
      {contentType:'image/gif',size:1},
      {contentType:'application/pdf',size:1},
      {contentType:'image/jpeg',size:10*1024*1024+1},
      {contentType:'video/mp4',size:100*1024*1024+1},
      {contentType:'image/png',size:0},
    ];
    for(const payload of rejectedUploads){
      const response=await call('/uploads','POST',payload,a.cookie);
      assert.equal(response.status,400,`expected ${payload.contentType} (${payload.size} bytes) to be rejected`);
      assert.equal((await uploadRows()).length,0,'rejected upload requests must not create upload records');
    }
    const acceptedUploads=[
      {contentType:'image/jpeg',size:1},
      {contentType:'image/png',size:10*1024*1024},
      {contentType:'image/webp',size:10*1024*1024},
      {contentType:'video/mp4',size:1},
      {contentType:'video/webm',size:100*1024*1024},
      {contentType:'audio/mpeg',size:100*1024*1024},
      {contentType:'audio/wav',size:44},
      {contentType:'audio/x-wav',size:44},
    ];
    for(const payload of acceptedUploads){
      const response=await call('/uploads','POST',payload,a.cookie);
      // App Storage may be unavailable in the integration-test environment.
      // The request must pass validation and persist the upload before URL signing.
      assert([200,503].includes(response.status),`expected ${payload.contentType} (${payload.size} bytes) to pass validation`);
      assert((await uploadRows()).some(row=>row.contentType===payload.contentType&&row.size===payload.size),
        `expected accepted upload ${payload.contentType} (${payload.size} bytes) to be recorded`);
    }
    process.env.PRIVATE_OBJECT_DIR='test-bucket/meduha-integration';
    const storedObjects=new Map<string,{bytes:Buffer;contentType:string}>();
    let readFailure:'metadata'|'download'|null=null;
    let copyFailureKey:string|null=null;
    let stagingCopyCount=0;
    let pausedFinalDestination:string|null=null;
    let finalCopyCount=0;
    let finalCopyGate:Promise<void>|null=null;
    let onFinalCopyStarted:(()=>void)|null=null;
    t.mock.method(objectStorageClient,'bucket',(bucketName:string)=>{
      const bucket={
        file(objectName:string){
          const key=`${bucketName}/${objectName}`;
          return {
            name:objectName,
            bucket:{name:bucketName},
            copy:async(destination:{name:string;bucket:{name:string}})=>{
              const destinationKey=`${destination.bucket.name}/${destination.name}`;
              if(key.includes('/templates/staging/'))stagingCopyCount++;
              if(destinationKey===copyFailureKey)throw new Error('Test final media copy failed');
              if(destinationKey===pausedFinalDestination){
                finalCopyCount++;
                onFinalCopyStarted?.();
                if(finalCopyGate)await finalCopyGate;
              }
              const source=storedObjects.get(key);
              if(!source)throw new Error('Test object does not exist');
              storedObjects.set(destinationKey,{...source});
            },
            getMetadata:async()=>{
              if(readFailure==='metadata')throw new Error('Test metadata read failed');
              const object=storedObjects.get(key);
              if(!object)throw new Error('Test object does not exist');
              return [{size:String(object.bytes.length),contentType:object.contentType}];
            },
            download:async()=>{
              if(readFailure==='download')throw new Error('Test object read failed');
              const object=storedObjects.get(key);
              if(!object)throw new Error('Test object does not exist');
              return [object.bytes];
            },
            createReadStream:(options?:{start?:number;end?:number})=>{
              const object=storedObjects.get(key);
              if(!object)throw new Error('Test object does not exist');
              const start=options?.start??0,end=options?.end??object.bytes.length-1;
              return Readable.from([object.bytes.subarray(start,end+1)]);
            },
            delete:async()=>{storedObjects.delete(key);},
          };
        },
      };
      return bucket as unknown as ReturnType<typeof objectStorageClient.bucket>;
    });
    const validPng=Buffer.concat([
      Buffer.from([137,80,78,71,13,10,26,10]),
      Buffer.from('final-media-payload'),
    ]);
    const rejectedFinalizations=[
      {name:'wrong size',size:validPng.length+1,contentType:'image/png',bytes:validPng,actualType:'image/png',failure:null,status:400},
      {name:'wrong metadata type',size:validPng.length,contentType:'image/png',bytes:validPng,actualType:'image/jpeg',failure:null,status:400},
      {name:'metadata read error',size:validPng.length,contentType:'image/png',bytes:validPng,actualType:'image/png',failure:'metadata' as const,status:503},
      {name:'file read error',size:validPng.length,contentType:'image/png',bytes:validPng,actualType:'image/png',failure:'download' as const,status:503},
      {name:'invalid file signature',size:8,contentType:'image/png',bytes:Buffer.from('<script>'),actualType:'image/png',failure:null,status:400},
    ];
    for(const item of rejectedFinalizations){
      const id=randomUUID();
      await db.insert(meduhaUploads).values({id,ownerId:a.account.id,size:item.size,contentType:item.contentType});
      storedObjects.set(`test-bucket/meduha-integration/templates/staging/${id}`,{
        bytes:item.bytes,contentType:item.actualType,
      });
      readFailure=item.failure;
      const response=await call(`/uploads/${id}/complete`,'POST',{},a.cookie);
      assert.equal(response.status,item.status,`${item.name} must reject upload completion`);
      const [upload]=await db.select({finalized:meduhaUploads.finalized}).from(meduhaUploads).where(eq(meduhaUploads.id,id));
      assert.equal(upload.finalized,false,`${item.name} must not mark the upload finalized`);
      assert.equal(storedObjects.has(`test-bucket/meduha-integration/templates/${id}`),false,
        `${item.name} must not create a final media object`);
      assert.equal((await call(`/media/${id}`)).status,404,`${item.name} must not expose a media file`);
      const stagingKey=`test-bucket/meduha-integration/templates/staging/${id}`;
      if(item.failure){
        assert.equal(storedObjects.has(stagingKey),true,`${item.name} must retain staging data for retry`);
        readFailure=null;
        assert.equal((await call(`/uploads/${id}/complete`,'POST',{},a.cookie)).status,200,
          `${item.name} should succeed when retried after the storage read recovers`);
        assert.equal(storedObjects.has(stagingKey),false,`${item.name} should clear staging after successful retry`);
        assert.equal(storedObjects.has(`test-bucket/meduha-integration/templates/${id}`),true,
          `${item.name} should create final media after successful retry`);
        let retryFinalized=false;
    for(let attempt=0;attempt<20;attempt++){
      const [retriedUpload]=await db.select({finalized:meduhaUploads.finalized})
        .from(meduhaUploads).where(eq(meduhaUploads.id,id));
          if(retriedUpload.finalized){retryFinalized=true;break;}
          await new Promise(resolve=>setTimeout(resolve,10));
        }
        assert.equal(retryFinalized,true,`${item.name} should finalize after successful retry`);
        if(item.failure==='metadata'){
          const download=await call(`/media/${id}?download=true&filename=${encodeURIComponent('../Мой файл')}`,'GET',undefined,a.cookie);
          assert.equal(download.status,200,'owner-authorized media can be downloaded without losing its real content');
          assert.equal(download.headers.get('content-type'),'image/png');
          const disposition=download.headers.get('content-disposition')??'';
          assert(disposition.startsWith('attachment; filename="meduha-'));
          assert(disposition.includes("filename*=UTF-8''-%D0%9C%D0%BE%D0%B9-%D1%84%D0%B0%D0%B9%D0%BB.png"),
            'download filenames must retain safe Unicode while stripping path separators');
          assert.deepEqual(Buffer.from(await download.arrayBuffer()),validPng);
        }
      }else{
        assert.equal(storedObjects.has(stagingKey),false,`${item.name} must remove permanently invalid staging data`);
      }
    }
    readFailure=null;
    const copyFailureId=randomUUID();
    const copyFailureStagingKey=`test-bucket/meduha-integration/templates/staging/${copyFailureId}`;
    const copyFailureFinalKey=`test-bucket/meduha-integration/templates/${copyFailureId}`;
    await db.insert(meduhaUploads).values({
      id:copyFailureId,ownerId:a.account.id,size:validPng.length,contentType:'image/png',
    });
    storedObjects.set(copyFailureStagingKey,{bytes:validPng,contentType:'image/png'});
    copyFailureKey=copyFailureFinalKey;
    const failedCopyResponse=await call(`/uploads/${copyFailureId}/complete`,'POST',{},a.cookie);
    assert.equal(failedCopyResponse.status,503,'a temporary failure copying to permanent storage should be retryable');
    const [failedCopyUpload]=await db.select({finalized:meduhaUploads.finalized})
      .from(meduhaUploads).where(eq(meduhaUploads.id,copyFailureId));
    assert.equal(failedCopyUpload.finalized,false,'a failed permanent copy must not finalize the upload');
    assert.equal(storedObjects.has(copyFailureStagingKey),true,'a failed permanent copy must preserve staging data');
    assert.equal(storedObjects.has(copyFailureFinalKey),false,'a failed permanent copy must not create final media');
    assert.equal((await call(`/media/${copyFailureId}`)).status,404,'a failed permanent copy must not expose media');
    copyFailureKey=null;
    assert.equal((await call(`/uploads/${copyFailureId}/complete`,'POST',{},a.cookie)).status,200,
      'completion should succeed when permanent storage recovers');
    assert.equal(storedObjects.has(copyFailureStagingKey),false,'a successful retry should clear staging data');
    assert.equal(storedObjects.has(copyFailureFinalKey),true,'a successful retry should create permanent media');
    let copyRetryFinalized=false;
    for(let attempt=0;attempt<20;attempt++){
      const [retriedUpload]=await db.select({finalized:meduhaUploads.finalized})
        .from(meduhaUploads).where(eq(meduhaUploads.id,copyFailureId));
      if(retriedUpload.finalized){copyRetryFinalized=true;break;}
      await new Promise(resolve=>setTimeout(resolve,10));
    }
    assert.equal(copyRetryFinalized,true,'a successful retry should mark the upload finalized');
    const validUploadId=randomUUID();
    await db.insert(meduhaUploads).values({
      id:validUploadId,ownerId:a.account.id,size:validPng.length,contentType:'image/png',
    });
    storedObjects.set(`test-bucket/meduha-integration/templates/staging/${validUploadId}`,{
      bytes:validPng,contentType:'image/png',
    });
    const initialValidCompletion=await call(`/uploads/${validUploadId}/complete`,'POST',{},a.cookie);
    assert.equal(initialValidCompletion.status,200);
    const initialValidCompletionBody=await initialValidCompletion.json() as {objectPath:string};
    const validStagingKey=`test-bucket/meduha-integration/templates/staging/${validUploadId}`;
    const validFinalKey=`test-bucket/meduha-integration/templates/${validUploadId}`;
    assert.equal(storedObjects.has(validStagingKey),false,'successful completion should remove staging data');
    let validUploadFinalized=false;
    for(let attempt=0;attempt<20;attempt++){
      const [finalizedUpload]=await db.select({finalized:meduhaUploads.finalized})
        .from(meduhaUploads).where(eq(meduhaUploads.id,validUploadId));
      if(finalizedUpload.finalized){validUploadFinalized=true;break;}
      await new Promise(resolve=>setTimeout(resolve,10));
    }
    assert.equal(validUploadFinalized,true,'a valid upload should become finalized');
    assert.equal(storedObjects.has(validFinalKey),true,
      'a valid upload should be copied to final media storage');
    const firstMediaResponse=await call(`/media/${validUploadId}`,'GET',undefined,a.cookie);
    assert.equal(firstMediaResponse.status,200,'the owner should be able to read finalized media');
    assert.equal(firstMediaResponse.headers.get('content-type'),'image/png');
    const firstMediaBytes=Buffer.from(await firstMediaResponse.arrayBuffer());
    assert.deepEqual(firstMediaBytes,validPng,
      'the media endpoint should stream the complete finalized bytes without changes');

    const repeatedCompletion=await call(`/uploads/${validUploadId}/complete`,'POST',{},a.cookie);
    assert.equal(repeatedCompletion.status,200,'repeating successful completion should succeed');
    const repeatedCompletionBody=await repeatedCompletion.json() as {objectPath:string};
    assert.equal(repeatedCompletionBody.objectPath,initialValidCompletionBody.objectPath,
      'repeated completion should return the same usable media path');
    assert.equal(storedObjects.has(validStagingKey),false,
      'repeated completion must not recreate or leave staging data');
    assert.deepEqual(storedObjects.get(validFinalKey),{bytes:validPng,contentType:'image/png'},
      'repeated completion must leave the permanent media unchanged');
    const repeatedMediaResponse=await call(`/media/${validUploadId}`,'GET',undefined,a.cookie);
    assert.equal(repeatedMediaResponse.status,200,'finalized media should remain readable after a retry');
    assert.deepEqual(Buffer.from(await repeatedMediaResponse.arrayBuffer()),firstMediaBytes,
      'repeated completion must not change the bytes served by the media endpoint');

    const stagingCopiesBeforeRestart=stagingCopyCount;
    await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
    await startApi();
    assert.equal(storedObjects.has(validStagingKey),false,'staging must still be absent before retrying after restart');
    const restartRetry=await call(`/uploads/${validUploadId}/complete`,'POST',{},a.cookie);
    assert.equal(restartRetry.status,200,'completion should still succeed after recreating the API server');
    const restartRetryBody=await restartRetry.json() as {objectPath:string};
    assert.equal(restartRetryBody.objectPath,initialValidCompletionBody.objectPath,
      'completion after restart should return the original media path');
    assert.equal(storedObjects.has(validStagingKey),false,'completion after restart must not recreate staging data');
    assert.equal(stagingCopyCount,stagingCopiesBeforeRestart,
      'completion after restart must use persisted finalized state without reading staging again');
    assert.deepEqual(storedObjects.get(validFinalKey),{bytes:validPng,contentType:'image/png'},
      'completion after restart must leave permanent media unchanged');
    const restartMediaResponse=await call(`/media/${validUploadId}`,'GET',undefined,a.cookie);
    assert.equal(restartMediaResponse.status,200,'permanent media should remain readable after API restart');
    assert.equal(restartMediaResponse.headers.get('content-type'),'image/png');
    assert.deepEqual(Buffer.from(await restartMediaResponse.arrayBuffer()),firstMediaBytes,
      'media bytes served after restart should be unchanged');

    storedObjects.set(validStagingKey,{
      bytes:Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.from('late-staging-write')]),
      contentType:'image/png',
    });
    const mediaAfterLateStagingWrite=await call(`/media/${validUploadId}`,'GET',undefined,a.cookie);
    assert.equal(mediaAfterLateStagingWrite.status,200,'finalized media should remain readable after a late staging write');
    assert.deepEqual(Buffer.from(await mediaAfterLateStagingWrite.arrayBuffer()),firstMediaBytes,
      'reusing the temporary upload link must not change the bytes served by the finalized media endpoint');

    const concurrentUploadId=randomUUID();
    const concurrentStagingKey=`test-bucket/meduha-integration/templates/staging/${concurrentUploadId}`;
    const concurrentFinalKey=`test-bucket/meduha-integration/templates/${concurrentUploadId}`;
    await db.insert(meduhaUploads).values({
      id:concurrentUploadId,ownerId:a.account.id,size:validPng.length,contentType:'image/png',
    });
    storedObjects.set(concurrentStagingKey,{bytes:validPng,contentType:'image/png'});
    pausedFinalDestination=concurrentFinalKey;
    let signalFinalCopyStarted!:()=>void;
    const finalCopyStarted=new Promise<void>(resolve=>{signalFinalCopyStarted=resolve;});
    onFinalCopyStarted=signalFinalCopyStarted;
    let releaseFinalCopy!:()=>void;
    finalCopyGate=new Promise<void>(resolve=>{releaseFinalCopy=resolve;});
    const firstCompletion=call(`/uploads/${concurrentUploadId}/complete`,'POST',{},a.cookie);
    await finalCopyStarted;
    const secondCompletion=call(`/uploads/${concurrentUploadId}/complete`,'POST',{},a.cookie);
    await new Promise(resolve=>setTimeout(resolve,50));
    const copiesWhilePaused=finalCopyCount;
    let mediaStatusWhilePaused:number;
    try{
      mediaStatusWhilePaused=(await call(`/media/${concurrentUploadId}`,'GET',undefined,a.cookie)).status;
    }finally{
      releaseFinalCopy();
    }
    const concurrentResponses=await Promise.all([firstCompletion,secondCompletion]);
    assert.equal(copiesWhilePaused,1,'the row lock should keep the second request from copying final media');
    assert.equal(mediaStatusWhilePaused,404,'media must not be exposed while its permanent copy is still pending');
    assert.deepEqual(concurrentResponses.map(response=>response.status),[200,200],
      'both simultaneous completion requests should succeed');
    assert.equal(finalCopyCount,1,'concurrent completion should create only one permanent copy');
    assert.equal(storedObjects.has(concurrentStagingKey),false,'successful completion should clear staging');
    assert.deepEqual(storedObjects.get(concurrentFinalKey),{bytes:validPng,contentType:'image/png'},
      'the final media should contain the complete original bytes');
    const [concurrentUpload]=await db.select({finalized:meduhaUploads.finalized})
      .from(meduhaUploads).where(eq(meduhaUploads.id,concurrentUploadId));
    assert.equal(concurrentUpload.finalized,true,'the upload should be finalized after both requests settle');
    pausedFinalDestination=null;
    finalCopyGate=null;
    onFinalCopyStarted=null;

    const rangeStart=2,rangeEnd=9;
    const rangedResponse=await call(`/media/${validUploadId}`,'GET',undefined,a.cookie,true,{
      range:`bytes=${rangeStart}-${rangeEnd}`,
    });
    assert.equal(rangedResponse.status,206,'a valid byte range should return Partial Content');
    assert.equal(rangedResponse.headers.get('content-range'),`bytes ${rangeStart}-${rangeEnd}/${validPng.length}`);
    assert.equal(rangedResponse.headers.get('content-type'),'image/png');
    assert.deepEqual(Buffer.from(await rangedResponse.arrayBuffer()),validPng.subarray(rangeStart,rangeEnd+1),
      'a byte range should contain exactly the requested media bytes');
    await t.test('audio publications require an owned finalized audio file and remain editable', async () => {
      const audioId = randomUUID(), foreignId = randomUUID();
      const wav = Buffer.from('RIFF0000WAVEfmt ');
      await db.insert(meduhaUploads).values([
        { id: audioId, ownerId: a.account.id, size: wav.length, contentType: 'audio/wav', finalized: false },
        { id: foreignId, ownerId: b.account.id, size: wav.length, contentType: 'audio/wav', finalized: true },
      ]);
      storedObjects.set(`test-bucket/meduha-integration/templates/staging/${audioId}`, { bytes: wav, contentType: 'audio/wav' });
      const audioUrl = `/api/meduha/media/${audioId}`;
      const input = { title: 'Audio fixture', description: '', kind: 'audio', poster: 'images/fixture.png', audioUrl, width: 1, height: 1, prompt: 'Test audio prompt', tags: [], parameters: { model: '', style: '', ratio: '1:1', duration: '' } };
      assert.equal((await call('/templates', 'POST', input, a.cookie)).status, 400, 'unfinished audio is rejected');
      assert.equal((await call(`/uploads/${audioId}/complete`, 'POST', {}, a.cookie)).status, 200);
      assert.equal((await call('/templates', 'POST', { ...input, audioUrl: null }, a.cookie)).status, 400);
      assert.equal((await call('/templates', 'POST', { ...input, audioUrl: `/api/meduha/media/${foreignId}` }, a.cookie)).status, 400);
      assert.equal((await call('/templates', 'POST', { ...input, audioUrl: `/api/meduha/media/${validUploadId}` }, a.cookie)).status, 400, 'image cannot masquerade as audio');
      const created = await call('/templates', 'POST', input, a.cookie);
      assert.equal(created.status, 201);
      const row = CreateTemplateResponse.parse(await created.json());
      assert.equal(row.audioUrl, audioUrl); assert.equal(row.videoUrl, null);
      assert.equal((await call(`/media/${audioId}`)).status, 404, 'draft audio stays private');
      assert.equal((await call(`/templates/${row.id}/publication`, 'POST', { action: 'submit' }, a.cookie)).status, 200);
      await db.update(meduhaTemplates).set({ status: 'published' }).where(eq(meduhaTemplates.id, row.id));
      const publicPage = ListTemplatesResponse.parse(await (await call('/templates?kind=audio')).json());
      assert(publicPage.items.some((item: { id: string }) => item.id === row.id));
      const stream = await call(`/media/${audioId}`, 'GET', undefined, undefined, true, { range: 'bytes=0-3' });
      assert.equal(stream.status, 206); assert.equal(stream.headers.get('content-type'), 'audio/wav');
      assert.equal(Buffer.from(await stream.arrayBuffer()).toString(), 'RIFF');
      const edited = await call(`/templates/${row.id}`, 'PUT', { ...input, title: 'Edited audio' }, a.cookie);
      assert.equal(edited.status, 200); assert.equal(CreateTemplateResponse.parse(await edited.json()).status, 'draft');
      assert.equal((await call(`/media/${audioId}`)).status, 404);
      const changed = await call(`/templates/${row.id}`, 'PUT', { ...input, kind: 'photo', audioUrl: null }, a.cookie);
      assert.equal(changed.status, 200); assert.equal(CreateTemplateResponse.parse(await changed.json()).audioUrl, null);
    });
    const payload={title:'Fixture idea',type:'photo',prompt:'An orange ocean',style:'Кино',model:'Flux',ratio:'9:16',duration:'5 сек'};
    assert.equal((await call('/drafts/shared-fixture','PUT',{...payload,userId:String(ids[1])},a.cookie)).status,200);
    const accountA=await bootstrap(a.cookie);
    const accountB=await bootstrap(b.cookie);
    assert.equal(accountA.drafts.length,1);assert.equal(accountB.drafts.length,0);
    assert.equal((await call('/drafts/shared-fixture','DELETE',undefined,b.cookie)).status,404);
    assert.equal((await call('/drafts/shared-fixture','PUT',{...payload,title:'Other account'},b.cookie)).status,200);
    assert.equal((await bootstrap(a.cookie)).drafts[0].title,payload.title);
    assert.equal((await call('/settings','PATCH',{notifications:false,quality:false},a.cookie)).status,200);
    assert.deepEqual((await bootstrap(a.cookie)).settings,{notifications:false,quality:false});
    const imports={drafts:[{...payload,id:'shared-fixture',title:'Must not overwrite',updatedAt:Date.now()},{...payload,id:'new-import',updatedAt:Date.now()}]};
    let result=ImportMeduhaDraftsResponse.parse(await (await call('/drafts/import','POST',imports,a.cookie)).json());
    assert.equal(result.length,2);assert.equal(result.find(d=>d.id==='shared-fixture')?.title,payload.title);
    result=ImportMeduhaDraftsResponse.parse(await (await call('/drafts/import','POST',imports,a.cookie)).json());assert.equal(result.length,2);
    await db.update(meduhaAccounts).set({credits:42}).where(eq(meduhaAccounts.id,String(ids[0])));
    const reauth=await call('/auth/telegram','POST',{initData:signed(ids[0])},a.cookie);
    assert.equal(reauth.status,200);assert.equal(GetMeduhaSessionResponse.parse(await reauth.json()).account?.credits,42);
    const rotated=reauth.headers.get('set-cookie')!.split(';')[0];
    assert.equal((await call('/bootstrap','GET',undefined,a.cookie)).status,401);
    assert.equal((await call('/session','DELETE',undefined,rotated)).status,204);
    assert.equal((await call('/bootstrap','GET',undefined,rotated)).status,401);
    await db.update(meduhaSessions).set({expiresAt:new Date(0)}).where(eq(meduhaSessions.userId,String(ids[1])));
    assert.equal((await call('/bootstrap','GET',undefined,b.cookie)).status,401);
  }finally{
    if(previousObjectDir===undefined)delete process.env.PRIVATE_OBJECT_DIR;
    else process.env.PRIVATE_OBJECT_DIR=previousObjectDir;
    await db.delete(meduhaTemplates).where(inArray(meduhaTemplates.ownerId,ids.map(String)));
    await db.delete(meduhaUploads).where(inArray(meduhaUploads.ownerId,ids.map(String)));
    await db.delete(meduhaAccounts).where(inArray(meduhaAccounts.id,ids.map(String)));
    await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
    await pool.end();
  }
});
