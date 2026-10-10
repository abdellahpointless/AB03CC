import type { CalendarSettings } from './types';

const pad = (n: number) => String(n).padStart(2, '0');

/** Local wall-clock string "YYYY-MM-DDTHH:mm" (no timezone suffix on purpose). */
export function toLocalIso(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function parseLocalDate(iso: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(iso);
  if (!m) return new Date(NaN);
  return new Date(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0, 0, 0);
}

export function minutesPerDay(cal: CalendarSettings): number {
  return cal.continuous247 ? 1440 : Math.max(1, Math.round(cal.shiftsPerDay * cal.hoursPerShift * 60));
}

/**
 * Minutes of the first day that pass before the plan starts: the axis begins at the shift start, and the hours up to
 * `startHour` are treated as time in which no machine works.
 */
export function planStartOffset(cal: CalendarSettings): number {
  const off = Math.round((cal.startHour - cal.shiftStartHour) * 60);
  return Math.min(Math.max(0, off), minutesPerDay(cal) - 1);
}

/**
 * Maps the continuous "working minute" axis used by the scheduler to wall-clock
 * time, skipping weekends when the calendar says so.
 */
export class WorkCalendar {
  readonly dayLen: number;
  private readonly start: Date;
  private readonly days: Date[] = [];

  constructor(private readonly cal: CalendarSettings) {
    this.dayLen = minutesPerDay(cal);
    const s = parseLocalDate(cal.startDate);
    this.start = isNaN(s.getTime()) ? new Date() : s;
    this.start.setHours(0, 0, 0, 0);
    this.days.push(this.firstWorkingDay());
  }

  private isOff(d: Date) {
    if (this.cal.continuous247) return false;
    const dow = d.getDay();
    return (dow === 6 && !this.cal.workSaturday) || (dow === 0 && !this.cal.workSunday);
  }

  private firstWorkingDay(): Date {
    const d = new Date(this.start);
    while (this.isOff(d)) d.setDate(d.getDate() + 1);
    return d;
  }

  /** Calendar date (midnight) of the n-th working day. */
  dayDate(index: number): Date {
    while (this.days.length <= index) {
      const d = new Date(this.days[this.days.length - 1]);
      do {
        d.setDate(d.getDate() + 1);
      } while (this.isOff(d));
      this.days.push(d);
    }
    return this.days[index];
  }

  private dayStart(index: number): Date {
    const d = new Date(this.dayDate(index));
    d.setHours(this.cal.shiftStartHour, 0, 0, 0);
    return d;
  }

  /** Wall-clock time of a working minute. `asEnd` keeps a job ending exactly at shift end on the same day. */
  toDate(minute: number, asEnd = false): Date {
    const m = Math.max(0, minute);
    let day = Math.floor(m / this.dayLen);
    let within = m - day * this.dayLen;
    if (asEnd && within === 0 && day > 0) {
      day -= 1;
      within = this.dayLen;
    }
    return new Date(this.dayStart(day).getTime() + within * 60000);
  }

  toIso(minute: number, asEnd = false): string {
    return toLocalIso(this.toDate(minute, asEnd));
  }

  /** Plan minute of a local date and time "YYYY-MM-DDTHH:mm" (see fromDate). */
  fromIso(iso: string): number {
    return this.fromDate(parseLocalDate(iso));
  }

  /** Inverse mapping used for the "now" marker; clamps into the plan axis. */
  fromDate(date: Date): number {
    for (let i = 0; i < 400; i++) {
      const nextStart = this.dayStart(i + 1).getTime();
      if (date.getTime() < nextStart || i === 399) {
        const diff = (date.getTime() - this.dayStart(i).getTime()) / 60000;
        if (diff < 0) return i * this.dayLen;
        return i * this.dayLen + Math.min(diff, this.dayLen);
      }
    }
    return 0;
  }
}

export function formatClock(iso: string | undefined): string {
  return iso ? iso.slice(11, 16) : '';
}

export function formatDayMonth(iso: string | undefined): string {
  return iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '';
}

export function formatDuration(min: number): string {
  const m = Math.round(min);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}h ${pad(r)}m` : `${h}h`;
}
