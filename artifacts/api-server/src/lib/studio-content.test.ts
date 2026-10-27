import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import express from 'express';
import type { Server } from 'node:http';
import { pool } from '@workspace/db';
import {
  CONTENT_KEY, MAX_CONTENT_IMAGE, listStudioContent, parseStudioContent,
  safeStudioCover, saveStudioContent, validateStudioImage,
} from './studio-content';
import { createStudioContentAdminRouter, createStudioContentPublicRouter } from '../routes/meduha-studio-content';

const input = {title:'Редактор',description:'Описание',cover:null,enabled:false,revision:0};
test('studio content only accepts bounded presentation fields and stable keys', () => {
  assert.ok(CONTENT_KEY.test('photo-example:higgsfield-ai/soul/standard'));
  assert.ok(CONTENT_KEY.test('photo-example:channel:09ad-01'));
  assert.ok(parseStudioContent('photo-idea:portrait',input));
  assert.equal(parseStudioContent('model:portrait',input),null);
  assert.equal(parseStudioContent('photo-idea:portrait',{...input,title:'   '}),null);
  assert.equal(parseStudioContent('photo-idea:portrait',{...input,title:'a'.repeat(121)}),null);
  assert.equal(parseStudioContent('photo-idea:portrait',{...input,creditPrice:1}),null);
  assert.equal(parseStudioContent('photo-idea:portrait',{...input,revision:-1}),null);
  assert.equal(parseStudioContent('photo-idea:portrait',{...input,enabled:'false'}),null);
});

test('covers never reference private user media or active/local URLs', () => {
  for (const value of [null,'https://cdn.example.com/cover.webp','/images/meduha/car.png',
    '/api/meduha/example-media/cover-abc.webp',`/api/meduha/studio-content-media/${randomUUID()}`]) {
    assert.equal(safeStudioCover(value),true,String(value));
  }
  for (const value of ['javascript:alert(1)','data:image/svg+xml,x','http://cdn.example.com/a.png','https://127.0.0.1/a',
    'https://[::1]/a','https://localhost/a','https://server.local/a','https://user:pass@cdn.example.com/a',
    '/api/meduha/photo/generations/private/image','/api/storage/objects/private','//localhost/a','https://cdn.example.com:8080/a']) {
    assert.equal(safeStudioCover(value),false,value);
  }
});

test('curated media rejects empty, oversized, SVG and mismatched bytes', () => {
  assert.equal(validateStudioImage('image/png',Buffer.alloc(0)),false);
  assert.equal(validateStudioImage('image/png',Buffer.alloc(MAX_CONTENT_IMAGE+1)),false);
  assert.equal(validateStudioImage('image/svg+xml',Buffer.from('<svg/>')),false);
  const png=Buffer.alloc(24); Buffer.from([137,80,78,71,13,10,26,10]).copy(png);
  assert.equal(validateStudioImage('image/png',png),true);
  assert.equal(validateStudioImage('image/jpeg',png),false);
  const webp=Buffer.alloc(20); webp.write('RIFF',0); webp.write('WEBP',8); webp.write('VP8L',12);
  assert.equal(validateStudioImage('image/webp',webp),true);
  webp.write('HTML',12);
  assert.equal(validateStudioImage('image/webp',webp),false);
});

test('stored edits survive reads, preserve disabled state and reject stale concurrent writes', async () => {
  const key=`photo-idea:test-${randomUUID()}`;
  const actor='studio-content-unit-test';
  try {
    assert.equal((await pool.query(`SELECT count(*)::int n FROM information_schema.columns WHERE table_name='meduha_studio_content'`)).rows[0].n,7);
    const saved=await saveStudioContent(key,input,actor);
    assert.equal(saved.status,200);
    if(saved.status!==200) throw new Error('Save failed');
    assert.equal(saved.item.enabled,false);
    const row=(await listStudioContent()).find(row=>row.key===key);
    assert.equal(row?.title,input.title);
    assert.equal(row?.revision,1);
    assert.equal((await saveStudioContent(key,{...input,title:'Перезапись'},actor)).status,409);
    const writes=await Promise.all([
      saveStudioContent(key,{...input,title:'Первый',revision:1,enabled:true},actor),
      saveStudioContent(key,{...input,title:'Второй',revision:1,enabled:true},actor),
    ]);
    assert.deepEqual(writes.map(write=>write.status).sort(),[200,409]);
    assert.equal((await listStudioContent()).find(row=>row.key===key)?.revision,2);
    const missing=await saveStudioContent(key,{...input,cover:`/api/meduha/studio-content-media/${randomUUID()}`,revision:2},actor);
    assert.equal(missing.status,400);
    assert.equal((await pool.query('SELECT count(*)::int n FROM meduha_admin_audit WHERE entity_id=$1',[key])).rows[0].n,2);
  } finally {
    await pool.query('DELETE FROM meduha_admin_audit WHERE entity_id=$1',[key]);
    await pool.query('DELETE FROM meduha_studio_content WHERE key=$1',[key]);
  }
});

test('admin routes reject unauthenticated reads, writes and uploads; public catalogue is no-store', async () => {
  const app=express(); app.use(express.json());
  app.use('/admin',createStudioContentAdminRouter(async(_req,res)=>{res.status(403).json({code:'ADMIN_REQUIRED'});return null;}));
  app.use(createStudioContentPublicRouter());
  const server: Server=await new Promise(resolve=>{const server=app.listen(0,'127.0.0.1',()=>resolve(server));});
  try {
    const address=server.address(); assert.ok(address&&typeof address==='object');
    const base=`http://127.0.0.1:${address.port}`;
    for (const [method,path] of [['GET','/studio-content'],['PUT','/studio-content/photo-idea:test'],['POST','/studio-content-media']]) {
      const response=await fetch(`${base}/admin${path}`,{method});
      assert.equal(response.status,403);
    }
    const response=await fetch(`${base}/studio-content`);
    assert.equal(response.status,200);
    assert.equal(response.headers.get('cache-control'),'no-store');
    assert.ok(Array.isArray(await response.json()));
    assert.equal((await fetch(`${base}/studio-content-media/../../private`)).status,404);
  } finally { await new Promise<void>(resolve=>server.close(()=>resolve())); }
});

test('encoded model IDs round-trip through the editor API without losing fields', async () => {
  const key=`photo-example:test-provider/model-${randomUUID()}`;
  const app=express(); app.use(express.json());
  app.use('/admin',createStudioContentAdminRouter(async()=> 'studio-content-route-test'));
  const server: Server=await new Promise(resolve=>{const server=app.listen(0,'127.0.0.1',()=>resolve(server));});
  try {
    const address=server.address(); assert.ok(address&&typeof address==='object');
    const url=`http://127.0.0.1:${address.port}/admin/studio-content/${encodeURIComponent(key)}`;
    const options={method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({...input,description:''})};
    const response=await fetch(url,options);
    assert.equal(response.status,200);
    const row=await response.json();
    assert.equal(row.key,key);
    assert.equal(row.description,'');
    assert.equal(row.cover,null);
    assert.equal(row.enabled,false);
    assert.equal((await fetch(url,options)).status,409);
    assert.equal((await fetch(url,{...options,body:JSON.stringify({...input,revision:1,enabled:'true'})})).status,400);
  } finally {
    await new Promise<void>(resolve=>server.close(()=>resolve()));
    await pool.query('DELETE FROM meduha_admin_audit WHERE entity_id=$1',[key]);
    await pool.query('DELETE FROM meduha_studio_content WHERE key=$1',[key]);
  }
});

test.after(async()=>{await pool.end();});
