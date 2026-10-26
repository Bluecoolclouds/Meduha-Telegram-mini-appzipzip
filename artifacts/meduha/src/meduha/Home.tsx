import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Clapperboard, Music2, Replace, ScanFace, Sparkles, WandSparkles } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { HeaderActions, Frame, LiveMascot, SectionTitle, Sheet, asset, brandAsset, mood } from './shared';
import TemplateFeed from './templates/TemplateFeed';
import { usePlaybackPolicy } from './templates/playback-policy';

const homePhotoFiles = ['home-photo-1.webp','home-photo-2.webp','home-photo-3.webp','home-photo-4.webp'];
function HomeVideoPreview() {
 const videoRef=useRef<HTMLVideoElement>(null);const [visible,setVisible]=useState(false);const {pageActive,canAutoplay}=usePlaybackPolicy();
 useEffect(()=>{const video=videoRef.current;if(!video)return;const observer=new IntersectionObserver(([entry])=>setVisible(entry.isIntersecting),{rootMargin:'120px'});observer.observe(video);return()=>observer.disconnect()},[]);
 useEffect(()=>{const video=videoRef.current;if(!video)return;
  if(!visible||!pageActive||!canAutoplay){video.pause();video.removeAttribute('src');video.load();return}
  video.src='/api/meduha/example-media/home-video.mp4';void video.play().catch(()=>undefined);
  return()=>{video.pause();video.removeAttribute('src');video.load()};
 },[visible,pageActive,canAutoplay]);
 return <video ref={videoRef} className="m-entry-video" poster="/api/meduha/example-media/home-video-poster.webp" muted playsInline loop preload="none" aria-hidden="true" tabIndex={-1}/>;
}

function HomePhotoPreview() {
 const imageRef=useRef<HTMLDivElement>(null);const [visible,setVisible]=useState(false);const [index,setIndex]=useState(0);const [previous,setPrevious]=useState<number|null>(null);const {pageActive,canAutoplay}=usePlaybackPolicy();
 useEffect(()=>{const node=imageRef.current;if(!node)return;const observer=new IntersectionObserver(([entry])=>setVisible(entry.isIntersecting),{rootMargin:'120px'});observer.observe(node);return()=>observer.disconnect()},[]);
 useEffect(()=>{if(!visible||!pageActive||!canAutoplay)return;
  const upcoming=new Image();upcoming.src=`/api/meduha/example-media/${homePhotoFiles[(index+1)%homePhotoFiles.length]}`;
  const timer=window.setTimeout(()=>{setPrevious(index);setIndex(current=>(current+1)%homePhotoFiles.length)},6000);
  return()=>window.clearTimeout(timer);
 },[visible,pageActive,canAutoplay,index]);
 useEffect(()=>{if(previous===null)return;const timer=window.setTimeout(()=>setPrevious(current=>current===previous?null:current),700);return()=>window.clearTimeout(timer)},[previous]);
 return <div ref={imageRef} className="m-entry-photo-stack" aria-hidden="true" data-testid="home-photo-preview">
  {previous!==null&&<img className="m-entry-photo-layer m-entry-photo-previous" src={`/api/meduha/example-media/${homePhotoFiles[previous]}`} alt=""/>}
  <img key={index} data-testid="home-photo-current" className={`m-entry-photo-layer m-entry-photo-current${previous!==null?' m-entry-photo-incoming':''}`} src={`/api/meduha/example-media/${homePhotoFiles[index]}`} alt="" decoding="async"/>
 </div>;
}

export default function Home(){
 const [,navigate]=useLocation();const [tools,setTools]=useState(false);
 return <Frame active="Home"><div className="m-home-line"><Link className="m-wordmark" href="/"><span className="m-logo"><img src={brandAsset('app-icon')} alt=""/></span>meduha<span className="m-orange">.</span></Link><HeaderActions/></div>
  <section className="m-hero"><div className="m-eyebrow" style={{marginBottom:7}}>Твоя идея. Наша магия.</div><h1>А что, если<br/><span>можно всё?</span></h1><p>Фото, видео и музыка.<br/>Просто придумай — я создам.</p><LiveMascot moods={['hello','wink','joy']} alt="Белая медуза — творческий помощник"/><Sparkles className="spark" size={23}/></section>
  <div className="m-info-note">Пока можно подготовить идею и сохранить черновик. Генерация ещё не подключена.</div>
    <div className="m-entry-grid"><Link href="/create?type=photo" className="m-entry m-entry-photo press"><HomePhotoPreview/><div className="m-entry-content"><h3>Создать фото</h3><p>Ты в любой вселенной</p><div className="m-entry-cta">Попробовать<ArrowRight size={14}/></div></div></Link><Link href="/create?type=video" className="m-entry press"><HomeVideoPreview/><div className="m-entry-content"><h3>Создать видео</h3><p>Оживи свою историю</p><div className="m-entry-cta">Попробовать<ArrowRight size={14}/></div></div></Link></div>
  <Link className="m-music-link m-music-feature press" href="/create?type=music"><span className="music-icon m-music-feature-icon"><Music2 size={17}/></span><span className="m-music-feature-copy"><strong>А может, свой трек?</strong><small>Из пары слов</small></span><span className="m-music-feature-arrow" aria-hidden="true"><ArrowRight size={15}/></span></Link>
  <SectionTitle action="Все инструменты" onClick={()=>setTools(true)}>Больше, чем промпт</SectionTitle><div className="m-tools">{[{label:'Замена объекта',icon:Replace,href:'/create?type=video&scenario=object-swap'},{label:'Видеоэффекты',icon:Clapperboard,href:`/create?preset=${encodeURIComponent('Видеоэффекты')}`},{label:'Оживить фото',icon:WandSparkles,href:`/create?preset=${encodeURIComponent('Оживить фото')}`}].map(({label,icon:Icon,href})=><Link key={label} href={href} className="m-tool"><Icon size={23}/>{label}</Link>)}</div>
   <SectionTitle action="Все шаблоны" onClick={()=>navigate('/community')}>Примеры для вдохновения</SectionTitle><TemplateFeed/>
  <div className="ml-peek"><img src={mood('curious')} alt="Медуха выглядывает с вопросом"/></div><p className="m-footer-note" style={{marginTop:4}}>Хорошие идеи заслуживают быть созданными.<br/>А что придумаешь ты?</p>
  {tools&&<Sheet title="Чуть больше магии" onClose={()=>setTools(false)}><img src={mood('wink')} alt="" className="m-mascot ml-sheet-mascot ml-landscape" style={{width:150}}/><p>Выбери идею — всё остальное мы уже подготовили. Сохранить результат пока можно как черновик.</p><div className="m-gallery">{[{image:'fashion',title:'AI-фотосессия'},{image:'car',title:'Кино из фото'},{image:'astronaut',title:'Другая вселенная'},{image:'flower',title:'Предметная магия'}].map(item=><Link href={`/create?preset=${encodeURIComponent(item.title)}`} className="m-work" key={item.image} onClick={()=>setTools(false)}><img style={{height:160,width:'100%',objectFit:'cover',borderRadius:14}} src={asset(item.image)} alt={`Пример: ${item.title}`}/><h3>{item.title} <ArrowRight size={12} style={{display:'inline'}}/></h3></Link>)}</div></Sheet>}
 </Frame>;
}
