import { X } from 'lucide-react';
import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { materialBadgeStyle } from '../lib/colors';

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
      className={`inline-flex items-center justify-center gap-1.5 rounded-md border font-semibold whitespace-nowrap transition-all duration-150 active:scale-[0.96] disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100 ${
        size === 'sm' ? 'px-2 py-1 text-[11px]' : 'px-3 py-1.5 text-xs'
      } ${VARIANTS[variant]} ${variant === 'primary' ? 'btn-glow-primary' : ''} ${className}`}
    />
  );
}

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
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="no-print anim-fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className={`anim-scale-in flex max-h-[90vh] w-full ${width} flex-col overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-2xl`}>
        <div className="flex items-start justify-between gap-4 border-b border-slate-800 px-5 py-3">
          <div>
            <h2 className="text-sm font-bold text-white">{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs text-slate-400">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 border-t border-slate-800 bg-slate-900/80 px-5 py-3">{footer}</div>}
      </div>
    </div>
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
  return (
    <div className="inline-flex rounded-md border border-slate-700 bg-slate-950 p-0.5">
      {options.map(o => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`rounded px-2.5 py-1 text-[11px] font-semibold transition-colors ${
            o.value === value ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
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
