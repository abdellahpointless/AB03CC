import { useEffect, useRef, useState } from 'react';
import { DUR, prefersReducedMotion } from './motion';

/** Last value shown per `id`, so a KPI that mounts again continues from where it was instead of counting up from 0. */
const lastShown = new Map<string, number>();

/**
 * Number that eases from its previous value to the new one (counts up from 0 on first show). Its width is reserved
 * for the widest value of the tween, so the text around it never moves while it counts.
 */
export function CountUp({
  value,
  id,
  decimals = 0,
  duration = DUR.num,
  prefix = '',
  suffix = '',
  className = '',
}: {
  value: number;
  /** remembers the last shown value across mounts */
  id?: string;
  decimals?: number;
  duration?: number;
  prefix?: string;
  suffix?: string;
  className?: string;
}) {
  const initial = () => (prefersReducedMotion() ? value : id !== undefined ? (lastShown.get(id) ?? 0) : 0);
  const [shown, setShown] = useState(initial);
  const [tweenFrom, setTweenFrom] = useState<number | null>(null);
  const from = useRef(shown);

  useEffect(() => {
    const remember = (v: number) => {
      from.current = v;
      if (id !== undefined) lastShown.set(id, v);
    };
    // nothing to do (also the case when a hidden view is shown again)
    if (from.current === value) {
      setShown(value);
      setTweenFrom(null);
      remember(value);
      return;
    }
    if (prefersReducedMotion()) {
      remember(value);
      setShown(value);
      setTweenFrom(null);
      return;
    }
    const startValue = from.current;
    setTweenFrom(startValue);
    // the start time comes from the first frame: a timestamp taken here can be later than the frame's, which made
    // the progress negative and the eased value overshoot below the start (KPIs flashed "-5,615m")
    let start = -1;
    let raf = 0;
    const tick = (now: number) => {
      if (start < 0) start = now;
      const p = Math.min(1, Math.max(0, (now - start) / duration));
      const eased = 1 - Math.pow(1 - p, 3);
      const v = p >= 1 ? value : startValue + (value - startValue) * eased;
      remember(v);
      setShown(v);
      if (p < 1) raf = requestAnimationFrame(tick);
      else setTweenFrom(null);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration, id]);

  const fmt = (n: number) => `${prefix}${n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}${suffix}`;
  return (
    <span className={`inline-grid tabular-nums ${className}`}>
      <span aria-hidden className="invisible [grid-area:1/1]">
        {fmt(value)}
      </span>
      {tweenFrom !== null && (
        <span aria-hidden className="invisible [grid-area:1/1]">
          {fmt(tweenFrom)}
        </span>
      )}
      <span className="[grid-area:1/1]">{fmt(shown)}</span>
    </span>
  );
}
