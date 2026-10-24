/** Peak lists are immutable at their source wavelength; d is in angstroms. */
export type ReferencePeak = {
  twoTheta: number;
  d: number;
  intensity: number;
  hkl?: string;
  intensityQualifier?: "<" | ">";
};

export type ReferenceCard = {
  id: string;
  name: string;
  formula?: string;
  source: "cod" | "jade";
  sourceId?: string;
  sourceFile?: string;
  sourceUrl?: string;
  wavelength: number;
  peaks: ReferencePeak[];
  warnings: string[];
  citation?: string;
  calculation?: string;
  visible: boolean;
  color: string;
  preserveSourceAngles?: boolean;
};

export type CodEntry = {
  id: string;
  name: string;
  formula: string;
  spaceGroup?: string;
  citation?: string;
  sourceUrl: string;
};

export const XRD_DEFAULT_WAVELENGTH = 1.5406;
export const XRD_REFERENCE_COLORS = ["#c04d36", "#744ab6", "#18877c", "#c18a22", "#387ec0", "#a94b7b"];

export function referencePeaksAtWavelength(card: ReferenceCard, wavelength: number): ReferencePeak[] {
  if (!Number.isFinite(wavelength) || wavelength <= 0) return [];
  return card.peaks.flatMap(peak => {
    if(card.preserveSourceAngles&&Math.abs(card.wavelength-wavelength)<=1e-4)return [{...peak}];
    const sine = wavelength / (2 * peak.d);
    if (!(sine > 0 && sine < 1)) return [];
    return [{ ...peak, twoTheta: 2 * Math.asin(sine) * 180 / Math.PI }];
  });
}
