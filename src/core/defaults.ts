import type {
  CalendarSettings,
  MachineConfig,
  PlannerSettings,
  PriorityRule,
} from './types';

export const DEFAULT_MACHINES: MachineConfig[] = [
  {
    id: 'FANUC - 1',
    name: 'FANUC - 1',
    allowedMaterials: ['ALU', 'MS'],
    speedPercentage: 100,
    description: 'Standard 3-axis mill for aluminium and mild steel',
  },
  {
    id: 'HAAS - 1',
    name: 'HAAS - 1',
    allowedMaterials: ['ALU', 'MS', 'PCGF'],
    speedPercentage: 100,
    description: 'Versatile machining centre for ALU, MS and glass-filled plastics',
  },
  {
    id: 'HAAS - 2',
    name: 'HAAS - 2',
    allowedMaterials: ['FH', 'POM', 'PEEK'],
    speedPercentage: 100,
    description: 'Dedicated to FH, POM (Delrin) and high-temperature PEEK',
  },
  {
    id: 'FANUC - 2',
    name: 'FANUC - 2',
    allowedMaterials: ['ALU', 'POM', 'MS'],
    maxNcMinutes: 8,
    speedPercentage: 100,
    description: 'Quick-turn machine for small parts (NC time below 8 min)',
  },
  {
    id: 'HAAS - 5',
    name: 'HAAS - 5',
    allowedMaterials: ['POM'],
    minNcMinutesPref: 20,
    overflowMaterials: ['ALU', 'PCGF'],
    speedPercentage: 100,
    description: 'Heavy / large POM jobs (NC >= 20 min preferred), optional overflow',
  },
];

export const DEFAULT_OUT_OF_SCOPE = [
  'MASTER',
  'ROUTER - 1',
  'LASER - 1',
  'DMG - 1',
  'HAAS - 3',
  'HAAS - 4',
  'LATHE - 1',
];

export const DEFAULT_MATERIAL_OFFSETS: Record<string, number> = {
  ALU: 0,
  POM: 0,
  FH: 2,
  PCGF: 3,
  MS: 4,
  PEEK: 5,
  PP: 1,
  INOX: 8,
  FR4: 2,
};

export const MATERIAL_TYPES = ['ALU', 'POM', 'FH', 'PCGF', 'MS', 'PEEK', 'PP', 'INOX', 'FR4'];

function pad(n: number) {
  return String(n).padStart(2, '0');
}

export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function defaultCalendar(): CalendarSettings {
  return {
    startDate: todayIso(),
    shiftsPerDay: 2,
    hoursPerShift: 8,
    shiftStartHour: 6,
    weekendOff: true,
    continuous247: false,
  };
}

export const RULE_PRESETS: Record<string, { label: string; description: string; rules: PriorityRule[] }> = {
  finishModule: {
    label: 'Finish full module first',
    description: 'Modules with the fewest parts left go first, then closest production date.',
    rules: [
      { id: 'finish-module', type: 'finish_master_order', level: 1, enabled: true, name: 'Finish Full Module First', direction: 'lowest_first' },
      { id: 'production-date', type: 'production_date', level: 2, enabled: true, name: 'Production Date: Closest First', dateDirection: 'closest_first' },
    ],
  },
  waiting: {
    label: 'Fewest remaining parts',
    description: 'Waiting-based ranking, then closest production date.',
    rules: [
      { id: 'waiting', type: 'waiting', level: 1, enabled: true, name: 'Waiting: Modules with Fewest Remaining Parts', direction: 'lowest_first' },
      { id: 'production-date', type: 'production_date', level: 2, enabled: true, name: 'Production Date: Closest First', dateDirection: 'closest_first' },
    ],
  },
  salesAndCustomer: {
    label: 'Sales order & customer first',
    description: 'Chosen sales orders / customers at level 1, then the default ranking.',
    rules: [
      { id: 'sales-order', type: 'sales_order', level: 1, enabled: true, name: 'Sales Order Priority', values: [] },
      { id: 'customer', type: 'customer', level: 1, enabled: true, name: 'Customer Priority', values: [] },
      { id: 'waiting', type: 'waiting', level: 2, enabled: true, name: 'Waiting: Modules with Fewest Remaining Parts', direction: 'lowest_first' },
      { id: 'production-date', type: 'production_date', level: 3, enabled: true, name: 'Production Date: Closest First', dateDirection: 'closest_first' },
    ],
  },
  scheduleRange: {
    label: 'Schedule number range first',
    description: 'Schedule numbers in a range first, then the default ranking.',
    rules: [
      { id: 'schedule', type: 'schedule', level: 1, enabled: true, name: 'Schedule Priority', scheduleMode: 'range', scheduleMin: 10, scheduleMax: 30 },
      { id: 'waiting', type: 'waiting', level: 2, enabled: true, name: 'Waiting: Modules with Fewest Remaining Parts', direction: 'lowest_first' },
      { id: 'production-date', type: 'production_date', level: 3, enabled: true, name: 'Production Date: Closest First', dateDirection: 'closest_first' },
    ],
  },
};

