import { Activity } from "lucide-react";
import RamanWorkspace from "@/app/raman-workspace";
import type { ModuleDefinition } from "./types";

export const ramanModule: ModuleDefinition = {
  id: "raman",
  label: "Raman",
  scope: "raman",
  icon: Activity,
  render: runtime => <RamanWorkspace onExportOrigin={runtime.exportRamanToOrigin}/>,
};
