import { NavLink } from 'react-router-dom';
import { cn } from '@/lib/cn';

export interface SubNavTab {
  path: string;
  label: string;
  /** Activa solo con la ruta exacta (la pestaña "raíz" de la sección). */
  end?: boolean;
}

/**
 * Submenú de pestañas por ruta de una sección (Finanzas, Equipo). Cada
 * pestaña es una URL, así que se puede enlazar y el botón atrás funciona.
 */
export function SubNavTabs({ tabs }: { tabs: SubNavTab[] }) {
  return (
    <div className="flex flex-wrap gap-1 rounded-xl bg-white/5 p-1">
      {tabs.map((t) => (
        <NavLink
          key={t.path}
          to={t.path}
          end={t.end}
          className={({ isActive }) =>
            cn(
              'rounded-lg px-3 py-1.5 text-xs font-medium transition-colors sm:text-sm',
              isActive
                ? 'bg-gold-400 text-ink-950 shadow-gold-glow'
                : 'text-white/50 hover:text-white',
            )
          }
        >
          {t.label}
        </NavLink>
      ))}
    </div>
  );
}
