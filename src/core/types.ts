/** Domain types shared by the parsers, the scheduler (worker) and the UI. */

import type { PartKind } from './partKinds';

export type Id = string;

/** Where a job's planned time comes from. */
export type TimeBasis = 'measured' | 'estimated' | 'manual';

/** Average real time per piece taken from the parts time list. */
export interface PartTime {
  minutes: number;
  name?: string;
}

/** Part times keyed by normalized material number (see parse/partTimes.ts). */
export type PartTimeMap = Record<string, PartTime>;

/** One normalized production line ("box") coming from the BoxShelf export. */
export interface Job {
  id: Id; // unique key (order number, de-duplicated)
  boxCode: string;
  masterOrder: string;
  orderNumber: string;
  matnr: string; // drawing / program number
  materialNo: string; // stock blank
  materialType: string;
  ncMinutes: number; // ideal NC minutes for ONE piece
  qty: number;
  waitingDays: number;
  salesOrder: string;
  customer: string;
  scheduleNo: number | null; // "Planned Scheduled Number"
  plannedDate: string | null; // ISO yyyy-mm-dd
  ocd: string | null;
  dueDate: string | null; // earliest of planned date / ocd
  warehousePickDate: string | null;
  cuttingCount: number;
  finishedCount: number;
  boxRemaining: number;
  erpMachine: string | null;
  productionStatus: string | null;
  discontinuedReason: string | null;
  discontinuedText: string | null;
  blocked: boolean;
  blockedReason: string | null;
  /** Synthetic part created from a rework event; not part of the imported workload. */
  isRework?: boolean;
}

export interface PartSizes {
  small: boolean;
  big: boolean;
}

/** Which standard part names (and sizes) a machine may produce, on top of its material rules. */
export interface MachinePartTypes {
  /** off: every part type is accepted */
  restricted: boolean;
  allowed: Record<string, PartSizes>;
}

/** How big a part may be on a machine, per piece. Both limits are hard: a part outside them never goes there. */
export interface MachineSizeLimit {
  /** 'nc' = NC file minutes per piece; 'planned' = planned (real or estimated) minutes per piece */
  basis: 'nc' | 'planned';
  /** only parts of at least this many minutes (null = no lower limit) */
  min: number | null;
  /** only parts below this many minutes (null = no upper limit) */
  max: number | null;
}

export interface MachineConfig {
  id: Id;
  name: string;
  /** materials the machine always takes */
  allowedMaterials: string[];
  /** extra materials it takes only while `useBackupMaterials` is on (e.g. HAAS - 5 helping out with ALU) */
  backupMaterials?: string[];
  useBackupMaterials?: boolean;
  size?: MachineSizeLimit;
  /** Default efficiency of the machine in percent (100 = ideal feed). */
  speedPercentage: number;
  isDown?: boolean;
  description?: string;
  partTypes?: MachinePartTypes;
  /** @deprecated settings v3 and older; turned into `size` / `backupMaterials` when loaded */
  maxNcMinutes?: number | null;
  /** @deprecated settings v3 and older */
  minNcMinutesPref?: number | null;
  /** @deprecated settings v3 and older */
  overflowMaterials?: string[];
}

/**
 * A changeover happens only when the next part is of a different material family, or is much bigger (in time) than
 * the part before it. Anything else runs straight on.
 */
export interface ChangeoverRules {
  /** the next part is of a different material family */
  differentMaterialTypeMin: number;
  /** the next part takes at least `biggerPartRatio` times as long as the one before */
  biggerPartMin: number;
  biggerPartRatio: number;
}

/** A break the operators take every working day (lunch, coffee …), in wall-clock time. */
export interface OperatorBreak {
  id: string;
  label: string;
  /** "HH:MM" */
  start: string;
  minutes: number;
}

export interface CalendarSettings {
  /** First day of the plan, yyyy-mm-dd. */
  startDate: string;
  shiftsPerDay: number;
  hoursPerShift: number;
  shiftStartHour: number;
  /** hour of the first day at which the plan starts (before that the machines count as not available) */
  startHour: number;
  /** operators normally work Monday to Saturday */
  workSaturday: boolean;
  workSunday: boolean;
  continuous247: boolean;
  /** daily operator breaks */
  breaks: OperatorBreak[];
  /** 'stop': machines stand still during a break; 'run': a running part carries on, but nothing is started or changed over */
  breakMode: 'stop' | 'run';
}

export type PriorityRuleType =
  | 'sales_order'
  | 'schedule'
  | 'customer'
  | 'material_type'
  | 'waiting'
  | 'finish_master_order'
  | 'production_date';

export interface PriorityRule {
  id: Id;
  type: PriorityRuleType;
  level: number; // 1 = most important. Several rules may share a level.
  enabled: boolean;
  name: string;
  /** sales_order / customer / material_type / schedule(list) targets */
  values?: string[];
  scheduleMode?: 'single' | 'range';
  scheduleSingle?: number | null;
  scheduleMin?: number | null;
  scheduleMax?: number | null;
  direction?: 'lowest_first' | 'highest_first'; // waiting / finish module
  dateDirection?: 'closest_first' | 'furthest_first'; // production date
}

