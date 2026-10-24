import { TrendingUp } from "lucide-react";
import ElectrochemWorkspace from "@/app/electrochem-workspace";
import type { ModuleDefinition } from "./types";

export const tafelModule: ModuleDefinition = {
  id: "tafel",
  label: "Tafel",
  scope: "tafel",
  icon: TrendingUp,
  render: runtime => <ElectrochemWorkspace kind="tafel" active={runtime.active}/>,
};
