import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { query, queryOne } from '@/lib/db';
import { AlertTriangle } from 'lucide-react';
import { Input, Select } from '@/components/ui';
import type { BankAccount, CashSession, PaymentMethod } from '@/types';

/** Cuentas bancarias activas de la organización (la caja física no es una fila). */
export function useBankAccounts(orgId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['bank-accounts', orgId],
    enabled: enabled && !!orgId,
    queryFn: () =>
      query<BankAccount>(
        'SELECT * FROM bank_account WHERE organization_id = ? AND active = 1 ORDER BY name',
        [orgId],
      ),
  });
}

/**
 * Selector de cuenta: caja física + cuentas bancarias activas.
 *
 * Aparece en cada pantalla que mueve plata (ingreso, egreso, transferencia,
 * pago de comisiones, adelantos y el filtro de transacciones). Estaba copiado
 * seis veces, así que un banco nuevo o un rótulo distinto había que tocarlo en
 * seis lugares. Las opciones viven acá.
 */
export function AccountSelect({
  label,
  value,
  onChange,
  accounts,
  /** Rótulo de la opción neutra: "Seleccionar…" al elegir, "Todas" al filtrar. */
  placeholder = 'Seleccionar…',
  /** Valor de esa opción: '' en formularios, 'all' en filtros. */
  placeholderValue = '',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  accounts: BankAccount[] | undefined;
  placeholder?: string;
  placeholderValue?: string;
}) {
  return (
    <Select
      label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value={placeholderValue}>{placeholder}</option>
      <option value="cash">Caja (efectivo)</option>
      {accounts?.map((b) => (
        <option key={b.id} value={b.id}>
          {b.name}
        </option>
      ))}
    </Select>
  );
}

/** Métodos de pago activos de la organización. */
export function usePaymentMethods(orgId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['payment-methods', orgId],
    enabled: enabled && !!orgId,
    queryFn: () =>
      query<PaymentMethod>(
        'SELECT * FROM payment_method WHERE organization_id = ? AND active = 1 ORDER BY name',
        [orgId],
      ),
  });
}

/**
 * Método de pago que corresponde a la cuenta elegida en `AccountSelect`: caja →
 * efectivo, cualquier banco → transferencia. Las cinco pantallas que mueven
 * plata buscaban `'cash'` y `'transfer'` por separado para después elegir uno.
 */
export function paymentMethodFor(
  methods: PaymentMethod[] | undefined,
  isCash: boolean,
): PaymentMethod | undefined {
  return methods?.find((m) => m.method_type === (isCash ? 'cash' : 'transfer'));
}

/** Caja abierta de la sucursal: necesaria para cualquier movimiento en efectivo. */
export function useOpenCashSession(branchId: string, enabled = true) {
  return useQuery({
    queryKey: ['open-cash', branchId],
    enabled: enabled && !!branchId,
    queryFn: () =>
      queryOne<CashSession>(
        `SELECT cs.* FROM cash_session cs
           JOIN cash_register cr ON cr.id = cs.cash_register_id
          WHERE cr.branch_id = ? AND cs.status = 'open'
          ORDER BY cs.opened_at DESC LIMIT 1`,
        [branchId],
      ),
  });
}

/**
 * Contexto de un cobro: a dónde entra la plata y con qué método.
 *
 * `dest` es lo que el usuario eligió en el selector; mientras esté vacío se
 * asume la primera cuenta bancaria y, si no hay ninguna, la caja. Las tres
 * pantallas que cobran (abono de la cita, confirmar venta de la cita y nueva
 * venta) repetían estas cuatro consultas y el mismo cálculo de destino.
 */
export function usePaymentTarget(orgId: string, branchId: string, dest: string) {
  const banks = useBankAccounts(orgId, true);
  const methods = usePaymentMethods(orgId, true);
  const cash = useOpenCashSession(branchId);

  const effectiveDest = dest || banks.data?.[0]?.id || 'cash';
  const isCash = effectiveDest === 'cash';

  return {
    banks,
    methods,
    sessionId: cash.data?.id ?? null,
    effectiveDest,
    isCash,
    method: paymentMethodFor(methods.data, isCash),
  };
}

export type PaymentTarget = ReturnType<typeof usePaymentTarget>;

/**
 * Campos de un cobro: dónde entra la plata, la referencia de la transferencia y
 * el aviso de que no hay caja abierta. Idénticos en el abono de la cita, en
 * confirmar la venta de la cita y en una venta nueva.
 *
 * `extra` se dibuja entre la referencia y el aviso de caja (ahí va, por ejemplo,
 * la advertencia de venta retroactiva).
 */
export function PaymentTargetFields({
  target,
  onDest,
  reference,
  onReference,
  noun = 'pago',
  extra,
}: {
  target: PaymentTarget;
  onDest: (value: string) => void;
  reference: string;
  onReference: (value: string) => void;
  /** Qué se registra si la caja está cerrada: "pago", "abono". */
  noun?: string;
  extra?: ReactNode;
}) {
  return (
    <>
      <Select
        label="Cobrar en"
        value={target.effectiveDest}
        onChange={(e) => onDest(e.target.value)}
      >
        {target.banks.data?.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name} (transferencia)
          </option>
        ))}
        <option value="cash">Efectivo (caja)</option>
      </Select>

      {!target.isCash && (
        <Input
          label="Nº de voucher (opcional)"
          value={reference}
          onChange={(e) => onReference(e.target.value)}
          placeholder="Nº de transferencia o voucher"
        />
      )}

      {extra}

      {target.isCash && !target.sessionId && (
        <p className="flex items-center gap-1.5 text-xs text-amber-300/80">
          <AlertTriangle className="h-3.5 w-3.5" /> No hay caja abierta: el{' '}
          {noun} se registra pero no entra al efectivo de caja.
        </p>
      )}
    </>
  );
}
