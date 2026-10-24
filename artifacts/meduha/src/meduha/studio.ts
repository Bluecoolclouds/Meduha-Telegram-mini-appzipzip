import * as React from 'react';
import { z } from 'zod';
export type Mood='glossy'|'hello'|'joy'|'curious'|'thinking'|'surprise'|'wink'|'sleep'|'tired'|'flight';
export type StudioType='photo'|'video'|'music';
export type Draft={id:string;title:string;type:StudioType;prompt:string;style:string;model:string;ratio:string;duration:string;updatedAt:number;referenceName?:string};
export type ContentPlanSettings={platform:string;count:string;format:string};
const contentPlanDefaults:ContentPlanSettings={platform:'Instagram',count:'3',format:'Короткое видео'};
const contentPlanMarker=/\n\nПараметры контент-плана Meduha:\nПлощадка: (.*)\nИдей: (\d+)\nФормат: (.*)$/;
export function unpackContentPlanPrompt(value:string):{prompt:string;plan:ContentPlanSettings}{
  const match=contentPlanMarker.exec(value);
  return match
    ? {prompt:value.slice(0,match.index),plan:{platform:match[1],count:match[2],format:match[3]}}
    : {prompt:value,plan:{...contentPlanDefaults}};
}
export function getDraftPromptDisplay(draft:Pick<Draft,'type'|'model'|'prompt'>):{prompt:string;plan:ContentPlanSettings|null}{
  if(draft.type!=='video'||draft.model!=='Контент-завод')return {prompt:draft.prompt,plan:null};
  const {prompt,plan}=unpackContentPlanPrompt(draft.prompt);
  return {prompt,plan};
}
export function packContentPlanPrompt(prompt:string,plan:ContentPlanSettings){
  return `${prompt.trim()}\n\nПараметры контент-плана Meduha:\nПлощадка: ${plan.platform}\nИдей: ${plan.count}\nФормат: ${plan.format}`;
}
export const mood=(name:Mood)=>`${import.meta.env.BASE_URL}images/brand/mascot-${name}.png`;
export const DRAFTS_KEY='meduha.drafts.v1', SETTINGS_KEY='meduha.settings.v1';
export type Settings={notifications:boolean;quality:boolean};
const draftSchema=z.object({
  id:z.string().min(1),title:z.string(),type:z.enum(['photo','video','music']),
  prompt:z.string(),style:z.string(),model:z.string(),ratio:z.string(),duration:z.string(),
  updatedAt:z.number().finite().min(0).max(8640000000000000),referenceName:z.string().optional(),
});
const settingsSchema=z.object({notifications:z.boolean(),quality:z.boolean()});
const problems=new Map<string,string>();
function readStored<T>(key:string,validate:(value:unknown)=>T,fallback:T):T{
  try {
    const raw=localStorage.getItem(key);
    const value=raw===null?fallback:validate(JSON.parse(raw));
    problems.delete(key);
    return value;
  } catch {
    problems.set(key,'Не удалось прочитать данные браузера. Сохранение отключено, чтобы не перезаписать твои черновики. Проверь доступ к хранилищу; существующие данные не изменены.');
    return fallback;
  }
}
export function loadDrafts():Draft[]{return readStored(DRAFTS_KEY,value=>z.array(draftSchema).parse(value),[])}
export function saveDrafts(rows:Draft[]){
  loadDrafts();
  if(problems.has(DRAFTS_KEY))return false;
  try{localStorage.setItem(DRAFTS_KEY,JSON.stringify(rows));window.dispatchEvent(new Event('meduha:drafts'));return true}catch{return false}
}
export function loadSettings():Settings{return readStored(SETTINGS_KEY,value=>settingsSchema.parse(value),{notifications:true,quality:true})}
export function saveSettings(settings:Settings){
  loadSettings();
  if(problems.has(SETTINGS_KEY))return false;
  try{localStorage.setItem(SETTINGS_KEY,JSON.stringify(settings));window.dispatchEvent(new Event('meduha:settings'));return true}catch{return false}
}
export function storageProblem(){loadDrafts();loadSettings();return [...problems.values()][0]}
export function useDraftList(){
  const [rows,setRows]=React.useState<Draft[]>(()=>loadDrafts());
  React.useEffect(()=>{const refresh=()=>setRows(loadDrafts());window.addEventListener('meduha:drafts',refresh);window.addEventListener('storage',refresh);return()=>{window.removeEventListener('meduha:drafts',refresh);window.removeEventListener('storage',refresh)}},[]);
  return rows;
}
