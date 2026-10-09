import type { Job } from '../core/types';

export type ColorMode = 'material' | 'masterOrder' | 'salesOrder';

const MATERIAL_HUE: Record<string, number> = {
  ALU: 217,
  POM: 158,
  FH: 275,
  PCGF: 36,
  MS: 190,
  PEEK: 350,
  PP: 240,
  INOX: 172,
  FR4: 20,
};

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export interface Swatch {
  bg: string;
  border: string;
  fg: string;
  hue: number;
}

export function swatchFor(job: Job, mode: ColorMode): Swatch {
  let hue: number;
  let sat = 70;
  if (mode === 'material') {
    hue = MATERIAL_HUE[job.materialType] ?? 215;
    if (MATERIAL_HUE[job.materialType] === undefined) sat = 10;
  } else {
    const key = mode === 'masterOrder' ? job.masterOrder : job.salesOrder || job.masterOrder;
    hue = (hash(key) * 47) % 360;
  }
  return {
    hue,
    bg: `hsl(${hue} ${sat}% 38%)`,
    border: `hsl(${hue} ${sat}% 62%)`,
    fg: '#fff',
  };
}

export function materialBadgeStyle(material: string): { background: string; color: string; borderColor: string } {
  const hue = MATERIAL_HUE[material] ?? 215;
  const sat = MATERIAL_HUE[material] === undefined ? 8 : 60;
  return { background: `hsl(${hue} ${sat}% 18%)`, color: `hsl(${hue} ${sat}% 80%)`, borderColor: `hsl(${hue} ${sat}% 35%)` };
}

export const MACHINE_ACCENT = ['#38bdf8', '#34d399', '#c084fc', '#fbbf24', '#fb7185', '#2dd4bf', '#f97316', '#a3e635'];
