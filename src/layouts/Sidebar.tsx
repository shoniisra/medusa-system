import { useLocation, NavLink } from "react-router-dom";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  LayoutDashboard,
  Wallet,
  Users,
  Contact,
  CalendarDays,
  CalendarPlus,
  CalendarRange,
  CalendarOff,
  ClipboardList,
  FileText,
  Settings,
  History,
  BellRing,
  ShoppingCart,
  Receipt,
  BarChart3,
  ArrowLeftRight,
  Landmark,
  Scale,
  ChevronRight,
  ChevronDown,
} from "lucide-react";
import { ROUTES, APP_NAME } from "@/config/constants";
import { query } from "@/lib/db";
import { useBranchId, useSession } from "@/store/session";
import { cn } from "@/lib/cn";
import { ymd } from "@/features/calendar/appointmentBoard";
import { useHasPermission } from "@/config/permissions";

interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  end?: boolean;
}

type NavItemWithChildren = NavItem & { children?: NavItem[] };

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
  const role = useSession((s) => s.user?.role);
  const can = useHasPermission(role);

  // Agenda arranca expandida porque es la sección más usada; el resto queda
  // colapsado y se abre con el chevron o cuando un hijo está activo (no se
  // pueden cerrar mientras hay un hijo activo).
  const [openSections, setOpenSections] = useState<Set<string>>(
    () => new Set([ROUTES.tasks]),
  );

  function isSectionOpen(to: string, children: NavItem[] | undefined): boolean {
    if (!children) return false;
    if (children.some((c) => pathname === c.to || pathname.startsWith(c.to + '/')))
      return true;
    return openSections.has(to);
  }

  function toggleSection(to: string, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(to)) next.delete(to);
      else next.add(to);
      return next;
    });
  }

  type Section = { title?: string; items: NavItemWithChildren[] };

  const sections: Section[] = [
    {
      items: [
        {
          to: ROUTES.dashboard,
          label: "Tablero Principal",
          icon: LayoutDashboard,
          end: true,
        },
        ...(can("use_pos")
          ? [
              {
                to: ROUTES.pos,
                label: "POS (venta sin cita)",
                icon: ShoppingCart,
              },
            ]
          : []),
      ],
    },
    {
      title: "Citas Agendadas",
      items: [
        {
          to: ROUTES.tasks,
          label: "Agenda",
          icon: CalendarDays,
          children: [
            { to: ROUTES.tasks, label: "Tablero", icon: ClipboardList, end: true },
            {
              to: ROUTES.calendarView,
              label: "Calendario",
              icon: CalendarRange,
            },
          ],
        },
        { to: ROUTES.reminders, label: "Recordatorios", icon: BellRing },
      ],
    },
    {
      items: [
        ...(can("view_finance")
          ? [
              {
                to: ROUTES.cashflow,
                label: "Finanzas",
                icon: Wallet,
                children: [
                  { to: ROUTES.cashflow, label: "Vista general", icon: Wallet, end: true },
                  { to: ROUTES.cashflowResumen, label: "Resumen", icon: BarChart3 },
                  { to: ROUTES.cashflowTransacciones, label: "Transacciones", icon: Receipt },
                  { to: ROUTES.cashflowTransferencias, label: "Transferencias", icon: ArrowLeftRight },
                  { to: ROUTES.cashflowCuentas, label: "Cuentas", icon: Landmark },
                  { to: ROUTES.cashflowDeudas, label: "Deudas · Créditos", icon: Scale },
                ],
              } as NavItemWithChildren,
            ]
          : []),
        ...(can("view_staff_finance")
          ? [
              {
                to: ROUTES.staff,
                label: "Equipo",
                icon: Users,
                children: [
                  ...(can("manage_staff")
                    ? [{ to: ROUTES.staffTeam, label: "Miembros del equipo", icon: Users }]
                    : []),
                  { to: ROUTES.staff, label: "Comisiones", icon: Users, end: true },
                  {
                    to: ROUTES.staffAbsences,
                    label: "Ausencias y cierres",
                    icon: CalendarOff,
                  },
                ],
              } as NavItemWithChildren,
            ]
          : []),
        ...(can("manage_clients")
          ? [{ to: ROUTES.clients, label: "Clientes", icon: Contact }]
          : []),
        ...(can("view_invoices")
          ? [{ to: ROUTES.invoices, label: "Facturación", icon: FileText }]
          : []),
        ...(can("view_audit")
          ? [{ to: ROUTES.audit, label: "Auditoría", icon: History }]
          : []),
        ...(can("manage_settings")
          ? [{ to: ROUTES.settings, label: "Configuración", icon: Settings }]
          : []),
      ],
    },
  ].filter((s) => s.items.length > 0);

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

      {/* Accesos rápidos: las dos acciones más repetidas del día — crear cita
          y registrar un gasto — a un click, sin tener que pasar por la
          sección correspondiente. El gasto llega a Finanzas con ?nuevo=gasto
          y abre el modal apenas monta la pestaña General. */}
      <div className="mb-2 space-y-2 px-3">
        <NavLink
          to={ROUTES.appointmentNew}
          className="flex items-center gap-2 rounded-xl bg-gradient-to-b from-gold-300 to-gold-500 px-3 py-2.5 text-sm font-semibold text-ink-950 shadow-gold-glow transition active:scale-[0.98]"
        >
          <CalendarPlus className="h-4 w-4" />
          Agendar Cita
        </NavLink>
        {can("view_finance") && (
          <NavLink
            to={`${ROUTES.cashflow}?nuevo=gasto`}
            className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm font-medium text-white/85 transition hover:bg-white/[0.07] active:scale-[0.98]"
          >
            <Receipt className="h-4 w-4 text-gold-300" />
            Registrar gasto
          </NavLink>
        )}
      </div>

      <nav className="flex-1 space-y-4 px-3">
        {sections.map((section, si) => (
          <div key={section.title ?? si} className="space-y-1">
            {section.title && (
              <p className="px-3 pb-1 pt-2 text-xs font-medium uppercase tracking-wide text-white/30">
                {section.title}
              </p>
            )}
            {section.items.map(({ to, label, icon: Icon, end, children }) => {
              const parentActive = children
                ? children.some((c) => pathname === c.to || pathname.startsWith(c.to + '/'))
                : false;
              const open = isSectionOpen(to, children);
              return (
                <div key={to}>
                  <div className="relative">
                    <NavLink
                      to={to}
                      end={end}
                      className={({ isActive }) =>
                        cn(
                          "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors",
                          children ? "pr-9" : "",
                          children
                            ? // El padre que agrupa submenús nunca toma la "chip" dorada
                              // llena, para no competir visualmente con el hijo activo.
                              isActive || parentActive
                              ? "text-gold-200/85 hover:bg-white/5"
                              : "text-white/60 hover:bg-white/5 hover:text-white"
                            : isActive
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
                      <button
                        type="button"
                        onClick={(e) => toggleSection(to, e)}
                        className="absolute right-1 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-white/40 hover:bg-white/10 hover:text-white"
                        aria-label={open ? "Colapsar" : "Expandir"}
                      >
                        {open ? (
                          <ChevronDown className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5" />
                        )}
                      </button>
                    )}
                  </div>

                  {open && children && (
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
