import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { HandCoins } from 'lucide-react';
import { query } from '@/lib/db';
import { dateShort, money } from '@/lib/format';
import { Badge, EmptyState, Select } from '@/components/ui';
import { timestampBounds } from './activityModel';

interface Movement {
  id: string;
  kind: 'advance' | 'payment' | 'adjustment';
  staff_id: string;
  staff_name: string;
  occurred_at: string;
  amount: number;
  method: string | null;
  notes: string | null;
  status: string;
}
const labels = { advance: 'Adelanto', payment: 'Pago de comisión', adjustment: 'Cuadre de saldo' };

export function StaffMovements({ branchId, from, to, staffId }: { branchId: string; from: string; to: string; staffId: string }) {
  const [kind, setKind] = useState('');
  const [status, setStatus] = useState('confirmed');
  const timestamps = timestampBounds(from, to);
  const movements = useQuery({
    queryKey: ['staff-movements', branchId, from, to, timestamps.start, timestamps.end],
    enabled: !!branchId,
    queryFn: () => query<Movement>(
      `SELECT a.id AS id, CASE WHEN instr(COALESCE(a.notes, ''), '[Ajuste de comisión]') > 0 THEN 'adjustment' ELSE 'advance' END AS kind,
              a.staff_member_id AS staff_id, sm.first_name || COALESCE(' ' || sm.last_name, '') AS staff_name,
              a.advance_date AS occurred_at, a.amount, pm.name AS method, a.notes, a.status
       FROM staff_advance a JOIN staff_member sm ON sm.id = a.staff_member_id
       LEFT JOIN payment_method pm ON pm.id = a.payment_method_id
       WHERE a.branch_id = ? AND a.advance_date >= ? AND a.advance_date < date(?, '+1 day')
       UNION ALL
       SELECT p.id, 'payment', p.staff_member_id, sm.first_name || COALESCE(' ' || sm.last_name, ''),
              p.paid_at, p.net_paid, pm.name, COALESCE(p.notes, p.reference), p.status
       FROM staff_payment p JOIN staff_member sm ON sm.id = p.staff_member_id
       LEFT JOIN payment_method pm ON pm.id = p.payment_method_id
       WHERE p.branch_id = ? AND datetime(p.paid_at) >= datetime(?) AND datetime(p.paid_at) < datetime(?)
       ORDER BY occurred_at DESC, id DESC`,
      [branchId, from, to, branchId, timestamps.start, timestamps.end]),
  });
  const rows = (movements.data ?? []).filter(row => (!staffId || row.staff_id === staffId) && (!kind || row.kind === kind) && (!status || row.status === status));
  const sum = (type: Movement['kind']) => rows.filter(row => row.kind === type && row.status === 'confirmed').reduce((total, row) => total + row.amount, 0);
  return <div className="space-y-4">
    <div className="grid gap-3 sm:grid-cols-2">
      <Select label="Tipo de movimiento" value={kind} onChange={e => setKind(e.target.value)}><option value="">Todos los movimientos</option><option value="advance">Adelantos</option><option value="payment">Pagos de comisión</option><option value="adjustment">Cuadres de saldo</option></Select>
      <Select label="Estado" value={status} onChange={e => setStatus(e.target.value)}><option value="confirmed">Confirmados</option><option value="">Todos los estados</option><option value="pending">Pendientes</option><option value="voided">Anulados</option></Select>
    </div>
    {movements.isError ? <p role="alert" className="text-sm text-danger">No se pudieron cargar los movimientos. <button onClick={() => void movements.refetch()} className="underline">Reintentar</button></p>
      : movements.isPending ? <p role="status" className="text-sm text-white/50">Cargando movimientos…</p> : <>
        <div className="flex flex-wrap gap-x-6 gap-y-2 rounded-xl bg-white/5 p-3 text-sm text-white/70"><span>Adelantos confirmados: <strong className="text-white">{money(sum('advance'))}</strong></span><span>Pagos confirmados: <strong className="text-gold-200">{money(sum('payment'))}</strong></span><span className="text-white/40">{rows.length} movimientos</span></div>
        <p className="text-xs text-white/40">Los cuadres ajustan el saldo y no representan una salida de dinero.</p>
        {rows.length ? <div className="max-h-[560px] overflow-auto"><table className="w-full min-w-[680px] text-sm">
          <thead className="text-left text-xs text-white/40"><tr><th className="pb-3">Fecha</th><th className="pb-3">Colaborador</th><th className="pb-3">Movimiento</th><th className="pb-3">Método / detalle</th><th className="pb-3">Estado</th><th className="pb-3 text-right">Monto</th></tr></thead>
          <tbody className="divide-y divide-white/5">{rows.map(row => <tr key={`${row.kind}:${row.id}`} className="text-white/70"><td className="py-3 pr-3">{dateShort(row.occurred_at.length === 10 ? row.occurred_at + 'T12:00:00' : row.occurred_at)}</td><td className="py-3 pr-3 text-white">{row.staff_name}</td><td className="py-3 pr-3">{labels[row.kind]}</td><td className="max-w-xs py-3 pr-3"><span>{row.kind === 'adjustment' ? 'Sin movimiento de caja' : row.method || '—'}</span>{row.notes && <span className="mt-1 block break-words text-xs text-white/40">{row.notes}</span>}</td><td className="py-3 pr-3"><Badge tone={row.status === 'confirmed' ? 'success' : 'muted'}>{row.status === 'confirmed' ? 'Confirmado' : row.status === 'voided' ? 'Anulado' : 'Pendiente'}</Badge></td><td className="py-3 text-right font-medium text-white">{money(row.amount)}</td></tr>)}</tbody>
        </table></div> : <EmptyState icon={HandCoins} title="Sin movimientos para estos filtros" />}
      </>}
  </div>;
}
