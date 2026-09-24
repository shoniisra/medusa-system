import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Wallet, HandCoins } from 'lucide-react';
import { query, execute } from '@/lib/db';
import { qk } from '@/lib/queryClient';
import { genId, money, dateShort } from '@/lib/format';
import { useBranchId, useOrgId } from '@/store/session';
import {
  Button,
  Card,
  CardHeader,
  Modal,
  Input,
  Select,
  EmptyState,
  Badge,
} from '@/components/ui';
import type { PaymentMethod, SaleWithBalance } from '@/types';

/** Ventas con saldo pendiente (total − pagos confirmados). */
export function CollectTab() {
  const branchId = useBranchId();
  const [target, setTarget] = useState<SaleWithBalance | null>(null);

  const sales = useQuery({
    queryKey: qk.sales(branchId),
    enabled: !!branchId,
    queryFn: () =>
      query<SaleWithBalance>(
        `SELECT s.*,
                COALESCE(pp.paid, 0) AS paid_amount,
                s.total - COALESCE(pp.paid, 0) AS balance
           FROM sale s
           LEFT JOIN (
             SELECT sale_id, SUM(amount) AS paid
               FROM payment WHERE status = 'confirmed' GROUP BY sale_id
           ) pp ON pp.sale_id = s.id
          WHERE s.branch_id = ? AND s.status = 'completed'
          ORDER BY s.sold_at DESC
          LIMIT 100`,
        [branchId],
      ),
  });

  const pending = sales.data?.filter((s) => s.balance > 0.001) ?? [];

  return (
    <div className="mx-auto max-w-3xl">
      <Card>
        <CardHeader
          title="Ventas con saldo pendiente"
          subtitle="Registrá abonos o el saldo total"
        />
        {pending.length === 0 ? (
          <EmptyState
            icon={Wallet}
            title="Sin saldos pendientes"
            description="Todas las ventas están cobradas."
          />
        ) : (
          <ul className="divide-y divide-white/5">
            {pending.map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between gap-3 py-3"
              >
                <div>
                  <p className="text-sm font-medium text-white">
                    {s.sale_number}
                  </p>
                  <p className="text-xs text-white/40">
                    {dateShort(s.sold_at)} · Total {money(s.total)} · Pagado{' '}
                    {money(s.paid_amount)}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <Badge tone="danger">Saldo {money(s.balance)}</Badge>
                  <Button size="sm" onClick={() => setTarget(s)}>
                    <HandCoins className="h-4 w-4" /> Cobrar
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {target && (
        <PaymentModal
          sale={target}
          onClose={() => setTarget(null)}
        />
      )}
    </div>
  );
}

function PaymentModal({
  sale,
  onClose,
}: {
  sale: SaleWithBalance;
  onClose: () => void;
}) {
  const orgId = useOrgId();
  const branchId = useBranchId();
  const qc = useQueryClient();

  const [amount, setAmount] = useState(String(sale.balance));
  const [methodId, setMethodId] = useState('');
  const [reference, setReference] = useState('');

  const methods = useQuery({
    queryKey: ['payment-methods', orgId],
    enabled: !!orgId,
    queryFn: () =>
      query<PaymentMethod>(
        'SELECT * FROM payment_method WHERE organization_id = ? AND active = 1 ORDER BY name',
        [orgId],
      ),
  });

  const pay = useMutation({
    mutationFn: async () => {
      await execute(
        `INSERT INTO payment
           (id, organization_id, branch_id, sale_id, payment_method_id, paid_at,
            amount, status, reference)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'confirmed', ?)`,
        [
          genId(),
          orgId,
          branchId,
          sale.id,
          methodId,
          new Date().toISOString(),
          Number(amount),
          reference || null,
        ],
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.sales(branchId) });
      onClose();
    },
  });

  return (
    <Modal open onClose={onClose} title={`Cobrar ${sale.sale_number}`}>
      <div className="space-y-4">
        <div className="rounded-xl bg-white/5 p-3 text-sm">
          <div className="flex justify-between text-white/60">
            <span>Saldo pendiente</span>
            <span className="kpi-gold">{money(sale.balance)}</span>
          </div>
        </div>
        <Input
          label="Monto a cobrar (abono o total)"
          type="number"
          min="0"
          step="0.01"
          max={sale.balance}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <Select
          label="Método de pago"
          value={methodId}
          onChange={(e) => setMethodId(e.target.value)}
        >
          <option value="">Seleccionar…</option>
          {methods.data?.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </Select>
        <Input
          label="Referencia (opcional)"
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          placeholder="Nº transferencia, voucher…"
        />
        <Button
          className="w-full"
          disabled={!methodId || !amount || Number(amount) <= 0}
          loading={pay.isPending}
          onClick={() => pay.mutate()}
        >
          Registrar pago
        </Button>
      </div>
    </Modal>
  );
}
