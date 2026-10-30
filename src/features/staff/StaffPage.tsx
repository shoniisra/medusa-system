import { useState, useMemo, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Users,
  Plus,
  HandCoins,
  Scale,
  CalendarOff,
  ChevronRight,
} from 'lucide-react';
import { query, queryOne, batch, execute, type Stmt } from '@/lib/db';
import { genId, money, dateShort, fullName, todayISO } from '@/lib/format';
import { useOrgId, useBranchId, useSession } from '@/store/session';
import {
  Card,
  CardHeader,
  Badge,
  Button,
  Select,
  Input,
  Modal,
  EmptyState,
  useToast,
} from '@/components/ui';
import { activityTotals, groupingForPeriod, periodBounds, timestampBounds, weekBounds, type ActivityRow, type Period } from './activityModel';
import { ActivityTable } from './ActivityTable';
import { ADJUST_COMMISSION_MARK, COMMISSION_BALANCE_SQL, commissionBalance, type CommissionBalanceData, type CommissionBalanceRow } from './commissionBalanceModel';
import { StaffMovements } from './StaffMovements';
import { StaffShell } from './StaffShell';
import { ROUTES } from '@/config/constants';
import { useTimeOff } from './useTimeOff';
import { invalidateFinance } from '@/lib/queryClient';
import {
  AccountSelect,
  paymentMethodFor,
  usePaymentMethods,
  useBankAccounts,
} from '@/features/cashflow/accounts';
import { expenseStatements } from '@/features/cashflow/expense';
import { staffExpenseCategoryId } from './staffExpense';
import type {
  CashSession,
  StaffMember,
} from '@/types';

/** Color de reserva para colaboradores sin color asignado. */
const NO_COLOR = '#64748b';

/** El mismo color con opacidad, para fondos y bordes teñidos (#RGB o #RRGGBB). */
function tint(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.replace(/./g, (c) => c + c) : h;
  if (full.length !== 6) return hex;
  const a = Math.round(alpha * 255)
    .toString(16)
    .padStart(2, '0');
  return `#${full}${a}`;
}

/** Punto con el color del colaborador, para identificarlo en filas y listas. */
function StaffDot({ color }: { color: string | null }) {
  const c = color || NO_COLOR;
  return (
    <span
      className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
      style={{ backgroundColor: c, boxShadow: `0 0 0 3px ${tint(c, 0.25)}` }}
    />
  );
}

/**
 * Fondo de una fila de colaborador: un degradado con su color, que se apaga
 * hacia la mitad para no pelearse con los números. Lo usan las tablas de
 * liquidación y de saldos, que antes lo repetían tal cual.
 */
function staffRowStyle(color: string | null): CSSProperties {
  return {
    background: `linear-gradient(90deg, ${tint(color || NO_COLOR, 0.16)}, transparent 45%)`,
  };
}

/** Primera celda de esas tablas: punto de color + nombre. */
function StaffNameCell({
  color,
  name,
}: {
  color: string | null;
  name: string;
}) {
  return (
    <td className="py-2 text-white">
      <span className="flex items-center gap-2">
        <StaffDot color={color} />
        <span className="truncate">{name}</span>
      </span>
    </td>
  );
}

/** Iniciales del colaborador teñidas con su color. */
function StaffInitials({
  first,
  last,
  color,
}: {
  first: string;
  last: string | null;
  color: string | null;
}) {
  const c = color || NO_COLOR;
  // Toma la inicial de las dos primeras palabras del nombre completo: algunos
  // colaboradores tienen el nombre y el apellido juntos en `first_name`.
  const words = `${first ?? ''} ${last ?? ''}`.trim().split(/\s+/);
  const initials =
    ((words[0]?.[0] ?? '') + (words[1]?.[0] ?? '')).toUpperCase() || '?';
  return (
    <span
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold"
      style={{
        backgroundColor: tint(c, 0.22),
        color: c,
        borderWidth: 1,
        borderStyle: 'solid',
        borderColor: tint(c, 0.55),
      }}
    >
      {initials}
    </span>
  );
}

export function StaffPage() {
  const orgId = useOrgId();
  const [advanceOpen, setAdvanceOpen] = useState(false);

  return (
    <StaffShell
      action={
        <Button onClick={() => setAdvanceOpen(true)}>
          <HandCoins className="h-4 w-4" /> Adelanto
        </Button>
      }
    >
      <CommissionBalanceSection orgId={orgId} />
      <TeamActivitySection orgId={orgId} />
      <AbsencesSummaryCard />

      <AdvanceModal open={advanceOpen} onClose={() => setAdvanceOpen(false)} />
    </StaffShell>
  );
}

