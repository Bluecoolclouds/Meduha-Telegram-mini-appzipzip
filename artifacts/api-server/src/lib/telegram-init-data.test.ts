import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { TelegramAuthError, validateTelegramInitData } from './telegram-init-data';

// Deliberately fictitious, only used by isolated tests; never a runtime credential.
const fixtureToken='123456:unit-test-only-not-real';
const now=1_900_000_000;
function signed(fields:Record<string,string>,token=fixtureToken){
  const params=new URLSearchParams(fields);
  const pairs=[...params.entries()].sort(([a],[b])=>a<b?-1:a>b?1:0);
  const key=createHmac('sha256','WebAppData').update(token).digest();
  const hash=createHmac('sha256',key).update(pairs.map(([k,v])=>`${k}=${v}`).join('\n')).digest('hex');
  params.set('hash',hash);return params.toString();
}
const fields=()=>({auth_date:String(now),query_id:'fixture',user:JSON.stringify({id:123456789,first_name:'Test',username:'fixture'})});
const rejects=(raw:string,code='INVALID_TELEGRAM_DATA')=>assert.throws(
  ()=>validateTelegramInitData(raw,fixtureToken,now),
  (e:unknown)=>e instanceof TelegramAuthError&&e.code===code,
);
test('valid signed identity; fields signed along with new signature metadata',()=>{
  assert.equal(validateTelegramInitData(signed({...fields(),signature:'fixture-signature'}),fixtureToken,now).id,'123456789');
});
test('tampered user, wrong bot, malformed hash and duplicate fields are rejected',()=>{
  const valid=signed(fields());
  rejects(valid.replace('Test','Intruder'));
  rejects(signed(fields(),'wrong-unit-test-token'));
  rejects(valid.replace(/hash=[^&]+/,'hash=00'));
  rejects(`${valid}&user=${encodeURIComponent(fields().user)}`);
  rejects(`${valid}&hash=${'0'.repeat(64)}`);
});
test('expired, missing and excessively future timestamps are rejected',()=>{
  rejects(signed({...fields(),auth_date:String(now-601)}),'EXPIRED_TELEGRAM_DATA');
  rejects(signed({...fields(),auth_date:String(now+31)}));
  const {auth_date,...remaining}=fields();
  rejects(signed(remaining));
  assert.equal(validateTelegramInitData(signed({...fields(),auth_date:String(now-600)}),fixtureToken,now).firstName,'Test');
});
test('invalid users and oversized payloads are rejected',()=>{
  for(const user of [null,{id:'123',first_name:'Test'},{id:-1,first_name:'Test'},{id:123,first_name:''},{id:123,first_name:'Test',photo_url:'javascript:alert(1)'}]){
    rejects(signed({...fields(),user:JSON.stringify(user)}));
  }
  rejects('x'.repeat(16385));
});
