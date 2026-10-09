import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, History, Receipt, Search } from 'lucide-react';
import { query } from '@/lib/db';
import { ROUTES } from '@/config/constants';
import { dateShort, money, timeShort } from '@/lib/format';
import { useBranchId } from '@/store/session';
import { cn } from '@/lib/cn';
import { Badge, Card, EmptyState, Select } from '@/components/ui';
import { useStaff } from '@/features/pos/useCatalog';
import { customerNameSql } from '@/features/clients/customerNameSql';
import {
  NO_CHARGE_MARK,
  ToggleBtn,
  rangeFor,
  shiftAnchor,
  ymd,
  type RangeMode,
} from '@/features/calendar/appointmentBoard';
import { SaleDetailModal } from '@/features/sales/SaleDetailModal';
import { MetricCard } from '@/features/cashflow/MetricCard';

/** Una atención ya hecha: cita atendida o venta directa del POS. */
interface HistoryRow {
  id: string;
  kind: 'appointment' | 'pos';
  at: string;
  customer_id: string | null;
  customer_name: string | null;
  phone: string | null;
  /** Servicios/productos separados por " · ". */
  detail: string | null;
  /** Nombres de quienes atendieron, separados por ", ". */
  staff_names: string | null;
  /** IDs de quienes atendieron, separados por ",". Para filtrar. */
  staff_ids: string | null;
  sale_id: string | null;
  appointment_id: string | null;
  total: number | null;
  notes: string | null;
}

type KindFilter = 'all' | 'appointment' | 'pos';

/**
 * Citas atendidas + ventas del POS en un rango. La agenda solo muestra lo que
 * está por atender; acá queda lo que ya pasó, venga de una cita o del
 * mostrador, con quién lo hizo y cuánto se cobró.
 *
 * En las citas con venta, las colaboradoras salen de la venta (es lo que define
 * la comisión); si no hay venta, de lo asignado en la cita.
 */
function useAttentionHistory(from: string, to: string) {
  const branchId = useBranchId();
  return useQuery({
    queryKey: ['attention-history', branchId, from, to],
    enabled: !!branchId,
    queryFn: () =>
      query<HistoryRow>(
        `SELECT * FROM (
           SELECT a.id AS id, 'appointment' AS kind, a.start_at AS at,
                  a.customer_id AS customer_id,
                  ${customerNameSql()} AS customer_name,
                  c.phone AS phone,
                  COALESCE(
                    (SELECT GROUP_CONCAT(si.description, ' · ')
                       FROM sale_item si WHERE si.sale_id = s.id),
                    (SELECT GROUP_CONCAT(COALESCE(sv.name, ai.description), ' · ')
                       FROM appointment_item ai
                       LEFT JOIN service sv ON sv.id = ai.service_id
                      WHERE ai.appointment_id = a.id)
                  ) AS detail,
                  COALESCE(
                    (SELECT GROUP_CONCAT(DISTINCT sm.first_name)
                       FROM sale_item si
                       JOIN sale_service_staff sss ON sss.sale_item_id = si.id
                       JOIN staff_member sm ON sm.id = sss.staff_member_id
                      WHERE si.sale_id = s.id),
                    (SELECT GROUP_CONCAT(DISTINCT sm.first_name)
                       FROM appointment_item ai
                       JOIN staff_member sm ON sm.id = ai.assigned_staff_id
                      WHERE ai.appointment_id = a.id)
                  ) AS staff_names,
                  COALESCE(
                    (SELECT GROUP_CONCAT(DISTINCT sss.staff_member_id)
                       FROM sale_item si
                       JOIN sale_service_staff sss ON sss.sale_item_id = si.id
                      WHERE si.sale_id = s.id),
                    (SELECT GROUP_CONCAT(DISTINCT ai.assigned_staff_id)
                       FROM appointment_item ai
                      WHERE ai.appointment_id = a.id AND ai.assigned_staff_id IS NOT NULL)
                  ) AS staff_ids,
                  s.id AS sale_id, a.id AS appointment_id,
                  s.total AS total, a.notes AS notes
             FROM appointment a
             LEFT JOIN customer c ON c.id = a.customer_id
             LEFT JOIN sale s ON s.id = (SELECT s2.id FROM sale s2
                                          WHERE s2.appointment_id = a.id
                                            AND s2.status <> 'voided'
                                          ORDER BY s2.created_at DESC LIMIT 1)
            WHERE a.branch_id = ? AND a.status = 'attended'
              AND date(a.start_at) BETWEEN ? AND ?
           UNION ALL
           SELECT s.id AS id, 'pos' AS kind, s.sold_at AS at,
                  s.customer_id AS customer_id,
                  ${customerNameSql()} AS customer_name,
                  c.phone AS phone,
                  (SELECT GROUP_CONCAT(si.description, ' · ')
                     FROM sale_item si WHERE si.sale_id = s.id) AS detail,
                  (SELECT GROUP_CONCAT(DISTINCT sm.first_name)
                     FROM sale_item si
                     JOIN sale_service_staff sss ON sss.sale_item_id = si.id
                     JOIN staff_member sm ON sm.id = sss.staff_member_id
                    WHERE si.sale_id = s.id) AS staff_names,
                  (SELECT GROUP_CONCAT(DISTINCT sss.staff_member_id)
                     FROM sale_item si
                     JOIN sale_service_staff sss ON sss.sale_item_id = si.id
                    WHERE si.sale_id = s.id) AS staff_ids,
                  s.id AS sale_id, NULL AS appointment_id,
                  s.total AS total, s.notes AS notes
             FROM sale s
             LEFT JOIN customer c ON c.id = s.customer_id
            WHERE s.branch_id = ? AND s.appointment_id IS NULL
              AND s.status <> 'voided'
              AND date(s.sold_at) BETWEEN ? AND ?
         ) t
         ORDER BY t.at DESC`,
        [branchId, from, to, branchId, from, to],
      ),
  });
}

