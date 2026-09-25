import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { UserPlus, X } from 'lucide-react';
import { usePosDraft } from '@/store/posDraft';
import { useStaff } from './useCatalog';
import { resolveCommission, loadCommissionRules } from './createSale';
import { money, fullName } from '@/lib/format';
import { DEFAULT_COMMISSION_RATE } from '@/config/constants';
import { Button, Select, Input, Badge } from '@/components/ui';
import type { CommissionType, DraftSaleItem, ParticipationRole } from '@/types';

/**
 * Distribución de comisión de una línea de servicio.
 * Permite asignar un Principal y opcionalmente Ayudantes, cada uno con su
 * tipo (% o fijo) y valor. La base es el valor final del servicio (línea).
 */
export function CommissionEditor({ item }: { item: DraftSaleItem }) {
  const draft = usePosDraft();
  const staff = useStaff();
  const lineTotal = item.final_unit_price * item.quantity;

  const [staffId, setStaffId] = useState('');
  const [role, setRole] = useState<ParticipationRole>('primary');
  const [type, setType] = useState<CommissionType>('percentage');
  const [rate, setRate] = useState(String(DEFAULT_COMMISSION_RATE));
  const [reduces, setReduces] = useState(false);

  // Reglas configuradas por colaborador+servicio (para autocompletar el valor).
  const rules = useQuery({
    queryKey: ['commission-rules'],
    queryFn: loadCommissionRules,
    staleTime: 5 * 60 * 1000,
  });

  // Al elegir colaborador, precarga tipo/valor desde la config (o el % por defecto).
  function pickStaff(id: string) {
    setStaffId(id);
    if (!id || !item.service_id) return;
    const rule = rules.data?.get(`${id}:${item.service_id}`);
    if (rule) {
      setType(rule.commission_type);
      setRate(String(rule.commission_value));
    } else {
      setType('percentage');
      setRate(String(DEFAULT_COMMISSION_RATE));
    }
  }

  function add() {
    if (!staffId) return;
    const amount = resolveCommission(type, Number(rate) || 0, lineTotal);
    draft.addCommission(item.tempId, {
      staff_member_id: staffId,
      participation_role: role,
      commission_type: type,
      commission_rate: Number(rate) || 0,
      commission_amount: amount,
      reduces_primary_amount: reduces,
    });
    setStaffId('');
    setRate(type === 'percentage' ? String(DEFAULT_COMMISSION_RATE) : '0');
  }

  const staffName = (id: string) => {
    const s = staff.data?.find((x) => x.id === id);
    return s ? fullName(s.first_name, s.last_name) : id;
  };

  const hasPrimary = item.commissions.some(
    (c) => c.participation_role === 'primary',
  );

  return (
    <div className="mt-4 rounded-xl border border-white/10 bg-ink-800/40 p-3">
      <p className="mb-3 text-xs font-medium uppercase tracking-wide text-white/40">
        Distribución de comisión
      </p>

      {/* Comisiones ya asignadas */}
      {item.commissions.length > 0 && (
        <ul className="mb-3 space-y-2">
          {item.commissions.map((c) => (
            <li
              key={c.tempId}
              className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-2 text-sm"
            >
              <span className="flex items-center gap-2">
                <Badge tone={c.participation_role === 'primary' ? 'gold' : 'info'}>
                  {c.participation_role === 'primary' ? 'Principal' : 'Ayudante'}
                </Badge>
                <span className="text-white/80">
                  {staffName(c.staff_member_id)}
                </span>
                <span className="text-white/40">
                  {c.commission_type === 'percentage'
                    ? `${c.commission_rate}%`
                    : 'fijo'}
                </span>
              </span>
              <span className="flex items-center gap-2">
                <span className="font-medium text-gold-200">
                  {money(c.commission_amount)}
                </span>
                <button
                  onClick={() => draft.removeCommission(item.tempId, c.tempId)}
                  className="text-white/40 hover:text-danger"
                >
                  <X className="h-4 w-4" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* Alta de comisión */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="col-span-2">
          <Select value={staffId} onChange={(e) => pickStaff(e.target.value)}>
            <option value="">Colaborador…</option>
            {staff.data?.map((s) => (
              <option key={s.id} value={s.id}>
                {fullName(s.first_name, s.last_name)}
              </option>
            ))}
          </Select>
        </div>
        <Select
          value={role}
          onChange={(e) => setRole(e.target.value as ParticipationRole)}
        >
          <option value="primary" disabled={hasPrimary}>
            Principal
          </option>
          <option value="assistant">Ayudante</option>
        </Select>
        <Select
          value={type}
          onChange={(e) => setType(e.target.value as CommissionType)}
        >
          <option value="percentage">%</option>
          <option value="fixed">Fijo $</option>
        </Select>
      </div>

      <div className="mt-2 flex items-end gap-2">
        <div className="w-24">
          <Input
            type="number"
            min="0"
            step="0.01"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            placeholder={type === 'percentage' ? '%' : '$'}
          />
        </div>
        <label className="flex items-center gap-1.5 text-xs text-white/50">
          <input
            type="checkbox"
            checked={reduces}
            onChange={(e) => setReduces(e.target.checked)}
            className="rounded border-white/20 bg-ink-800 text-gold-400 focus:ring-gold/40"
          />
          Descuenta del principal
        </label>
        <Button size="sm" variant="ghost" className="ml-auto" onClick={add}>
          <UserPlus className="h-4 w-4" /> Asignar
        </Button>
      </div>

      <p className="mt-2 text-right text-xs text-white/30">
        Base (valor del servicio): {money(lineTotal)}
      </p>
    </div>
  );
}