function TeamActivitySection({ orgId }: { orgId: string }) {
  const branchId = useBranchId();
  const [period, setPeriod] = useState<Period>('day');
  const [anchor, setAnchor] = useState(todayISO);
  const grouping = groupingForPeriod(period);
  const [staffId, setStaffId] = useState('');
  const [tab, setTab] = useState<'activity' | 'movements'>('activity');
  const bounds = periodBounds(period, anchor);
  const { from, to } = bounds ?? { from: '', to: '' };
  const timestamps = bounds ? timestampBounds(from, to) : { start: '', end: '' };
  const staff = useQuery({
    queryKey: ['staff', orgId], enabled: !!orgId,
    queryFn: () => query<StaffMember>('SELECT * FROM staff_member WHERE organization_id = ? ORDER BY active DESC, first_name', [orgId]),
  });
  const rows = useQuery({
    queryKey: ['team-activity', branchId, from, to, timestamps.start, timestamps.end],
    enabled: !!branchId && !!bounds && tab === 'activity',
    queryFn: () => query<ActivityRow>(
      `SELECT sss.staff_member_id AS staff_id, si.description AS service,
              c.first_name || CASE WHEN c.last_name IS NOT NULL THEN ' ' || c.last_name ELSE '' END AS client,
              sss.basis_amount AS amount, sss.commission_amount AS commission,
              sss.participation_role AS role, sss.assist_label,
              s.sold_at, s.id AS sale_id, s.sale_number, s.appointment_id
       FROM sale s JOIN sale_item si ON si.sale_id = s.id
       JOIN sale_service_staff sss ON sss.sale_item_id = si.id
       LEFT JOIN customer c ON c.id = s.customer_id
       WHERE s.branch_id = ? AND s.status IN ('completed','partially_refunded')
         AND datetime(s.sold_at) >= datetime(?) AND datetime(s.sold_at) < datetime(?)
       ORDER BY s.sold_at DESC, s.id, si.id`,
      [branchId, timestamps.start, timestamps.end]),
  });
  const byStaff = useMemo(() => {
    const map = new Map<string, ActivityRow[]>();
    for (const row of rows.data ?? []) {
      const items = map.get(row.staff_id) ?? [];
      items.push(row);
      map.set(row.staff_id, items);
    }
    return map;
  }, [rows.data]);
  const members = (staff.data ?? []).filter(s => !staffId || s.id === staffId);
  const working = members.filter(s => byStaff.has(s.id));
  const idle = members.filter(s => !byStaff.has(s.id));
  const totals = activityTotals((rows.data ?? []).filter(row => !staffId || row.staff_id === staffId));

  return (
    <Card className="!p-3 sm:!p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-sm font-semibold text-white">Actividad del equipo</h2>
      <div className="flex flex-wrap gap-1">
        {(['activity', 'movements'] as const).map(value => <button key={value} type="button" aria-pressed={tab === value}
          onClick={() => setTab(value)} className={`rounded-lg px-3 py-1.5 text-xs font-medium ${tab === value ? 'bg-gold-400 text-ink-950' : 'text-white/60 hover:bg-white/5'}`}>
          {value === 'activity' ? 'Servicios y comisiones' : 'Adelantos y pagos'}
        </button>)}
      </div>
      </div>
      <div className="mb-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Select label="Período" value={period} onChange={e => setPeriod(e.target.value as Period)}>
          <option value="day">Día</option><option value="week">Semana</option><option value="month">Mes</option>
        </Select>
        <Input label={period === 'week' ? 'Fecha de la semana' : period === 'month' ? 'Fecha del mes' : 'Fecha'} type="date" value={anchor} onChange={e => setAnchor(e.target.value)} />
        <div className="col-span-2 sm:col-span-1">
          <Select label="Colaborador" value={staffId} onChange={e => setStaffId(e.target.value)}>
            <option value="">Todo el equipo</option>{(staff.data ?? []).map(s => <option key={s.id} value={s.id}>{fullName(s.first_name, s.last_name)}</option>)}
          </Select>
        </div>
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-white/50">
        <button type="button" className="rounded-lg border border-white/15 px-3 py-1.5 hover:bg-white/5" onClick={() => { setAnchor(todayISO()); setPeriod('day'); }}>Ir a hoy</button>
        {bounds ? <span>{dateShort(from + 'T12:00:00')} {from !== to && `— ${dateShort(to + 'T12:00:00')}`}</span> : <span role="alert" className="text-danger">Selecciona una fecha válida.</span>}
      </div>
      {bounds && (tab === 'movements' ? <StaffMovements branchId={branchId} from={from} to={to} staffId={staffId} /> : (
        rows.isError || staff.isError ? <p role="alert" className="text-sm text-danger">No se pudo cargar la actividad. <button onClick={() => { void rows.refetch(); void staff.refetch(); }} className="underline">Reintentar</button></p>
          : rows.isPending || staff.isPending ? <p role="status" className="text-sm text-white/50">Cargando actividad…</p> : <>
            <div className="mb-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-white/50">
              <span>{working.length} colaboradores con actividad</span>
              <span>Cobrado <strong className="text-white">{money(totals.billed)}</strong></span>
              <span>Comisiones <strong className="text-gold-200">{money(totals.commission)}</strong></span>
            </div>
            <div className="grid items-start gap-3 xl:grid-cols-2">
              {working.map(s => {
                const items = byStaff.get(s.id)!;
                const total = activityTotals(items);
                return <details key={`${s.id}:${grouping}:${from}:${to}`} open className="rounded-xl border border-white/10" style={{ borderLeft: `3px solid ${s.color || NO_COLOR}` }}>
                  <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl p-2 [&::-webkit-details-marker]:hidden text-white focus-visible:outline focus-visible:outline-gold-300">
                    <StaffInitials first={s.first_name} last={s.last_name} color={s.color} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{fullName(s.first_name, s.last_name)}</span>
                      <span className="block truncate text-xs text-white/50">{items.length} servicios · Cobrado {money(total.billed)}</span>
                    </span>
                    <span className="shrink-0 text-right text-sm font-semibold tabular-nums text-gold-200">
                      {money(total.commission)}
                      <span className="block text-[10px] font-normal text-white/40">comisión</span>
                    </span>
                  </summary>
                  <ActivityTable items={items} period={period} />
                </details>;
              })}
              {!working.length && <EmptyState icon={Users} title="Sin servicios en este período" />}
              {idle.length > 0 && <details className="rounded-xl border border-dashed border-white/10 p-3 text-sm text-white/50"><summary className="cursor-pointer">Sin actividad en el período ({idle.length})</summary><div className="mt-3 flex flex-wrap gap-2">{idle.map(s => <span key={s.id} className="flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2"><StaffDot color={s.color} />{fullName(s.first_name, s.last_name)}{!s.active && <Badge tone="muted">Inactivo</Badge>}</span>)}</div></details>}
            </div>
          </>
      ))}
    </Card>
  );
}

