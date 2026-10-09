import type { CalibrationRow, Job, MachineConfig, PlannerSettings } from './types';

export type EfficiencySource = 'part' | 'matrix' | 'material' | 'machine' | 'global';

export interface ResolvedEfficiency {
  percent: number; // efficiency used for planning (honours planning mode)
  expectedPercent: number;
  lowerBoundPercent: number;
  source: EfficiencySource;
}

const clamp = (v: number) => Math.max(10, Math.round(v));

/**
 * Efficiency lookup, most specific first:
 * part override -> machine x material -> material default -> machine speed (when changed from 100) -> global.
 */
export function resolveEfficiency(job: Job, machine: MachineConfig, s: PlannerSettings): ResolvedEfficiency {
  const part = s.partEfficiencyOverrides[job.id] ?? s.partEfficiencyOverrides[job.orderNumber];
  const cell = s.efficiencyMatrix[machine.id]?.[job.materialType];
  const mat = s.materialEfficiency[job.materialType];

  let base: number;
  let source: EfficiencySource;
  if (part !== undefined && part > 0) {
    base = part;
    source = 'part';
  } else if (cell !== undefined && cell > 0) {
    base = cell;
    source = 'matrix';
  } else if (mat !== undefined && mat > 0) {
    base = mat;
    source = 'material';
  } else if (machine.speedPercentage > 0 && machine.speedPercentage !== 100) {
    base = machine.speedPercentage;
    source = 'machine';
  } else {
    base = s.globalEfficiencyPercent > 0 ? s.globalEfficiencyPercent : 100;
    source = 'global';
  }

  const variability = s.efficiencyVariability[machine.id]?.[job.materialType] ?? 0;
  const expectedPercent = clamp(base);
  const lowerBoundPercent = clamp(base - variability);
  return {
    percent: s.efficiencyMode === 'cautious' ? lowerBoundPercent : expectedPercent,
    expectedPercent,
    lowerBoundPercent,
    source,
  };
}

export interface PlannedDuration {
  durationMin: number;
  cautiousDurationMin: number;
  idealMinutes: number;
  efficiencyPercent: number;
  source: EfficiencySource | 'manual';
  materialOffset: number;
}

/** planned minutes = (NC minutes / efficiency + material offset) x qty */
export function plannedDuration(
  job: Job,
  machine: MachineConfig,
  s: PlannerSettings,
  manualDurationMin?: number,
): PlannedDuration {
  const idealMinutes = job.ncMinutes * job.qty;
  if (manualDurationMin !== undefined && manualDurationMin > 0) {
    return {
      durationMin: manualDurationMin,
      cautiousDurationMin: manualDurationMin,
      idealMinutes,
      efficiencyPercent: Math.round((idealMinutes / manualDurationMin) * 100),
      source: 'manual',
      materialOffset: 0,
    };
  }
  const offset = s.materialOffsets[job.materialType] ?? 0;
  const eff = resolveEfficiency(job, machine, s);
  const total = (percent: number) => Math.max(1, Math.round((job.ncMinutes / (percent / 100) + offset) * job.qty));
  const expected = total(eff.expectedPercent);
  const cautious = total(eff.lowerBoundPercent);
  return {
    durationMin: s.efficiencyMode === 'cautious' ? cautious : expected,
    cautiousDurationMin: cautious,
    idealMinutes,
    efficiencyPercent: eff.percent,
    source: eff.source,
    materialOffset: offset,
  };
}

/** Parses "Box Code, Machine, Actual Minutes" lines (comma / tab / semicolon separated). */
export function parseCalibration(text: string, jobs: Job[]): { rows: CalibrationRow[]; error?: string } {
  const byBox = new Map<string, Job>();
  for (const j of jobs) {
    byBox.set(j.boxCode.toLowerCase(), j);
    byBox.set(j.orderNumber.toLowerCase(), j);
  }
  const rows: CalibrationRow[] = [];
  text
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean)
    .forEach((line, i) => {
      if (i === 0 && /box/i.test(line) && /actual/i.test(line)) return;
      const [box, machineId, actualRaw] = line.split(/[,\t;]+/).map(p => p.trim());
      const actual = parseFloat(actualRaw ?? '');
      if (!box || !machineId || !(actual > 0)) return;
      const job = byBox.get(box.toLowerCase());
      rows.push({
        boxCode: box,
        machineId,
        materialType: job?.materialType,
        ncMinutes: job ? job.ncMinutes * job.qty : actual,
        actualMinutes: actual,
      });
    });
  return rows.length ? { rows } : { rows, error: 'No valid rows. Expected: Box Code, Machine, Actual Minutes' };
}

export interface CalibrationSuggestion {
  machineId: string;
  materialType: string;
  samples: number;
  ncMinutes: number;
  actualMinutes: number;
  suggestedPercent: number;
  currentPercent: number;
}

export function calibrationSuggestions(history: CalibrationRow[], s: PlannerSettings): CalibrationSuggestion[] {
  const groups = new Map<string, CalibrationSuggestion>();
  for (const r of history) {
    const material = r.materialType ?? 'ALU';
    const key = `${r.machineId}|${material}`;
    const g =
      groups.get(key) ??
      ({
        machineId: r.machineId,
        materialType: material,
        samples: 0,
        ncMinutes: 0,
        actualMinutes: 0,
        suggestedPercent: 100,
        currentPercent:
          s.efficiencyMatrix[r.machineId]?.[material] ?? s.materialEfficiency[material] ?? s.globalEfficiencyPercent,
      } as CalibrationSuggestion);
    g.samples += 1;
    g.ncMinutes += r.ncMinutes;
    g.actualMinutes += r.actualMinutes;
    groups.set(key, g);
  }
  return [...groups.values()]
    .map(g => ({ ...g, suggestedPercent: Math.max(10, Math.min(200, Math.round((g.ncMinutes / g.actualMinutes) * 100))) }))
    .sort((a, b) => b.samples - a.samples);
}
