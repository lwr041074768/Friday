import { BarChart3 } from "lucide-react";
import OverpotentialWorkspace from "@/app/overpotential-workspace";
import type { ModuleDefinition } from "./types";

export const overpotentialModule: ModuleDefinition = {
  id: "overpotential",
  label: "过电位",
  scope: "overpotential",
  icon: BarChart3,
  render: runtime => <OverpotentialWorkspace snapshot={runtime.snapshot} saveTextFile={runtime.saveCdlFile}/>,
};
