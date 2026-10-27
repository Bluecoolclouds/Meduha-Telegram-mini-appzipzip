import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import express from 'express';
import { pool } from '@workspace/db';
import { parseBroadcast, broadcastParameters } from './broadcast-content';
import { checkBroadcastMedia } from './broadcast-storage';
import { deliveryFailure, processBroadcastDelivery } from './broadcast-worker';
import { createTelegramApi, TelegramApiError } from './telegram-api';
import { recordBotContact, eligibleCount } from './broadcasts';
import { createBroadcastRouter } from '../routes/meduha-broadcasts';
import { createTelegramCommandHandler, pendingCommands } from './telegram-commands';

test('post validation, media limits, plain text and safe keyboard', () => {
  const content = { title:'News', text:'<b>plain</b>', buttons:[{text:'Studio',url:'https://example.com/',kind:'web_app'}] };
  assert.equal(parseBroadcast(content).text, '<b>plain</b>');
  for (const url of ['javascript:alert(1)','http://example.com/','https://user:pass@example.com/','https://127.0.0.1/']) assert.throws(() => parseBroadcast({...content, buttons:[{...content.buttons[0],url}]}));
  assert.throws(() => parseBroadcast({...content,text:'x'.repeat(1025),mediaId:randomUUID()}));
  assert.throws(() => parseBroadcast({...content,buttons:Array(7).fill(content.buttons[0])}));
  const parameters = broadcastParameters(content.text,parseBroadcast(content).buttons,'123');
  assert.equal((parameters as any).parse_mode, undefined);
  assert.deepEqual(parameters.reply_markup, {inline_keyboard:[[{text:'Studio',web_app:{url:'https://example.com/'}}]]});
  assert.equal(checkBroadcastMedia('image/png',Buffer.from([137,80,78,71,13,10,26,10])), 'photo');
  assert.throws(() => checkBroadcastMedia('image/png',Buffer.from('not-image')));
  assert.throws(() => checkBroadcastMedia('video/mp4',Buffer.alloc(20)));
  assert.equal(deliveryFailure(new TelegramApiError(429,42),1).delay,42);
  assert.equal(deliveryFailure(new TelegramApiError(403),1).status,'failed');
  assert.equal(deliveryFailure(new TelegramApiError(0),1).status,'unknown');
});
test('consent commands persist subscription and are not lost while coalescing greetings', async () => {
  const changes: unknown[] = [];
  const handler = createTelegramCommandHandler(async () => ({}),'test_bot',undefined,async (...args) => {changes.push(args);});
  const commands = ['/subscribe','/stop','/start'].map((text,i) => ({update_id:i+1,message:{text,chat:{id:123,type:'private'}}}));
  assert.equal(pendingCommands(commands).length,3);
  for (const command of commands) await handler(command);
  assert.deepEqual(changes, [['123',true],['123',false],['123',undefined]]);
});
test('Telegram transport uploads binary media without exposing it through a public URL', async () => {
  const originalFetch = globalThis.fetch;
  try {
    const bodies: RequestInit[] = [];
    globalThis.fetch = async (_input, init) => {
      bodies.push(init!);
      return new Response(JSON.stringify({ok:true,result:{message_id:1}}),{status:200,headers:{'Content-Type':'application/json'}});
    };
    const api = createTelegramApi('synthetic-test-token');
    await api('sendMessage',{chat_id:'123',text:'Hello'});
    assert.equal(typeof bodies[0].body,'string');
    await api('sendPhoto',{chat_id:'123',photo:new Blob(['fake-binary'],{type:'image/png'}),reply_markup:{inline_keyboard:[]}});
    assert(bodies[1].body instanceof FormData);
    assert.equal(bodies[1].headers,undefined);
    assert.equal((bodies[1].body as FormData).get('chat_id'),'123');
    assert.equal((bodies[1].body as FormData).get('reply_markup'),'{"inline_keyboard":[]}');
  } finally {globalThis.fetch=originalFetch;}
});

