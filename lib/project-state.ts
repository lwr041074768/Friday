"use client";
import {useCallback,useEffect,useLayoutEffect,useRef,useState,useSyncExternalStore,type Dispatch,type SetStateAction} from "react";
import {decodeProject,encodeProject,validateStateShape,type ProjectDocument} from "./project-document";
type Adapter={write:(value:unknown)=>void;initial:unknown};
type Snapshot=Record<string,unknown>;
type Change={before:Snapshot;after:Snapshot;time:number;keys:string};
const values=new Map<string,unknown>(),adapters=new Map<string,Adapter>(),defaults=new Map<string,unknown>(),readers=new Map<string,()=>unknown>(),listeners=new Set<()=>void>();
let revision=0,epoch=0,dirty=false,name="未命名项目",fileName="",savedAt="",undo:Change[]=[],redo:Change[]=[],pending:Snapshot|null=null,pendingKeys=new Set<string>();
const capture=():Snapshot=>{const state=Object.fromEntries(values);for(const [key,read] of readers)state[key]=read();return state;};
const emit=()=>{revision++;for(const listener of listeners)listener();};
function flush(){if(!pending)return;const entry={before:pending,after:capture(),time:Date.now(),keys:[...pendingKeys].sort().join("|")};const last=undo.at(-1);if(last&&last.keys===entry.keys&&entry.time-last.time<400){last.after=entry.after;last.time=entry.time;}else undo.push(entry);if(undo.length>120)undo.shift();redo=[];pending=null;pendingKeys=new Set();dirty=true;emit();}
function change(key:string,value:unknown){if(Object.is(values.get(key),value))return;if(!pending){pending=capture();pending[key]=values.get(key);setTimeout(flush,40);}pendingKeys.add(key);values.set(key,value);dirty=true;emit();}
function apply(snapshot:Snapshot){pending=null;pendingKeys=new Set();values.clear();for(const [key,value] of Object.entries(snapshot))values.set(key,value);for(const [key,adapter] of adapters)adapter.write(Object.hasOwn(snapshot,key)?snapshot[key]:structuredClone(adapter.initial));epoch++;emit();}
export function useProjectState<T>(scope:string|undefined,key:string,initial:T|(()=>T)):[T,Dispatch<SetStateAction<T>>]{
 const id=scope?`${scope}.${key}`:undefined;
 const init=useRef<{value:T}|null>(null);if(!init.current)init.current={value:typeof initial==="function"?(initial as ()=>T)():initial};
 const [value,setValue]=useState<T>(()=>id&&values.has(id)?values.get(id) as T:init.current!.value),ref=useRef(value);ref.current=value;
 useLayoutEffect(()=>{if(!id)return;if(!values.has(id))values.set(id,ref.current);if(!defaults.has(id))defaults.set(id,init.current!.value);const adapter:Adapter={initial:init.current!.value,write:raw=>{ref.current=raw as T;setValue(raw as T);}};adapters.set(id,adapter);return()=>{if(adapters.get(id)===adapter)adapters.delete(id);};},[id]);
 const set=useCallback<Dispatch<SetStateAction<T>>>(action=>{const next=typeof action==="function"?(action as (v:T)=>T)(ref.current):action;if(Object.is(next,ref.current))return;if(id)change(id,next);ref.current=next;setValue(next);},[id]);
 return[value,set];
}
export function useProjectDerived<T>(scope:string|undefined,key:string,value:T,onRestore:(value:T)=>boolean|void){
 const id=scope?`${scope}.${key}`:undefined,pendingValue=useRef<{value:T}|null>(null),callback=useRef(onRestore),live=useRef(value);callback.current=onRestore;live.current=value;
 const restoreEpoch=useSyncExternalStore(projectStore.subscribe,()=>epoch,()=>epoch);
 useLayoutEffect(()=>{if(!id)return;if(!values.has(id))values.set(id,value);if(!defaults.has(id))defaults.set(id,value);const adapter:Adapter={initial:value,write:raw=>{pendingValue.current={value:raw as T};}};adapters.set(id,adapter);readers.set(id,()=>pendingValue.current?pendingValue.current.value:live.current);return()=>{if(adapters.get(id)===adapter)adapters.delete(id);readers.delete(id);};},[id]);
 useEffect(()=>{if(!id)return;if(pendingValue.current){const next=pendingValue.current.value;pendingValue.current=null;if(callback.current(next)===false)change(id,false);return;}change(id,value);},[id,value,restoreEpoch]);
}
function restoreDocument(text:string,file:string,nextDirty:boolean){const document=decodeProject(text);for(const [key,value] of Object.entries(document.states)){if(!defaults.has(key))throw Error(`当前版本不支持项目字段：${key}`);validateStateShape(key,value,defaults.get(key));}const state:Snapshot=Object.fromEntries(defaults);Object.assign(state,document.states);name=document.name;fileName=file;savedAt=nextDirty?"":document.savedAt;undo=[];redo=[];dirty=nextDirty;apply(state);}
export const projectStore={
 subscribe:(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};},
 getRevision:()=>revision,
 get:<T>(key:string)=>values.get(key) as T|undefined,
 status:()=>({dirty,name,fileName,savedAt,canUndo:undo.length>0,canRedo:redo.length>0,epoch}),
 summary:()=>[... ["lsv","tafel","eis","xrd","raman"].map(scope=>({scope,count:Array.isArray(values.get(`${scope}.curves`))?(values.get(`${scope}.curves`) as unknown[]).length:0})),{scope:'cdl',count:Array.isArray(values.get('cdl.slots'))?(values.get('cdl.slots') as {samples:unknown[]}[]).reduce((sum,slot)=>sum+slot.samples.length,0):0},...['ph','cv'].map(scope=>({scope,count:Array.isArray(values.get(`${scope}.groups`))?(values.get(`${scope}.groups`) as {series:unknown[]}[]).reduce((sum,group)=>sum+group.series.length,0):0}))],
 hasData:()=>[...values].some(([key,value])=>key.endsWith('.curves')&&Array.isArray(value)&&value.length>0||key==='cdl.slots'&&Array.isArray(value)&&value.some(slot=>slot?.samples?.length>0)||['ph.groups','cv.groups'].includes(key)&&Array.isArray(value)&&value.some(group=>group?.series?.length>0)),
 rename:(value:string)=>{const next=value.trim().slice(0,120)||"未命名项目";if(name===next)return;name=next;dirty=true;emit();},
 serialize:(version:string)=>{flush();const document:ProjectDocument={schema:"electrocatalysis-project/v1",application:"Scientific Plot Studio",name,version,savedAt:new Date().toISOString(),states:capture()};return encodeProject(document);},
 load:(text:string,file:string)=>restoreDocument(text,file,false),
 recover:(text:string)=>restoreDocument(text,"",true),
 saved:(file:string,capturedRevision?:number)=>{flush();const changed=capturedRevision!==undefined&&revision!==capturedRevision;fileName=file;savedAt=new Date().toISOString();dirty=changed;emit();},
 reset:()=>{name="未命名项目";fileName="";savedAt="";dirty=false;undo=[];redo=[];apply(Object.fromEntries([...defaults].map(([key,value])=>[key,structuredClone(value)])));},
 undo:()=>{flush();const entry=undo.pop();if(!entry)return;redo.push(entry);apply(entry.before);dirty=true;emit();},
 redo:()=>{flush();const entry=redo.pop();if(!entry)return;undo.push(entry);apply(entry.after);dirty=true;emit();},
};
export function useProjectEpoch(){return useSyncExternalStore(projectStore.subscribe,()=>epoch,()=>epoch);}
