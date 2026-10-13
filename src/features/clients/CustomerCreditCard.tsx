import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Wallet } from 'lucide-react';
import { batch, type Stmt } from '@/lib/db';
import { genId, money, dateShort, timeShort } from '@/lib/format';
import { useBranchId, useOrgId, useSession } from '@/store/session';
import { invalidateFinance } from '@/lib/queryClient';
import { Badge, Button, Card, CardHeader, Input, Modal, useToast } from '@/components/ui';
import {
  usePaymentTarget,
  PaymentTargetFields,
} from '@/features/cashflow/accounts';
import { useCustomerCredit, invalidateCredit } from './customerCredit';
import type { CreditKind } from '@/types';

const KIND_LABEL: Record<CreditKind, string> = {
  load: 'Carga',
  redeem: 'Canje',
  adjustment: 'Ajuste',
  refund: 'Devolución',
};

/**
 * Saldo a favor (gift card / bono) del cliente: el disponible, un botón para
 * cargar más y el historial de movimientos. El canje se hace desde el cobro
 * (POS o cita), no acá: esta tarjeta es la caja fuerte y su bitácora.
 */
export function CustomerCreditCard({
  customerId,
  customerLabel,
}: {
  customerId: string;
  customerLabel: string;
}) {
  const credit = useCustomerCredit(customerId);
  const [loadOpen, setLoadOpen] = useState(false);
  const balance = credit.data?.balance ?? 0;
  const entries = credit.data?.entries ?? [];

  return (
    <Card>
      <CardHeader
        title="Saldo a favor"
        subtitle="Bonos y abonos a futuro del cliente"
        action={
          <Button variant="ghost" size="sm" onClick={() => setLoadOpen(true)}>
            <Plus className="h-4 w-4" /> Cargar
          </Button>
        }
      />

      <div className="flex items-center gap-3 rounded-xl border border-gold/30 bg-gold/[0.08] p-4">
        <Wallet className="h-6 w-6 text-gold-300" />
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-white/50">
            Disponible
          </p>
          <p className="text-2xl font-semibold text-gold-100">
            {money(balance)}
          </p>
        </div>
      </div>

      {entries.length > 0 && (
        <ul className="mt-3 divide-y divide-white/5">
          {entries.map((e) => (
            <li
              key={e.id}
              className="flex items-start justify-between gap-3 py-2.5"
            >
              <div className="min-w-0">
                <p className="text-sm text-white/90">
                  <Badge tone={e.amount >= 0 ? 'success' : 'info'}>
                    {KIND_LABEL[e.kind]}
                  </Badge>{' '}
                  {e.note ?? ''}
                </p>
                <p className="text-xs text-white/40">
                  {dateShort(e.created_at)} · {timeShort(e.created_at)}
                </p>
              </div>
              <span
                className={
                  e.amount >= 0
                    ? 'shrink-0 font-semibold text-success'
                    : 'shrink-0 font-semibold text-white/70'
                }
              >
                {e.amount >= 0 ? '+' : '−'}
                {money(Math.abs(e.amount))}
              </span>
            </li>
          ))}
        </ul>
      )}

      {loadOpen && (
        <LoadCreditModal
          customerId={customerId}
          customerLabel={customerLabel}
          onClose={() => setLoadOpen(false)}
        />
      )}
    </Card>
  );
}

