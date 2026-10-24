"use client";
// Shared modal structure supplied by DeepSeek and reviewed for the local Radix API.
import { useEffect, useId, useRef, useState, type ReactNode, type KeyboardEvent } from "react";
import { Settings2 } from "lucide-react";
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import "./plot-settings-dialog.css";

export type PlotSettingsTab = { id: string; label: string; content: ReactNode };

export default function PlotSettingsDialog({
  rangeControls, axisControls, tickControls, titleControls, annotationControls, tabs, children, label = "图形设置",
  open, onOpenChange, initialTab,
}: {
  rangeControls?: ReactNode; axisControls?: ReactNode; tickControls?: ReactNode;
  titleControls?: ReactNode; annotationControls?: ReactNode; tabs?: PlotSettingsTab[];
  children?: ReactNode; label?: string;
  open?: boolean; onOpenChange?: (open: boolean) => void; initialTab?: string;
}) {
  const [container, setContainer] = useState<HTMLElement | undefined>(() => document.fullscreenElement as HTMLElement || undefined);
  const [innerOpen, setInnerOpen] = useState(false);
  const [active, setActive] = useState(initialTab ?? "axes");
  const controlled = open !== undefined;
  const actualOpen = controlled ? open : innerOpen;
  const id=useId(),buttons=useRef(new Map<string,HTMLButtonElement>());
  const trigger=useRef<HTMLButtonElement>(null),opener=useRef<Element|null>(null),wasOpen=useRef(false);
  if(actualOpen&&!wasOpen.current)opener.current=document.activeElement;
  wasOpen.current=actualOpen;
  const setOpen = (next: boolean) => { if (!controlled) setInnerOpen(next); onOpenChange?.(next); };
  useEffect(() => { const sync = () => setContainer(document.fullscreenElement as HTMLElement || undefined); document.addEventListener("fullscreenchange", sync); return () => document.removeEventListener("fullscreenchange", sync); }, []);
  useEffect(() => { if (actualOpen && initialTab) setActive(initialTab); }, [actualOpen, initialTab]);

  const legacy = <div className="plot-settings-body">
    {rangeControls && <section className="plot-settings-section"><h3>坐标范围</h3>{rangeControls}</section>}
    {axisControls && <section className="plot-settings-section"><h3>双 Y 轴 / 上轴</h3>{axisControls}</section>}
    {tickControls && <section className="plot-settings-section"><h3>主刻度 / 次刻度</h3>{tickControls}</section>}
    {children && <div className="plot-settings-extra">{children}</div>}
  </div>;

  const items: PlotSettingsTab[] = tabs ?? [
    { id: "axes", label: "坐标轴", content: <>{rangeControls}{axisControls}{tickControls}</> },
    ...(titleControls ? [{ id: "titles", label: "标题", content: titleControls }] : []),
    ...(annotationControls ? [{ id: "annotations", label: "注释", content: annotationControls }] : []),
    ...(children ? [{ id: "page", label: "本页", content: children }] : []),
  ].filter(item => item.content);
  useEffect(() => { if (items.length && !items.some(item => item.id === active)) setActive(items[0].id); }, [items, active]);
  function tabKey(event:KeyboardEvent<HTMLButtonElement>,index:number){
    const next=event.key==='ArrowRight'?(index+1)%items.length:event.key==='ArrowLeft'?(index-1+items.length)%items.length:event.key==='Home'?0:event.key==='End'?items.length-1:null;
    if(next===null)return;
    event.preventDefault();event.stopPropagation();setActive(items[next].id);buttons.current.get(items[next].id)?.focus();
  }

  return <Dialog open={actualOpen} onOpenChange={setOpen}>
    <DialogTrigger asChild><button ref={trigger} type="button" className="plot-settings-trigger lsv-button secondary" aria-label={label} title={label}><Settings2 size={16}/><span>设置</span></button></DialogTrigger>
    <DialogContent className="plot-settings-dialog" overlayClassName="plot-settings-overlay" container={container}
      onOpenAutoFocus={event=>{if(tabs){event.preventDefault();(buttons.current.get(initialTab??active)??buttons.current.values().next().value)?.focus();}}}
      onCloseAutoFocus={event=>{event.preventDefault();const target=opener.current;if((target instanceof HTMLElement||target instanceof SVGElement)&&target.isConnected&&target.getClientRects().length&&!target.closest('[hidden],[inert]'))target.focus({preventScroll:true});else trigger.current?.focus({preventScroll:true});}}>
      <DialogHeader><DialogTitle>图形设置</DialogTitle><DialogDescription className="sr-only">调整当前图形的坐标范围、主次刻度、标题与注释。</DialogDescription></DialogHeader>
      {tabs ? <>
        <div className="plot-settings-tabs" role="tablist" aria-label="设置页">
          {items.map((item,index) => <button key={item.id} ref={node=>{if(node)buttons.current.set(item.id,node);else buttons.current.delete(item.id);}} id={`${id}-tab-${item.id}`} aria-controls={`${id}-panel-${item.id}`} tabIndex={active===item.id?0:-1} type="button" role="tab" aria-selected={active === item.id} className={active === item.id ? "is-active" : ""} onClick={() => setActive(item.id)} onKeyDown={event=>tabKey(event,index)}>{item.label}</button>)}
        </div>
        <div className="plot-settings-body">
          {items.map(item => <section key={item.id} id={`${id}-panel-${item.id}`} role="tabpanel" aria-labelledby={`${id}-tab-${item.id}`} tabIndex={0} hidden={active !== item.id} className="plot-settings-section">{item.content}</section>)}
        </div>
      </> : legacy}
    </DialogContent>
  </Dialog>;
}
