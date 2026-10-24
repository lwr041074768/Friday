import { lsvModule } from "./lsv";
import { overpotentialModule } from "./overpotential";
import { eisModule } from "./eis";
import { cdlModule } from "./cdl";
import { cvModule } from "./cv";
import { tafelModule } from "./tafel";
import { xrdModule } from "./xrd";
import { ramanModule } from "./raman";
import { phModule } from "./ph";
import type { ModuleDefinition, ModuleId } from "./types";

/** The shell only knows this registry; module internals stay in their own files. */
export const modules: readonly ModuleDefinition[] = [
  lsvModule,
  overpotentialModule,
  eisModule,
  cdlModule,
  cvModule,
  tafelModule,
  phModule,
  xrdModule,
  ramanModule,
];

export type { ModuleId, ModuleDefinition, ModuleRuntime } from "./types";
export const moduleIds = modules.map(module => module.id) as ModuleId[];
export const moduleById = new Map<ModuleId, ModuleDefinition>(modules.map(module => [module.id, module]));
