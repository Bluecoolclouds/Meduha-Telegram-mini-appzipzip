import { Suspense, lazy, useEffect, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import Home from './meduha/Home';
import Create from './meduha/Create';
import Works from './meduha/Works';
import Profile from './meduha/Profile';
import Community from './meduha/Community';
import TemplateManager from './meduha/templates/manage/TemplateManager';
const AdminApp = lazy(() => import('./meduha/admin/AdminApp'));
const Wallet = lazy(() => import('./meduha/wallet/Wallet'));
import { ThemeProvider } from './meduha/theme';
import { MeduhaSessionProvider, meduhaErrorMessage, useMeduhaSession } from './meduha/session';
import { brandAsset } from './meduha/shared';
import { RotateCw, ShieldAlert, UserRound } from 'lucide-react';

const queryClient = new QueryClient();
const pageMeta:Record<string,{title:string;description:string}>={
  '/':{title:'meduha — твоя творческая студия',description:'Подготовь идею для фото, видео или музыки и сохрани её как черновик.'},
  '/create':{title:'Создать идею — meduha',description:'Опиши идею, выбери формат и сохрани локальный черновик.'},
  '/works':{title:'Мои работы — meduha',description:'Твои сохранённые идеи и черновики на этом устройстве.'},
  '/profile':{title:'Профиль — meduha',description:'Настройки локальной студии meduha.'},
  '/community/manage':{title:'Мои публикации — meduha',description:'Поделись фото или видео и промптом с сообществом.'},
  '/wallet':{title:'Кошелёк — meduha',description:'Баланс кредитов и история операций аккаунта.'},
  '/admin':{title:'Пульт — meduha',description:'Панель управления студией meduha.'},
  '/community':{title:'Вдохновение — meduha',description:'Мозаика фото и видео участников сообщества с оригинальными промптами.'},
};
function Metadata(){const [location]=useLocation();useEffect(()=>{const meta=pageMeta[location.split('?')[0]]||pageMeta['/'];document.title=meta.title;let element=document.querySelector('meta[name="description"]');if(!element){element=document.createElement('meta');element.setAttribute('name','description');document.head.appendChild(element)}element.setAttribute('content',meta.description)},[location]);return null}
function Router(){return <><Metadata/><RoutedErrorBoundary><Switch>
  <Route path="/" component={Home}/>
  <Route path="/create" component={Create}/>
  <Route path="/works" component={Works}/>
  <Route path="/profile" component={Profile}/>
   <Route path="/community" component={Community}/>
  <Route path="/community/manage" component={TemplateManager}/>
  <Route path="/wallet">{()=><Suspense fallback={<div className="m-startup"><p>Загружаем кошелёк…</p></div>}><Wallet/></Suspense>}</Route>
  <Route component={NotFound}/>
</Switch></RoutedErrorBoundary></>}
function RoutedErrorBoundary({children}:{children:ReactNode}){const [location]=useLocation();return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>}
function SessionGate({children}:{children:ReactNode}){
 const [location]=useLocation();
 if(location==='/admin'||location.startsWith('/admin/'))return <RoutedErrorBoundary><Suspense fallback={<div style={{padding:40}}>Загружаем пульт…</div>}><AdminApp/></Suspense></RoutedErrorBoundary>;
 return <AppSessionGate>{children}</AppSessionGate>;
}
function AppSessionGate({children}:{children:ReactNode}){
 const session=useMeduhaSession();
 const configMissing=(session.error as {data?:{code?:string}}|null)?.data?.code==='TELEGRAM_NOT_CONFIGURED';
 const staleTelegramAuth=session.phase==='expired'||(session.error as {status?:number}|null)?.status===401;
 if(session.phase==='checking'||session.phase==='authenticating'||session.phase==='loading-account')return <div className="m-startup"><div className="m-startup-capsule"><img src={brandAsset('app-icon')} alt=""/><div><strong>meduha<span>.</span></strong><small>{session.phase==='loading-account'?'Загружаем аккаунт':'Проверяем Telegram'}</small></div></div><div className="m-startup-skeleton"><i/><i/><i/></div><p>{session.phase==='loading-account'?'Подготавливаем твою студию…':'Подключаем личную студию'}</p></div>;
 if(session.phase==='error'||session.phase==='expired')return <div className="m-startup"><div className="m-startup-capsule"><ShieldAlert size={22}/><div><strong>{session.phase==='expired'?'Сессия завершилась':configMissing?'Telegram-аккаунт недоступен':'Не удалось подключиться'}</strong><small>{configMissing?'Проверка аккаунтов Telegram пока не настроена на сервере. Ты можешь продолжить только в явном гостевом режиме.':`${meduhaErrorMessage(session.error)}${staleTelegramAuth?' Закрой и заново открой Mini App из Telegram, чтобы получить свежую проверку входа.':''}`}</small></div></div><button className="m-startup-action" onClick={session.phase==='expired'?session.reauthenticate:session.retry}><RotateCw size={15}/> {session.phase==='expired'?'Подтвердить аккаунт':'Повторить попытку'}</button>{session.phase!=='expired'&&<button className="m-startup-guest" onClick={session.continueGuest}><UserRound size={15}/> Продолжить локально как гость</button>}</div>;
 const screenKey=session.phase==='authenticated'?`account:${session.account?.id??'verified'}`:session.phase;
 return <div key={screenKey} className="m-session-content">{children}</div>;
}
function App(){return <ThemeProvider><QueryClientProvider client={queryClient}><MeduhaSessionProvider><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/,'')}><SessionGate><Router/></SessionGate></WouterRouter><Toaster/></TooltipProvider></MeduhaSessionProvider></QueryClientProvider></ThemeProvider>}
export default App;
