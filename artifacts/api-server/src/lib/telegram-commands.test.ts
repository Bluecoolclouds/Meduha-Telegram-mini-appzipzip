import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { TelegramApi } from './telegram-api';
import { createTelegramCommandHandler, pendingCommands, type TelegramUpdate } from './telegram-commands';

const update = (text:string, id=1, type='private'):TelegramUpdate => ({update_id:id,message:{text,chat:{id:123,type}}});
function fixture(menu:unknown={type:'commands'}){
  const calls:{method:string;params:Record<string,unknown>}[]=[];
  const api:TelegramApi=async(method,params={})=>{calls.push({method,params});return method==='getChatMenuButton'?menu:{message_id:1}};
  return {calls,handle:createTelegramCommandHandler(api,'fixture_bot')};
}
test('/start responds honestly before publication, without an invented launch button',async()=>{
  const {handle,calls}=fixture();await handle(update('/start referral'));
  const sent=calls.find(call=>call.method==='sendMessage');assert(sent);
  assert.match(String(sent.params.text),/Привет! Я meduha/);
  assert.match(String(sent.params.text),/ещё не опубликован/);
  assert.equal(sent.params.reply_markup,undefined);
});
test('/start and /help offer the configured HTTPS Mini App in a private chat',async()=>{
  for(const command of ['/start@fixture_bot','/help']){
    const {handle,calls}=fixture({type:'web_app',web_app:{url:'https://studio.example.com/'}});
    await handle(update(command));
    const sent=calls.find(call=>call.method==='sendMessage');assert(sent);
    assert.deepEqual(sent.params.reply_markup,{inline_keyboard:[[{text:'Открыть meduha',web_app:{url:'https://studio.example.com/'}}]]});
  }
});
test('other bots, unrelated text and missing messages are ignored',async()=>{
  const {handle,calls}=fixture();
  for(const message of ['/start@another_bot','hello','/startwrong'])await handle(update(message));
  await handle({update_id:5});
  assert.equal(calls.length,0);
});
test('groups get a personal-chat link, not an unsupported web_app keyboard',async()=>{
  const {handle,calls}=fixture();await handle(update('/start',1,'group'));
  assert.equal(calls[0].method,'sendMessage');
  assert.deepEqual(calls[0].params.reply_markup,{inline_keyboard:[[{text:'Перейти к боту',url:'https://t.me/fixture_bot'}]]});
});
test('retry commands already queued for the same chat are coalesced',()=>{
  const batch=[update('/start',1),update('/start',2),update('other text',3),update('/help',4)];
  assert.deepEqual(pendingCommands(batch).map(item=>item.update_id),[3,4]);
});
test('unsafe launch URL never becomes a launch button',async()=>{
  const {handle,calls}=fixture({type:'web_app',web_app:{url:'http://unsafe.example.com/'}});
  await handle(update('/start'));
  assert.equal(calls.find(call=>call.method==='sendMessage')?.params.reply_markup,undefined);
});