test('isolated DB: consent, test gate, queue replay, cancellation, errors and restart safety', async () => {
  if (process.env.NODE_ENV === 'production') throw new Error('No production tests');
  const schema = `broadcast_test_${randomUUID().replaceAll('-','')}`, quoted = `"${schema}"`;
  const originalConnect = pool.connect.bind(pool);
  const mutable = pool as any;
  const tokenBefore = process.env.TELEGRAM_BOT_TOKEN;
  const client = await originalConnect();
  await client.query(`CREATE SCHEMA ${quoted}`);
  client.release();
  mutable.connect = (...args: any[]) => {
    if (typeof args[0] === 'function') {
      return originalConnect((err: Error, c: any, release: any) => {
        if (err) {args[0](err,c,release);return;}
        c.query(`SET search_path TO ${quoted}`, (error: Error) => {
          if (error) {release(error);args[0](error);return;}
          args[0](null,c,release);
        });
      });
    }
    return originalConnect().then(async c => {await c.query(`SET search_path TO ${quoted}`);return c;});
  };
  let server: ReturnType<ReturnType<typeof express>['listen']> | undefined;
  try {
    process.env.TELEGRAM_BOT_TOKEN = 'synthetic-not-a-token';
    await pool.query(await readFile('scripts/ensure-broadcasts.sql','utf8'));
    await pool.query(`CREATE TABLE meduha_accounts(id text PRIMARY KEY,blocked boolean DEFAULT false,notifications boolean DEFAULT true);
      CREATE TABLE meduha_admin_audit(id serial PRIMARY KEY,actor_id text,action text,entity_type text,entity_id text,details jsonb)`);
    await recordBotContact('101'); await recordBotContact('102',true); await recordBotContact('103',true);
    await recordBotContact('104',true); await recordBotContact('105',true);
    await pool.query("INSERT INTO meduha_accounts(id,blocked,notifications) VALUES('103',true,true),('104',false,false)");
    assert.equal(await eligibleCount(),2);
    await recordBotContact('105',false); assert.equal(await eligibleCount(),1);
    const sent: string[] = [];
    const fakeSend = async (_row: any,id: string) => {sent.push(id);return {message_id:123};};
    const app = express(); app.use(express.json());
    app.use(createBroadcastRouter(async (req,res) => {
      if (req.get('X-Test-Auth') !== 'yes') {res.status(403).end();return null;}
      return 'fixture-admin';
    }, fakeSend));
    server = app.listen(0,'127.0.0.1'); await once(server,'listening');
    const addr = server.address(); if (!addr || typeof addr === 'string') throw new Error('No server');
    const base = `http://127.0.0.1:${addr.port}`;
    const request = (path: string, body?: unknown, auth=true) => fetch(base+path,{
      method:body === undefined ? 'GET' : 'POST',
      headers:{'Content-Type':'application/json',...(auth?{'X-Test-Auth':'yes'}:{})},
      ...(body === undefined ? {} : {body:JSON.stringify(body)}),
    });
    assert.equal((await request('/broadcasts',undefined,false)).status,403);
    assert.equal((await request('/broadcasts',{title:'bad',text:'hello',buttons:[{text:'bad',url:'javascript:1',kind:'url'}]})).status,400);
    const draft = await (await request('/broadcasts',{title:'Fixture',text:'Hello',buttons:[]})).json() as any;
    assert.equal((await request(`/broadcasts/${draft.id}/send`,{confirm:draft.id})).status,409);
    assert.equal((await request(`/broadcasts/${draft.id}/test`,{chatId:'999'})).status,400);
    assert.equal((await request(`/broadcasts/${draft.id}/test`,{chatId:'101'})).status,200);
    assert.deepEqual(sent,['101']);
    assert.equal((await request(`/broadcasts/${draft.id}/send`,{confirm:draft.id})).status,200);
    assert.equal((await request(`/broadcasts/${draft.id}/send`,{confirm:draft.id})).status,200);
    assert.equal((await pool.query('SELECT * FROM meduha_broadcast_deliveries')).rowCount,1);
    await Promise.all([processBroadcastDelivery(fakeSend),processBroadcastDelivery(fakeSend)]);
    assert.deepEqual(sent,['101','102']);
    await processBroadcastDelivery(fakeSend);
    const list = await (await request('/broadcasts')).json() as any;
    assert.equal(list.items[0].status,'completed'); assert.equal(list.items[0].counts.sent,1);
    assert.equal((await pool.query('SELECT * FROM meduha_admin_audit')).rowCount,3);
    // Inject queued work and prove subscription is rechecked at send time.
    const fresh = await (await request('/broadcasts',{title:'Second',text:'Test',buttons:[]})).json() as any;
    await request(`/broadcasts/${fresh.id}/test`,{chatId:'101'});
    await request(`/broadcasts/${fresh.id}/send`,{confirm:fresh.id});
    await recordBotContact('102',false);
    await processBroadcastDelivery(fakeSend);
    assert.equal((await pool.query('SELECT status FROM meduha_broadcast_deliveries WHERE campaign_id=$1',[fresh.id])).rows[0].status,'skipped');
    // Replay uncertain/interrupted sends is forbidden.
    await pool.query("UPDATE meduha_broadcast_deliveries SET status='sending' WHERE campaign_id=$1",[fresh.id]);
    await processBroadcastDelivery(fakeSend);
    assert.equal((await pool.query('SELECT status FROM meduha_broadcast_deliveries WHERE campaign_id=$1',[fresh.id])).rows[0].status,'unknown');
    const third = await (await request('/broadcasts',{title:'Third',text:'Cancel me',buttons:[]})).json() as any;
    await recordBotContact('102',true);
    await request(`/broadcasts/${third.id}/test`,{chatId:'101'});
    await request(`/broadcasts/${third.id}/send`,{confirm:third.id});
    await request(`/broadcasts/${third.id}/cancel`,{});
    assert.equal((await request(`/broadcasts/${third.id}/send`,{confirm:third.id})).status,409);
    await processBroadcastDelivery(fakeSend);
    assert.equal((await pool.query('SELECT status FROM meduha_broadcast_deliveries WHERE campaign_id=$1',[third.id])).rows[0].status,'canceled');
  } finally {
    if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
    if (tokenBefore === undefined) delete process.env.TELEGRAM_BOT_TOKEN; else process.env.TELEGRAM_BOT_TOKEN=tokenBefore;
    await pool.query(`DROP SCHEMA ${quoted} CASCADE`);
    mutable.connect=originalConnect; await pool.end();
  }
});