/** Saldo actual y movimientos de la semana, con arrastre de semanas anteriores. */
function CommissionBalanceSection({ orgId }: { orgId: string }) {
  const branchId = useBranchId();
  const [adjust, setAdjust] = useState<CommissionBalanceRow | null>(null);
  const [pay, setPay] = useState<CommissionBalanceRow | null>(null);
  const [showZero, setShowZero] = useState(false);

  const week = weekBounds(new Date());
  const today = todayISO();
  const weekStart = timestampBounds(week.from, week.to).start;
  const bal = useQuery({
    queryKey: ['commission-balance', branchId, orgId, week.from, today, weekStart],
    enabled: !!branchId && !!orgId,
    queryFn: async (): Promise<CommissionBalanceRow[]> => {
      const data = await query<CommissionBalanceData>(COMMISSION_BALANCE_SQL, [
        orgId, branchId, weekStart, week.from, today, new Date().toISOString(),
      ]);
      return data.map(commissionBalance);
    },
  });

  const rows = bal.data ?? [];
  const visibleRows = rows.filter(r => showZero || r.opening !== 0 || r.earned_week !== 0 || r.advances_week !== 0 || r.paid_week !== 0 || r.adjustments_week !== 0 || r.pending !== 0);
  const zeroCount = rows.length - visibleRows.length;
  const hasAdjustments = rows.some(r => r.adjustments_week !== 0);
  const totalPending = rows.reduce((a, r) => a + r.pending, 0);

  return (
    <Card className="!p-3 sm:!p-4">
      <CardHeader
        title="Comisiones · saldo actual"
        subtitle={`Esta semana: ${dateShort(week.from)} — ${dateShort(week.to)} · Movimientos hasta hoy`}
        action={<label className="flex shrink-0 items-center gap-2 text-xs text-white/50"><input type="checkbox" checked={showZero} onChange={e => setShowZero(e.target.checked)} className="rounded border-white/20 bg-white/5 text-gold-400" />Sin actividad{zeroCount > 0 ? ` (${zeroCount})` : ''}</label>}
      />
      <p className="mb-3 hidden text-xs text-white/50 sm:block">Saldo anterior + generado esta semana − adelantos − pagos{hasAdjustments ? ' − cuadres' : ''} = pendiente actual.</p>
      {bal.isError ? <p role="alert" className="text-sm text-danger">No se pudieron cargar los saldos. <button className="underline" onClick={() => void bal.refetch()}>Reintentar</button></p>
        : bal.isPending ? <p role="status" className="text-sm text-white/50">Cargando saldos…</p>
        : rows.length > 0 ? (<>
        {/* Teléfono: una fila por colaborador con el pendiente a la vista y el
            desglose de la semana en una línea; la tabla completa desde `sm`. */}
        <div className="sm:hidden">
          <div className="mb-1 flex items-baseline justify-between rounded-lg bg-gold-400/5 px-2 py-1.5 text-sm">
            <span className="text-white/70">Pendiente total</span>
            <span className="font-semibold tabular-nums text-gold-200">{money(totalPending)}</span>
          </div>
          <ul className="divide-y divide-white/5">
            {visibleRows.map((r) => (
              <li key={r.staff_member_id} className="flex items-center gap-2 px-1 py-2" style={staffRowStyle(r.color)}>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-sm text-white">
                    <StaffDot color={r.color} />
                    <span className="truncate">{r.staff_name}</span>
                  </p>
                  <p className="truncate text-[11px] tabular-nums text-white/40">
                    Ant. {money(r.opening)} · Gen. {money(r.earned_week)}
                    {r.advances_week ? ` · Adel. −${money(r.advances_week)}` : ''}
                    {r.paid_week ? ` · Pag. −${money(r.paid_week)}` : ''}
                    {r.adjustments_week ? ` · Cuadre ${adjustmentLabel(r.adjustments_week)}` : ''}
                  </p>
                </div>
                <span className={`shrink-0 text-sm font-semibold tabular-nums ${r.pending >= 0 ? 'text-gold-200' : 'text-danger'}`}>
                  {money(r.pending)}
                </span>
                <BalanceActions row={r} onPay={setPay} onAdjust={setAdjust} compact />
              </li>
            ))}
          </ul>
        </div>
        <div className="hidden overflow-x-auto sm:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-white/40">
                <th className="pb-2">Colaborador</th>
                <th className="px-2 pb-2 text-right" title="Saldo que quedó al iniciar el lunes, incluidos pendientes o créditos anteriores">Saldo anterior</th>
                <th className="px-2 pb-2 text-right">Generado<span className="block text-[10px] font-normal normal-case">esta semana</span></th>
                <th className="px-2 pb-2 text-right">Adelantos<span className="block text-[10px] font-normal normal-case">esta semana</span></th>
                <th className="px-2 pb-2 text-right">Pagos<span className="block text-[10px] font-normal normal-case">esta semana</span></th>
                {hasAdjustments && <th className="px-2 pb-2 text-right">Cuadres<span className="block text-[10px] font-normal normal-case">esta semana</span></th>}
                <th className="bg-gold-400/5 px-3 pb-2 text-right text-gold-200">Pendiente actual<span className="block text-[10px] font-normal normal-case text-white/40">incluye saldos anteriores</span></th>
                <th className="pb-2 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {visibleRows.map((r) => (
                <tr key={r.staff_member_id} style={staffRowStyle(r.color)}>
                  <StaffNameCell color={r.color} name={r.staff_name} />
                  <td className="px-2 py-2 text-right tabular-nums text-white/50">{money(r.opening)}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-white/80">{money(r.earned_week)}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-white/60">{r.advances_week ? `−${money(r.advances_week)}` : '—'}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-white/60">{r.paid_week ? `−${money(r.paid_week)}` : '—'}</td>
                  {hasAdjustments && <td className="px-2 py-2 text-right tabular-nums text-white/50">{r.adjustments_week ? adjustmentLabel(r.adjustments_week) : '—'}</td>}
                  <td
                    className={`bg-gold-400/5 px-3 py-2 text-right font-semibold tabular-nums ${
                      r.pending >= 0 ? 'text-gold-200' : 'text-danger'
                    }`}
                  >
                    {money(r.pending)}
                  </td>
                  <td className="py-2">
                    <BalanceActions row={r} onPay={setPay} onAdjust={setAdjust} />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-white/10 text-sm font-semibold">
                <td className="pt-2 text-white/70" colSpan={hasAdjustments ? 6 : 5}>
                  Saldo pendiente total
                </td>
                <td className="pt-2 text-right text-gold-200">
                  {money(totalPending)}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </>) : (
        <EmptyState
          icon={Users}
          title="Sin colaboradores activos"
          description="Agregá colaboradores para ver su saldo de comisiones."
        />
      )}
      <details className="mt-2 text-xs text-white/40">
        <summary className="cursor-pointer">Cómo leer estos saldos</summary>
        <p className="mt-1">Saldo anterior: pendiente al iniciar el lunes. Generado, adelantos y pagos: solo esta semana. El pendiente actual incluye todo lo que aún se debe; un importe negativo es saldo a favor del negocio. Los adelantos de semanas anteriores ya están incluidos en el saldo anterior y no se descuentan otra vez. El historial completo sigue en Adelantos y pagos.</p>
        <p className="mt-1">Los cuadres ajustan el saldo sin representar dinero entregado ni afectar la caja.</p>
      </details>

      {adjust && (
        <AdjustCommissionModal
          orgId={orgId}
          row={adjust}
          onClose={() => setAdjust(null)}
        />
      )}
      {pay && (
        <PayCommissionModal
          orgId={orgId}
          row={pay}
          onClose={() => setPay(null)}
        />
      )}
    </Card>
  );
}

