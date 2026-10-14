import { X } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { materialBadgeStyle } from '../lib/colors';
import { DUR, PillBg, prefersReducedMotion, usePill } from './motion';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'amber';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-blue-600 hover:bg-blue-500 text-white border-blue-500',
  secondary: 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700',
  ghost: 'bg-transparent hover:bg-slate-800 text-slate-300 border-transparent',
  danger: 'bg-rose-950/60 hover:bg-rose-900/70 text-rose-200 border-rose-800',
  amber: 'bg-amber-600 hover:bg-amber-500 text-white border-amber-500',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' }) {
  return (
    <button
      {...rest}
      className={`inline-flex items-center justify-center gap-1.5 rounded-md border font-semibold whitespace-nowrap transition-[background-color,border-color,color,box-shadow,opacity,scale] duration-(--dur-1) ease-(--ease-out) active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100 ${
        size === 'sm' ? 'px-2 py-1 text-[11px]' : 'px-3 py-1.5 text-xs'
      } ${VARIANTS[variant]} ${variant === 'primary' ? 'btn-glow-primary' : ''} ${className}`}
    />
  );
}

/** Closes the surrounding Modal with its exit animation (for buttons rendered inside it). */
const ModalCtx = createContext<() => void>(() => {});
export const useModalClose = () => useContext(ModalCtx);

type Slot = ReactNode | ((close: () => void) => ReactNode);

/**
 * Dialog anchored near the top (growing content extends downwards instead of re-centring). Escape, a backdrop click,
 * the × button and close() from useModalClose / a render-function child all play the exit animation, then onClose.
 */
