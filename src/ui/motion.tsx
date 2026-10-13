import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type Ref,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';

/* Motion helpers shared by the views. The numbers mirror the CSS tokens in index.css (element.animate cannot read
   var(--…) easings, so they are repeated here). Every element.animate call goes through animate(), which respects
   prefers-reduced-motion. */

export const DUR = { 1: 120, 2: 180, 3: 240, 4: 320, num: 600 } as const;
export const EASE_OUT = 'cubic-bezier(0.22, 1, 0.36, 1)';
export const EASE_IN = 'cubic-bezier(0.4, 0, 1, 1)';
export const EASE_IN_OUT = 'cubic-bezier(0.65, 0, 0.35, 1)';

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}

/** element.animate with no fill (nothing is left behind once it ends); does nothing under reduced motion. */
export function animate(el: Element | null | undefined, keyframes: Keyframe[], options: KeyframeAnimationOptions): Animation | null {
  if (!el || prefersReducedMotion() || typeof (el as HTMLElement).animate !== 'function') return null;
  return el.animate(keyframes, options);
}

/** True for `ms` after mount (and again after `key` changes): lets a stagger play once, not on every re-show. */
export function useIntro(ms: number, key?: unknown): boolean {
  const [state, setState] = useState({ key, on: true });
  if (state.key !== key) setState({ key, on: true });
  useEffect(() => {
    if (!state.on) return;
    const t = window.setTimeout(() => setState(s => (s.on ? { ...s, on: false } : s)), ms);
    return () => window.clearTimeout(t);
  }, [state, ms]);
  return state.on || state.key !== key;
}

/** Plays an enter animation once per component instance (a view shown again by <Activity> does not replay it). */
export function useEnterOnce<T extends HTMLElement>(keyframes: Keyframe[] = [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], duration: number = DUR[3]) {
  const ref = useRef<T>(null);
  const played = useRef(false);
  useLayoutEffect(() => {
    if (played.current) return;
    played.current = true;
    animate(ref.current, keyframes, { duration, easing: EASE_OUT });
  }, []);
  return ref;
}

/**
 * A <style> element in <head> whose text is set without rendering anything: hover highlights over hundreds of boxes
 * become one CSS rule instead of a React re-render per mouse move.
 */
export function useDynamicStyle(): (css: string) => void {
  const el = useRef<HTMLStyleElement | null>(null);
  const last = useRef('');
  useEffect(() => {
    const s = document.createElement('style');
    s.textContent = last.current;
    document.head.appendChild(s);
    el.current = s;
    return () => {
      s.remove();
      el.current = null;
    };
  }, []);
  return useCallback((css: string) => {
    if (css === last.current) return;
    last.current = css;
    if (el.current) el.current.textContent = css;
  }, []);
}

/* ------------------------------------------------------------ sliding pill */

export interface PillRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Measures the active item of a group so one absolutely positioned highlight can slide between items (transform +
 * width, never left/top). Skips measuring while the group is hidden (inside a hidden <Activity>), so the pill does
 * not fly in from the corner when the view is shown again.
 */
