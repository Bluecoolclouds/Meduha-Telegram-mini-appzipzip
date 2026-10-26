import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Check, ChevronRight, House, Images, Plus, UserRound, X, Zap, UsersRound } from 'lucide-react';
import { Link } from 'wouter';
import { mood, storageProblem, type Mood } from '../studio';
import { ThemeToggle, useTheme } from '../theme';
import { useMeduhaSession } from '../session';

export { mood };
export type { Mood };
export const asset = (name: string) => `${import.meta.env.BASE_URL}images/meduha/${name}.png`;
export const brandAsset = (name: string) => `${import.meta.env.BASE_URL}images/brand/${name === 'app-icon' ? 'app-icon-ui.webp' : `${name}.png`}`;
export const route = (name: string) => ({Home:'/',Create:'/create',Works:'/works',Profile:'/profile',Community:'/community'}[name] ?? '/');
export const ink = '#df4f12';
export function SectionTitle({children,action,onClick}:{children:ReactNode;action?:string;onClick?:()=>void}) {
  return <div className="m-section-title"><h2>{children}</h2>{action&&<button onClick={onClick}>{action}<ChevronRight size={12}/></button>}</div>;
}
export function LiveMascot({moods,alt='',interval=4000,className='',style,priority=false}:{moods:Mood[];alt?:string;interval?:number;className?:string;style?:CSSProperties;priority?:boolean}) {
  const [index,setIndex]=useState(0);
  useEffect(()=>{if(window.matchMedia('(prefers-reduced-motion: reduce)').matches||moods.length<2)return;const timer=window.setInterval(()=>setIndex(i=>(i+1)%moods.length),interval);return()=>window.clearInterval(timer)},[moods,interval]);
  return <div className={`ml-live ${className}`} style={style} role="img" aria-label={alt}>{moods.map((m,i)=><img key={m} src={mood(m)} alt="" decoding="async" fetchPriority={priority ? i===0?'high':'low' : 'auto'} className={i===index?'on':''}/>)}</div>;
}
export function Credit(){const {phase,account}=useMeduhaSession();return <Link className="m-credit press" href="/profile?topup=1" aria-label={phase==='authenticated'?`${account?.credits??'—'} кредитов, открыть пополнение`:'Гостевой режим — открыть пакеты кредитов'}><Zap size={13} fill="currentColor"/><span className="m-credit-value">{phase==='authenticated'?(account?.credits??'—'):'Гость'}</span><Plus size={16} className="plus"/></Link>}
export function HeaderActions(){return <div className="m-header-actions"><ThemeToggle/><Credit/></div>}
export function AppNavigation({active,onNavigate}:{active:string;onNavigate?:()=>void}) {
  return <nav className="m-nav" aria-label="Основная навигация">{[{name:'Home',label:'Главная',icon:House,path:'/'},{name:'Community',label:'Сообщество',icon:UsersRound,path:'/community'},{name:'Create',label:'Создать',icon:Plus,path:'/create'},{name:'Works',label:'История',icon:Images,path:'/works'},{name:'Profile',label:'Профиль',icon:UserRound,path:'/profile'}].map(({name,label,icon:Icon,path})=><Link key={name} href={path} onClick={onNavigate} className={`${active===name?'active':''} ${name==='Create'?'nav-create':''}`}><Icon size={name==='Create'?17:21}/><span>{label}</span></Link>)}</nav>;
}
export function Frame({active,children}:{active:string;children:ReactNode}) {
  const problem=storageProblem();
  const {theme}=useTheme();
  useEffect(()=>{
    const tg=(window as Window&{Telegram?:{WebApp?:{initData?:string;ready?:()=>void;expand?:()=>void;isVersionAtLeast?:(version:string)=>boolean;setHeaderColor?:(color:string)=>void;setBackgroundColor?:(color:string)=>void;setBottomBarColor?:(color:string)=>void}}}).Telegram?.WebApp;
     if(tg?.initData){
       tg.expand?.();
      if(tg.isVersionAtLeast?.('6.1')){tg.setHeaderColor?.(theme==='dark'?'#151416':'#fffbf7');tg.setBackgroundColor?.(theme==='dark'?'#111113':'#fff6ec')}
      if(tg.isVersionAtLeast?.('7.10'))tg.setBottomBarColor?.(theme==='dark'?'#111113':'#fff6ec');
    }
  },[theme]);
  return <div className="meduha-app" data-theme={theme}><div className={`meduha light${theme==='dark'?' dark':''}`}>
     {active!=='Home'&&<header className="m-app-header"><Link href="/" className="brand"><img src={brandAsset('app-icon')} alt=""/>meduha<span className="m-orange">.</span></Link><HeaderActions/></header>}
     <main className={`m-scroll m-screen-${active.toLowerCase()}`}>{problem&&<p className="m-info-note" role="alert">{problem}</p>}{children}</main>
    <AppNavigation active={active}/>
  </div></div>;
}
export function Sheet({title,children,onClose,className}:{title:string;children:ReactNode;onClose:()=>void;className?:string}) {
  const dialog=useRef<HTMLElement>(null); const close=useRef(onClose);close.current=onClose;
  useEffect(()=>{
    const previous=document.activeElement as HTMLElement|null;
    const node=dialog.current;
    const panels=()=>[...document.querySelectorAll('[role="dialog"]')];
    const focusables=()=>node?[...node.querySelectorAll<HTMLElement>('button,a[href],input,textarea,select,[tabindex="0"]')].filter(el=>!el.hasAttribute('disabled')&&el.getClientRects().length>0):[];
    (focusables()[0]||node)?.focus();
    const key=(e:KeyboardEvent)=>{
      if(panels().at(-1)!==node)return;
      if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close.current()}
      if(e.key!=='Tab'||!node)return;
      const els=focusables();
      if(!els.length){e.preventDefault();node.focus();return}
      if(!node.contains(document.activeElement)||document.activeElement===node){e.preventDefault();(e.shiftKey?els[els.length-1]:els[0]).focus()}
      else if(e.shiftKey&&document.activeElement===els[0]){e.preventDefault();els[els.length-1].focus()}
      else if(!e.shiftKey&&document.activeElement===els[els.length-1]){e.preventDefault();els[0].focus()}
    };
    document.addEventListener('keydown',key);
    return()=>{document.removeEventListener('keydown',key);if(previous?.isConnected)previous.focus()};
  },[]);
  return <div className="m-overlay" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><section ref={dialog} tabIndex={-1} className={`m-sheet${className ? ` ${className}` : ''}`} role="dialog" aria-modal="true" aria-label={title}><div className="m-sheet-handle"/><div className="m-sheet-header"><h2>{title}</h2><button className="m-icon-button" aria-label="Закрыть" onClick={onClose}><X size={18}/></button></div>{children}</section></div>;
}
export function Toast({children,face}:{children:ReactNode;face?:Mood}) {return <div className="m-toast" role="status" aria-live="polite">{face?<img className="ml-toast-face" src={mood(face)} alt=""/>:<Check size={16}/ >}{children}</div>}
export function useToast(){const [notice,setNotice]=useState('');const timer=useRef<number|undefined>(undefined);const notify=(text:string)=>{setNotice(text);window.clearTimeout(timer.current);timer.current=window.setTimeout(()=>setNotice(''),3000)};useEffect(()=>()=>window.clearTimeout(timer.current),[]);return {notice,notify,toast:notice?<Toast>{notice}</Toast>:null}}
