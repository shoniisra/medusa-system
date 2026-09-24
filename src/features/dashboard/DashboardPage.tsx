import { Link, useNavigate } from 'react-router-dom';
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
} from 'lucide-react';
import { useDashboard } from './useDashboard';
import { useDashboardMetrics } from './useDashboardMetrics';
import { useMonthlySales } from './useMonthlySales';
import { FinanceOverview, MiniBarChart, Gauge } from './FinanceOverview';
import { StatCard, Card, CardHeader, Badge, Button, EmptyState } from '@/components/ui';
import { money, dateShort, timeShort, todayISO } from '@/lib/format';
import { useSession } from '@/store/session';
import { ROUTES, APPOINTMENT_STATUS } from '@/config/constants';
import type { AppointmentStatus } from '@/types';

export function DashboardPage() {
  const branchName = useSession((s) => s.branch?.name ?? '');
  const navigate = useNavigate();

  const { data, isLoading } = useDashboard();
  const m = useDashboardMetrics();
  const monthly = useMonthlySales();

  const col = data?.collections;
  const cash = data?.cashSession;
  const expected = data?.cashExpected ?? 0;
  const counted = cash?.counted_cash ?? null;

  const met = m.data;
  const attendance = met ? Math.max(0, 100 - met.noShowRate) : 0;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
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
          label="Recibido hoy"
          value={isLoading ? '—' : money(col?.total_received)}
          icon={Banknote}
        />
        <StatCard
          tone="gold"
          gold
          label="Ventas del mes"
          value={m.isLoading ? '—' : money(met?.month.sales)}
          icon={BarChart3}
        />
      </div>

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
                    <Badge tone={meta.tone}>{meta.label}</Badge>
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

      {/* Rankings */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
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
      </div>

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

function RowKV({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-white/60">{label}</span>
      <span className="text-sm font-medium text-white">{value}</span>
    </div>
  );
}
