import { Layers3 } from "lucide-react";
import XrdWorkspace from "@/app/xrd-workspace";
import type { ModuleDefinition } from "./types";

export const xrdModule: ModuleDefinition = {
  id: "xrd",
  label: "XRD",
  scope: "xrd",
  icon: Layers3,
  render: () => <XrdWorkspace/>,
};
