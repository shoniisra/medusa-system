import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  BarChart3,
  CalendarDays,
  ClipboardList,
  Lock,
  Repeat,
  Unlock,
  Wallet,
} from 'lucide-react';
import { Button, Input, Modal, useToast } from '@/components/ui';
import { useBankAccounts } from './accounts';
import { CountCashFields } from './CountCashFields';
import { MetricCard } from './MetricCard';
import {
  isOpenedToday,
  useCashCarryover,
  useCashRegister,
  useCloseCashMutation,
  useDayMetricsForSession,
  useExpectedCash,
  useLastClosedSession,
  useLatestCashSession,
  useOpenCashMutation,
  usePendingAppointments,
  useRolloverCashMutation,
  type CashCtx,
} from './cashSessionActions';
import { money, dateShort, timeShort } from '@/lib/format';
import { ymd } from '@/lib/date';
import { ROUTES } from '@/config/constants';
import { useSession, useBranchId, useOrgId } from '@/store/session';
import { cn } from '@/lib/cn';
import { CloseOverdueModal } from '@/features/tasks/CloseOverdueModal';
import type { CashSession } from '@/types';

/**
 * Modal único de caja: abre, cierra o roll-overea la sesión (cerrar ayer y
 * abrir hoy en un solo paso) y, al terminar un cierre, muestra el resumen del
 * día con dos accesos directos (métricas / agenda).
 *
 * `enforce` lo pone el guard diario del AppLayout cuando el usuario arrastra
 * una caja de ayer o no abrió la de hoy: en ese modo no se puede cerrar sin
 * resolver (la X desaparece y el fondo no cierra).
 */
export function CashRegisterModal({
  open,
  onClose,
  enforce = false,
}: {
  open: boolean;
  onClose: () => void;
  enforce?: boolean;
}) {
  const branchId = useBranchId();
  const orgId = useOrgId();
  const userId = useSession((s) => s.user?.id ?? null);
  const ctx: CashCtx = { branchId, orgId, userId };

  const register = useCashRegister(branchId);
  const latest = useLatestCashSession(branchId);
  const session = latest.data ?? null;
  const session_isOpen = session?.status === 'open';
  const today = ymd(new Date());

  const openedToday = isOpenedToday(session, today);

  // Modo inicial — se calcula cada render pero SOLO se aplica cuando el modal
  // pasa de cerrado a abierto. Mientras el modal está abierto, las transiciones
  // internas (close → summary, rollover → summary) mandan. Antes recalculábamos
  // el modo en cada cambio de initialMode, lo que causaba el bug clásico:
  // después de abrir caja el refetch de latest-cash hacía initialMode='close' y
  // el modal volvía a mostrar "Cerrar caja" por un frame.
  type Mode = 'open' | 'close' | 'rollover' | 'summary';
  const initialMode: Mode =
    !session ? 'open'
    : session_isOpen && openedToday ? 'close'
    : session_isOpen && !openedToday ? 'rollover'
    : 'open';

  const [mode, setMode] = useState<Mode>(initialMode);
  const [justClosedSession, setJustClosedSession] = useState<CashSession | null>(
    null,
  );
  const [justClosedDay, setJustClosedDay] = useState<string | null>(null);

  // Solo reseteamos el modo cuando el modal se vuelve a abrir desde fuera.
  // Setear estado durante render ajustado a un disparador explícito ("open"
  // cambió) es el patrón recomendado por React y no infringe el linter.
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) {
      setMode(initialMode);
      setJustClosedSession(null);
      setJustClosedDay(null);
    }
  }

  // Resumen: usa la sesión que acabamos de cerrar en esta tanda (sincrónica,
  // sin esperar refetch) o la última cerrada si entramos directo al summary.
  const summarySessionId =
    justClosedSession?.id ?? (!session_isOpen ? session?.id ?? null : null);
  const summaryDay =
    justClosedDay ??
    (!session_isOpen && session?.closed_at ? ymd(new Date(session.closed_at)) : null);

  if (!open) return null;

  const canClose = !enforce || mode === 'summary' || !needsAction(session, today);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={titleFor(mode)}
      className="sm:max-w-xl"
    >
      {enforce && mode !== 'summary' && !canClose && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-xs text-amber-100">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            Para empezar el día necesitás{' '}
            {mode === 'rollover'
              ? 'cerrar la caja de ayer y abrir la de hoy'
              : 'abrir la caja'}
            .
          </span>
        </div>
      )}

      {!register.data && register.isFetched && (
        <p className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-100">
          Esta sucursal no tiene caja registradora. Creá una en Configuración →
          Cajas registradoras para poder abrir y cerrar la caja del día.
        </p>
      )}

      {register.data && mode === 'close' && session_isOpen && session && (
        <CloseBody
          ctx={ctx}
          session={session}
          onDismiss={onClose}
          onClosed={(closedDay) => {
            setJustClosedSession(session);
            setJustClosedDay(closedDay);
            setMode('summary');
          }}
        />
      )}

      {register.data && mode === 'rollover' && session_isOpen && session && (
        <RolloverBody
          ctx={ctx}
          oldSession={session}
          registerId={register.data.id}
          onDismiss={onClose}
          onDone={({ closedDay }) => {
            setJustClosedSession(session);
            setJustClosedDay(closedDay);
            setMode('summary');
          }}
        />
      )}

      {register.data && mode === 'open' && (
        <OpenBody
          ctx={ctx}
          registerId={register.data.id}
          onDismiss={onClose}
          onOpened={onClose}
        />
      )}

      {mode === 'summary' && (
        <SummaryBody
          sessionId={summarySessionId}
          branchId={branchId}
          day={summaryDay}
          onViewMetrics={onClose}
          onGoCalendar={onClose}
        />
      )}
    </Modal>
  );
}

