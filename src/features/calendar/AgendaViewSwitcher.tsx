import { Link } from 'react-router-dom';
import {
  CalendarRange,
  CalendarDays,
  ClipboardList,
  CalendarPlus,
} from 'lucide-react';
import { ROUTES } from '@/config/constants';
import { cn } from '@/lib/cn';

export type AgendaSection = 'calendar' | 'list' | 'board';

interface SwitchItem {
  key: AgendaSection;
  to: string;
  label: string;
  icon: typeof CalendarRange;
}

/** Orden: calendario (vista principal), lista, tablero. */
const VIEWS: SwitchItem[] = [
  { key: 'calendar', to: ROUTES.calendarView, label: 'Calendario', icon: CalendarRange },
  { key: 'list', to: ROUTES.calendar, label: 'Lista', icon: CalendarDays },
  { key: 'board', to: ROUTES.tasks, label: 'Tablero', icon: ClipboardList },
];

/**
 * Barra de cambio de vista + alta de cita, pensada para móvil: 3 botones
 * grandes con ícono y etiqueta compacta y un botón dorado para agendar.
 * En escritorio queda oculta: cada página ya trae su propia barra de acciones.
 */
export function AgendaViewSwitcher({
  current,
  className,
}: {
  current: AgendaSection;
  className?: string;
}) {
  return (
    <div className={cn('flex items-center gap-2 lg:hidden', className)}>
      <div className="flex flex-1 items-center gap-1 rounded-2xl border border-white/10 bg-ink-800/60 p-1">
        {VIEWS.map(({ key, to, label, icon: Icon }) => {
          const active = current === key;
          return (
            <Link
              key={key}
              to={to}
              aria-label={label}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex min-h-[44px] flex-1 flex-col items-center justify-center gap-0.5 rounded-xl py-1.5 text-[11px] font-medium transition-colors',
                active
                  ? 'bg-gold-400 text-ink-950 shadow-gold-glow'
                  : 'text-white/60 active:bg-white/10',
              )}
            >
              <Icon className="h-6 w-6" strokeWidth={2} />
              <span className="leading-none">{label}</span>
            </Link>
          );
        })}
      </div>
      <Link
        to={ROUTES.appointmentNew}
        aria-label="Nueva cita"
        className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-b from-gold-300 to-gold-500 text-ink-950 shadow-gold-glow transition active:scale-95"
      >
        <CalendarPlus className="h-6 w-6" strokeWidth={2.25} />
      </Link>
    </div>
  );
}
