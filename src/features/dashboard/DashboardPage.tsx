import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CalendarDays,
  CalendarPlus,
  Trophy,
  Users,
  Clock,
  ArrowLeftRight,
  CreditCard,
  Banknote,
  CalendarClock,
  Wallet,
  BarChart3,
  MessageCircle,
  Cake,
  Check,
  GripVertical,
} from 'lucide-react';
import { query, execute } from '@/lib/db';
import { cn } from '@/lib/cn';
import { useDashboard } from './useDashboard';
import { useDashboardMetrics } from './useDashboardMetrics';
import { useMonthlySales } from './useMonthlySales';
import { FinanceOverview, MiniBarChart, Gauge } from './FinanceOverview';
import { StatCard, Card, CardHeader, Badge, Button, EmptyState } from '@/components/ui';
import { money, dateShort, timeShort, todayISO } from '@/lib/format';
import { useSession, useOrgId } from '@/store/session';
import { ROUTES, APPOINTMENT_STATUS } from '@/config/constants';
import type { AppointmentStatus } from '@/types';

const SECTION_KEYS = [
  'stats',
  'chart',
  'appointments',
  'rankings',
  'availability',
] as const;
type SectionKey = (typeof SECTION_KEYS)[number];
const ORDER_STORAGE_KEY = 'medusa-dashboard-order';

/** Orden de las secciones del dashboard, persistido por navegador. */
function useSectionOrder() {
  const [order, setOrder] = useState<SectionKey[]>(() => {
    try {
      const raw = localStorage.getItem(ORDER_STORAGE_KEY);
      if (raw) {
        const saved = (JSON.parse(raw) as string[]).filter((k): k is SectionKey =>
          (SECTION_KEYS as readonly string[]).includes(k),
        );
        const missing = SECTION_KEYS.filter((k) => !saved.includes(k));
        return [...saved, ...missing];
      }
    } catch {
      /* localStorage no disponible → orden por defecto */
    }
    return [...SECTION_KEYS];
  });

  const move = (from: SectionKey, to: SectionKey) => {
    setOrder((prev) => {
      if (from === to) return prev;
      const arr = [...prev];
      const fi = arr.indexOf(from);
      const ti = arr.indexOf(to);
      if (fi < 0 || ti < 0) return prev;
      arr.splice(fi, 1);
      arr.splice(ti, 0, from);
      try {
        localStorage.setItem(ORDER_STORAGE_KEY, JSON.stringify(arr));
      } catch {
        /* ignore */
      }
      return arr;
    });
  };

  return { order, move };
}

