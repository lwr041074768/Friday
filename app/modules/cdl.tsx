import { Waves } from "lucide-react";
import CdlWorkspace from "@/app/cdl-workspace";
import type { ModuleDefinition } from "./types";

export const cdlModule: ModuleDefinition = {
  id: "cdl",
  label: "Cdl",
  scope: "cdl",
  icon: Waves,
  render: runtime => <CdlWorkspace saveTextFile={runtime.saveCdlFile} saveBinaryFile={runtime.saveCdlBinaryFile} chooseFiles={runtime.chooseCdlFiles} chooseFolder={runtime.chooseCdlFolder} onExportOrigin={runtime.exportCdlToOrigin}/>,
};
