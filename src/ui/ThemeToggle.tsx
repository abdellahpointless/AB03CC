import { Moon, Sun } from 'lucide-react';
import { useState } from 'react';
import { flushSync } from 'react-dom';
import { prefersReducedMotion } from './motion';

const KEY = 'cnc-planner.theme';
export type Theme = 'dark' | 'light';

export function savedTheme(): Theme {
  try {
    return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}
/** Called once before the first render, so the page never flashes the other theme. */
export function applyTheme(t: Theme) {
  document.documentElement.classList.toggle('light', t === 'light');
}

type ViewTransitionDoc = Document & { startViewTransition?: (cb: () => void) => { ready: Promise<void> } };

/** Sun / moon button: the new theme spreads over the page as a circle growing from the button. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(savedTheme);
  const toggle = (e: React.MouseEvent<HTMLButtonElement>) => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    const swap = () => {
      applyTheme(next);
      flushSync(() => setTheme(next));
      try {
        localStorage.setItem(KEY, next);
      } catch {
        /* the theme still changes for this visit */
      }
    };
    const doc = document as ViewTransitionDoc;
    if (!doc.startViewTransition || prefersReducedMotion()) return swap();
    const r = e.currentTarget.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    const t = doc.startViewTransition(swap);
    t.ready
      .then(() =>
        document.documentElement.animate(
          { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
          { duration: 750, easing: 'cubic-bezier(0.65, 0, 0.35, 1)', pseudoElement: '::view-transition-new(root)' },
        ),
      )
      .catch(() => {});
  };
  return (
    <button
      type="button"
      onClick={toggle}
      title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
      aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      className="relative flex h-8 w-8 items-center justify-center rounded-md text-slate-300 transition-colors duration-(--dur-1) hover:bg-slate-800 hover:text-white"
    >
      <Sun className={`absolute h-4 w-4 transition-all duration-500 ease-(--ease-out) ${theme === 'light' ? 'rotate-0 scale-100 opacity-100' : '-rotate-90 scale-50 opacity-0'}`} />
      <Moon className={`absolute h-4 w-4 transition-all duration-500 ease-(--ease-out) ${theme === 'dark' ? 'rotate-0 scale-100 opacity-100' : 'rotate-90 scale-50 opacity-0'}`} />
    </button>
  );
}