export type TimelineEventType =
  | 'breakdown'
  | 'rework'
  | 'absent'
  | 'maintenance'
  | 'material_shortage'
  | 'other';

export interface TimelineEvent {
  id: Id;
  machineId: Id | 'ALL';
  type: TimelineEventType;
  title: string;
  startMinute: number; // working-minute axis (0 = plan start)
  durationMinutes: number;
  boxCode?: string; // rework only: the box being produced again (optional)
  anchorJobId?: string; // rework only: the part it was dropped next to
  placement?: 'before' | 'after'; // rework only: which side of the anchor part
  note?: string;
}

/** How the planner searches: the optimizing engine, or the earlier fast heuristic only. */
export type PlanningMode = 'modules_first' | 'classic';
export type PlanningEffort = 'quick' | 'standard' | 'thorough';

export type CarpenterCutColumn = 'cutted_status' | 'carpenter_status' | 'either';
export type CarpenterDelayMode = 'off' | 'soft' | 'hard';

export interface CarpenterPart {
  masterOrder: string;
  workOrder?: string;
  text?: string;
  mText?: string;
  materialType?: string;
  qty: number;
  cuttedStatus: boolean;
  carpenterStatus: boolean;
  alertMessage?: string;
  customer?: string;
}

export interface CarpenterOpenPart {
  text?: string;
  mText?: string;
  materialType?: string;
  qty: number;
  alertMessage?: string;
}

export interface CarpenterMoInfo {
  masterOrder: string;
  totalParts: number;
  cutParts: number;
  openParts: number;
  openQty: number;
  hasOpenParts: boolean;
  hasMaterialAlert: boolean;
  status: 'all_cut' | 'has_open' | 'material_issue';
  openPartsList: CarpenterOpenPart[];
  customer?: string;
  simulated?: boolean;
}

export interface CalibrationRow {
  boxCode: string;
  machineId: string;
  materialType?: string;
  ncMinutes: number;
  actualMinutes: number;
}

export interface PlannerSettings {
  machines: MachineConfig[];
  changeover: ChangeoverRules;
  calendar: CalendarSettings;
  materialOffsets: Record<string, number>; // extra time in percent of the planned time
  priorityRules: PriorityRule[];
  outOfScopeMachines: string[];
  materialAliases: Record<string, string>; // e.g. "ALU B" -> "ALU"
  keepErpAssignments: boolean;
  excludeMasterOrders30000: boolean;
  /** @deprecated settings v3 and older (now per machine: `useBackupMaterials`) */
  allowHaas5Overflow?: boolean;
  syncToleranceMin: number;
  restartJobOnEvent: boolean;
  timelineEvents: TimelineEvent[];

  carpenterCutColumn: CarpenterCutColumn;
  carpenterDelayMode: CarpenterDelayMode;
  carpenterMaxDelayHours: number;
  simulatedUncutMasterOrders: string[];

  globalEfficiencyPercent: number;
  efficiencyMatrix: Record<string, Record<string, number>>; // machine -> material -> %
  efficiencyVariability: Record<string, Record<string, number>>; // +/- points
  materialEfficiency: Record<string, number>; // material -> %
  partEfficiencyOverrides: Record<string, number>; // job id -> %
  efficiencyMode: 'expected' | 'cautious';
  /** @deprecated settings v3 and older (now per machine: `size.basis`) */
  fanuc2UsesIdealMinutes?: boolean;
  calibrationHistory: CalibrationRow[];

  /** Parts found in the time list use that time as-is; efficiency and offsets never touch them. */
  useMeasuredTimes: boolean;
  /** Parts missing from the list are planned at NC minutes x this factor. */
  estimateMultiplier: number;

  /** modules_first searches for the plan that finishes master orders soonest; classic is the earlier heuristic. */
  planningMode: PlanningMode;
  /** how long the search may work: quick, standard or thorough */
  planningEffort: PlanningEffort;
  /** urgent orders (the big red button) */
  emergencies: EmergencyOrder[];
  /** start and finish the user gave to table and spare groups, by group key */
  partWindows: Record<string, PartWindow>;
  settingsVersion: number;
}

/** An urgent order: everything of this sales order (and schedule) is planned before anything else. */
export interface EmergencyOrder {
  id: Id;
  salesOrder: string;
  /** only the parts of this schedule number; null = every part of the sales order */
  schedule: number | null;
  /** off = only looked at (the analysis), on = in the plan */
  applied: boolean;
}

/** When a table or spare group should start and be finished: local date and time, "YYYY-MM-DDTHH:mm". */
export interface PartWindow {
  start: string;
  finish: string;
}