export function DashboardPage() {
  const branchName = useSession((s) => s.branch?.name ?? '');
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data, isLoading } = useDashboard();
  const m = useDashboardMetrics();
  const monthly = useMonthlySales();
  const { order, move } = useSectionOrder();

  // Marca una cita como atendida desde la tarjeta de próximas citas.
  const attend = useMutation({
    mutationFn: (id: string) =>
      execute(
        "UPDATE appointment SET status = 'attended', updated_at = ? WHERE id = ?",
        [new Date().toISOString(), id],
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dashboard-metrics'] });
      qc.invalidateQueries({ queryKey: ['appointments'] });
    },
  });
  const orderOf = (k: SectionKey) => order.indexOf(k) + 1;

  const col = data?.collections;
  const cash = data?.cashSession;
  const expected = data?.cashExpected ?? 0;
  const counted = cash?.counted_cash ?? null;

  const met = m.data;
  const attendance = met ? Math.max(0, 100 - met.noShowRate) : 0;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      {/* Encabezado + acciones */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-white">Dashboard</h1>
          <p className="text-sm text-white/40">
            {branchName} · {dateShort(todayISO())}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link to={ROUTES.calendar}>
            <Button variant="outline">
              <CalendarDays className="h-4 w-4" /> Ver calendario
            </Button>
          </Link>
          <Button onClick={() => navigate(ROUTES.appointmentNew)}>
            <CalendarPlus className="h-4 w-4" /> Agendar cita
          </Button>
        </div>
      </div>

      {/* Resumen financiero con tabs día/semana/mes */}
      <FinanceOverview />

      <SortableSection id="stats" order={orderOf('stats')} onMove={move}>
      {/* Quick stats de hoy */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Citas hoy"
          value={
            m.isLoading
              ? '—'
              : `${met?.todayAttended ?? 0} / ${met?.todayPending ?? 0}`
          }
          icon={CalendarClock}
          hint="Atendidas / Pendientes"
        />
        <StatCard
          label="Efectivo esperado"
          value={isLoading ? '—' : money(expected)}
          icon={Wallet}
          hint={counted != null ? `Contado: ${money(counted)}` : 'Sin contar'}
        />
        <StatCard
          tone="success"
          glow="green"
          label="Recibido hoy"
          value={isLoading ? '—' : money(col?.total_received)}
          icon={Banknote}
        />
        <StatCard
          tone="gold"
          gold
          glow="gold"
          label="Ventas del mes"
          value={m.isLoading ? '—' : money(met?.month.sales)}
          icon={BarChart3}
        />
      </div>
      </SortableSection>

      <SortableSection id="chart" order={orderOf('chart')} onMove={move}>
      {/* Gráfico mensual + gauge de asistencia */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Resumen de ventas mensuales"
            subtitle="Últimos 6 meses"
          />
          {monthly.data && monthly.data.length > 0 ? (
            <MiniBarChart data={monthly.data} />
          ) : (
            <EmptyState icon={BarChart3} title="Sin datos de ventas" />
          )}
          {met && (
            <div className="mt-4 grid grid-cols-3 gap-3 border-t border-white/5 pt-4">
              <MiniStat
                icon={Banknote}
                label="Efectivo (mes)"
                value={money(met.month.cash)}
              />
              <MiniStat
                icon={ArrowLeftRight}
                label="Transfer. (mes)"
                value={money(met.month.transfer)}
              />
              <MiniStat
                icon={CreditCard}
                label="Tarjeta (mes)"
                value={money(met.month.card)}
              />
            </div>
          )}
        </Card>

        <Card gold>
          <CardHeader
            title="Asistencia del mes"
            subtitle="Citas cumplidas vs no-show"
          />
          <div className="flex flex-col items-center justify-center py-4">
            <Gauge
              value={attendance}
              label={`${met?.noShowCount ?? 0} no-show de ${met?.monthAppointments ?? 0}`}
              tone={attendance >= 80 ? 'emerald' : attendance >= 60 ? 'gold' : 'rose'}
            />
          </div>
        </Card>
      </div>
      </SortableSection>

      <SortableSection
        id="appointments"
        order={orderOf('appointments')}
        onMove={move}
      >
      {/* Próximas citas + Estado de caja */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Próximas citas"
            subtitle="Las siguientes en la agenda"
            action={
              <Link
                to={ROUTES.calendar}
                className="text-xs text-gold-300 hover:underline"
              >
                Ver todas
              </Link>
            }
          />
          {met && met.nextAppointments.length > 0 ? (
            <ul className="space-y-3">
              {met.nextAppointments.map((a) => {
                const meta = APPOINTMENT_STATUS[a.status as AppointmentStatus];
                return (
                  <li
                    key={a.id}
                    className="flex items-center justify-between gap-3 rounded-xl bg-white/5 p-3"
                  >
                    <div className="flex items-center gap-3">
                      <div className="text-center">
                        <p className="kpi-gold text-sm">
                          {timeShort(a.start_at)}
                        </p>
                        <p className="text-[10px] text-white/30">
                          {dateShort(a.start_at)}
                        </p>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-white">
                          {a.customer_name ?? 'Sin cliente'}
                        </p>
                        <p className="text-xs text-white/40">
                          {a.services ?? 'Sin servicios'}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {a.phone && (
                        <a
                          href={waReminder(
                            a.phone,
                            a.customer_name,
                            a.start_at,
                          )}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Recordar por WhatsApp"
                          className="rounded-lg p-1.5 text-emerald-400 hover:bg-emerald-400/10"
                        >
                          <MessageCircle className="h-4 w-4" />
                        </a>
                      )}
                      <Badge tone={meta.tone}>{meta.label}</Badge>
                      <Button
                        size="sm"
                        loading={attend.isPending && attend.variables === a.id}
                        onClick={() => attend.mutate(a.id)}
                      >
                        <Check className="h-4 w-4" /> Atender
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState
              icon={CalendarDays}
              title="Sin próximas citas"
              action={
                <Button size="sm" onClick={() => navigate(ROUTES.appointmentNew)}>
                  <CalendarPlus className="h-4 w-4" /> Agendar
                </Button>
              }
            />
          )}
        </Card>

        <Card gold>
          <CardHeader
            title="Estado de caja"
            subtitle="Esperado vs contado (efectivo físico)"
          />
          {cash ? (
            <div className="space-y-3">
              <RowKV label="Apertura" value={money(cash.opening_cash)} />
              <RowKV label="Esperado" value={money(expected)} />
              <RowKV
                label="Contado"
                value={counted != null ? money(counted) : '—'}
              />
              {counted != null && (
                <div className="flex items-center justify-between border-t border-white/10 pt-3">
                  <span className="text-sm font-medium text-white/70">
                    Diferencia
                  </span>
                  <span
                    className={
                      counted - expected < 0
                        ? 'text-lg font-bold text-danger'
                        : 'text-lg font-bold text-success'
                    }
                  >
                    {money(counted - expected)}
                  </span>
                </div>
              )}
            </div>
          ) : (
            <p className="py-6 text-center text-sm text-white/40">
              No hay una sesión de caja abierta.
            </p>
          )}
        </Card>
      </div>
      </SortableSection>

      <SortableSection id="rankings" order={orderOf('rankings')} onMove={move}>
      {/* Rankings */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="Estilista del mes" subtitle="Por ingresos generados" />
          {met?.topSeller ? (
            <>
              <div className="mb-3 flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-gold/15">
                  <Trophy className="h-5 w-5 text-gold-300" />
                </div>
                <div>
                  <p className="font-semibold text-white">
                    {met.topSeller.name}
                  </p>
                  <p className="kpi-gold text-lg">
                    {money(met.topSeller.revenue)}
                  </p>
                </div>
              </div>
              <ul className="space-y-1.5">
                {met.sellers.slice(1).map((s) => (
                  <li
                    key={s.staff_member_id}
                    className="flex justify-between text-sm text-white/60"
                  >
                    <span>{s.name}</span>
                    <span>{money(s.revenue)}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <EmptyState icon={Trophy} title="Sin datos del mes" />
          )}
        </Card>

        <Card>
          <CardHeader title="Top clientes" subtitle="Los que más han gastado" />
          {met && met.topCustomers.length > 0 ? (
            <ul className="space-y-2.5">
              {met.topCustomers.map((c, i) => (
                <li
                  key={c.customer_id}
                  className="flex items-center justify-between gap-2"
                >
                  <span className="flex items-center gap-2 text-sm text-white/80">
                    <span className="w-4 text-xs text-white/30">{i + 1}</span>
                    {c.name}
                  </span>
                  <span className="text-right">
                    <span className="block text-sm font-medium text-gold-200">
                      {money(c.spent)}
                    </span>
                    <span className="block text-[10px] text-white/30">
                      {c.visits} visitas
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={Users} title="Sin clientes aún" />
          )}
        </Card>

        <BirthdaysCard />
      </div>
      </SortableSection>

      <SortableSection
        id="availability"
        order={orderOf('availability')}
        onMove={move}
      >
      {/* Disponibilidad hoy por estilista */}
      <Card>
        <CardHeader
          title="Disponibilidad de hoy"
          subtitle="Huecos libres por estilista (horario del local)"
        />
        {met && met.availability.length > 0 ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {met.availability.map((st) => (
              <div
                key={st.staff_member_id}
                className="rounded-xl border border-white/10 bg-white/5 p-3"
              >
                <p className="mb-2 flex items-center gap-2 text-sm font-medium text-white">
                  <Clock className="h-4 w-4 text-gold-300/70" />
                  {st.name}
                </p>
                {st.closed ? (
                  <Badge tone="muted">Cerrado hoy</Badge>
                ) : st.intervals.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {st.intervals.map((iv) => (
                      <Badge key={iv.label} tone="success">
                        {iv.label}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <Badge tone="danger">Sin huecos</Badge>
                )}
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={Clock}
            title="Sin estilistas en esta sede"
            description="Asigná colaboradores a la sucursal para ver disponibilidad."
          />
        )}
      </Card>
      </SortableSection>
    </div>
  );
}

/** Sección reordenable por drag & drop. El orden se aplica con CSS `order`. */
function SortableSection({
  id,
  order,
  onMove,
  children,
}: {
  id: SectionKey;
  order: number;
  onMove: (from: SectionKey, to: SectionKey) => void;
  children: ReactNode;
}) {
  const [over, setOver] = useState(false);
  return (
    <div
      style={{ order }}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const from = e.dataTransfer.getData('text/plain') as SectionKey;
        if (from) onMove(from, id);
      }}
      className={cn(
        'group relative rounded-2xl transition-shadow',
        over && 'ring-2 ring-gold-400/60',
      )}
    >
      <button
        type="button"
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('text/plain', id);
          e.dataTransfer.effectAllowed = 'move';
        }}
        title="Arrastrar para reordenar"
        className="absolute -top-2 right-2 z-10 hidden cursor-grab rounded-lg bg-ink-800 p-1.5 text-white/40 shadow hover:text-white active:cursor-grabbing group-hover:flex"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      {children}
    </div>
  );
}

function MiniStat({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Banknote;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between rounded-xl bg-white/[0.03] p-3">
      <span className="flex items-center gap-2 text-xs text-white/50">
        <Icon className="h-4 w-4 text-gold-300/70" />
        {label}
      </span>
      <span className="text-sm font-medium text-white">{value}</span>
    </div>
  );
}

interface BirthdayRow {
  id: string;
  name: string;
  phone: string | null;
  day: number;
}

/** Clientes que cumplen años este mes. */
function BirthdaysCard() {
  const orgId = useOrgId();
  const month = String(new Date().getMonth() + 1).padStart(2, '0');
  const today = new Date().getDate();

  const rows = useQuery({
    queryKey: ['birthdays', orgId, month],
    enabled: !!orgId,
    queryFn: () =>
      query<BirthdayRow>(
        `SELECT id,
                first_name || CASE WHEN last_name IS NOT NULL THEN ' ' || last_name ELSE '' END AS name,
                phone,
                CAST(substr(birth_date,9,2) AS INTEGER) AS day
           FROM customer
          WHERE organization_id = ? AND active = 1 AND birth_date IS NOT NULL
            AND substr(birth_date,6,2) = ?
          ORDER BY day`,
        [orgId, month],
      ),
  });

  return (
    <Card>
      <CardHeader title="Cumpleaños del mes" subtitle="Clientes que cumplen años" />
      {rows.data && rows.data.length > 0 ? (
        <ul className="space-y-2">
          {rows.data.map((b) => (
            <li key={b.id} className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-sm text-white/80">
                <Cake
                  className={
                    b.day === today
                      ? 'h-4 w-4 text-gold-300'
                      : 'h-4 w-4 text-white/30'
                  }
                />
                {b.name}
                <span className="text-xs text-white/30">día {b.day}</span>
              </span>
              {b.phone && (
                <a
                  href={waBirthday(b.phone, b.name)}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Saludar por WhatsApp"
                  className="rounded-lg p-1.5 text-emerald-400 hover:bg-emerald-400/10"
                >
                  <MessageCircle className="h-4 w-4" />
                </a>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={Cake} title="Sin cumpleaños este mes" />
      )}
    </Card>
  );
}

function normalizePhone(phone: string): string {
  let d = phone.replace(/\D/g, '');
  if (d.startsWith('0')) d = '593' + d.slice(1);
  else if (!d.startsWith('593')) d = '593' + d;
  return d;
}

function waBirthday(phone: string, name: string | null): string {
  const saludo = name ? `¡Feliz cumpleaños, ${name.split(' ')[0]}!` : '¡Feliz cumpleaños!';
  const text = `${saludo} 🎉 De parte de todo el equipo de Medusa Estudio. Te esperamos para consentirte 💇✨`;
  return `https://wa.me/${normalizePhone(phone)}?text=${encodeURIComponent(text)}`;
}

/** Arma un enlace wa.me con mensaje de recordatorio precargado (EC por defecto). */
function waReminder(
  phone: string,
  name: string | null,
  startAt: string,
): string {
  const saludo = name ? `Hola ${name.split(' ')[0]}` : 'Hola';
  const text = `${saludo} 👋 Te recordamos tu cita en Medusa Estudio el ${dateShort(
    startAt,
  )} a las ${timeShort(startAt)}. ¿La confirmás? 💇`;
  return `https://wa.me/${normalizePhone(phone)}?text=${encodeURIComponent(text)}`;
}

function RowKV({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-white/60">{label}</span>
      <span className="text-sm font-medium text-white">{value}</span>
    </div>
  );
}
