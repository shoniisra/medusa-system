import { useLocation, NavLink } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  LayoutDashboard,
  Wallet,
  Users,
  Contact,
  CalendarDays,
  CalendarRange,
  ClipboardList,
  FileText,
  Settings,
  BellRing,
  ShoppingCart,
} from "lucide-react";
import { ROUTES, APP_NAME } from "@/config/constants";
import { query } from "@/lib/db";
import { useBranchId } from "@/store/session";
import { cn } from "@/lib/cn";
import { ymd } from "@/features/calendar/appointmentBoard";

interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  end?: boolean;
}

/** Navegación por secciones; `title` opcional pinta un encabezado de grupo. */
const NAV_SECTIONS: {
  title?: string;
  items: (NavItem & { children?: NavItem[] })[];
}[] = [
  {
    items: [
      {
        to: ROUTES.dashboard,
        label: "Tablero Principal",
        icon: LayoutDashboard,
        end: true,
      },
      { to: ROUTES.pos, label: "POS (venta sin cita)", icon: ShoppingCart },
    ],
  },
  {
    title: "Citas Agendadas",
    items: [
      {
        to: ROUTES.calendar,
        label: "Agenda",
        icon: CalendarDays,
        children: [
          { to: ROUTES.calendar, label: "Lista", icon: CalendarDays, end: true },
          { to: ROUTES.calendarView, label: "Calendario", icon: CalendarRange },
          { to: ROUTES.tasks, label: "Tablero", icon: ClipboardList },
        ],
      },
      { to: ROUTES.reminders, label: "Recordatorios", icon: BellRing },
    ],
  },
  {
    items: [
      { to: ROUTES.cashflow, label: "Finanzas", icon: Wallet },
      { to: ROUTES.staff, label: "Personal", icon: Users },
      { to: ROUTES.clients, label: "Clientes", icon: Contact },
      { to: ROUTES.invoices, label: "Facturación", icon: FileText },
      { to: ROUTES.settings, label: "Configuración", icon: Settings },
    ],
  },
];

/** Cuenta de citas vencidas (reservadas/atendiendo de días pasados). */
function useOverdueCount(): number {
  const branchId = useBranchId();
  // Fecha local del navegador: el reloj del servidor de la base va en UTC y de
  // noche adelantaría el corte, contando como vencidas las citas de hoy.
  const today = ymd(new Date());
  const q = useQuery({
    queryKey: ["overdue-count", branchId, today],
    enabled: !!branchId,
    refetchInterval: 5 * 60 * 1000,
    queryFn: async () => {
      const rows = await query<{ n: number }>(
        `SELECT COUNT(*) AS n FROM appointment
          WHERE branch_id = ? AND status IN ('reserved','confirmed')
            AND date(start_at) < ?`,
        [branchId, today],
      );
      return rows[0]?.n ?? 0;
    },
  });
  return q.data ?? 0;
}

/** Cuenta de citas de mañana (reservadas/atendiendo) pendientes de recordar. */
function useTomorrowCount(): number {
  const branchId = useBranchId();
  const q = useQuery({
    queryKey: ["tomorrow-count", branchId],
    enabled: !!branchId,
    refetchInterval: 5 * 60 * 1000,
    queryFn: async () => {
      const rows = await query<{ n: number }>(
        `SELECT COUNT(*) AS n FROM appointment
          WHERE branch_id = ? AND status IN ('reserved','confirmed')
            AND date(start_at) = date('now','localtime','+1 day')`,
        [branchId],
      );
      return rows[0]?.n ?? 0;
    },
  });
  return q.data ?? 0;
}

export function Sidebar() {
  const overdue = useOverdueCount();
  const tomorrow = useTomorrowCount();
  const { pathname } = useLocation();
  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-white/5 bg-ink-900/80 backdrop-blur-xl lg:flex">
      <div className="flex items-center gap-2 px-6 py-6">
        <img
          src="/medusa-logo.jpg"
          alt="Medusa Estudio"
          className="h-16 w-16 rounded-lg"
        />
        <span className="brand-script text-2xl leading-none">{APP_NAME}</span>
      </div>

      <nav className="flex-1 space-y-4 px-3">
        {NAV_SECTIONS.map((section, si) => (
          <div key={section.title ?? si} className="space-y-1">
            {section.title && (
              <p className="px-3 pb-1 pt-2 text-xs font-medium uppercase tracking-wide text-white/30">
                {section.title}
              </p>
            )}
            {section.items.map(({ to, label, icon: Icon, end, children }) => {
              // El padre se resalta si la ruta actual es la suya o la de un hijo.
              const parentActive = children
                ? children.some((c) => pathname.startsWith(c.to))
                : false;
              return (
                <div key={to}>
                  <NavLink
                    to={to}
                    end={end}
                    className={({ isActive }) =>
                      cn(
                        "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors",
                        isActive || parentActive
                          ? "bg-gold/10 text-gold-200 shadow-gold-glow"
                          : "text-white/60 hover:bg-white/5 hover:text-white",
                      )
                    }
                  >
                    <Icon className="h-5 w-5" />
                    <span className="flex-1">{label}</span>
                    {to === ROUTES.reminders && tomorrow > 0 && (
                      <span className="rounded-full bg-gold/20 px-2 py-0.5 text-xs font-medium text-gold-200">
                        {tomorrow}
                      </span>
                    )}
                  </NavLink>

                  {children && (
                    <div className="ml-[1.15rem] space-y-0.5 border-l border-white/10 pl-4">
                      {children.map((c) => (
                        <NavLink
                          key={c.to}
                          to={c.to}
                          end={c.end}
                          className={({ isActive }) =>
                            cn(
                              "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
                              isActive
                                ? "bg-gold/10 text-gold-200 shadow-gold-glow"
                                : "text-white/50 hover:bg-white/5 hover:text-white",
                            )
                          }
                        >
                          <span className="flex-1">{c.label}</span>
                          {c.to === ROUTES.tasks && overdue > 0 && (
                            <span className="rounded-full bg-danger/20 px-2 py-0.5 text-xs font-medium text-danger">
                              {overdue}
                            </span>
                          )}
                        </NavLink>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="px-6 py-4 text-xs text-white/30">MVP · v0.1</div>
    </aside>
  );
}
