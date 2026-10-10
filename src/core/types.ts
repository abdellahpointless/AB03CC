/** Domain types shared by the parsers, the scheduler (worker) and the UI. */

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

export interface MachineConfig {
  id: Id;
  name: string;
  allowedMaterials: string[];
  /** Only accepts parts whose ideal NC minutes per piece are below this value. */
  maxNcMinutes?: number | null;
  /** Preference only: jobs at or above this length are favoured on this machine. */
  minNcMinutesPref?: number | null;
  /** Default efficiency of the machine in percent (100 = ideal feed). */
  speedPercentage: number;
  /** Extra materials accepted when "overflow" is enabled in settings. */
  overflowMaterials?: string[];
  isDown?: boolean;
  description?: string;
}

export interface ChangeoverRules {
  sameMatnrMin: number;
  sameMaterialNoMin: number;
  sameMaterialTypeMin: number;
  differentMaterialTypeMin: number;
}

export interface CalendarSettings {
  /** First day of the plan, yyyy-mm-dd. */
  startDate: string;
  shiftsPerDay: number;
  hoursPerShift: number;
  shiftStartHour: number;
  weekendOff: boolean;
  continuous247: boolean;
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
  materialOffsets: Record<string, number>; // extra minutes per piece
  priorityRules: PriorityRule[];
  outOfScopeMachines: string[];
  materialAliases: Record<string, string>; // e.g. "ALU B" -> "ALU"
  keepErpAssignments: boolean;
  excludeMasterOrders30000: boolean;
  allowHaas5Overflow: boolean;
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
  fanuc2UsesIdealMinutes: boolean;
  calibrationHistory: CalibrationRow[];

  /** Parts found in the time list use that time as-is; efficiency and offsets never touch them. */
  useMeasuredTimes: boolean;
  /** Parts missing from the list are planned at NC minutes x this factor. */
  estimateMultiplier: number;

  /** modules_first searches for the plan that finishes master orders soonest; classic is the earlier heuristic. */
  planningMode: PlanningMode;
  /** how long the search may work: quick, standard or thorough */
  planningEffort: PlanningEffort;
  settingsVersion: number;
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
  };
  kpis: PlanKpis;
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