function titleFor(mode: 'open' | 'close' | 'rollover' | 'summary'): string {
  if (mode === 'close') return 'Cerrar caja';
  if (mode === 'rollover') return 'Cerrar ayer y abrir hoy';
  if (mode === 'summary') return 'Resumen del día';
  return 'Abrir caja';
}

function needsAction(session: CashSession | null, today: string): boolean {
  if (!session) return true; // nunca abrió → necesita abrir
  if (session.status === 'open' && !isOpenedToday(session, today)) return true; // arrastre
  // Si la última sesión está cerrada y es de otro día, falta abrir hoy.
  if (session.status === 'closed') {
    const closedDay = session.closed_at ? ymd(new Date(session.closed_at)) : null;
    return closedDay !== today;
  }
  return false;
}

/* ────────────────── Abrir caja ────────────────── */

function OpenBody({
  ctx,
  registerId,
  onOpened,
  onDismiss,
}: {
  ctx: CashCtx;
  registerId: string;
  onOpened: () => void;
  onDismiss: () => void;
}) {
  const toast = useToast();
  const carry = useCashCarryover(ctx.branchId);
  const [opening, setOpening] = useState<string | null>(null);
  const value = opening ?? String(carry.data ?? 0);

  const openIt = useOpenCashMutation(ctx, registerId, () => {
    toast.success('Caja abierta', `Fondo inicial ${money(Number(value) || 0)}`);
    onOpened();
  });

  return (
    <div className="space-y-4">
      <LastCloseSummary branchId={ctx.branchId} />
      <PendingTodayNotice branchId={ctx.branchId} onGoTasks={onDismiss} />

      <Input
        label="Efectivo de apertura"
        type="number"
        min="0"
        step="0.01"
        value={value}
        onChange={(e) => setOpening(e.target.value)}
      />
      {!!carry.data && (
        <p className="text-xs text-white/40">
          Del cierre anterior quedaron {money(carry.data)} en caja como fondo de
          vueltos.
        </p>
      )}
      <Button
        className="w-full"
        size="lg"
        loading={openIt.isPending}
        onClick={() => openIt.mutate(Number(value) || 0)}
      >
        <Unlock className="h-4 w-4" /> Abrir caja
      </Button>
      {openIt.isError && (
        <p className="text-xs text-danger">
          {openIt.error instanceof Error ? openIt.error.message : 'Error al abrir caja.'}
        </p>
      )}
      <Button variant="ghost" className="w-full" onClick={onDismiss}>
        Cerrar
      </Button>
    </div>
  );
}

