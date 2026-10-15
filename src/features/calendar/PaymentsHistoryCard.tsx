import { useState } from 'react';
import { Badge, Card, CardHeader } from '@/components/ui';
import { dateShort, money, timeShort } from '@/lib/format';

export interface PaymentRow {
  id: string;
  amount: number;
  paid_at: string;
  reference: string | null;
  bank_name: string | null;
  bank_account_id: string | null;
  method_type: string;
  created_by_name: string | null;
  movement_id: string | null;
  movement_session_id: string | null;
  kind: 'deposit' | 'sale';
  status: 'confirmed' | 'voided';
}

export function PaymentsHistoryCard({
  payments,
  onVoid,
}: {
  payments: PaymentRow[];
  onVoid?: (row: PaymentRow) => void;
}) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const active = payments.filter((p) => p.status === 'confirmed');
  const voided = payments.filter((p) => p.status === 'voided');
  const total = active.reduce((a, p) => a + p.amount, 0);

  function rowContent(p: PaymentRow, allowVoid: boolean) {
    const isConfirming = confirming === p.id;
    return (
      <li
        key={p.id}
        className={`py-2.5 text-sm ${p.status === 'voided' ? 'opacity-40' : ''}`}
      >
        <div className="flex items-start justify-between gap-3">
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="font-semibold text-white">{money(p.amount)}</span>
              <Badge tone={p.kind === 'deposit' ? 'info' : 'success'}>
                {p.kind === 'deposit' ? 'Abono' : 'Cobro'}
              </Badge>
              {p.status === 'voided' && (
                <Badge tone="danger">Anulado</Badge>
              )}
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
          {allowVoid && onVoid && p.status === 'confirmed' && (
            <div className="shrink-0">
              {isConfirming ? (
                <div className="flex items-center gap-2">
                  <button
                    className="text-xs text-white/40 hover:text-white/70"
                    onClick={() => setConfirming(null)}
                  >
                    No
                  </button>
                  <button
                    className="text-xs font-medium text-danger hover:underline"
                    onClick={() => {
                      setConfirming(null);
                      onVoid(p);
                    }}
                  >
                    Confirmar anulación
                  </button>
                </div>
              ) : (
                <button
                  className="text-xs font-medium text-danger/70 hover:text-danger hover:underline"
                  onClick={() => setConfirming(p.id)}
                >
                  Anular
                </button>
              )}
            </div>
          )}
        </div>
      </li>
    );
  }

  return (
    <Card>
      <CardHeader
        title="Cobros"
        subtitle="Abonos y pagos vinculados a esta cita"
      />
      <ul className="divide-y divide-white/5">
        {active.map((p) => rowContent(p, true))}
        {voided.map((p) => rowContent(p, false))}
      </ul>
      <div className="mt-3 flex items-center justify-between border-t border-white/10 pt-3 text-sm">
        <span className="text-white/60">Total cobrado</span>
        <span className="font-semibold text-white">{money(total)}</span>
      </div>
    </Card>
  );
}
