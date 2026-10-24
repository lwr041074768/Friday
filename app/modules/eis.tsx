import { CircleDot } from "lucide-react";
import EisWorkspace from "@/app/eis-workspace";
import type { ModuleDefinition } from "./types";

export const eisModule: ModuleDefinition = {
  id: "eis",
  label: "EIS",
  scope: "eis",
  icon: CircleDot,
  render: () => <EisWorkspace/>,
};