/** Resumen compacto del último cierre: ventas, cobrado y fondo que quedó. */
function LastCloseSummary({ branchId }: { branchId: string }) {
  const last = useLastClosedSession(branchId);
  const sessionId = last.data?.id ?? null;
  const day = last.data?.closed_at ? ymd(new Date(last.data.closed_at)) : null;
  const metrics = useDayMetricsForSession(sessionId, branchId, day);
  const m = metrics.data;

  if (!day || !m) return null;
  const received = m.cashReceived + m.bankReceived;

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-white/40">
        Último cierre · {dateShort(day)}
      </p>
      <div className="mt-2 grid grid-cols-3 gap-2 text-center">
        <MiniStat label="Ventas" value={String(m.salesCount)} />
        <MiniStat label="Cobrado" value={money(received)} />
        <MiniStat label="Quedó en caja" value={money(m.countedCash)} />
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white/5 p-2">
      <p className="text-sm font-semibold text-white">{value}</p>
      <p className="mt-0.5 text-[10px] uppercase tracking-wide text-white/40">
        {label}
      </p>
    </div>
  );
}

/**
 * Pendientes del día que conviene procesar: reservadas de hoy y vencidas.
 * Informativo al abrir (no bloquea); al cerrar la caja sí son obligatorias.
 */
function PendingTodayNotice({
  branchId,
  onGoTasks,
}: {
  branchId: string;
  onGoTasks: () => void;
}) {
  const navigate = useNavigate();
  const pending = usePendingAppointments(branchId);
  const p = pending.data;
  if (!p || p.total === 0) return null;

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-xs text-amber-100">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          Pendiente para hoy: <b>{pendingLabel(p.reservedToday, p.overdue)}</b>.
          Conviene procesarlas antes de cerrar la caja.
        </span>
      </div>
      <Button
        size="sm"
        variant="outline"
        className="self-start"
        onClick={() => {
          navigate(ROUTES.tasks);
          onGoTasks();
        }}
      >
        <ClipboardList className="h-4 w-4" /> Ver en tareas
      </Button>
    </div>
  );
}

