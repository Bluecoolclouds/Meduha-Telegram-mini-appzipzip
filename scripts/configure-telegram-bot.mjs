import { createHmac } from 'node:crypto';

// Run only after publication, with getDeploymentInfo().primaryUrl, never a preview.
const raw=process.argv.find(value=>value.startsWith('--url='))?.slice(6);
const menuOnly=process.argv.includes('--menu-only');
let app;
try {
  app=new URL(raw??'');
  if(app.protocol!=='https:' || app.username || app.password || app.search || app.hash ||
    app.hostname.endsWith('.replit.dev') || ['localhost','127.0.0.1'].includes(app.hostname))throw new Error();
} catch {
  console.error('Provide the published HTTPS URL: node scripts/configure-telegram-bot.mjs --url=https://your-published-domain/');
  process.exit(1);
}
const token=process.env.TELEGRAM_BOT_TOKEN;
if(!token){console.error('TELEGRAM_BOT_TOKEN is missing from Secrets.');process.exit(1)}
async function call(method,body){
  try{
    const response=await fetch(`https://api.telegram.org/bot${token}/${method}`,{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000),
    });
    const data=await response.json();
    if(!response.ok||!data.ok)throw new Error();
    return data.result;
  }catch{console.error(`Telegram ${method} failed; credential and request details are not logged.`);process.exit(1)}
}
const health=await fetch(new URL('/api/healthz',app),{signal:AbortSignal.timeout(15000)}).catch(()=>null);
const status=health?.ok?await health.json().catch(()=>null):null;
if(status?.status!=='ok'){console.error('Published API is not publicly reachable. No bot settings changed.');process.exit(1)}
if(!menuOnly){
  const probe=await fetch(new URL('/api/telegram/webhook',app),{
    method:'POST',headers:{'Content-Type':'application/json'},body:'{"update_id":0}',signal:AbortSignal.timeout(15000),
  }).catch(()=>null);
  if(probe?.status!==403){
    console.error('Published webhook is not ready. Publish the current API first, or use --menu-only to configure only the launch button. No bot settings changed.');
    process.exit(1);
  }
}
const secret=createHmac('sha256',token).update('meduha/telegram-webhook/v1').digest('hex');
await call('setChatMenuButton',{menu_button:{type:'web_app',text:'Открыть meduha',web_app:{url:app.href}}});
const menu=await call('getChatMenuButton',{});
if(menu?.type!=='web_app'||menu?.web_app?.url!==app.href){
  console.error('Telegram did not confirm the requested menu button.');process.exit(1);
}
console.log('Mini App menu button configured and verified.');
if(!menuOnly){
  await call('setWebhook',{url:new URL('/api/telegram/webhook',app).href,secret_token:secret,allowed_updates:['message'],drop_pending_updates:false});
  console.log('Webhook configured. The development poller will stop without deleting it.');
}else{
  console.log('Message reception unchanged; /start replies use the configured Mini App URL.');
}
