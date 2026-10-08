import { Input, Select } from '@/components/ui';
import { money } from '@/lib/format';
import type { BankAccount } from '@/types';

/**
 * Bloque "Retirar de caja" del cierre: monto, cuenta destino y lo que queda para
 * vueltos. Mismo UI en el modal de caja del AppLayout y en la pestaña Caja.
 */
export function CountCashFields({
  cnt,
  withdraw,
  onWithdrawChange,
  destination,
  onDestinationChange,
  banks,
  left,
}: {
  cnt: number | null;
  withdraw: string;
  onWithdrawChange: (v: string) => void;
  destination: string;
  onDestinationChange: (v: string) => void;
  banks: BankAccount[];
  left: number | null;
}) {
  return (
    <div className="space-y-3 rounded-xl border border-white/10 bg-white/[0.02] p-3">
      <div className="flex items-center justify-between">
        <p className="text-xs uppercase tracking-wide text-white/40">
          Retirar de caja (opcional)
        </p>
        {cnt != null && cnt > 0 && (
          <button
            type="button"
            onClick={() => onWithdrawChange(String(cnt))}
            className="text-xs text-gold-300 hover:underline"
          >
            Retirar todo
          </button>
        )}
      </div>
      <Input
        label="Monto a retirar"
        type="number"
        min="0"
        step="0.01"
        value={withdraw}
        onChange={(e) => onWithdrawChange(e.target.value)}
      />
      <Select
        label="Depositar en"
        value={destination}
        onChange={(e) => onDestinationChange(e.target.value)}
      >
        <option value="">Seleccionar…</option>
        {banks.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </Select>
      {banks.length === 0 && (
        <p className="text-xs text-white/40">
          No hay cuentas donde depositar. Creá una en Configuración → Cuentas
          (por ejemplo «Ahorros efectivo»).
        </p>
      )}
      {cnt != null && (
        <div className="flex items-center justify-between border-t border-white/10 pt-3 text-sm">
          <span className="text-white/60">Queda en caja para vueltos</span>
          <span className="font-semibold text-gold-300">
            {money(left ?? 0)}
          </span>
        </div>
      )}
    </div>
  );
}
