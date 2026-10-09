import { X } from 'lucide-react';
import { useStore } from '../state/store';

export function Toasts() {
  const { toasts, dismissToast } = useStore();
  return (
    <div className="no-print fixed bottom-4 right-4 z-[60] flex w-80 flex-col gap-2">
      {toasts.map(t => (
        <div
          key={t.id}
          className={`anim-toast flex items-start gap-2 rounded-lg border px-3 py-2 text-xs shadow-xl backdrop-blur ${
            t.tone === 'error'
              ? 'border-rose-800 bg-rose-950 text-rose-100'
              : t.tone === 'warn'
                ? 'border-amber-800 bg-amber-950 text-amber-100'
                : 'border-emerald-800 bg-emerald-950 text-emerald-100'
          }`}
        >
          <span className="flex-1 leading-snug">{t.text}</span>
          <button onClick={() => dismissToast(t.id)} className="opacity-70 hover:opacity-100" aria-label="Dismiss">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
