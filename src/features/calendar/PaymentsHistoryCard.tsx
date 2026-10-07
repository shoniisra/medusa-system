import { Badge, Card, CardHeader } from '@/components/ui';
import { dateShort, money, timeShort } from '@/lib/format';

/**
 * Un cobro asociado a la cita, visto desde "detalle de cita":
 *  - `kind='deposit'`: abono (payment sin sale_id, cobrado antes del servicio);
 *  - `kind='sale'`: pago de la venta ya facturada contra la cita.
 * Se unen en una sola lista "Pagos recibidos" porque el usuario los piensa
 * como "lo que entró por esta cita" sin distinguir el momento.
 */
export interface PaymentRow {
  id: string;
  amount: number;
  paid_at: string;
  reference: string | null;
  bank_name: string | null;
  method_type: string;
  created_by_name: string | null;
  kind: 'deposit' | 'sale';
}

/**
 * Historial de todos los pagos recibidos por la cita (abono + pagos de la
 * venta ya facturada), con la data que pide el personal para auditar: valor,
 * cuenta/método, día+hora y quién lo registró.
 */
export function PaymentsHistoryCard({ payments }: { payments: PaymentRow[] }) {
  const total = payments.reduce((a, p) => a + p.amount, 0);
  return (
    <Card>
      <CardHeader
        title="Pagos recibidos"
        subtitle="Todas las transacciones vinculadas a la cita"
      />
      <ul className="divide-y divide-white/5">
        {payments.map((p) => (
          <li
            key={p.id}
            className="flex items-start justify-between gap-3 py-2.5 text-sm"
          >
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="font-semibold text-white">{money(p.amount)}</span>
                <Badge tone={p.kind === 'deposit' ? 'info' : 'success'}>
                  {p.kind === 'deposit' ? 'Abono' : 'Pago de venta'}
                </Badge>
              </span>
              <span className="mt-0.5 block text-xs text-white/50">
                {p.bank_name ?? 'Efectivo'}
                {p.reference ? ` · ${p.reference}` : ''}
              </span>
              <span className="mt-0.5 block text-[11px] text-white/40">
                {dateShort(p.paid_at)} · {timeShort(p.paid_at)}
                {p.created_by_name ? ` · ${p.created_by_name}` : ''}
              </span>
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex items-center justify-between border-t border-white/10 pt-3 text-sm">
        <span className="text-white/60">Total cobrado</span>
        <span className="font-semibold text-white">{money(total)}</span>
      </div>
    </Card>
  );
}
