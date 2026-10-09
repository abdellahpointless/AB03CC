import type { CarpenterPart, Job } from './types';

/** Small deterministic demo dataset so the app can be tried without any spreadsheet. */
export function demoJobs(): Job[] {
  let seed = 7;
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
  const customers = ['Aptiv Connection Systems', 'Lear Automotive Morocco', 'Komax Testing Marocco', 'Leoni Wiring Systems', 'SE Bordnetze Morocco'];
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
