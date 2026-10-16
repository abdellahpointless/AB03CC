import type { CarpenterPart, Job } from './types';

/** Small deterministic demo dataset so the app can be tried without any spreadsheet. */
export function demoJobs(): Job[] {
  let seed = 7;
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
  const customers = ['Atlas Harness Works', 'Nordline Cable Systems', 'Meridian Automotive', 'Orion Wiring', 'Sahara Connect'];
  const materials = ['ALU', 'ALU', 'ALU', 'POM', 'POM', 'FH', 'PCGF', 'MS', 'PEEK'];
  const machinesInErp = ['FANUC - 1', 'HAAS - 2', 'HAAS - 5', 'MASTER'];
  const base = new Date();
  const iso = (offsetDays: number) => {
    const d = new Date(base);
    d.setDate(d.getDate() + offsetDays);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const jobs: Job[] = [];
  let order = 100000;
  for (let m = 0; m < 40; m++) {
    const masterOrder = String(m < 4 ? 300000000 + m * 17 : 100003000000 + m * 31);
    const parts = 1 + Math.floor(rnd() * 8);
    const customer = pick(customers);
    const sales = String(14100000 + Math.floor(rnd() * 20)).padStart(10, '0');
    const due = iso(Math.floor(rnd() * 8));
    for (let p = 0; p < parts; p++) {
      order++;
      const materialType = pick(materials);
      const matnr = String(200100000 + Math.floor(rnd() * 60));
      const cutting = parts + Math.floor(rnd() * 3);
      const finished = Math.floor(rnd() * (cutting - 1));
      const erp = rnd() < 0.06 ? pick(machinesInErp) : null;
      jobs.push({
        id: String(order),
        boxCode: String(Math.floor(rnd() * 9000) + 100).padStart(4, '0'),
        masterOrder,
        orderNumber: String(order),
        matnr,
        materialNo: String(100000 + Math.floor(rnd() * 12)),
        materialType,
        ncMinutes: [5, 8, 12, 15, 20, 29, 34, 45, 60][Math.floor(rnd() * 9)],
        qty: rnd() < 0.85 ? 1 : 2 + Math.floor(rnd() * 3),
        waitingDays: Math.floor(rnd() * 14),
        salesOrder: sales,
        customer,
        scheduleNo: pick([0, 1, 50, 75, 75, 100]),
        plannedDate: due,
        ocd: iso(Math.floor(rnd() * 14)),
        dueDate: due,
        warehousePickDate: rnd() < 0.9 ? iso(-2) : null,
        cuttingCount: cutting,
        finishedCount: finished,
        boxRemaining: cutting - finished,
        erpMachine: erp,
        productionStatus: null,
        discontinuedReason: null,
        discontinuedText: null,
        blocked: false,
        blockedReason: null,
      });
    }
  }
  return jobs;
}

export function demoCarpenterParts(jobs: Job[]): CarpenterPart[] {
  const mos = [...new Set(jobs.map(j => j.masterOrder))].filter(m => !m.startsWith('30000'));
  const parts: CarpenterPart[] = [];
  mos.slice(0, 20).forEach((mo, i) => {
    const total = 2 + (i % 3);
    for (let p = 0; p < total; p++) {
      const open = i % 5 === 0 && p === 0;
      // a part leaves the carpenter list when it reaches the CNC: only the open ones are listed
      if (!open) continue;
      parts.push({
        masterOrder: mo,
        text: `Wood part ${p + 1}`,
        mText: 'MDF 18mm',
        materialType: 'WOOD',
        qty: 1,
        cuttedStatus: !open,
        carpenterStatus: false,
        alertMessage: open && i % 10 === 0 ? 'Material not available in stock - change it' : undefined,
      });
    }
  });
  return parts;
}

/**
 * A carpenter list like the real export (Measure, Description De, files, quantities) for the demo build: boxes not cut
 * yet, some of them belonging to sales orders already in the workload.
 */
export function demoCarpenterList(jobs: Job[]): CarpenterPart[] {
  let seed = 11;
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
  const stock: Array<[string, string, string, number]> = [
    ['FH', '103314', 'FH8221 40x1000x1000mm', 40],
    ['FH', '103313', 'FH8221 30x1000x1000mm', 30],
    ['POM', '108001', 'POM TECAFORM 30x610x1000 Black', 30],
    ['POM', '114926', 'POM TECAFORM 20x610x1000 Black', 20],
    ['ALU', '103392', 'Alu 750x1000x20mm', 20],
    ['ALU', '103397', 'Alu 1000x500x30mm', 30],
    ['PCGF', '115022', 'BM PCGF30 1000x500x20', 20],
    ['MS', '120437', 'Brass 20x10', 10],
  ];
  const names: Record<string, string[]> = {
    FH: ['TOP PLATE', 'GROUND PLATE', 'TEST PIN PLATE'],
    POM: ['CONTACT PIN PLATE', 'SUB PLATE', 'COVER'],
    ALU: ['CONTOUR INSERT', 'HOLDING PLATE', 'TEST BRACKET'],
    PCGF: ['TEST PIN INSERT', 'CONTOUR PIECE'],
    MS: ['ANGLE BRACKET'],
  };
  const sales = [...new Set(jobs.map(j => j.salesOrder))];
  const parts: CarpenterPart[] = [];
  let wo = 100003600000;
  for (let b = 0; b < 26; b++) {
    const mo = String(100003700000 + b * 13);
    const salesOrder = b < 8 ? sales[b % sales.length] : String(14102000 + b).padStart(10, '0');
    const schedule = pick([0, 75, 75, 85, 100]);
    const day = new Date();
    day.setDate(day.getDate() + 2 + Math.floor(rnd() * 10));
    const productionDate = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
    const n = 2 + Math.floor(rnd() * 6);
    for (let p = 0; p < n; p++) {
      const [mat, id, text, z] = pick(stock);
      const name = pick(names[mat]);
      const matnr = String(200150000 + Math.floor(rnd() * 400));
      const w = [12, 15, 20, 24, 30, 50, 100][Math.floor(rnd() * 7)];
      const l = [18, 22, 30, 35, 45, 64, 100, 150][Math.floor(rnd() * 8)];
      const hasNc = rnd() > 0.06;
      parts.push({
        masterOrder: mo,
        workOrder: String(++wo),
        salesOrder,
        schedule,
        materialNr: matnr,
        modulNo: '999' + String(100000 + b),
        measure: `${name} ${mat === 'MS' ? 'M' : mat}/${matnr}/CUT:${w}X${l}X${z}`,
        descriptionDe: `${id} - ${text}`,
        partName: name.charAt(0) + name.slice(1).toLowerCase(),
        moduleName: `Test module ${String.fromCharCode(65 + (b % 6))}-${b + 1}`,
        text: name.charAt(0) + name.slice(1).toLowerCase(),
        materialType: mat,
        qty: rnd() < 0.8 ? 1 : 2 + Math.floor(rnd() * 3),
        cuttedStatus: false,
        carpenterStatus: false,
        hasPdf: rnd() > 0.04,
        hasNc,
        productionDate,
        customer: 'Demo customer',
      });
    }
  }
  return parts;
}
