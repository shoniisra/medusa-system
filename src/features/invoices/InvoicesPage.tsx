import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, ChevronLeft, FileText } from 'lucide-react';
import { query, execute } from '@/lib/db';
import { qk } from '@/lib/queryClient';
import { money, dateShort } from '@/lib/format';
import { useBranchId } from '@/store/session';
import { INVOICE_COLUMNS, CONSUMIDOR_FINAL_LABEL } from '@/config/constants';
import { Card, Badge, EmptyState, Button } from '@/components/ui';
import type { InvoiceRequestStatus, VInvoiceKanban } from '@/types';

const NEXT: Record<InvoiceRequestStatus, InvoiceRequestStatus | null> = {
  pending: 'in_progress',
  in_progress: 'done',
  done: null,
  cancelled: null,
};
const PREV: Record<InvoiceRequestStatus, InvoiceRequestStatus | null> = {
  pending: null,
  in_progress: 'pending',
  done: 'in_progress',
  cancelled: null,
};

export function InvoicesPage() {
  const branchId = useBranchId();
  const qc = useQueryClient();

  const kanban = useQuery({
    queryKey: qk.invoiceKanban(branchId),
    enabled: !!branchId,
    queryFn: () =>
      query<VInvoiceKanban>(
        `SELECT * FROM v_invoice_kanban
          WHERE branch_id = ? AND status <> 'cancelled'
          ORDER BY requested_at ASC`,
        [branchId],
      ),
  });

  const move = useMutation({
    mutationFn: async ({
      id,
      status,
    }: {
      id: string;
      status: InvoiceRequestStatus;
    }) => {
      const processed =
        status === 'done' ? new Date().toISOString() : null;
      await execute(
        'UPDATE invoice_request SET status = ?, processed_at = ? WHERE id = ?',
        [status, processed, id],
      );
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: qk.invoiceKanban(branchId) }),
  });

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-white">Facturación</h1>
        <p className="text-sm text-white/40">
          Las ventas con “requiere factura” entran en Pendiente.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {INVOICE_COLUMNS.map((col) => {
          const cards =
            kanban.data?.filter((c) => c.status === col.status) ?? [];
          return (
            <div key={col.status} className="space-y-3">
              <div className="flex items-center justify-between px-1">
                <h2 className="text-sm font-medium text-white/70">
                  {col.label}
                </h2>
                <Badge tone={col.status === 'done' ? 'success' : 'gold'}>
                  {cards.length}
                </Badge>
              </div>

              {cards.length === 0 ? (
                <Card>
                  <EmptyState icon={FileText} title="Sin solicitudes" />
                </Card>
              ) : (
                cards.map((c) => (
                  <Card key={c.id} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-white">
                        {c.sale_number}
                      </span>
                      <span className="kpi-gold">{money(c.sale_total)}</span>
                    </div>
                    <p className="text-xs text-white/50">
                      {c.customer_name ?? CONSUMIDOR_FINAL_LABEL}
                      {c.phone ? ` · ${c.phone}` : ''}
                    </p>
                    <p className="text-xs text-white/30">
                      Solicitada {dateShort(c.requested_at)}
                    </p>
                    <div className="flex gap-2 pt-1">
                      {PREV[c.status] && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            move.mutate({ id: c.id, status: PREV[c.status]! })
                          }
                        >
                          <ChevronLeft className="h-4 w-4" />
                        </Button>
                      )}
                      {NEXT[c.status] && (
                        <Button
                          size="sm"
                          className="ml-auto"
                          onClick={() =>
                            move.mutate({ id: c.id, status: NEXT[c.status]! })
                          }
                        >
                          {NEXT[c.status] === 'done' ? 'Marcar hecho' : 'Avanzar'}
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </Card>
                ))
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