/** How a table or spare group ended up in the plan. */
export interface WindowReport {
  key: string;
  startMinute: number;
  finishMinute: number;
  startTime: string;
  finishTime: string;
  /** the finish time the user asked for, in plan minutes */
  wantedFinishMinute: number;
  /** how many minutes after the wanted finish it ends (0 = in time) */
  lateBy: number;
}

export interface UserLock {
  machine?: Id;
  durationMin?: number;
  startMinute?: number;
}

export interface Segment {
  startMinute: number;
  endMinute: number;
}

export interface ScheduledJob {
  job: Job;
  machineId: Id;
  sequence: number;
  setupBefore: number;
  startMinute: number;
  endMinute: number;
  durationMin: number;
  cautiousDurationMin: number;
  idealMinutes: number; // ncMinutes * qty
  efficiencyPercent: number;
  efficiencySource: 'part' | 'matrix' | 'material' | 'machine' | 'global' | 'manual' | 'measured';
  timeBasis: TimeBasis;
  /** minutes per piece from the parts list (measured jobs only) */
  measuredPerPart?: number;
  partName?: string;
  materialOffset: number;
  segments: Segment[];
  startTime: string; // ISO
  endTime: string; // ISO
  rank: number;
  decidingRule: string;
  isLate: boolean;
  closesBox: boolean;
  userLocked: boolean;
  erpLocked: boolean;
  manualDuration: boolean;
  manualStart: boolean;
  carpenterOpen: boolean;
  kind: PartKind;
  /** part of an applied emergency */
  emergency: boolean;
  /** table or spare group this part was planned with */
  windowGroup?: string;
}

export interface MoSync {
  masterOrder: string;
  customer: string;
  parts: number;
  firstFinish: number;
  lastFinish: number;
  spread: number;
  synchronized: boolean;
  machines: Id[];
  finishTime: string;
  carpenterBlocked: boolean;
}

export interface CarpenterReport {
  totalParts: number;
  uniqueMasterOrders: number;
  matchedMasterOrders: number;
  openMasterOrders: number;
}

export interface WaitingOnCarpenter {
  masterOrder: string;
  customer: string;
  boxCodes: string[];
  openParts: CarpenterOpenPart[];
  totalParts: number;
  openQty: number;
  lastFinishMinute: number;
  lastFinishTime: string;
  hasAlert: boolean;
}

export interface Bottleneck {
  machineId: Id;
  loadMinutes: number;
  loadPercent: number;
  severity: 'warning' | 'critical';
  message: string;
}

export interface PlanKpis {
  plannedJobs: number;
  measuredJobs: number;
  estimatedJobs: number;
  plannedHours: number;
  changeoverMinutes: number;
  setupSavedMinutes: number;
  overdueJobs: number;
  boxesClosedFirstShift: number;
  synchronizedMos: number;
  totalMos: number;
  makespanMinutes: number;
  cautiousMakespanMinutes: number;
  sumMoCompletion: number;
  avgMoCompletion: number;
  waitingOnCarpenter: number;
  finishPerMachine: Record<Id, number>;
  loadPerMachine: Record<Id, { jobs: number; machineMinutes: number; setupMinutes: number }>;
  utilizationPerMachine: Record<Id, number>;
  bottlenecks: Bottleneck[];
}

/** What the optimizer did to the plan, so the app can show the gain over the earlier heuristic. */
export interface OptimizationInfo {
  effort: PlanningEffort;
  /** the same plan without the search: sum of master order completion, last machine finish, changeover */
  classicSumMo: number;
  classicMakespan: number;
  classicChangeover: number;
  /** master orders finished by the end of working day 1, 2 and 3: [classic plan, optimized plan] */
  doneByDay: Array<[number, number]>;
}

export interface PlanResult {
  generatedAt: string;
  optimization?: OptimizationInfo;
  queues: Record<Id, ScheduledJob[]>;
  moSync: Record<string, MoSync>;
  carpenter: Record<string, CarpenterMoInfo>;
  carpenterReport: CarpenterReport | null;
  waitingOnCarpenter: WaitingOnCarpenter[];
  exceptions: {
    blocked: Job[];
    noEligibleMachine: Job[];
    outOfScope: Job[];
    manual30000: Job[];
    unpickedWarehouse: Job[];
    /** the ERP put the part on a machine whose rules refuse it: planned on a machine that takes it instead */
    erpRefused: Job[];
  };
  /** why a machine refused a part (ERP machine refused, or no machine takes it), by job id */
  refusals: Record<string, string>;
  kpis: PlanKpis;
  /** per table / spare group that was given a start and a finish */
  windowReport: Record<string, WindowReport>;
  summary: string;
}

export interface ImportReport {
  fileName?: string;
  totalRows: number;
  uniqueOrders: number;
  uniqueMasterOrders: number;
  uniqueMatnr: number;
  assignedInErp: number;
  unassigned: number;
  unassignedMinutes: number;
  erpLoads: Record<string, { count: number; minutes: number }>;
  materialCounts: Record<string, number>;
  warnings: string[];
}
