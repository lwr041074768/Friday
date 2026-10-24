import { Repeat2 } from "lucide-react";
import CvWorkspace from "@/app/cv-workspace";
import type { ModuleDefinition } from "./types";

export const cvModule: ModuleDefinition = {
  id: "cv",
  label: "CV",
  scope: "cv",
  icon: Repeat2,
  render: runtime => <CvWorkspace chooseFiles={runtime.chooseCvFiles} chooseFolder={runtime.chooseCvFolder} saveTextFile={runtime.saveCdlFile} saveBinaryFile={runtime.saveCdlBinaryFile}/>,
};
