import type { ComponentProps, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import type OverpotentialWorkspace from "@/app/overpotential-workspace";
import type CdlWorkspace from "@/app/cdl-workspace";
import type RamanWorkspace from "@/app/raman-workspace";
import type { CdlSaveBinaryFile, CdlSaveTextFile } from "@/app/cdl-workspace";
import type { OverpotentialSnapshot } from "@/lib/overpotential-data";
import type PhWorkspace from "@/app/ph-workspace";

export type ModuleId = "lsv" | "overpotential" | "eis" | "cdl" | "cv" | "tafel" | "xrd" | "raman" | "ph";

export type ModuleRuntime = {
  active: boolean;
  snapshot: OverpotentialSnapshot;
  onSnapshot: (snapshot: OverpotentialSnapshot) => void;
  saveCdlFile: CdlSaveTextFile;
  saveCdlBinaryFile: CdlSaveBinaryFile;
  chooseCdlFiles: NonNullable<ComponentProps<typeof CdlWorkspace>>["chooseFiles"];
  chooseCdlFolder: NonNullable<ComponentProps<typeof CdlWorkspace>>["chooseFolder"];
  chooseCvFiles: NonNullable<ComponentProps<typeof CdlWorkspace>>["chooseFiles"];
  chooseCvFolder: NonNullable<ComponentProps<typeof CdlWorkspace>>["chooseFolder"];
  exportCdlToOrigin: NonNullable<ComponentProps<typeof CdlWorkspace>>["onExportOrigin"];
  exportRamanToOrigin: NonNullable<ComponentProps<typeof RamanWorkspace>>["onExportOrigin"];
  choosePhFiles: NonNullable<ComponentProps<typeof PhWorkspace>>["chooseFiles"];
  choosePhFolder: NonNullable<ComponentProps<typeof PhWorkspace>>["chooseFolder"];
  exportPhToOrigin: NonNullable<ComponentProps<typeof PhWorkspace>>["onExportOrigin"];
};

export type ModuleDefinition = {
  id: ModuleId;
  label: string;
  scope: string;
  icon: LucideIcon;
  render: (runtime: ModuleRuntime) => ReactNode;
};

export type SnapshotModuleProps = Pick<ComponentProps<typeof OverpotentialWorkspace>, "snapshot" | "saveTextFile">;