/** Cuadre en la convención del saldo: positivo baja el pendiente. */
function adjustmentLabel(v: number): string {
  return `${v > 0 ? '−' : '+'}${money(Math.abs(v))}`;
}

/** Pagar (si hay pendiente) + Cuadrar; `compact` deja solo los íconos. */
function BalanceActions({
  row,
  onPay,
  onAdjust,
  compact,
}: {
  row: CommissionBalanceRow;
  onPay: (r: CommissionBalanceRow) => void;
  onAdjust: (r: CommissionBalanceRow) => void;
  compact?: boolean;
}) {
  return (
    <div className="flex shrink-0 items-center justify-end gap-1.5 sm:gap-2">
      {row.pending > 0.001 && (
        <Button size="sm" onClick={() => onPay(row)} title="Pagar comisiones">
          <HandCoins className="h-4 w-4" />
          {!compact && ' Pagar'}
        </Button>
      )}
      <button
        title="Cuadrar saldo (ajustar pendiente real)"
        aria-label="Cuadrar saldo"
        onClick={() => onAdjust(row)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs font-medium text-white/60 hover:border-white/25 hover:bg-white/5 hover:text-gold-300"
      >
        <Scale className="h-3.5 w-3.5" />
        {!compact && ' Cuadrar'}
      </button>
    </div>
  );
}

function AdjustCommissionModal({
  orgId,
  row,
  onClose,
}: {
  orgId: string;
  row: CommissionBalanceRow;
  onClose: () => void;
}) {
  const branchId = useBranchId();
  const userId = useSession((s) => s.user?.id ?? null);
  const qc = useQueryClient();
  const toast = useToast();
  const [real, setReal] = useState(String(row.pending.toFixed(2)));

  const methods = usePaymentMethods(orgId, true);

  const diff = Math.round((row.pending - Number(real)) * 100) / 100;

  const save = useMutation({
    mutationFn: async () => {
      if (diff === 0) return;
      // Un adelanto marcado reduce el pendiente acumulado (o lo aumenta si es
      // negativo). No genera egreso ni movimiento de caja: es solo un ajuste.
      const method =
        methods.data?.find((m) => m.method_type === 'transfer') ??
        methods.data?.[0];
      if (!method) throw new Error('No hay un método de pago configurado.');
      await execute(
        `INSERT INTO staff_advance
           (id, organization_id, branch_id, staff_member_id, advance_date, amount,
            payment_method_id, bank_account_id, cash_session_id, notes, status, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, 'confirmed', ?)`,
        [
          genId(),
          orgId,
          branchId,
          row.staff_member_id,
          todayISO(),
          diff,
          method.id,
          `${ADJUST_COMMISSION_MARK} · pendiente ${money(row.pending)} → ${money(
            Number(real),
          )}`,
          userId,
        ],
      );
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['commission-balance'] });
      void qc.invalidateQueries({ queryKey: ['staff-movements'] });
      onClose();
      toast.success('Comisiones cuadradas', `${row.staff_name} · ${money(Number(real) || 0)}`);
    },
    onError: (e: Error) => toast.error('No se pudo cuadrar', e.message),
  });

  return (
    <Modal open onClose={onClose} title={`Cuadrar comisiones · ${row.staff_name}`}>
      <div className="space-y-4">
        <div className="rounded-xl bg-white/5 p-3 text-sm">
          <div className="flex justify-between text-white/60">
            <span>Pendiente en el sistema</span>
            <span className="font-medium text-white">{money(row.pending)}</span>
          </div>
        </div>
        <Input
          label="Pendiente real (lo que le debés hoy)"
          type="number"
          step="0.01"
          value={real}
          onChange={(e) => setReal(e.target.value)}
        />
        {diff !== 0 && (
          <p className="text-xs text-white/50">
            Se registrará un ajuste de{' '}
            <span
              className={`font-semibold ${
                diff > 0 ? 'text-danger' : 'text-success'
              }`}
            >
              {diff > 0 ? '−' : '+'}
              {money(Math.abs(diff))}
            </span>{' '}
            sobre el pendiente para cuadrarlo.
          </p>
        )}
        <Button
          className="w-full"
          disabled={diff === 0}
          loading={save.isPending}
          onClick={() => save.mutate()}
        >
          <Scale className="h-4 w-4" /> Cuadrar comisiones
        </Button>
      </div>
    </Modal>
  );
}

