import { describe, expect, it } from 'vitest';
import { demoJobs } from './demo';
import { defaultSettings } from './defaults';
import { partKey } from './parse/partTimes';
import { partTypeFromEntry, standardPartName } from './partTypes';
import { isEligible, planProduction } from './scheduler/plan';
import { SimContext } from './scheduler/simulate';

describe('standard part names', () => {
  it('drops numbering and drawing codes but keeps real words', () => {
    expect(standardPartName('Contact pin plate 001')).toBe('contact pin plate');
    expect(standardPartName('Switch pin plate V4')).toBe('switch pin plate');
    expect(standardPartName('Contour insert 2 100300659800')).toBe('contour insert');
    expect(standardPartName('Contact pin plate           100401187900')).toBe('contact pin plate');
    expect(standardPartName('Seal cage')).toBe('seal cage');
    expect(standardPartName('Sub plate toul for dichmate')).toBe('sub plate toul for dichmate');
    expect(standardPartName('Top plate rev A')).toBe('top plate');
  });

  it('calls a part small under 15 minutes and big from 15', () => {
    expect(partTypeFromEntry({ name: 'Seal cage 7', minutes: 14.9 })).toEqual({ key: 'seal cage', size: 'small' });
    expect(partTypeFromEntry({ name: 'Seal cage 7', minutes: 15 })).toEqual({ key: 'seal cage', size: 'big' });
    expect(partTypeFromEntry(undefined)).toBeNull();
  });
});

describe('machines limited to part types', () => {
  const jobs = demoJobs();
  const job = jobs[0];
  const key = partKey(job.matnr);
  const settings = () => {
    const s = defaultSettings();
    s.calendar.startDate = '2026-10-09';
    s.planningEffort = 'quick';
    return s;
  };

  it('only takes ticked types and sizes, and ignores parts that are not in the list', () => {
    const s = settings();
    const machine = s.machines.find(m => m.allowedMaterials.includes(job.materialType))!;
    const plain = new SimContext(s, s.machines, {});
    expect(isEligible(job, machine, s, plain)).toBe(true);
    machine.partTypes = { restricted: true, allowed: { 'seal cage': { small: true, big: false } } };
    const small = new SimContext(s, s.machines, { [key]: { minutes: 5, name: 'Seal cage 001' } });
    const big = new SimContext(s, s.machines, { [key]: { minutes: 30, name: 'Seal cage 001' } });
    const other = new SimContext(s, s.machines, { [key]: { minutes: 5, name: 'Top plate 2' } });
    expect(isEligible(job, machine, s, small)).toBe(true);
    expect(isEligible(job, machine, s, big)).toBe(false);
    expect(isEligible(job, machine, s, other)).toBe(false);
    expect(isEligible(job, machine, s, plain)).toBe(true); // not in the list: materials only
    machine.partTypes.restricted = false;
    expect(isEligible(job, machine, s, big)).toBe(true);
  });

  it('keeps such parts off the limited machine in a real plan', () => {
    const s = settings();
    const times = Object.fromEntries(jobs.map(j => [partKey(j.matnr), { minutes: 40, name: 'Top plate 1' }]));
    const target = s.machines.find(m => m.allowedMaterials.includes('ALU'))!;
    target.partTypes = { restricted: true, allowed: { 'top plate': { small: true, big: false } } };
    const p = planProduction(jobs, s, {}, [], times);
    for (const it of p.queues[target.id] ?? []) expect(it.erpLocked || it.userLocked).toBe(true); // every part here is a big top plate
  });
});
