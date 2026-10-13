import { useQuery, type QueryClient } from '@tanstack/react-query';
import { query, queryOne } from '@/lib/db';
import type { CustomerCreditEntry, PaymentMethod } from '@/types';

/** Código del método de pago que representa el canje de saldo a favor. */
export const STORE_CREDIT_CODE = 'store_credit';

/**
 * Método "Saldo a favor" de la organización. Con él se registra el canje como
 * un pago de la venta sin mover plata real (su `method_type='other'` lo deja
 * fuera de los arqueos de efectivo y banco).
 */
export function storeCreditMethod(
  methods: PaymentMethod[] | undefined,
): PaymentMethod | undefined {
  return methods?.find((m) => m.code === STORE_CREDIT_CODE);
}

export interface CustomerCredit {
  /** Saldo disponible: suma de todos los movimientos del cliente. */
  balance: number;
  entries: CustomerCreditEntry[];
}

/** Saldo a favor de un cliente + su historial de movimientos (más nuevo primero). */
export function useCustomerCredit(customerId: string | null | undefined) {
  return useQuery({
    queryKey: ['customer-credit', customerId ?? ''],
    enabled: !!customerId,
    queryFn: async (): Promise<CustomerCredit> => {
      const entries = await query<CustomerCreditEntry>(
        `SELECT * FROM customer_credit_ledger
          WHERE customer_id = ? ORDER BY created_at DESC`,
        [customerId!],
      );
      const balance = entries.reduce((n, e) => n + e.amount, 0);
      return { balance, entries };
    },
  });
}

/**
 * Saldo disponible actual releído de la base. Se usa para revalidar justo antes
 * de canjear: la lista en memoria puede estar vieja si se cobró en otra pantalla.
 */
export async function creditBalance(customerId: string): Promise<number> {
  const row = await queryOne<{ balance: number }>(
    `SELECT COALESCE(SUM(amount), 0) AS balance
       FROM customer_credit_ledger WHERE customer_id = ?`,
    [customerId],
  );
  return row?.balance ?? 0;
}

/** Refresca el saldo a favor en todas las pantallas que lo muestran. */
export function invalidateCredit(qc: QueryClient): void {
  void qc.invalidateQueries({ queryKey: ['customer-credit'] });
}