export function usePill<K extends string>(active: K, deps: unknown[] = []) {
  const container = useRef<HTMLElement | null>(null);
  const items = useRef<Partial<Record<K, HTMLElement | null>>>({});
  const [pill, setPill] = useState<PillRect | null>(null);
  const measure = useCallback(() => {
    const b = items.current[active];
    if (!b || !b.offsetParent || b.offsetWidth === 0) return;
    const next = { left: b.offsetLeft, top: b.offsetTop, width: b.offsetWidth, height: b.offsetHeight };
    setPill(p => (p && p.left === next.left && p.top === next.top && p.width === next.width && p.height === next.height ? p : next));
  }, [active]);
  useLayoutEffect(measure, [measure, ...deps]);
  useEffect(() => {
    const ro = new ResizeObserver(() => measure());
    if (container.current) ro.observe(container.current);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [measure]);
  const setItem = useCallback((k: K) => (el: HTMLElement | null) => {
    items.current[k] = el;
  }, []);
  return { container, setItem, pill };
}

export function PillBg({ pill, className = '' }: { pill: PillRect | null; className?: string }) {
  if (!pill) return null;
  return (
    <span
      aria-hidden
      data-pill
      className={`pointer-events-none absolute left-0 top-0 ${className}`}
      style={{
        width: pill.width,
        height: pill.height,
        transform: `translate3d(${pill.left}px, ${pill.top}px, 0)`,
        transition: 'transform var(--dur-4) var(--ease-in-out), width var(--dur-4) var(--ease-in-out)',
      }}
    />
  );
}

/* ---------------------------------------------------------------- collapse */

/**
 * Height-animated section (grid-template-rows 0fr ↔ 1fr). Children stay mounted while it closes and unmount after;
 * overflow is only clipped while moving, so focus rings and popovers inside an open section are not cut off.
 */
export function Collapse({ open, children, className = '' }: { open: boolean; children: ReactNode; className?: string }) {
  const [mounted, setMounted] = useState(open);
  const [moving, setMoving] = useState(false);
  const prevOpen = useRef(open);
  useLayoutEffect(() => {
    if (prevOpen.current === open) return;
    prevOpen.current = open;
    if (open) setMounted(true);
    setMoving(true);
  }, [open]);
  // safety net: transitionend does not fire when the element is hidden
  useEffect(() => {
    if (!moving) return;
    const t = window.setTimeout(() => {
      setMoving(false);
      if (!open) setMounted(false);
    }, DUR[3] + 120);
    return () => window.clearTimeout(t);
  }, [moving, open]);
  return (
    <div
      className={`grid ${className}`}
      style={{ gridTemplateRows: open ? '1fr' : '0fr', transition: 'grid-template-rows var(--dur-3) var(--ease-out)' }}
      onTransitionEnd={e => {
        if (e.target !== e.currentTarget || e.propertyName !== 'grid-template-rows') return;
        setMoving(false);
        if (!open) setMounted(false);
      }}
    >
      <div className="min-h-0" style={{ overflow: open && !moving ? 'visible' : 'hidden' }} aria-hidden={!open || undefined}>
        {(open || mounted) && children}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ floating tip */

export interface TipApi<T> {
  show(item: T, x: number, y: number): void;
  move(x: number, y: number): void;
  /** hides after a short delay, so moving between neighbouring items does not blink */
  hide(delay?: number): void;
}

/**
 * Pointer tooltip rendered into <body>: always mounted, positioned with a transform (no layout, no layout shifts),
 * shown and hidden with an opacity transition. Only a change of the hovered item re-renders it.
 */
export function FloatingTip<T>({ api, width = 288, render }: { api: Ref<TipApi<T>>; width?: number; render: (item: T) => ReactNode }) {
  const [item, setItem] = useState<T | null>(null);
  const [visible, setVisible] = useState(false);
  const el = useRef<HTMLDivElement>(null);
  const pos = useRef({ x: 0, y: 0 });
  const hideTimer = useRef(0);
  const place = useCallback(() => {
    const n = el.current;
    if (!n) return;
    const { x, y } = pos.current;
    const w = n.offsetWidth || width;
    const h = n.offsetHeight;
    const left = x + 14 + w > window.innerWidth - 8 ? Math.max(8, x - 14 - w) : x + 14;
    const top = Math.max(8, Math.min(y + 14, window.innerHeight - h - 8));
    n.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
  }, [width]);
  useImperativeHandle(
    api,
    () => ({
      show(next, x, y) {
        window.clearTimeout(hideTimer.current);
        pos.current = { x, y };
        setItem(() => next);
        setVisible(true);
        place();
      },
      move(x, y) {
        pos.current = { x, y };
        place();
      },
      hide(delay = 80) {
        window.clearTimeout(hideTimer.current);
        hideTimer.current = window.setTimeout(() => setVisible(false), delay);
      },
    }),
    [place],
  );
  useLayoutEffect(place, [item, place]);
  // hidden with its view (or unmounted): never leave a tooltip floating
  useLayoutEffect(
    () => () => {
      window.clearTimeout(hideTimer.current);
      setVisible(false);
    },
    [],
  );
  return createPortal(
    <div
      ref={el}
      data-tip
      aria-hidden
      className="pointer-events-none fixed left-0 top-0 z-[70] rounded-lg border border-slate-600 bg-slate-900/[0.97] p-3 text-xs shadow-2xl"
      style={{ width, opacity: visible ? 1 : 0, transition: 'opacity var(--dur-2) var(--ease-out)', willChange: 'transform, opacity' }}
    >
      {item !== null && render(item)}
    </div>,
    document.body,
  );
}

/** Stable function identity that always calls the latest version (for memoised children). */
export function useLatest<T>(value: T): RefObject<T> {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}
