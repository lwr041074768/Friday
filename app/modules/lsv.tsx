import { Activity } from "lucide-react";
import ElectrochemWorkspace from "@/app/electrochem-workspace";
import type { ModuleDefinition } from "./types";

export const lsvModule: ModuleDefinition = {
  id: "lsv",
  label: "LSV",
  scope: "lsv",
  icon: Activity,
  render: runtime => <ElectrochemWorkspace kind="lsv" active={runtime.active} onSnapshotChange={runtime.onSnapshot}/>,
};
