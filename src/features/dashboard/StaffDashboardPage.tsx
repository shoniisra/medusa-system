import { maskCustomerPhone } from '@/features/clients/contactPrivacy';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarDays,
  CalendarPlus,
  CalendarClock,
  Banknote,
  Wallet,
  TrendingUp,
  Clock,
  Check,
  Play,
  MessageCircle,
  Cake,
  Star,
} from 'lucide-react';
import { query } from '@/lib/db';
import { useStaffDashboard } from './useStaffDashboard';
import {
  Card,
  CardHeader,
  Badge,
  Button,
  EmptyState,
} from '@/components/ui';
import { cn } from '@/lib/cn';
import type { LucideIcon } from 'lucide-react';
import { money, dateShort, timeShort, todayISO } from '@/lib/format';
import { daysUntilBirthday, birthdayCountdown, birthdayDayMonth } from '@/lib/date';
import { phoneToWaDigits } from '@/lib/phone';
import { useSession, useOrgId } from '@/store/session';
import { ROUTES, APPOINTMENT_STATUS } from '@/config/constants';
import { AppointmentActionsModal } from '@/features/calendar/AppointmentActions';
import type { NextAppointment } from './useDashboardMetrics';
import type { AppointmentStatus } from '@/types';
import { startAttention } from '@/features/calendar/appointmentBoard';

/**
 * Dashboard para el rol `staff`: solo información personal (sus comisiones,
 * sus citas y su saldo). Nada de métricas globales ni de otros colaboradores.
 */