/**
 * Pagar / liquidar comisiones pendientes de un colaborador en un paso:
 * registra un `staff_payment` (baja el pendiente) y el `expense` correspondiente
 * (egreso real que afecta la cuenta y el P&L). En efectivo mueve la caja.
 */
function PayCommissionModal({
  orgId,
  row,
  onClose,
}: {
  orgId: string;
  row: CommissionBalanceRow;
  onClose: () => void;
}) {
  const branchId = useBranchId();
  const userId = useSession((s) => s.user?.id ?? null);
  const qc = useQueryClient();
  const toast = useToast();

  const [amount, setAmount] = useState(String(row.pending.toFixed(2)));
  const [account, setAccount] = useState(''); // 'cash' | bank id

  const methods = usePaymentMethods(orgId, true);
  const banks = useBankAccounts(orgId, true);
  const session = useQuery({
    queryKey: ['cash-session', branchId],
    enabled: !!branchId,
    queryFn: () =>
      queryOne<CashSession>(
        `SELECT cs.* FROM cash_session cs
           JOIN cash_register cr ON cr.id = cs.cash_register_id
          WHERE cr.branch_id = ? AND cs.status = 'open'
          ORDER BY cs.opened_at DESC LIMIT 1`,
        [branchId],
      ),
  });

  const isCash = account === 'cash';
  const sessionId = session.data?.id ?? null;
  const needsSession = isCash && !sessionId;
  const value = Number(amount);
  const overflow = value > row.pending + 0.001;

  const save = useMutation({
    mutationFn: async () => {
      const method = paymentMethodFor(methods.data, banks.data, account);
      if (!method) throw new Error('No hay un método de pago configurado.');
      const bankId = isCash ? null : account;

      const categoryId = await staffExpenseCategoryId(orgId, 'commission');

      const label = `Pago de comisiones · ${row.staff_name}`;
      const paymentId = genId();
      const now = new Date().toISOString();

      const stmts: Stmt[] = [
        {
          sql: `INSERT INTO staff_payment
                  (id, organization_id, branch_id, staff_member_id, pay_period_id,
                   paid_at, gross_commission, advances_discount, other_deductions,
                   net_paid, payment_method_id, bank_account_id, cash_session_id,
                   status, reference, created_by)
                VALUES (?, ?, ?, ?, NULL, ?, ?, 0, 0, ?, ?, ?, ?, 'confirmed', ?, ?)`,
          args: [
            paymentId,
            orgId,
            branchId,
            row.staff_member_id,
            now,
            value,
            value,
            method.id,
            bankId,
            isCash ? sessionId : null,
            label,
            userId,
          ],
        },
      ];

      // Egreso real (afecta cuenta/caja y P&L).
      stmts.push(
        ...expenseStatements({
          orgId,
          branchId,
          expenseCategoryId: categoryId,
          paymentMethodId: method.id,
          bankAccountId: bankId,
          cashSessionId: sessionId,
          description: label,
          amount: value,
          userId,
        }),
      );

      await batch(stmts);
    },
    onSuccess: () => {
      invalidateFinance(qc, branchId);
      onClose();
      toast.success('Comisiones pagadas', `${row.staff_name} · ${money(Number(amount) || 0)}`);
    },
    onError: (e: Error) => toast.error('No se pudo pagar', e.message),
  });

  return (
    <Modal open onClose={onClose} title={`Pagar comisiones · ${row.staff_name}`}>
      <div className="space-y-4">
        <div className="rounded-xl bg-white/5 p-3 text-sm">
          <div className="flex justify-between text-white/60">
            <span>Pendiente</span>
            <span className="kpi-gold">{money(row.pending)}</span>
          </div>
        </div>
        <Input
          label="Monto a pagar"
          type="number"
          min="0"
          step="0.01"
          max={row.pending}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <AccountSelect
          label="Pagar desde"
          value={account}
          onChange={setAccount}
          accounts={banks.data}
        />
        {overflow && (
          <p className="text-xs text-danger">
            El monto supera el pendiente ({money(row.pending)}).
          </p>
        )}
        {needsSession && (
          <p className="text-xs text-danger">
            Para pagar en efectivo necesitás abrir la caja primero.
          </p>
        )}
        <p className="text-xs text-white/40">
          Se registra como egreso y baja el pendiente del colaborador.
        </p>
        <Button
          className="w-full"
          disabled={
            !account ||
            !value ||
            value <= 0 ||
            overflow ||
            needsSession
          }
          loading={save.isPending}
          onClick={() => save.mutate()}
        >
          <HandCoins className="h-4 w-4" /> Registrar pago
        </Button>
      </div>
    </Modal>
  );
}

function AdvanceModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const orgId = useOrgId();
  const branchId = useBranchId();
  const userId = useSession((s) => s.user?.id ?? null);
  const qc = useQueryClient();
  const toast = useToast();

  const [staffId, setStaffId] = useState('');
  const [amount, setAmount] = useState('');
  const [account, setAccount] = useState(''); // 'cash' | id de cuenta bancaria

  const staff = useQuery({
    queryKey: ['staff', orgId],
    enabled: open && !!orgId,
    queryFn: () =>
      query<StaffMember>(
        'SELECT * FROM staff_member WHERE organization_id = ? AND active = 1 ORDER BY first_name',
        [orgId],
      ),
  });

  const methods = usePaymentMethods(orgId, open);

  const banks = useBankAccounts(orgId, open);

  // Sesión de caja abierta: necesaria para descontar un adelanto en efectivo.
  const session = useQuery({
    queryKey: ['cash-session', branchId],
    enabled: open && !!branchId,
    queryFn: () =>
      queryOne<CashSession>(
        `SELECT cs.* FROM cash_session cs
           JOIN cash_register cr ON cr.id = cs.cash_register_id
          WHERE cr.branch_id = ? AND cs.status = 'open'
          ORDER BY cs.opened_at DESC LIMIT 1`,
        [branchId],
      ),
  });

  const isCash = account === 'cash';
  const sessionId = session.data?.id ?? null;
  const needsSession = isCash && !sessionId;
  const selected = staff.data?.find((s) => s.id === staffId) ?? null;

  const save = useMutation({
    mutationFn: async () => {
      const method = paymentMethodFor(methods.data, banks.data, account);
      if (!method) throw new Error('No hay un método de pago configurado.');
      const bankId = isCash ? null : account;

      const categoryId = await staffExpenseCategoryId(orgId, 'advance');

      const person = staff.data?.find((s) => s.id === staffId);
      const label = `Adelanto de sueldo · ${
        person ? fullName(person.first_name, person.last_name) : ''
      }`.trim();
      const advanceId = genId();

      const stmts: Stmt[] = [
        {
          sql: `INSERT INTO staff_advance
                  (id, organization_id, branch_id, staff_member_id, advance_date, amount,
                   payment_method_id, bank_account_id, cash_session_id, status, created_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?)`,
          args: [
            advanceId,
            orgId,
            branchId,
            staffId,
            todayISO(),
            Number(amount),
            method.id,
            bankId,
            isCash ? sessionId : null,
            userId,
          ],
        },
      ];

      // Se registra también como egreso (y descuenta la caja si es efectivo).
      stmts.push(
        ...expenseStatements({
          orgId,
          branchId,
          expenseCategoryId: categoryId,
          paymentMethodId: method.id,
          bankAccountId: bankId,
          cashSessionId: sessionId,
          description: label,
          amount: Number(amount),
          userId,
        }),
      );

      await batch(stmts);
    },
    onSuccess: () => {
      toast.success(
        'Adelanto registrado',
        `${selected ? fullName(selected.first_name, selected.last_name) : 'Colaborador'} · ${money(Number(amount) || 0)}`,
      );
      setStaffId('');
      setAmount('');
      setAccount('');
      invalidateFinance(qc, branchId);
      onClose();
    },
    onError: (e: Error) => toast.error('No se pudo registrar el adelanto', e.message),
  });

  return (
    <Modal open={open} onClose={onClose} title="Registrar adelanto de sueldo">
      <div className="space-y-4">
        <Select
          label="Colaborador"
          value={staffId}
          onChange={(e) => setStaffId(e.target.value)}
        >
          <option value="">Seleccionar…</option>
          {staff.data?.map((s) => (
            <option key={s.id} value={s.id}>
              {fullName(s.first_name, s.last_name)}
            </option>
          ))}
        </Select>
        {selected && (
          <div
            className="flex items-center gap-2.5 rounded-xl border p-2.5"
            style={{
              borderColor: tint(selected.color || NO_COLOR, 0.4),
              background: `linear-gradient(135deg, ${tint(
                selected.color || NO_COLOR,
                0.18,
              )}, transparent 70%)`,
            }}
          >
            <StaffInitials
              first={selected.first_name}
              last={selected.last_name}
              color={selected.color}
            />
            <p className="truncate text-sm font-medium text-white">
              {fullName(selected.first_name, selected.last_name)}
            </p>
          </div>
        )}
        <Input
          label="Monto"
          type="number"
          min="0"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <AccountSelect
          label="Cuenta"
          value={account}
          onChange={setAccount}
          accounts={banks.data}
        />
        {needsSession && (
          <p className="text-xs text-danger">
            Para un adelanto en efectivo necesitás abrir la caja primero.
          </p>
        )}
        <p className="text-xs text-white/40">
          Se registra automáticamente como egreso.
        </p>
        <Button
          className="w-full"
          disabled={!staffId || !amount || !account || needsSession}
          loading={save.isPending}
          onClick={() => save.mutate()}
        >
          <Plus className="h-4 w-4" /> Guardar adelanto
        </Button>
      </div>
    </Modal>
  );
}