/** "2 reservadas · 1 vencida" según lo que haya. */
function pendingLabel(reservedToday: number, overdue: number): string {
  const parts: string[] = [];
  if (reservedToday > 0)
    parts.push(`${reservedToday} reservada${reservedToday === 1 ? '' : 's'} de hoy`);
  if (overdue > 0) parts.push(`${overdue} vencida${overdue === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

/* ────────────────── Bloqueador de vencidas (inline) ────────────────── */

/**
 * Panel de bloqueo compartido por el cierre normal y el rollover: muestra el
 * conteo, lista las vencidas más viejas y ofrece abrir el cierre masivo sin
 * salir del modal de caja. Antes mandaba al tablero genérico (filtrado por
 * rango) y el usuario tenía que buscar manualmente una vencida de hace un mes.
 */
function BlockingPanel({
  reservedToday,
  overdue,
  onGoTasks,
}: {
  reservedToday: number;
  overdue: number;
  onOpenBulk: () => void;
  onGoTasks: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-amber-400/40 bg-amber-400/10 p-3 text-xs text-amber-100">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          No podés cerrar la caja porque hay tareas sin procesar:{' '}
          <b>{pendingLabel(reservedToday, overdue)}</b>.
        </span>
      </div>
      <Button
        size="sm"
        variant="outline"
        onClick={onGoTasks}
        className="self-start shrink-0"
      >
        <ClipboardList className="h-4 w-4" /> Ver Tareas Pendientes
      </Button>
    </div>
  );
}

/* ────────────────── Cerrar caja ────────────────── */

function CloseBody({
  ctx,
  session,
  onClosed,
  onDismiss,
}: {
  ctx: CashCtx;
  session: CashSession;
  onClosed: (closedDay: string) => void;
  onDismiss: () => void;
}) {
  const toast = useToast();
  const navigate = useNavigate();
  const banks = useBankAccounts(ctx.orgId, true);
  const expectedQ = useExpectedCash(session);
  const expected = expectedQ.data ?? session.opening_cash;

  // Cerrar la caja con citas reservadas de hoy o vencidas sin resolver arrastra
  // ventas sin cobrar y descuadra días futuros: el cierre las exige procesar.
  const pending = usePendingAppointments(ctx.branchId);
  const blockers = pending.data ?? { reservedToday: 0, overdue: 0, total: 0 };
  const blocked = blockers.total > 0;

  const [bulkOpen, setBulkOpen] = useState(false);
  const [counted, setCounted] = useState('');
  const [withdraw, setWithdraw] = useState('');
  const [destination, setDestination] = useState('');

  const cnt = counted === '' ? null : Number(counted);
  const diff = cnt == null ? null : cnt - expected;
  const out = withdraw === '' ? 0 : Number(withdraw);
  const left = cnt == null ? null : cnt - out;
  const tooMuch = cnt != null && out > cnt;
  const noDestination = out > 0 && !destination;

  const closeIt = useCloseCashMutation(ctx, session, expected, () => {
    toast.success(
      'Caja cerrada',
      diff ? `Diferencia ${money(diff)}` : 'Sin diferencia en el conteo',
    );
    onClosed(ymd(new Date()));
  });

  return (
    <div className="space-y-4">
      <OpenedHeader session={session} expected={expected} />

      <Input
        label="Efectivo contado (físico)"
        type="number"
        min="0"
        step="0.01"
        value={counted}
        onChange={(e) => setCounted(e.target.value)}
      />

      {cnt != null && (
        <div className="flex justify-between text-xs text-white/50">
          <span>Diferencia con lo esperado</span>
          <span
            className={cn(
              'font-semibold',
              diff === 0 ? 'text-white/70' : diff! < 0 ? 'text-danger' : 'text-success',
            )}
          >
            {money(diff ?? 0)}
          </span>
        </div>
      )}

      <CountCashFields
        cnt={cnt}
        withdraw={withdraw}
        onWithdrawChange={setWithdraw}
        destination={destination}
        onDestinationChange={setDestination}
        banks={banks.data ?? []}
        left={left}
      />

      {tooMuch && (
        <p className="text-xs text-danger">
          No podés retirar más de lo que contaste en caja.
        </p>
      )}
      {noDestination && (
        <p className="text-xs text-danger">Elegí la cuenta donde entra el retiro.</p>
      )}

      {blocked && (
        <BlockingPanel
          reservedToday={blockers.reservedToday}
          overdue={blockers.overdue}
          onOpenBulk={() => setBulkOpen(true)}
          onGoTasks={() => {
            navigate(ROUTES.tasks);
            onDismiss();
          }}
        />
      )}

      <Button
        variant="danger"
        className="w-full"
        size="lg"
        disabled={cnt == null || tooMuch || noDestination || blocked}
        loading={closeIt.isPending}
        onClick={() =>
          closeIt.mutate({
            counted: cnt ?? 0,
            withdraw: out,
            destination: out > 0 ? destination : null,
          })
        }
      >
        <Lock className="h-4 w-4" /> Confirmar cierre
      </Button>
      {closeIt.isError && (
        <p className="text-xs text-danger">
          {closeIt.error instanceof Error ? closeIt.error.message : 'Error al cerrar.'}
        </p>
      )}

      {bulkOpen && <CloseOverdueModal onClose={() => setBulkOpen(false)} />}
    </div>
  );
}

/* ────────────────── Rollover (cerrar ayer + abrir hoy en un paso) ────────────────── */

function RolloverBody({
  ctx,
  oldSession,
  registerId,
  onDone,
  onDismiss,
}: {
  ctx: CashCtx;
  oldSession: CashSession;
  registerId: string;
  onDone: (result: { closedDay: string }) => void;
  onDismiss: () => void;
}) {
  const toast = useToast();
  const navigate = useNavigate();
  const banks = useBankAccounts(ctx.orgId, true);
  const expectedQ = useExpectedCash(oldSession);
  const expected = expectedQ.data ?? oldSession.opening_cash;

  const pending = usePendingAppointments(ctx.branchId);
  const blockers = pending.data ?? { reservedToday: 0, overdue: 0, total: 0 };
  const blocked = blockers.total > 0;

  const [bulkOpen, setBulkOpen] = useState(false);
  const [counted, setCounted] = useState('');
  const [withdraw, setWithdraw] = useState('');
  const [destination, setDestination] = useState('');

  const cnt = counted === '' ? null : Number(counted);
  const diff = cnt == null ? null : cnt - expected;
  const out = withdraw === '' ? 0 : Number(withdraw);
  const left = cnt == null ? null : cnt - out;
  const tooMuch = cnt != null && out > cnt;
  const noDestination = out > 0 && !destination;

  const openedDay = ymd(new Date(oldSession.opened_at));

  const rollover = useRolloverCashMutation(
    ctx,
    oldSession,
    registerId,
    expected,
    (res) => {
      toast.success(
        'Día cerrado y caja de hoy abierta',
        `Fondo inicial de hoy: ${money(res.newSession.opening_cash)}`,
      );
      onDone({ closedDay: res.closedDay });
    },
  );

  return (
    <div className="space-y-4">
      <p className="flex items-start gap-2 rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-xs text-amber-100">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span>
          La caja quedó abierta desde el <b>{dateShort(openedDay)}</b>. Contá el
          efectivo que hay ahora: se usa para cerrar ese día y como fondo de
          apertura de hoy en un solo paso.
        </span>
      </p>

      <OpenedHeader session={oldSession} expected={expected} />

      <Input
        label="Efectivo contado ahora (físico en caja)"
        type="number"
        min="0"
        step="0.01"
        value={counted}
        onChange={(e) => setCounted(e.target.value)}
      />

      {cnt != null && (
        <div className="flex justify-between text-xs text-white/50">
          <span>Diferencia con lo esperado del día cerrado</span>
          <span
            className={cn(
              'font-semibold',
              diff === 0 ? 'text-white/70' : diff! < 0 ? 'text-danger' : 'text-success',
            )}
          >
            {money(diff ?? 0)}
          </span>
        </div>
      )}

      <CountCashFields
        cnt={cnt}
        withdraw={withdraw}
        onWithdrawChange={setWithdraw}
        destination={destination}
        onDestinationChange={setDestination}
        banks={banks.data ?? []}
        left={left}
      />

      {/* Lo que queda en caja arranca como fondo del día de hoy. Mostrarlo en
          grande evita la pregunta "¿cuánto quedó para hoy?" en la caja física. */}
      {cnt != null && (
        <div className="flex items-center justify-between rounded-xl border border-gold/30 bg-gold/[0.08] p-3">
          <div className="flex items-center gap-2 text-sm text-gold-100">
            <Repeat className="h-4 w-4" />
            <span>Fondo que arranca hoy</span>
          </div>
          <span className="text-base font-semibold text-gold-200">
            {money(Math.max(0, left ?? 0))}
          </span>
        </div>
      )}

      {tooMuch && (
        <p className="text-xs text-danger">
          No podés retirar más de lo que contaste en caja.
        </p>
      )}
      {noDestination && (
        <p className="text-xs text-danger">Elegí la cuenta donde entra el retiro.</p>
      )}

      {blocked && (
        <BlockingPanel
          reservedToday={blockers.reservedToday}
          overdue={blockers.overdue}
          onOpenBulk={() => setBulkOpen(true)}
          onGoTasks={() => {
            navigate(ROUTES.tasks);
            onDismiss();
          }}
        />
      )}

      <Button
        className="w-full"
        size="lg"
        disabled={cnt == null || tooMuch || noDestination || blocked}
        loading={rollover.isPending}
        onClick={() =>
          rollover.mutate({
            counted: cnt ?? 0,
            withdraw: out,
            destination: out > 0 ? destination : null,
          })
        }
      >
        <Repeat className="h-4 w-4" /> Cerrar ayer y abrir hoy
      </Button>
      {rollover.isError && (
        <p className="text-xs text-danger">
          {rollover.error instanceof Error
            ? rollover.error.message
            : 'Error en el cambio de día.'}
        </p>
      )}

      {bulkOpen && <CloseOverdueModal onClose={() => setBulkOpen(false)} />}
    </div>
  );
}

/** Cabecera compartida: apertura, fondo inicial y esperado. */
function OpenedHeader({
  session,
  expected,
}: {
  session: CashSession;
  expected: number;
}) {
  return (
    <div className="rounded-xl bg-white/5 p-3 text-xs text-white/60">
      <div className="flex justify-between">
        <span>Apertura</span>
        <span className="text-white">
          {dateShort(session.opened_at)} · {timeShort(session.opened_at)}
        </span>
      </div>
      <div className="mt-1 flex justify-between">
        <span>Fondo inicial</span>
        <span className="text-white">{money(session.opening_cash)}</span>
      </div>
      <div className="mt-1 flex justify-between">
        <span>Esperado en caja</span>
        <span className="font-semibold text-gold-200">{money(expected)}</span>
      </div>
    </div>
  );
}

/* ─────────────── Resumen del día + 2 CTAs ─────────────── */

function SummaryBody({
  sessionId,
  branchId,
  day,
  onViewMetrics,
  onGoCalendar,
}: {
  sessionId: string | null;
  branchId: string;
  day: string | null;
  onViewMetrics: () => void;
  onGoCalendar: () => void;
}) {
  const navigate = useNavigate();
  const metrics = useDayMetricsForSession(sessionId, branchId, day);
  const m = metrics.data;

  if (!day) {
    return (
      <p className="text-sm text-white/60">
        No hay un cierre reciente para resumir todavía.
      </p>
    );
  }

  const totalReceived = (m?.cashReceived ?? 0) + (m?.bankReceived ?? 0);
  const neto = totalReceived - (m?.expenses ?? 0);

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs uppercase tracking-wide text-white/40">Resumen</p>
        <h3 className="mt-0.5 text-lg font-semibold text-white">
          {dateShort(day)}
        </h3>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <MetricCard label="Ventas" value={String(m?.salesCount ?? 0)} />
        <MetricCard label="Total vendido" value={money(m?.salesTotal ?? 0)} gold />
        <MetricCard
          label="Cobrado en efectivo"
          value={money(m?.cashReceived ?? 0)}
          tone="success"
        />
        <MetricCard
          label="Cobrado a cuentas"
          value={money(m?.bankReceived ?? 0)}
          tone="success"
        />
        <MetricCard label="Gastos" value={money(m?.expenses ?? 0)} tone="danger" />
        <MetricCard
          label="Retirado al banco"
          value={money(m?.withdrawnToBank ?? 0)}
        />
      </div>

      <div className="rounded-xl bg-white/5 p-3 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-white/60">Neto del día</span>
          <span
            className={cn(
              'font-semibold',
              neto >= 0 ? 'text-success' : 'text-danger',
            )}
          >
            {money(neto)}
          </span>
        </div>
        {m?.difference !== 0 && m != null && (
          <div className="mt-1 flex items-center justify-between text-xs">
            <span className="text-white/50">Descuadre registrado</span>
            <span
              className={cn(
                'font-medium',
                m.difference < 0 ? 'text-danger' : 'text-success',
              )}
            >
              {money(m.difference)}
            </span>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3 text-xs text-white/60">
        <div className="flex items-center gap-2">
          <Wallet className="h-4 w-4 text-gold-300" />
          <span>
            Fondo que quedó en caja:{' '}
            <span className="font-semibold text-white">
              {money(m?.countedCash ?? 0)}
            </span>
          </span>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <Button
          variant="outline"
          className="h-12"
          onClick={() => {
            navigate(ROUTES.metrics);
            onViewMetrics();
          }}
        >
          <BarChart3 className="h-4 w-4" /> Ver tus métricas
        </Button>
        <Button
          className="h-12"
          onClick={() => {
            navigate(ROUTES.calendarView);
            onGoCalendar();
          }}
        >
          <CalendarDays className="h-4 w-4" /> Comenzar a agendar
        </Button>
      </div>
    </div>
  );
}

/* ───────── Hook de alto nivel para el guard diario del AppLayout ───────── */

export interface DailyCashState {
  loading: boolean;
  needsAction: boolean;
  mode: 'open' | 'rollover' | 'ok';
}

export function useDailyCashGuard(): DailyCashState {
  const branchId = useBranchId();
  const latest = useLatestCashSession(branchId);
  const today = ymd(new Date());
  const s = latest.data ?? null;

  if (latest.isLoading || !branchId) {
    return { loading: true, needsAction: false, mode: 'ok' };
  }
  if (s && s.status === 'open' && !isOpenedToday(s, today)) {
    return { loading: false, needsAction: true, mode: 'rollover' };
  }
  if (!s || (s.status === 'closed' && ymd(new Date(s.closed_at ?? s.opened_at)) !== today && (!isOpenedToday(s, today)))) {
    return { loading: false, needsAction: true, mode: 'open' };
  }
  return { loading: false, needsAction: false, mode: 'ok' };
}