export function StaffDashboardPage() {
  const branchName = useSession((s) => s.branch?.name ?? '');
  const userFullName = useSession((s) => s.user?.full_name ?? '');
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data, isLoading } = useStaffDashboard();
  const [selectedAppt, setSelectedAppt] = useState<NextAppointment | null>(null);

  const beginAttention = (a: { id: string }) => {
    void startAttention(qc, a.id).catch(() => {
      /* si falla, el estado sigue como estaba */
    });
  };

  const finishAttention = (a: { id: string }) =>
    navigate(`${ROUTES.appointment}/${a.id}?atender=1`);

  // Usuario sin colaboradora vinculada: avisamos cómo arreglarlo.
  if (!isLoading && data && !data.staff) {
    return (
      <div className="mx-auto max-w-[900px] p-6">
        <h1 className="mb-4 text-2xl font-semibold text-white">Inicio</h1>
        <EmptyState
          icon={Star}
          title="Tu usuario no está vinculado a una colaboradora"
          description="Pedile al administrador que lo configure en Configuración → Equipo para que puedas ver tus comisiones y citas."
        />
      </div>
    );
  }

  const c = data?.commissions;
  const b = data?.balance;
  const counts = data?.appointmentCounts;
  const next = data?.nextAppointments ?? [];
  const servicesToday = data?.servicesToday ?? [];
  const firstName = userFullName.split(' ')[0] || 'Hola';

  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-3 sm:gap-6">
      {/* Encabezado */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-white">¡Hola, {firstName}!</h1>
          <p className="text-sm text-white/40">
            {branchName} · {dateShort(todayISO())}
          </p>
        </div>
        <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:items-center">
          <Link to={ROUTES.calendar} className="contents sm:block">
            <Button variant="outline" className="w-full sm:w-auto">
              <CalendarDays className="h-4 w-4" /> Mi agenda
            </Button>
          </Link>
          <Button
            className="w-full sm:w-auto"
            onClick={() => navigate(ROUTES.appointmentNew)}
          >
            <CalendarPlus className="h-4 w-4" /> Agendar cita
          </Button>
        </div>
      </div>

      {/* Métricas compactas: ingresos, saldo, retirado y citas en un solo bloque */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-4 lg:grid-cols-6">
        <MiniStat
          label="Ingresos semana"
          value={isLoading ? '—' : money(c?.week ?? 0)}
          icon={TrendingUp}
        />
        <MiniStat
          gold
          label="Ingresos mes"
          value={isLoading ? '—' : money(c?.month ?? 0)}
          icon={Wallet}
        />
        <MiniStat
          label="Saldo a favor"
          value={isLoading ? '—' : money(b?.pending ?? 0)}
          icon={Wallet}
        />
        <MiniStat
          label="Retirado mes"
          value={isLoading ? '—' : money(b?.withdrawnMonth ?? 0)}
          icon={Banknote}
        />
        <MiniStat
          label="Citas hoy"
          value={isLoading ? '—' : String(counts?.today ?? 0)}
          icon={CalendarClock}
        />
        <MiniStat
          label="Citas semana"
          value={isLoading ? '—' : String(counts?.week ?? 0)}
          icon={CalendarDays}
        />
      </div>

      {/* Mis servicios de hoy */}
      <Card>
        <CardHeader
          title="Mis servicios de hoy"
          subtitle="Lo que has atendido hoy y la comisión de cada servicio"
        />
        {servicesToday.length === 0 ? (
          <EmptyState
            icon={Star}
            title="Sin servicios hoy"
            description="Cuando atiendas clientes, aparecerán acá con su comisión."
          />
        ) : (
          <ul className="space-y-2">
            {servicesToday.map((row, i) => (
              <li
                key={`${row.sale_id}-${i}`}
                className="flex items-start justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-white">
                    {row.description}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-white/50">
                    {row.customer_name}
                    {row.assist_label && (
                      <span className="ml-2 text-white/30">
                        · {row.assist_label}
                      </span>
                    )}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="text-sm font-semibold text-success">
                    +{money(row.commission_amount)}
                  </span>
                  <Badge
                    tone={row.participation_role === 'primary' ? 'gold' : 'muted'}
                  >
                    {row.participation_role === 'primary'
                      ? 'Principal'
                      : 'Ayudante'}
                  </Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Próximas citas + Cumpleaños del equipo */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Mis próximas citas"
            subtitle="Las siguientes en tu agenda"
            action={
              <Link
                to={ROUTES.calendar}
                className="text-xs text-gold-300 hover:underline"
              >
                Ver todas
              </Link>
            }
          />
          {next.length > 0 ? (
            <ul className="space-y-2">
              {next.map((a) => {
                const meta = APPOINTMENT_STATUS[a.status as AppointmentStatus];
                const started = a.status === 'confirmed';
                const actionable = a.status === 'reserved' || started;
                return (
                  <li
                    key={a.id}
                    onClick={() => setSelectedAppt(a)}
                    className="cursor-pointer rounded-xl bg-white/5 p-3 transition-colors hover:bg-white/[0.08]"
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-14 shrink-0 text-center">
                        <p className="kpi-gold text-sm leading-tight">
                          {timeShort(a.start_at)}
                        </p>
                        <p className="whitespace-nowrap text-[10px] leading-tight text-white/35">
                          {apptDay(a.start_at)}
                        </p>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-white">
                          {a.customer_name ?? 'Sin cliente'}
                        </p>
                        <p className="truncate text-xs text-white/40">
                          {a.services ?? 'Sin servicios'}
                        </p>
                      </div>
                      <span className="shrink-0">
                        <Badge tone={meta.tone}>{meta.label}</Badge>
                      </span>
                    </div>

                    {actionable && (
                      <div
                        className="mt-2.5 flex items-center gap-2 border-t border-white/5 pt-2.5"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {a.phone && (
                          <span className="text-xs text-white/40">{maskCustomerPhone(a.phone)}</span>
                        )}
                        <Button
                          size="sm"
                          variant={started ? 'gold' : 'outline'}
                          className="h-9 min-w-0 flex-1 whitespace-nowrap"
                          onClick={() =>
                            started ? finishAttention(a) : beginAttention(a)
                          }
                        >
                          {started ? (
                            <>
                              <Check className="h-4 w-4 shrink-0" />
                              <span className="truncate">Finalizar y Cobrar</span>
                            </>
                          ) : (
                            <>
                              <Play className="h-4 w-4 shrink-0" />
                              <span className="truncate">Empezar a Atender</span>
                            </>
                          )}
                        </Button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState
              icon={Clock}
              title="Sin próximas citas"
              description="Cuando tengas una cita asignada aparecerá acá."
            />
          )}
        </Card>

        <StaffBirthdaysCard />
      </div>

      {selectedAppt && (
        <AppointmentActionsModal
          appt={{
            id: selectedAppt.id,
            start_at: selectedAppt.start_at,
            end_at: selectedAppt.end_at,
            status: selectedAppt.status as AppointmentStatus,
            customer_name: selectedAppt.customer_name,
            customer_id: selectedAppt.customer_id,
            service_name: selectedAppt.services,
          }}
          onClose={() => setSelectedAppt(null)}
        />
      )}
    </div>
  );
}

interface StaffBirthdayRow {
  id: string;
  name: string;
  phone: string | null;
  birth_date: string;
}

/** Cumpleaños del equipo (sin datos de clientes): sólo el próximo y la lista. */
function StaffBirthdaysCard() {
  const orgId = useOrgId();

  const staff = useQuery({
    queryKey: ['staff-birthdays', orgId],
    enabled: !!orgId,
    queryFn: () =>
      query<StaffBirthdayRow>(
        `SELECT id,
                trim(first_name || ' ' || COALESCE(last_name, '')) AS name,
                phone, birth_date
           FROM staff_member
          WHERE organization_id = ? AND active = 1 AND birth_date IS NOT NULL`,
        [orgId],
      ),
  });

  const list = useMemo(() => {
    return (staff.data ?? [])
      .map((s) => ({ ...s, days: daysUntilBirthday(s.birth_date) }))
      .filter((s): s is StaffBirthdayRow & { days: number } => s.days != null)
      .sort((a, b) => a.days - b.days);
  }, [staff.data]);

  const next = list[0] ?? null;
  const rest = list.slice(1, 6);

  return (
    <Card>
      <CardHeader title="Cumpleaños del equipo" subtitle="Los próximos del mes" />
      {next ? (
        <div
          className={
            'mb-3 flex items-center justify-between gap-2 rounded-xl border p-3 ' +
            (next.days === 0
              ? 'border-gold-400/50 bg-gold-400/15'
              : 'border-gold-400/25 bg-gold-400/[0.07]')
          }
        >
          <div className="flex min-w-0 items-center gap-2.5">
            <Cake className="h-5 w-5 shrink-0 text-gold-300" />
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-wide text-gold-200/70">
                Próximo cumple
              </p>
              <p className="truncate text-sm font-semibold text-white">
                {next.name}
              </p>
              <p className="truncate text-xs text-white/50">
                {birthdayDayMonth(next.birth_date)} ·{' '}
                {birthdayCountdown(next.days)}
              </p>
            </div>
          </div>
          {next.phone && (
            <a
              href={waBirthday(next.phone, next.name)}
              target="_blank"
              rel="noopener noreferrer"
              title="Saludar por WhatsApp"
              className="shrink-0 rounded-lg p-1.5 text-emerald-400 hover:bg-emerald-400/10"
            >
              <MessageCircle className="h-4 w-4" />
            </a>
          )}
        </div>
      ) : (
        <EmptyState icon={Cake} title="Sin cumpleaños cargados" />
      )}
      {rest.length > 0 && (
        <ul className="space-y-2">
          {rest.map((s) => (
            <li
              key={s.id}
              className="flex items-center justify-between gap-2 text-sm"
            >
              <span className="flex items-center gap-2 text-white/80">
                <Cake className="h-4 w-4 text-white/30" />
                {s.name}
              </span>
              <span className="text-xs text-white/40">
                {birthdayDayMonth(s.birth_date)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function normalizePhone(phone: string): string {
  return phoneToWaDigits(phone);
}

function waBirthday(phone: string, name: string | null): string {
  const saludo = name ? `¡Feliz cumpleaños, ${name.split(' ')[0]}!` : '¡Feliz cumpleaños!';
  const text = `${saludo} 🎉 De parte de todo el equipo de Medusa Estudio 💇✨`;
  return `https://wa.me/${normalizePhone(phone)}?text=${encodeURIComponent(text)}`;
}

interface MiniStatProps {
  label: string;
  value: string;
  icon: LucideIcon;
  gold?: boolean;
}

function MiniStat({ label, value, icon: Icon, gold }: MiniStatProps) {
  return (
    <div
      className={cn(
        'rounded-xl border p-2.5 sm:p-3',
        gold
          ? 'border-gold-400/35 bg-gold-400/[0.07]'
          : 'border-white/10 bg-white/[0.03]',
      )}
    >
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-white/50 sm:text-[11px]">
        <Icon
          className={cn(
            'h-3.5 w-3.5 shrink-0',
            gold ? 'text-gold-300' : 'text-white/40',
          )}
        />
        <span className="truncate">{label}</span>
      </div>
      <p
        className={cn(
          'mt-1 truncate text-base font-semibold leading-tight sm:text-xl',
          gold ? 'kpi-gold' : 'text-white',
        )}
      >
        {value}
      </p>
    </div>
  );
}

function apptDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const ymdOf = (x: Date) =>
    `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  if (ymdOf(d) === ymdOf(today)) return 'Hoy';
  if (ymdOf(d) === ymdOf(tomorrow)) return 'Mañana';
  return d
    .toLocaleDateString('es-EC', { day: 'numeric', month: 'short' })
    .replace('.', '');
}
