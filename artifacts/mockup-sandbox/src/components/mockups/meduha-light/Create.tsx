import { useRef, useState } from "react";
import { Check, ChevronDown, ImagePlus, Image, Music2, Play, Plus, Sparkles, WandSparkles, Zap } from "lucide-react";
import { Credit, Frame, Progress, Sheet, Toast, asset, mood, route, type Mood } from "./_shared";

export default function Create(){
 const query=new URLSearchParams(window.location.search);
 const [type,setType]=useState(query.get("type")||"photo");
 const [prompt,setPrompt]=useState("Портрет девушки на закате, тёплый свет, ветер в волосах, как кадр из любимого фильма");
 const [style,setStyle]=useState("Кино");
 const [ratio,setRatio]=useState("9:16");
 const [duration,setDuration]=useState("5 сек");
 const [model,setModel]=useState(query.get("type")==="video"?"Kling 2.1":query.get("type")==="music"?"Suno v4.5":"Flux 1.1 Pro");
 const [modelOpen,setModelOpen]=useState(false);
 const [reference,setReference]=useState("");
 const [started,setStarted]=useState(false);
 const [notice,setNotice]=useState("");
 const [face,setFace]=useState<Mood|undefined>();
 const say=(text:string,mood?:Mood,ms=2600)=>{setNotice(text);setFace(mood);setTimeout(()=>setNotice(""),ms);};
 const upload=useRef<HTMLInputElement>(null);
 const cost=type==="video"?80:type==="music"?35:20;
 const models=type==="video"?["Kling 2.1","Seedance Pro","Veo 3"]:type==="music"?["Suno v4.5","Udio"]:["Flux 1.1 Pro","GPT Image","Recraft V3"];
 return <Frame active="Create"><div className="m-heading"><div><h1>Давай создадим<span className="m-orange">.</span></h1><p>Всё начинается с твоей идеи</p></div><Credit/></div>
 <div className="m-segment">{[{id:"photo",label:"Фото",icon:Image},{id:"video",label:"Видео",icon:Play},{id:"music",label:"Музыка",icon:Music2}].map(({id,label,icon:Icon})=><button key={id} className={type===id?"selected":""} onClick={()=>{setType(id);setModel(id==="photo"?"Flux 1.1 Pro":id==="video"?"Kling 2.1":"Suno v4.5");}}><Icon size={14}/>{label}</button>)}</div>
 <div className="ml-hint"><img src={mood("curious")} alt="Медуха с вопросом"/><span><strong>Что сегодня создадим?</strong>Опиши идею своими словами — остальное я придумаю сама.</span></div><label className="m-label" htmlFor="meduha-prompt">Что придумаем?<span>Можно своими словами</span></label><div className="m-prompt"><textarea id="meduha-prompt" value={prompt} onChange={e=>setPrompt(e.target.value)} maxLength={2000} placeholder="Опиши свою идею…"/><div className="m-prompt-bottom"><button onClick={()=>{setPrompt(type==="music"?"Мягкий инди-поп о летнем вечере в Петербурге, тёплый женский вокал, 92 BPM":"Кинематографичный портрет на закате, мягкий золотой свет, 35mm, плёночное зерно, ветер в волосах");say("Добавили немного магии в промпт","wink");}}><WandSparkles size={12}/>Улучшить идею</button><small className="m-muted">{prompt.length}/2000</small></div></div>
 <input type="file" accept="image/*" ref={upload} style={{display:"none"}} onChange={e=>{const file=e.target.files?.[0];if(file){setReference(URL.createObjectURL(file));}}}/><button className="m-upload" onClick={()=>upload.current?.click()}>{reference?<img src={reference} alt="Референс" style={{height:36,width:36,objectFit:"cover",borderRadius:8}}/>:<ImagePlus size={23}/>}<span><strong>{reference?"Фото добавлено":"Добавь фото-референс"}</strong><small>{reference?"Нажми, чтобы заменить":"Твоё селфи, предмет или вдохновение"}</small></span><Plus className="upload-plus" size={17}/></button>
 <div className="m-label">Настроение и стиль<span>На твой вкус</span></div><div className="m-style-row">{[{label:"Кино",image:"portrait"},{label:"Реализм",image:"fashion"},{label:"Фантазия",image:"astronaut"},{label:"Предметы",image:"perfume"}].map(item=><button className={`m-style ${style===item.label?"selected":""}`} key={item.label} onClick={()=>setStyle(item.label)}><img src={asset(item.image)} alt={item.label}/><span>{item.label}</span>{style===item.label&&<Check className="check" size={15}/>}</button>)}</div>
 <button className="m-model" onClick={()=>setModelOpen(true)}><Sparkles size={19}/><span><strong style={{fontSize:11}}>{model}</strong><small>{type==="photo"?"Красивые детали. Живые лица.":type==="video"?"Плавное движение. Большое кино.":"Твой звук. Твоё настроение."}</small></span><span style={{marginLeft:"auto",fontSize:8,color:"#b24a14",background:"#ffe1cb",padding:"3px 6px",borderRadius:5,fontWeight:650}}>PRO</span><ChevronDown size={14}/></button>
 <div className="m-label">Формат<span>{type==="photo"?"1 изображение":type==="video"?"HD · 1080p":"С вокалом"}</span></div><div className="m-options">{["1:1","9:16","16:9","4:5"].map(r=><button key={r} className={`m-option ${ratio===r?"selected":""}`} onClick={()=>setRatio(r)}>{r}</button>)}</div>
 {type!=="photo"&&<><div className="m-label">Длительность</div><div className="m-options">{(type==="video"?["5 сек","10 сек"]:["30 сек","2 мин","3 мин"]).map(d=><button key={d} className={`m-option ${duration===d?"selected":""}`} onClick={()=>setDuration(d)}>{d}</button>)}</div></>}
 <button className="m-generate" onClick={()=>{if(!prompt.trim()){say("Сначала расскажи свою идею","tired");return;}setStarted(true);say("Принято! Медуха уже творит","joy",2800);}}><Sparkles size={17}/>{started?"Создать ещё вариант":"Создать магию"}<small>·</small><Zap size={13} fill="currentColor"/>{cost}</button><p className="m-cost-note">Спишем {cost} кредитов · останется {started?"1 230":"1 250"} · результат только твой</p><Progress fresh={started}/>
 {started&&<div className="ml-flight"><img src={mood("flight")} alt="Медуха улетает в работы"/><div><p>Идея улетела в очередь. Готовую работу пришлю в чат.</p><a href={route("Works")}>Перейти в мои работы →</a></div></div>}
 {modelOpen&&<Sheet title="Кто будет создавать?" onClose={()=>setModelOpen(false)}><img src={mood("wink")} alt="" className="m-mascot ml-sheet-mascot ml-landscape" style={{width:140}}/><p>Разные модели — разный характер результата.</p>{models.map((m,i)=><button className="m-model" key={m} onClick={()=>{setModel(m);setModelOpen(false);}}><Sparkles size={20}/><span><strong>{m}</strong><small>{["Лучший баланс деталей и скорости","Точно следует твоему промпту","Для самых смелых идей"][i]}</small></span>{model===m?<Check size={16}/>:<Plus size={16}/>}</button>)}</Sheet>}
 {notice&&<Toast face={face}>{notice}</Toast>}
 </Frame>;
}