/* ──────────────────── Resumen de ausencias y cierres ──────────────────── */

/** "24 sep 2026" o "24 sep – 3 dic 2026" según el rango. */
function rangeLabel(a: string, b: string): string {
  return a === b ? dateShort(a) : `${dateShort(a)} – ${dateShort(b)}`;
}

/**
 * Tarjeta resumen que vive en /personal: muestra qué hay vigente hoy y lo más
 * próximo, con un botón que lleva a la pantalla completa (/personal/ausencias)
 * para registrar, ver conflictos y la línea de tiempo.
 */
function AbsencesSummaryCard() {
  const orgId = useOrgId();
  const timeOff = useTimeOff();
  const staff = useQuery({
    queryKey: ['staff-all', orgId],
    enabled: !!orgId,
    queryFn: () =>
      query<StaffMember>(
        'SELECT * FROM staff_member WHERE organization_id = ? ORDER BY first_name',
        [orgId],
      ),
  });
  const nameOf = (id: string | null): string => {
    if (!id) return 'Todo el local';
    const s = staff.data?.find((x) => x.id === id);
    return s ? fullName(s.first_name, s.last_name) : '—';
  };

  const today = todayISO();
  const rows = timeOff.data ?? [];
  const current = rows.filter((r) => r.start_date <= today && r.end_date >= today);
  const upcoming = rows
    .filter((r) => r.start_date > today)
    .slice(0, 3);

  return (
    <Card>
      <CardHeader
        title="Ausencias y cierres"
        subtitle="Vacaciones del equipo y días cerrados. El agendado respeta estas fechas."
        action={
          <Link to={ROUTES.staffAbsences}>
            <Button size="sm" variant="outline">
              Gestionar <ChevronRight className="h-4 w-4" />
            </Button>
          </Link>
        }
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={CalendarOff}
          title="Sin ausencias ni cierres"
          description="Registrá una vacación, un permiso o un día de cierre para que el agendado lo respete."
          action={
            <Link to={ROUTES.staffAbsences}>
              <Button size="sm">
                <Plus className="h-4 w-4" /> Registrar
              </Button>
            </Link>
          }
        />
      ) : (
        <div className="space-y-3 text-sm">
          <div>
            <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-white/50">
              Hoy
            </p>
            {current.length === 0 ? (
              <p className="text-white/50">Todo el equipo disponible.</p>
            ) : (
              <ul className="space-y-1">
                {current.map((r) => (
                  <li key={r.id} className="text-white/80">
                    {nameOf(r.staff_member_id)} ·{' '}
                    <span className="text-white/50">
                      hasta {dateShort(r.end_date)}
                      {r.reason ? ` · ${r.reason}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {upcoming.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-white/50">
                Próximas
              </p>
              <ul className="space-y-1">
                {upcoming.map((r) => (
                  <li key={r.id} className="text-white/80">
                    {nameOf(r.staff_member_id)} ·{' '}
                    <span className="text-white/50">
                      {rangeLabel(r.start_date, r.end_date)}
                      {r.reason ? ` · ${r.reason}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