export const EFFICIENCY_PRESETS: Record<string, { label: string; description: string; global: number; materials: Record<string, number> }> = {
  ideal: {
    label: 'Ideal (100%)',
    description: 'Perfect feed assumptions: planned time equals NC time.',
    global: 100,
    materials: { ALU: 100, POM: 100, FH: 100, PCGF: 100, MS: 100, PEEK: 100, PP: 100, INOX: 100, FR4: 100 },
  },
  realistic: {
    label: 'Realistic',
    description: 'Shop-floor observed feeds; hard alloys and abrasive composites run slower.',
    global: 80,
    materials: { ALU: 80, POM: 85, FH: 75, PCGF: 65, MS: 70, PEEK: 50, PP: 80, INOX: 45, FR4: 60 },
  },
  conservative: {
    label: 'Conservative',
    description: 'Safety buffer for tool wear, chips and cautious feeds.',
    global: 65,
    materials: { ALU: 65, POM: 70, FH: 60, PCGF: 50, MS: 55, PEEK: 40, PP: 65, INOX: 35, FR4: 45 },
  },
};

export function defaultSettings(): PlannerSettings {
  return {
    machines: structuredClone(DEFAULT_MACHINES),
    changeover: {
      sameMatnrMin: 0,
      sameMaterialNoMin: 8,
      sameMaterialTypeMin: 12,
      differentMaterialTypeMin: 20,
    },
    calendar: defaultCalendar(),
    materialOffsets: { ...DEFAULT_MATERIAL_OFFSETS },
    priorityRules: structuredClone(RULE_PRESETS.finishModule.rules),
    outOfScopeMachines: [...DEFAULT_OUT_OF_SCOPE],
    materialAliases: {},
    keepErpAssignments: true,
    excludeMasterOrders30000: true,
    allowHaas5Overflow: false,
    syncToleranceMin: 10,
    restartJobOnEvent: false,
    timelineEvents: [],
    carpenterCutColumn: 'cutted_status',
    carpenterDelayMode: 'soft',
    carpenterMaxDelayHours: 8,
    simulatedUncutMasterOrders: [],
    globalEfficiencyPercent: 100,
    efficiencyMatrix: {},
    efficiencyVariability: {},
    materialEfficiency: {},
    partEfficiencyOverrides: {},
    efficiencyMode: 'expected',
    fanuc2UsesIdealMinutes: true,
    calibrationHistory: [],
  };
}

/** Merge persisted settings over defaults so newly added fields always exist. */
export function mergeSettings(saved: Partial<PlannerSettings> | null | undefined): PlannerSettings {
  const base = defaultSettings();
  if (!saved || typeof saved !== 'object') return base;
  const merged: PlannerSettings = { ...base, ...saved };
  merged.calendar = { ...base.calendar, ...(saved.calendar ?? {}) };
  merged.changeover = { ...base.changeover, ...(saved.changeover ?? {}) };
  if (!Array.isArray(merged.machines) || merged.machines.length === 0) merged.machines = base.machines;
  if (!Array.isArray(merged.priorityRules)) merged.priorityRules = base.priorityRules;
  return merged;
}
