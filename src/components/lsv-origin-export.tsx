"use client";

import { useRef, useState } from "react";
import { Download, ExternalLink, Settings2, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { createOriginExportSession } from "@/lib/lsv-origin-session";
import type { PlotCurve } from "@/lib/lsv-math";
import type { ScanMode } from "@/lib/scan-branches";
import { preventStaticTextCaret } from "@/lib/plot-ui";
import LsvDataExport from "@/components/lsv-data-export";

const READY_KEY = "scientific-plot-origin-helper-v2.6";
const LEGACY_READY_KEYS = ["scientific-plot-origin-helper-v2.5", "scientific-plot-origin-helper-v1"];

export default function LsvOriginExport({ curves, scan }: { curves: PlotCurve[]; scan: ScanMode }) {
  const session = useRef(createOriginExportSession());
  const [open, setOpen] = useState(false);
  const [declaredReady, setDeclaredReady] = useState(false);
  const [upgradeRequired, setUpgradeRequired] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [filename, setFilename] = useState("");
  const [launchRequest, setLaunchRequest] = useState<{ id: string; curves: PlotCurve[]; scan: ScanMode }>();
  // A visible user-clicked link is available for the current export only.
  // Changing applied data hides it until the new snapshot has been prepared.
  const currentLaunch = launchRequest?.curves === curves && launchRequest.scan === scan ? launchRequest : undefined;

  function readSetupDeclaration() {
    try { return localStorage.getItem(READY_KEY) === "ready" || declaredReady; }
    catch { return declaredReady; }
  }

  function readUpgradeRequired() {
    try { return !readSetupDeclaration() && LEGACY_READY_KEYS.some(key => localStorage.getItem(key) === "ready"); }
    catch { return false; }
  }

  function transfer(launch: boolean, forceNew = false) {
    try {
      const request = session.current.prepare(curves, scan, forceNew);
      const firstDownload = !request.downloadRequested;
      const name = "lsv-origin-" + request.payload.requestId + ".lsvdata";
      if (firstDownload) {
        const url = URL.createObjectURL(new Blob([request.serialized], { type: "application/octet-stream" }));
        const link = document.createElement("a");
        link.href = url;
        link.download = name;
        document.body.appendChild(link);
        try {
          link.click();
          request.downloadRequested = true;
        } finally {
          link.remove();
          window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
        }
      }
      setFilename(name);
      setLaunchRequest({ id: request.payload.requestId, curves, scan });
      setError("");
      setMessage(launch
        ? firstDownload ? "已请求下载当前数据并打开 Origin。请允许浏览器打开本机连接程序。" : "复用已生成的数据，已请求打开 Origin，本次不再下载文件。"
        : firstDownload ? "已请求下载交接文件，包含全部样品所选扫描段的数据与备注。" : "当前数据的交接文件已生成，本次没有重复下载。需要补下载时，请点击“重新生成文件”。");
      if (launch) window.location.assign("lsv-origin://import/" + request.payload.requestId);
    } catch (cause) {
      setMessage("");
      setError(cause instanceof Error ? cause.message : "无法生成 Origin 交接数据。");
    }
  }

  function settings() {
    setDeclaredReady(readSetupDeclaration());
    setUpgradeRequired(readUpgradeRequired());
    setOpen(true);
  }

  function begin() {
    const ready = readSetupDeclaration();
    setDeclaredReady(ready);
    setUpgradeRequired(readUpgradeRequired());
    if (ready) transfer(true);
    else setOpen(true);
  }

  function rememberSetup() {
    // This is the user's declaration, never detection of an installed helper.
    try { localStorage.setItem(READY_KEY, "ready"); } catch { /* storage is optional */ }
    setDeclaredReady(true);
    setUpgradeRequired(false);
    setOpen(false);
    if (curves.length) transfer(true);
    else setMessage("已记住你的安装设置。请先导入 LSV 数据，再点击“导出至Origin”。");
  }

  const openOriginLink = declaredReady && currentLaunch && <a
    className="lsv-button primary lsv-origin-launch"
    href={"lsv-origin://import/" + currentLaunch.id}
    onClick={() => { setError(""); setMessage("已点击打开 Origin。请在浏览器提示中允许打开本机连接程序；本次不重复下载文件。"); }}
  ><ExternalLink size={16}/>打开 Origin</a>;

  const setupSteps = <div>
    <ol>
      <li>下载连接程序，解压后双击 <b>install.cmd</b>。</li>
      <li>安装完成后，回到网页点击“已安装 v2.6，导出并打开 Origin”。</li>
      <li>以后点击页面上的“导出至Origin”，在浏览器提示中允许打开程序。</li>
    </ol>
    <a className="lsv-button secondary" href="/origin-helper/lsv-origin-helper.zip?v=2.6" download><Download size={16}/>下载本地连接程序 v2.6</a>
    <p className="lsv-origin-columns">需要 Windows 和已安装的 Origin。每位成员在自己的电脑上设置一次。若文件保存到其他位置，本机连接程序会提示你选择交接文件。</p>
    <p className="lsv-origin-columns">交接文件为 .lsvdata，由助手自动读取，无需手动双击打开，也无需 CatGo。</p>
  </div>;

  return <>
    <div className="lsv-export-stack"><div className="lsv-origin-controls">
      <button className="lsv-button secondary lsv-origin-button" disabled={!curves.length} onClick={begin}>
        <ExternalLink size={16} />导出至Origin
      </button>
      <button className="lsv-origin-settings" aria-label="Origin 连接设置" title="Origin 连接设置" onClick={settings}><Settings2 size={17}/></button>
    </div><LsvDataExport curves={curves} scan={scan}/></div>
    {!open && (message || error) && <div className="lsv-origin-toast" role={error ? "alert" : "status"} onMouseDownCapture={preventStaticTextCaret}>
      <button aria-label="关闭导出提示" onClick={() => { setMessage(""); setError(""); }}><X size={16}/></button>
      <div>{error || message}</div>
      {!error && <small>{!declaredReady ? "请在连接设置中确认已安装 v2.6，再打开 Origin。" : currentLaunch ? "没有弹出打开程序的提示？点击下面的“打开 Origin”，无需重新下载或安装。" : "导入结果以本机连接程序的提示为准。"}</small>}
      {openOriginLink}
      <button className="lsv-origin-toast-settings" onClick={settings}>连接设置 / 重新生成文件</button>
    </div>}
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="lsv-help-modal lsv-origin-modal" onMouseDownCapture={preventStaticTextCaret}>
        <DialogHeader>
          <DialogTitle>{declaredReady ? "Origin 连接设置" : upgradeRequired ? "更新 Origin 连接程序" : "首次连接 Origin"}</DialogTitle>
          <DialogDescription>导出后新建 Book，所有样品在同一工作表中按五列一组横向排列。</DialogDescription>
        </DialogHeader>
        <div className="lsv-origin-content">
          {upgradeRequired && <p>v2.6 会在关闭或最小化助手时将本次导入的 Origin 带到前台。请更新连接程序后确认安装；如果本机已更新，直接点击下方确认按钮即可。</p>}
          {declaredReady
            ? <><p>已记住你确认的安装设置。直接点击页面上的“导出至Origin”即可，同一份数据不会反复下载。</p><details><summary>重新安装 / 使用说明</summary>{setupSteps}</details></>
            : setupSteps}
          <p className="lsv-origin-columns">按当前扫描选择导出：氧化峰仅导出正向扫描，还原峰仅导出反向扫描，全部则保留全部扫描段。保留原始列、校正 X/Y 和样品备注。切换扫描选择、修改数据或应用 IR 后，下次导出会生成新文件。</p>
          {message && <div className="lsv-origin-status" role="status">{message}</div>}
          {error && <div className="lsv-error" role="alert">{error}</div>}
          {filename && <div className="lsv-origin-file">最近生成：{filename}</div>}
          {declaredReady && currentLaunch && <div className="lsv-origin-open-row">{openOriginLink}<span>使用当前交接文件，不再下载。首次打开请允许浏览器启动程序。</span></div>}
          <div className="lsv-origin-dialog-actions">
            <button className="lsv-button secondary" disabled={!curves.length} onClick={() => transfer(false, !!filename)}>{filename ? "重新生成文件" : "仅下载交接文件"}</button>
            <button className="lsv-button primary" onClick={() => declaredReady ? setOpen(false) : rememberSetup()}>{declaredReady ? "完成" : curves.length ? "已安装 v2.6，导出并打开 Origin" : "已安装 v2.6，保存设置"}</button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  </>;
}