export function HistoryPage() {
  const navigate = useNavigate();
  const staff = useStaff();

  const [mode, setMode] = useState<RangeMode>('today');
  const [anchor, setAnchor] = useState(() => ymd(new Date()));
  const [kind, setKind] = useState<KindFilter>('all');
  const [staffId, setStaffId] = useState('');
  const [q, setQ] = useState('');
  const [openSale, setOpenSale] = useState<string | null>(null);

  const { from, to, label } = useMemo(() => rangeFor(mode, anchor), [mode, anchor]);
  const history = useAttentionHistory(from, to);

  const rows = useMemo(() => {
    let list = history.data ?? [];
    if (kind !== 'all') list = list.filter((r) => r.kind === kind);
    if (staffId)
      list = list.filter((r) => (r.staff_ids ?? '').split(',').includes(staffId));
    const needle = q.trim().toLowerCase();
    if (needle) {
      list = list.filter((r) =>
        [r.customer_name, r.detail, r.staff_names, r.phone, r.notes].some((v) =>
          (v ?? '').toLowerCase().includes(needle),
        ),
      );
    }
    return list;
  }, [history.data, kind, staffId, q]);

  const total = rows.reduce((a, r) => a + (r.total ?? 0), 0);
  const isToday = anchor === ymd(new Date());

  const open = (r: HistoryRow) => {
    if (r.kind === 'appointment') navigate(`${ROUTES.appointment}/${r.id}`);
    else setOpenSale(r.id);
  };

  return (
    <div className="mx-auto max-w-[1200px] space-y-3 lg:space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <h1 className="text-xl font-semibold text-white lg:text-2xl">Historial</h1>
          <Badge tone="gold">Atendidas</Badge>
        </div>
      </div>

      {/* Rango */}
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <div className="flex rounded-xl bg-white/5 p-1">
          {(['today', 'week', 'month'] as const).map((m) => (
            <ToggleBtn
              key={m}
              active={mode === m}
              onClick={() => {
                setMode(m);
              }}
            >
              {m === 'today' ? 'Día' : m === 'week' ? 'Semana' : 'Mes'}
            </ToggleBtn>
          ))}
        </div>
        <div className="flex flex-1 items-center gap-1">
          <button
            onClick={() => setAnchor(shiftAnchor(mode, anchor, -1))}
            aria-label="Anterior"
            className="tap flex h-10 w-10 items-center justify-center rounded-xl bg-white/5 text-white/60 hover:text-white"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <span className="min-w-0 flex-1 truncate text-center text-sm capitalize text-white/80">
            {label}
          </span>
          <button
            onClick={() => setAnchor(shiftAnchor(mode, anchor, 1))}
            aria-label="Siguiente"
            className="tap flex h-10 w-10 items-center justify-center rounded-xl bg-white/5 text-white/60 hover:text-white"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
          {!isToday && (
            <button
              onClick={() => setAnchor(ymd(new Date()))}
              className="tap rounded-xl px-3 text-xs font-medium text-gold-300 hover:underline"
            >
              Hoy
            </button>
          )}
        </div>
      </div>

      {/* Filtros */}
      <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Cliente, servicio, colaboradora, teléfono…"
            className="h-11 w-full rounded-xl border border-white/10 bg-ink-800/60 pl-9 pr-3 text-sm text-white placeholder:text-white/30 focus:border-gold-400/50 focus:outline-none"
          />
        </div>
        <div className="flex rounded-xl bg-white/5 p-1">
          {(
            [
              ['all', 'Todas'],
              ['appointment', 'Citas'],
              ['pos', 'POS'],
            ] as const
          ).map(([k, l]) => (
            <ToggleBtn key={k} active={kind === k} onClick={() => setKind(k)}>
              {l}
            </ToggleBtn>
          ))}
        </div>
        <div className="sm:min-w-[200px]">
          <Select value={staffId} onChange={(e) => setStaffId(e.target.value)}>
            <option value="">Todas las colaboradoras</option>
            {(staff.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.first_name}
                {s.last_name ? ` ${s.last_name}` : ''}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <MetricCard label="Atenciones" value={String(rows.length)} />
        <MetricCard label="Vendido" value={money(total)} gold />
      </div>

      {history.isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-2xl bg-white/[0.03]" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={History}
          title="Sin atenciones en el rango"
          description={
            (history.data?.length ?? 0) > 0
              ? 'Ninguna coincide con los filtros.'
              : 'Acá aparecen las citas atendidas y las ventas del POS.'
          }
        />
      ) : (
        <Card className="p-0">
          <ul className="divide-y divide-white/5">
            {rows.map((r) => {
              const noCharge =
                r.kind === 'appointment' && !r.sale_id && (r.notes ?? '').includes(NO_CHARGE_MARK);
              return (
                <li key={`${r.kind}-${r.id}`}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => open(r)}
                    onKeyDown={(e) => e.key === 'Enter' && open(r)}
                    className="tap flex cursor-pointer items-start gap-3 px-4 py-3 hover:bg-white/[0.03]"
                  >
                    <div className="w-[52px] shrink-0 text-xs text-white/50">
                      {mode !== 'today' && (
                        <span className="block text-white/70">{dateShort(r.at).slice(0, 6)}</span>
                      )}
                      <span className="block">{timeShort(r.at)}</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="font-medium text-white">
                          {r.customer_name?.trim() || 'Consumidor final'}
                        </span>
                        <Badge tone={r.kind === 'pos' ? 'gold' : 'info'}>
                          {r.kind === 'pos' ? 'POS' : 'Cita'}
                        </Badge>
                        {noCharge && <Badge tone="muted">Sin cobro</Badge>}
                      </div>
                      {r.detail && (
                        <p className="mt-0.5 truncate text-xs text-white/60">{r.detail}</p>
                      )}
                      <p className="mt-0.5 text-xs text-white/40">
                        {r.staff_names
                          ? r.staff_names.split(',').join(', ')
                          : 'Sin colaboradora'}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span
                        className={cn(
                          'font-semibold',
                          r.total == null ? 'text-white/30' : 'text-white',
                        )}
                      >
                        {r.total == null ? '—' : money(r.total)}
                      </span>
                      {r.sale_id && r.kind === 'appointment' && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenSale(r.sale_id);
                          }}
                          className="inline-flex items-center gap-1 text-[11px] font-medium text-gold-300 hover:underline"
                        >
                          <Receipt className="h-3 w-3" /> Venta
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {openSale && <SaleDetailModal saleId={openSale} onClose={() => setOpenSale(null)} />}
    </div>
  );
}
