import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Wallet, HandCoins } from 'lucide-react';
import { query, batch } from '@/lib/db';
import { qk } from '@/lib/queryClient';
import { genId, money, dateShort } from '@/lib/format';
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
import type { BankAccount, PaymentMethod, SaleWithBalance } from '@/types';

interface CollectCtx {
  branchId: string;
  orgId: string;
  userId: string | null;
  sessionId: string | null;
}

/**
 * Cobros / abonos de ventas con saldo pendiente. El destino del cobro se elige
 * por cuenta (bancos + caja), igual que el abono de una cita. El efectivo genera
 * un movimiento de caja atado a la sesión abierta; por eso «Efectivo (caja)»
 * solo aparece con la caja abierta.
 */
export function CollectSection({ ctx }: { ctx: CollectCtx }) {
  const [target, setTarget] = useState<SaleWithBalance | null>(null);

  const sales = useQuery({
    queryKey: qk.sales(ctx.branchId),
    enabled: !!ctx.branchId,
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
        [ctx.branchId],
      ),
  });

  const pending = sales.data?.filter((s) => s.balance > 0.001) ?? [];

  return (
    <Card>
      <CardHeader title="Cobros / abonos" subtitle="Ventas con saldo pendiente" />
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

      {target && (
        <PaymentModal
          sale={target}
          ctx={ctx}
          onClose={() => setTarget(null)}
        />
      )}
    </Card>
  );
}

function PaymentModal({
  sale,
  ctx,
  onClose,
}: {
  sale: SaleWithBalance;
  ctx: CollectCtx;
  onClose: () => void;
}) {
  const qc = useQueryClient();

  const [amount, setAmount] = useState(String(sale.balance));
  const [dest, setDest] = useState(''); // 'cash' | bank account id
  const [reference, setReference] = useState('');

  const methods = useQuery({
    queryKey: ['payment-methods', ctx.orgId],
    enabled: !!ctx.orgId,
    queryFn: () =>
      query<PaymentMethod>(
        'SELECT * FROM payment_method WHERE organization_id = ? AND active = 1 ORDER BY name',
        [ctx.orgId],
      ),
  });
  const banks = useQuery({
    queryKey: ['bank-accounts', ctx.orgId],
    enabled: !!ctx.orgId,
    queryFn: () =>
      query<BankAccount>(
        'SELECT * FROM bank_account WHERE organization_id = ? AND active = 1 ORDER BY name',
        [ctx.orgId],
      ),
  });

  const cashMethod = methods.data?.find((m) => m.method_type === 'cash');
  const transferMethod = methods.data?.find((m) => m.method_type === 'transfer');
  const isCash = dest === 'cash';
  const needsSession = isCash && !ctx.sessionId;

  const pay = useMutation({
    mutationFn: async () => {
      const method = isCash ? cashMethod : transferMethod;
      if (!method) throw new Error('No hay un método de pago configurado.');
      const bankId = isCash ? null : dest;
      const paymentId = genId();
      const now = new Date().toISOString();

      const stmts: { sql: string; args: (string | number | null)[] }[] = [
        {
          sql: `INSERT INTO payment
                  (id, organization_id, branch_id, sale_id, payment_method_id,
                   bank_account_id, paid_at, amount, status, reference)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?)`,
          args: [
            paymentId,
            ctx.orgId,
            ctx.branchId,
            sale.id,
            method.id,
            bankId,
            now,
            Number(amount),
            reference || null,
          ],
        },
      ];

      // Solo el efectivo ingresa a la caja física.
      if (isCash) {
        stmts.push({
          sql: `INSERT INTO cash_movement
                  (id, cash_session_id, branch_id, movement_type, direction, amount,
                   movement_at, sale_id, payment_id, description, created_by)
                VALUES (?, ?, ?, 'sale', 'in', ?, ?, ?, ?, ?, ?)`,
          args: [
            genId(),
            ctx.sessionId,
            ctx.branchId,
            Number(amount),
            now,
            sale.id,
            paymentId,
            `Cobro ${sale.sale_number}`,
            ctx.userId,
          ],
        });
      }

      await batch(stmts);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.sales(ctx.branchId) });
      qc.invalidateQueries({ queryKey: ['fin-accounts'] });
      qc.invalidateQueries({ queryKey: ['transactions'] });
      if (ctx.sessionId) {
        qc.invalidateQueries({ queryKey: ['cash-expected', ctx.sessionId] });
      }
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
          label="Cobrar en"
          value={dest}
          onChange={(e) => setDest(e.target.value)}
        >
          <option value="">Seleccionar…</option>
          {banks.data?.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name} (transferencia)
            </option>
          ))}
          <option value="cash">Efectivo (caja)</option>
        </Select>
        {!isCash && dest && (
          <Input
            label="Referencia (opcional)"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="Nº transferencia, voucher…"
          />
        )}
        {needsSession && (
          <p className="text-xs text-danger">
            Para un cobro en efectivo necesitás abrir la caja primero.
          </p>
        )}
        <Button
          className="w-full"
          disabled={
            !dest || !amount || Number(amount) <= 0 || needsSession
          }
          loading={pay.isPending}
          onClick={() => pay.mutate()}
        >
          Registrar pago
        </Button>
      </div>
    </Modal>
  );
}
