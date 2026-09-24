import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock, Unlock, Plus, Receipt } from 'lucide-react';
import { query, queryOne, execute, batch } from '@/lib/db';
import { qk } from '@/lib/queryClient';
import { genId, money, timeShort, todayISO } from '@/lib/format';
import { useSession, useBranchId, useOrgId } from '@/store/session';
import {
  Button,
  Card,
  CardHeader,
  Input,
  Select,
  Modal,
  EmptyState,
} from '@/components/ui';
import type {
  CashRegister,
  CashSession,
  Expense,
  ExpenseCategory,
  PaymentMethod,
} from '@/types';

export function CashflowPage() {
  const branchId = useBranchId();
  const orgId = useOrgId();
  const user = useSession((s) => s.user);
  const setCashSession = useSession((s) => s.setCashSession);
  const qc = useQueryClient();

  const session = useQuery({
    queryKey: qk.cashSession(branchId),
    enabled: !!branchId,
    queryFn: async () => {
      const s = await queryOne<CashSession>(
        `SELECT cs.* FROM cash_session cs
           JOIN cash_register cr ON cr.id = cs.cash_register_id
          WHERE cr.branch_id = ? AND cs.status = 'open'
          ORDER BY cs.opened_at DESC LIMIT 1`,
        [branchId],
      );
      setCashSession(s);
      return s;
    },
  });

  const open = session.data ?? null;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <h1 className="text-2xl font-semibold text-white">Caja y finanzas</h1>

      {open ? (
        <>
          <OpenSessionCard
            session={open}
            onClosed={() => {
              setCashSession(null);
              qc.invalidateQueries({ queryKey: qk.cashSession(branchId) });
            }}
          />
          <ExpensesSection
            branchId={branchId}
            orgId={orgId}
            userId={user?.id ?? null}
            sessionId={open.id}
          />
        </>
      ) : (
        <OpenForm
          branchId={branchId}
          userId={user?.id ?? null}
          onOpened={() =>
            qc.invalidateQueries({ queryKey: qk.cashSession(branchId) })
          }
        />
      )}
    </div>
  );
}

/* ─────────────────────────── Apertura ─────────────────────────── */

function OpenForm({
  branchId,
  userId,
  onOpened,
}: {
  branchId: string;
  userId: string | null;
  onOpened: () => void;
}) {
  const [opening, setOpening] = useState('0');

  // Una sucursal tiene una sola caja registradora: la cargamos directo, sin elegir.
  const register = useQuery({
    queryKey: ['register', branchId],
    enabled: !!branchId,
    queryFn: () =>
      queryOne<CashRegister>(
        'SELECT * FROM cash_register WHERE branch_id = ? AND active = 1 ORDER BY name LIMIT 1',
        [branchId],
      ),
  });

  const mut = useMutation({
    mutationFn: async () => {
      const registerId = register.data?.id;
      if (!registerId) throw new Error('La sucursal no tiene caja registradora.');
      await execute(
        `INSERT INTO cash_session (id, cash_register_id, opened_by, opened_at, opening_cash, status)
         VALUES (?, ?, ?, ?, ?, 'open')`,
        [genId(), registerId, userId, new Date().toISOString(), Number(opening)],
      );
    },
    onSuccess: onOpened,
  });

  if (register.isLoading) return null;

  // Sin caja configurada para la sucursal → no se puede abrir.
  if (!register.data) {
    return (
      <Card>
        <CardHeader title="Abrir caja" subtitle="Iniciá la sesión del día" />
        <EmptyState
          icon={Receipt}
          title="Sin caja registradora"
          description="Esta sucursal no tiene una caja registradora configurada. Creá una en Configuración."
        />
      </Card>
    );
  }

  return (
    <Card gold>
      <CardHeader
        title="Abrir caja"
        subtitle={`Caja: ${register.data.name}`}
      />
      <div className="space-y-4">
        <Input
          label="Efectivo de apertura"
          type="number"
          min="0"
          step="0.01"
          value={opening}
          onChange={(e) => setOpening(e.target.value)}
        />
        <Button
          className="w-full"
          size="lg"
          loading={mut.isPending}
          onClick={() => mut.mutate()}
        >
          <Unlock className="h-4 w-4" /> Abrir caja
        </Button>
      </div>
    </Card>
  );
}

