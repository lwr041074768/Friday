"use client";

import { useState } from "react";
import { ChevronDown, Download } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { buildLsvDataFile, type DataExportFormat } from "@/lib/lsv-data-export";
import type { PlotCurve } from "@/lib/lsv-math";
import type { ScanMode } from "@/lib/scan-branches";

const FORMATS: { format: DataExportFormat; label: string }[] = [
  { format: "txt", label: "TXT（.txt）" }, { format: "xlsx", label: "Excel（.xlsx）" },
  { format: "csv", label: "CSV（.csv）" }, { format: "tsv", label: "TSV（.tsv）" },
];

export default function LsvDataExport({ curves, scan }: { curves: PlotCurve[]; scan: ScanMode }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function download(format: DataExportFormat) {
    if (busy) return;
    setBusy(true); setError("");
    try {
      await new Promise(resolve => window.setTimeout(resolve, 0));
      const file = buildLsvDataFile(curves, scan, format);
      const url = URL.createObjectURL(new Blob([new Uint8Array(file.bytes).buffer], { type: file.mime }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `LSV-数据-${new Date().toISOString().replace(/[:.]/g, "-")}.${file.extension}`;
      document.body.appendChild(link);
      try { link.click(); } finally { link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 60_000); }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "数据导出失败，请重试。");
    } finally { setBusy(false); }
  }

  return <div className="lsv-data-export">
    <DropdownMenu>
      <DropdownMenuTrigger asChild><button className="lsv-button secondary lsv-origin-button lsv-data-export-button" disabled={!curves.length || busy}>
        <Download size={16}/>{busy ? "正在导出…" : "导出数据"}<ChevronDown size={14}/>
      </button></DropdownMenuTrigger>
      <DropdownMenuContent className="lsv-data-export-menu" align="end" sideOffset={6}>
        {FORMATS.map(item => <DropdownMenuItem key={item.format} onSelect={() => { void download(item.format); }}>{item.label}</DropdownMenuItem>)}
      </DropdownMenuContent>
    </DropdownMenu>
    {error && <div className="lsv-data-export-error" role="alert">{error}</div>}
  </div>;
}