export function Modal({
  title,
  subtitle,
  onClose,
  children,
  footer,
  width = 'max-w-2xl',
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  children: Slot;
  footer?: Slot;
  width?: string;
}) {
  const [closing, setClosing] = useState(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const done = useRef(false);
  const finish = useCallback(() => {
    if (done.current) return;
    done.current = true;
    onCloseRef.current();
  }, []);
  const close = useCallback(() => {
    if (prefersReducedMotion()) finish();
    else setClosing(true);
  }, [finish]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);
  // safety net if animationend never arrives (hidden tab, animations off)
  useEffect(() => {
    if (!closing) return;
    const t = window.setTimeout(finish, DUR[2] + 120);
    return () => window.clearTimeout(t);
  }, [closing, finish]);
  const slot = (x: Slot | undefined) => (typeof x === 'function' ? x(close) : x);
  return (
    <ModalCtx.Provider value={close}>
      <div
        className={`no-print fixed inset-0 z-50 flex items-start justify-center bg-slate-950/75 p-4 pt-[8vh] ${closing ? 'pointer-events-none anim-fade-out' : 'anim-fade-in'}`}
        onMouseDown={e => e.target === e.currentTarget && close()}
        onAnimationEnd={e => closing && e.target === e.currentTarget && finish()}
      >
        <div
          role="dialog"
          aria-modal="true"
          className={`${closing ? 'anim-scale-out' : 'anim-scale-in'} flex max-h-[84vh] w-full ${width} flex-col overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-2xl`}
        >
          <div className="flex items-start justify-between gap-4 border-b border-slate-800 px-5 py-3">
            <div>
              <h2 className="text-sm font-bold text-white">{title}</h2>
              {subtitle && <p className="mt-0.5 text-xs text-slate-400">{subtitle}</p>}
            </div>
            <button onClick={close} className="rounded p-1 text-slate-400 transition-colors duration-(--dur-1) hover:bg-slate-800 hover:text-white" aria-label="Close">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="overflow-y-auto px-5 py-4">{slot(children)}</div>
          {footer && <div className="flex items-center justify-end gap-2 border-t border-slate-800 bg-slate-900/80 px-5 py-3">{slot(footer)}</div>}
        </div>
      </div>
    </ModalCtx.Provider>
  );
}

export function Badge({ children, className = '', style }: { children: ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <span style={style} className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-bold leading-none ${className}`}>
      {children}
    </span>
  );
}

export function MaterialBadge({ material }: { material: string }) {
  return <Badge style={materialBadgeStyle(material)}>{material}</Badge>;
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-800 bg-slate-950/50 p-3 hover:border-slate-700">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 accent-blue-500" />
      <span className="text-xs">
        <span className="block font-semibold text-slate-100">{label}</span>
        {hint && <span className="mt-0.5 block text-[11px] leading-snug text-slate-400">{hint}</span>}
      </span>
    </label>
  );
}

export function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block text-xs">
      <span className="mb-1 block font-semibold text-slate-300">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-slate-500">{hint}</span>}
    </label>
  );
}

export const inputCls =
  'w-full rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-100 outline-none focus:border-blue-500 disabled:opacity-50';

export function NumberInput({
  value,
  onChange,
  min,
  max,
  step,
  className = '',
  placeholder,
  disabled,
}: {
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  min?: number;
  max?: number;
  step?: number;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  // Keep the raw text while the field has focus so clearing/retyping a number never snaps back.
  const [text, setText] = useState(value === undefined ? '' : String(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(value === undefined ? '' : String(value));
  }, [value]);
  return (
    <input
      type="number"
      className={`${inputCls} ${className}`}
      value={text}
      min={min}
      max={max}
      step={step}
      placeholder={placeholder}
      disabled={disabled}
      onFocus={() => (focused.current = true)}
      onBlur={() => {
        focused.current = false;
        setText(value === undefined ? '' : String(value));
      }}
      onChange={e => {
        setText(e.target.value);
        const n = e.target.value === '' ? undefined : Number(e.target.value);
        if (n === undefined || Number.isFinite(n)) onChange(n);
      }}
    />
  );
}

/**
 * Subtle marker for where a planned time comes from: filled dot = measured (found in the parts list),
 * hollow ring = estimated (NC x multiplier). Manual times get no marker.
 */
export function TimeMark({ basis, title, className = '' }: { basis: 'measured' | 'estimated' | 'manual'; title?: string; className?: string }) {
  if (basis === 'manual') return null;
  return (
    <span title={title} className={`inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center align-middle ${className}`}>
      <span className={`block h-[6px] w-[6px] rounded-full opacity-60 ${basis === 'measured' ? 'bg-current' : 'border border-current'}`} />
    </span>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ value: T; label: ReactNode }>;
  onChange: (v: T) => void;
}) {
  // the active background slides between options instead of snapping
  const { container, setItem, pill } = usePill<T>(value, [options.length]);
  return (
    <div ref={el => void (container.current = el)} className="relative inline-flex rounded-md border border-slate-700 bg-slate-950 p-0.5">
      <PillBg pill={pill} className="rounded bg-blue-600" />
      {options.map(o => (
        <button
          key={o.value}
          ref={setItem(o.value)}
          onClick={() => onChange(o.value)}
          className={`relative rounded px-2.5 py-1 text-[11px] font-semibold transition-colors duration-(--dur-2) ${
            o.value === value ? `on-accent text-white ${pill ? '' : 'bg-blue-600'}` : 'text-slate-400 hover:text-white'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`glass rounded-xl border border-slate-800 ${className}`}>{children}</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-dashed border-slate-800 p-10 text-center text-sm text-slate-500">{children}</div>;
}

/** A read-only text box with a Copy button: copies through the clipboard, else selects the text for Ctrl+C. */
export function CopyBox({ text, label, rows = 4 }: { text: string; label: string; rows?: number }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [state, setState] = useState<'idle' | 'copied' | 'select'>('idle');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState('copied');
    } catch {
      const el = ref.current;
      if (el) {
        el.focus();
        el.select();
      }
      let ok = false;
      try {
        ok = document.execCommand('copy');
      } catch {
        ok = false;
      }
      setState(ok ? 'copied' : 'select');
    }
    window.setTimeout(() => setState('idle'), 2500);
  };
  return (
    <div className="mt-2 space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</span>
        <span className="flex items-center gap-2">
          {state === 'copied' && <span className="text-[11px] text-emerald-400">Copied</span>}
          {state === 'select' && <span className="text-[11px] text-amber-300">Selected: press Ctrl+C</span>}
          <Button size="sm" variant="secondary" onClick={copy}>
            Copy
          </Button>
        </span>
      </div>
      <textarea
        ref={ref}
        readOnly
        rows={rows}
        wrap="off"
        spellCheck={false}
        value={text}
        onFocus={e => e.currentTarget.select()}
        className="mono w-full resize-y rounded-md border border-slate-800 bg-slate-950 p-2 text-[11px] text-slate-400"
      />
    </div>
  );
}