/* ─────────────────────────── Sesión abierta / cierre ─────────────────────── */

function OpenSessionCard({
  session,
  onClosed,
}: {
  session: CashSession;
  onClosed: () => void;
}) {
  const [counted, setCounted] = useState('');
  const [closing, setClosing] = useState(false);

  const expected = useQuery({
    queryKey: ['cash-expected', session.id],
    queryFn: async () => {
      const row = await queryOne<{ net: number }>(
        `SELECT COALESCE(SUM(CASE WHEN direction='in' THEN amount ELSE -amount END),0) AS net
           FROM cash_movement WHERE cash_session_id = ?`,
        [session.id],
      );
      return session.opening_cash + (row?.net ?? 0);
    },
  });

  const close = useMutation({
    mutationFn: async () => {
      const exp = expected.data ?? session.opening_cash;
      const cnt = Number(counted);
      await execute(
        `UPDATE cash_session
            SET status='closed', closed_at=?, expected_cash=?, counted_cash=?, difference=?
          WHERE id = ?`,
        [new Date().toISOString(), exp, cnt, cnt - exp, session.id],
      );
    },
    onSuccess: onClosed,
  });

  const exp = expected.data ?? session.opening_cash;
  const diff = counted ? Number(counted) - exp : null;

  return (
    <Card>
      <CardHeader
        title="Sesión de caja abierta"
        subtitle={`Abierta ${timeShort(session.opened_at)}`}
      />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Metric label="Apertura" value={money(session.opening_cash)} />
        <Metric label="Esperado" value={money(exp)} gold />
        {diff != null && (
          <Metric
            label="Diferencia"
            value={money(diff)}
            tone={diff < 0 ? 'danger' : 'success'}
          />
        )}
      </div>

      {!closing ? (
        <Button
          variant="outline"
          className="mt-5 w-full"
          onClick={() => setClosing(true)}
        >
          <Lock className="h-4 w-4" /> Cerrar caja
        </Button>
      ) : (
        <div className="mt-5 space-y-3 border-t border-white/10 pt-4">
          <Input
            label="Efectivo contado (físico)"
            type="number"
            min="0"
            step="0.01"
            value={counted}
            onChange={(e) => setCounted(e.target.value)}
          />
          <div className="flex gap-2">
            <Button
              variant="ghost"
              className="flex-1"
              onClick={() => setClosing(false)}
            >
              Cancelar
            </Button>
            <Button
              variant="danger"
              className="flex-1"
              disabled={!counted}
              loading={close.isPending}
              onClick={() => close.mutate()}
            >
              Confirmar cierre
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

/* ─────────────────────────── Egresos ─────────────────────────── */

function ExpensesSection({
  branchId,
  orgId,
  userId,
  sessionId,
}: {
  branchId: string;
  orgId: string;
  userId: string | null;
  sessionId: string;
}) {
  const [modal, setModal] = useState(false);
  const qc = useQueryClient();

  const expenses = useQuery({
    queryKey: ['expenses', branchId, todayISO()],
    queryFn: () =>
      query<Expense & { category_name: string; method_type: string }>(
        `SELECT e.*, ec.name AS category_name, pm.method_type
           FROM expense e
           JOIN expense_category ec ON ec.id = e.expense_category_id
           JOIN payment_method pm ON pm.id = e.payment_method_id
          WHERE e.branch_id = ? AND e.expense_date = ? AND e.status <> 'voided'
          ORDER BY e.created_at DESC`,
        [branchId, todayISO()],
      ),
  });

  return (
    <Card>
      <CardHeader
        title="Egresos del día"
        subtitle="Efectivo descuenta de caja física; transferencia no"
        action={
          <Button size="sm" onClick={() => setModal(true)}>
            <Plus className="h-4 w-4" /> Egreso
          </Button>
        }
      />

      {expenses.data && expenses.data.length > 0 ? (
        <ul className="divide-y divide-white/5">
          {expenses.data.map((e) => (
            <li key={e.id} className="flex items-center justify-between py-3">
              <div>
                <p className="text-sm text-white">{e.description}</p>
                <p className="text-xs text-white/40">
                  {e.category_name} ·{' '}
                  {e.method_type === 'cash' ? 'Efectivo' : 'Transferencia'}
                </p>
              </div>
              <span className="text-sm font-medium text-danger">
                −{money(e.amount)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={Receipt} title="Sin egresos hoy" />
      )}

      <ExpenseModal
        open={modal}
        onClose={() => setModal(false)}
        branchId={branchId}
        orgId={orgId}
        userId={userId}
        sessionId={sessionId}
        onSaved={() => {
          setModal(false);
          qc.invalidateQueries({ queryKey: ['expenses', branchId, todayISO()] });
          qc.invalidateQueries({ queryKey: ['cash-expected', sessionId] });
        }}
      />
    </Card>
  );
}

function ExpenseModal({
  open,
  onClose,
  branchId,
  orgId,
  userId,
  sessionId,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  branchId: string;
  orgId: string;
  userId: string | null;
  sessionId: string;
  onSaved: () => void;
}) {
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [methodId, setMethodId] = useState('');

  const categories = useQuery({
    queryKey: ['expense-categories', orgId],
    enabled: open && !!orgId,
    queryFn: () =>
      query<ExpenseCategory>(
        'SELECT * FROM expense_category WHERE organization_id = ? AND active = 1 ORDER BY name',
        [orgId],
      ),
  });

  const methods = useQuery({
    queryKey: ['payment-methods', orgId],
    enabled: open && !!orgId,
    queryFn: () =>
      query<PaymentMethod>(
        'SELECT * FROM payment_method WHERE organization_id = ? AND active = 1 ORDER BY name',
        [orgId],
      ),
  });

  const save = useMutation({
    mutationFn: async () => {
      const method = methods.data?.find((m) => m.id === methodId);
      const expenseId = genId();
      const now = new Date().toISOString();

      // Registrar el egreso. Si es efectivo, además crear el movimiento de caja
      // (salida) que descuenta de la caja física. Transferencia NO toca caja.
      const stmts: { sql: string; args: (string | number | null)[] }[] = [
        {
          sql: `INSERT INTO expense
                  (id, organization_id, branch_id, expense_category_id, payment_method_id,
                   expense_date, description, amount, status, created_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?)`,
          args: [
            expenseId,
            orgId,
            branchId,
            categoryId,
            methodId,
            todayISO(),
            description,
            Number(amount),
            userId,
          ],
        },
      ];

      if (method?.method_type === 'cash') {
        stmts.push({
          sql: `INSERT INTO cash_movement
                  (id, cash_session_id, branch_id, movement_type, direction, amount,
                   movement_at, expense_id, description, created_by)
                VALUES (?, ?, ?, 'expense', 'out', ?, ?, ?, ?, ?)`,
          args: [
            genId(),
            sessionId,
            branchId,
            Number(amount),
            now,
            expenseId,
            description,
            userId,
          ],
        });
      }

      await batch(stmts);
    },
    onSuccess: () => {
      setDescription('');
      setAmount('');
      setCategoryId('');
      setMethodId('');
      onSaved();
    },
  });

  return (
    <Modal open={open} onClose={onClose} title="Registrar egreso">
      <div className="space-y-4">
        <Input
          label="Descripción"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Insumos, servicios básicos…"
        />
        <Input
          label="Monto"
          type="number"
          min="0"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <Select
          label="Categoría"
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
        >
          <option value="">Seleccionar…</option>
          {categories.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
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
        <Button
          className="w-full"
          disabled={!description || !amount || !categoryId || !methodId}
          loading={save.isPending}
          onClick={() => save.mutate()}
        >
          Guardar egreso
        </Button>
      </div>
    </Modal>
  );
}

function Metric({
  label,
  value,
  gold,
  tone,
}: {
  label: string;
  value: string;
  gold?: boolean;
  tone?: 'danger' | 'success';
}) {
  const color = gold
    ? 'kpi-gold'
    : tone === 'danger'
      ? 'text-danger'
      : tone === 'success'
        ? 'text-success'
        : 'text-white';
  return (
    <div className="rounded-xl bg-white/5 p-3">
      <p className="text-xs text-white/50">{label}</p>
      <p className={`mt-1 text-xl font-semibold ${color}`}>{value}</p>
    </div>
  );
}
