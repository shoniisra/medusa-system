import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Users, Plus, HandCoins } from 'lucide-react';
import { query, execute } from '@/lib/db';
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
} from '@/components/ui';
import type {
  PayPeriod,
  PaymentMethod,
  StaffMember,
  VStaffPayableSummary,
} from '@/types';

export function StaffPage() {
  const orgId = useOrgId();
  const [advanceOpen, setAdvanceOpen] = useState(false);

  const staff = useQuery({
    queryKey: ['staff', orgId],
    enabled: !!orgId,
    queryFn: () =>
      query<StaffMember>(
        'SELECT * FROM staff_member WHERE organization_id = ? ORDER BY active DESC, first_name',
        [orgId],
      ),
  });

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-white">Personal y nómina</h1>
        <Button onClick={() => setAdvanceOpen(true)}>
          <HandCoins className="h-4 w-4" /> Adelanto
        </Button>
      </div>

      <LiquidationSection orgId={orgId} />

      <Card>
        <CardHeader title="Colaboradores" subtitle="Equipo del salón" />
        {staff.data && staff.data.length > 0 ? (
          <ul className="divide-y divide-white/5">
            {staff.data.map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between py-3"
              >
                <div>
                  <p className="text-sm font-medium text-white">
                    {fullName(s.first_name, s.last_name)}
                  </p>
                  <p className="text-xs text-white/40">
                    {s.employee_code ?? 'Sin código'} · Ciclo{' '}
                    {s.default_pay_cycle}
                  </p>
                </div>
                <Badge tone={s.active ? 'success' : 'muted'}>
                  {s.active ? 'Activo' : 'Inactivo'}
                </Badge>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon={Users} title="Sin colaboradores" />
        )}
      </Card>

      <AdvanceModal open={advanceOpen} onClose={() => setAdvanceOpen(false)} />
    </div>
  );
}

/** Liquidación por periodo: comisiones − adelantos = neto a pagar. */
function LiquidationSection({ orgId }: { orgId: string }) {
  const [periodId, setPeriodId] = useState('');

  const periods = useQuery({
    queryKey: ['pay-periods', orgId],
    enabled: !!orgId,
    queryFn: () =>
      query<PayPeriod>(
        'SELECT * FROM pay_period WHERE organization_id = ? ORDER BY start_date DESC LIMIT 24',
        [orgId],
      ),
  });

  const summary = useQuery({
    queryKey: ['payable-summary', periodId],
    enabled: !!periodId,
    queryFn: () =>
      query<VStaffPayableSummary>(
        'SELECT * FROM v_staff_payable_summary WHERE pay_period_id = ? ORDER BY staff_name',
        [periodId],
      ),
  });

  return (
    <Card gold>
      <CardHeader
        title="Liquidación de comisiones"
        subtitle="Comisiones − adelantos = neto a pagar"
        action={
          <div className="w-56">
            <Select
              value={periodId}
              onChange={(e) => setPeriodId(e.target.value)}
            >
              <option value="">Elegí un periodo…</option>
              {periods.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {dateShort(p.start_date)} – {dateShort(p.end_date)} ({p.status})
                </option>
              ))}
            </Select>
          </div>
        }
      />

      {!periodId ? (
        <p className="py-6 text-center text-sm text-white/40">
          Seleccioná un periodo para ver la liquidación.
        </p>
      ) : summary.data && summary.data.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-white/40">
                <th className="pb-2">Colaborador</th>
                <th className="pb-2 text-right">Comisiones</th>
                <th className="pb-2 text-right">Adelantos</th>
                <th className="pb-2 text-right">Otros</th>
                <th className="pb-2 text-right">Neto</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {summary.data.map((r) => (
                <tr key={r.id}>
                  <td className="py-2 text-white">{r.staff_name}</td>
                  <td className="py-2 text-right text-white/70">
                    {money(r.commission_total)}
                  </td>
                  <td className="py-2 text-right text-danger">
                    −{money(r.advances_total)}
                  </td>
                  <td className="py-2 text-right text-white/50">
                    {money(r.other_deductions)}
                  </td>
                  <td className="py-2 text-right font-semibold text-gold-200">
                    {money(r.net_payable)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState
          icon={Users}
          title="Sin liquidación calculada"
          description="Este periodo aún no tiene comisiones calculadas."
        />
      )}
    </Card>
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

  const [staffId, setStaffId] = useState('');
  const [amount, setAmount] = useState('');
  const [methodId, setMethodId] = useState('');

  const staff = useQuery({
    queryKey: ['staff', orgId],
    enabled: open && !!orgId,
    queryFn: () =>
      query<StaffMember>(
        'SELECT * FROM staff_member WHERE organization_id = ? AND active = 1 ORDER BY first_name',
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
      await execute(
        `INSERT INTO staff_advance
           (id, organization_id, branch_id, staff_member_id, advance_date, amount,
            payment_method_id, status, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'confirmed', ?)`,
        [
          genId(),
          orgId,
          branchId,
          staffId,
          todayISO(),
          Number(amount),
          methodId,
          userId,
        ],
      );
    },
    onSuccess: () => {
      setStaffId('');
      setAmount('');
      setMethodId('');
      qc.invalidateQueries({ queryKey: ['payable-summary'] });
      onClose();
    },
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
        <Input
          label="Monto"
          type="number"
          min="0"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <Select
          label="Método"
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
          disabled={!staffId || !amount || !methodId}
          loading={save.isPending}
          onClick={() => save.mutate()}
        >
          <Plus className="h-4 w-4" /> Guardar adelanto
        </Button>
      </div>
    </Modal>
  );
}