/** Carga de saldo: entra plata real hoy (como un abono) y sube el disponible. */
function LoadCreditModal({
  customerId,
  customerLabel,
  onClose,
}: {
  customerId: string;
  customerLabel: string;
  onClose: () => void;
}) {
  const orgId = useOrgId();
  const branchId = useBranchId();
  const userId = useSession((s) => s.user?.id ?? null);
  const qc = useQueryClient();
  const toast = useToast();

  const [amountStr, setAmountStr] = useState('');
  const [dest, setDest] = useState('');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  const target = usePaymentTarget(orgId, branchId, dest);
  const amount = Number(amountStr) || 0;

  const load = useMutation({
    mutationFn: async () => {
      if (amount <= 0) throw new Error('Ingresá un monto mayor a cero.');
      const method = target.method;
      if (!method)
        throw new Error(
          `No hay un método de pago ${target.isCash ? 'en efectivo' : 'por transferencia'} configurado.`,
        );
      const nowIso = new Date().toISOString();
      const bankId = target.isCash ? null : target.effectiveDest;
      const paymentId = genId();
      const ref = reference.trim()
        ? `[Carga saldo] ${customerLabel} · ${reference.trim()}`
        : `[Carga saldo] ${customerLabel}`;
      const stmts: Stmt[] = [
        {
          // Movimiento aparte: ingreso sin venta ni cita (como un abono).
          sql: `INSERT INTO payment
                  (id, organization_id, branch_id, sale_id, appointment_id,
                   payment_method_id, bank_account_id, paid_at, amount, status, reference)
                VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, ?, 'confirmed', ?)`,
          args: [paymentId, orgId, branchId, method.id, bankId, nowIso, amount, ref],
        },
      ];
      if (target.isCash && target.sessionId) {
        stmts.push({
          sql: `INSERT INTO cash_movement
                  (id, cash_session_id, branch_id, movement_type, direction, amount,
                   movement_at, payment_id, description, created_by)
                VALUES (?, ?, ?, 'cash_in', 'in', ?, ?, ?, ?, ?)`,
          args: [
            genId(),
            target.sessionId,
            branchId,
            amount,
            nowIso,
            paymentId,
            `Carga saldo ${customerLabel}`,
            userId,
          ],
        });
      }
      stmts.push({
        sql: `INSERT INTO customer_credit_ledger
                (id, organization_id, customer_id, amount, kind, sale_id,
                 appointment_id, payment_id, note, created_by, created_at)
              VALUES (?, ?, ?, ?, 'load', NULL, NULL, ?, ?, ?, ?)`,
        args: [
          genId(),
          orgId,
          customerId,
          amount,
          paymentId,
          note.trim() || null,
          userId,
          nowIso,
        ],
      });
      await batch(stmts);
    },
    onSuccess: () => {
      invalidateCredit(qc);
      invalidateFinance(qc, branchId);
      void qc.invalidateQueries({ queryKey: ['client-payments', customerId] });
      toast.success('Saldo cargado', `${customerLabel} · ${money(amount)}`);
      onClose();
    },
    onError: (e) => {
      const msg =
        e instanceof Error ? e.message : 'No se pudo cargar el saldo.';
      setError(msg);
      toast.error('No se pudo cargar el saldo', msg);
    },
  });

  const canSave =
    !load.isPending && amount > 0 && target.hasOpenCashToday;

  return (
    <Modal open onClose={onClose} title="Cargar saldo a favor">
      <div className="space-y-4">
        <Input
          label="Monto"
          type="number"
          inputMode="decimal"
          min="0"
          step="0.01"
          autoFocus
          placeholder="0.00"
          value={amountStr}
          onChange={(e) => setAmountStr(e.target.value)}
        />

        <PaymentTargetFields
          target={target}
          onDest={setDest}
          reference={reference}
          onReference={setReference}
          noun="carga"
        />

        <Input
          label="Nota (opcional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Ej. bono de cumpleaños, promo 3x2…"
        />

        {error && <p className="text-sm text-danger">{error}</p>}

        <div className="flex gap-2">
          <Button
            className="flex-1"
            disabled={!canSave}
            loading={load.isPending}
            onClick={() => load.mutate()}
          >
            Cargar {amount > 0 ? money(amount) : 'saldo'}
          </Button>
          <Button variant="outline" onClick={onClose} disabled={load.isPending}>
            Cancelar
          </Button>
        </div>
      </div>
    </Modal>
  );
}
