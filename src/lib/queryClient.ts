import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

/** Claves de caché centralizadas para invalidaciones consistentes. */
export const qk = {
  dashboard: (branchId: string, day: string) =>
    ['dashboard', branchId, day] as const,
  cashSession: (branchId: string) => ['cash-session', branchId] as const,
  sales: (branchId: string) => ['sales', branchId] as const,
  sale: (id: string) => ['sale', id] as const,
  customers: (orgId: string) => ['customers', orgId] as const,
  staff: (orgId: string) => ['staff', orgId] as const,
  appointments: (branchId: string, day: string) =>
    ['appointments', branchId, day] as const,
  invoiceKanban: (branchId: string) => ['invoice-kanban', branchId] as const,
  payableSummary: (periodId: string) =>
    ['payable-summary', periodId] as const,
};

/* ───────────────────── Invalidaciones por evento de dominio ──────────────── */

const invalidateAll = (qc: QueryClient, keys: readonly unknown[][]): void => {
  // Fire-and-forget a propósito: la mutación no debe quedar en "guardando…"
  // esperando que terminen los refetch de media app.
  for (const queryKey of keys) void qc.invalidateQueries({ queryKey });
};

/**
 * Una cita que cambia toca más de lo que parece: la agenda, su propia ficha, el
 * dashboard, la disponibilidad de la semana y los contadores de vencidas del
 * menú lateral y de Tareas. Antes cada pantalla invalidaba su propia lista, así
 * que arrastrar una cita en el calendario dejaba los contadores viejos y
 * cerrarla desde Tareas dejaba el dashboard viejo. Un solo lugar, un solo
 * criterio.
 */
export function invalidateAppointments(
  qc: QueryClient,
  appointmentId?: string,
): void {
  const keys: unknown[][] = [
    ['appointments'],
    ['dashboard-metrics'],
    ['week-availability'],
    ['overdue-pending'],
    ['overdue-count'],
  ];
  if (appointmentId) {
    keys.push(
      ['appointment-head', appointmentId],
      ['appointment-items', appointmentId],
      ['appointment-deposits', appointmentId],
      ['appointment-payments', appointmentId],
    );
  }
  invalidateAll(qc, keys);
}

/**
 * La libreta de contactos se lee con dos claves distintas (`customers` para los
 * selectores del POS y la agenda, `clients` para el listado con métricas), así
 * que crear o editar un cliente tiene que invalidar las dos o una de las dos
 * pantallas queda mostrando datos viejos.
 */
export function invalidateCustomers(qc: QueryClient, orgId: string): void {
  invalidateAll(qc, [
    ['customers', orgId],
    ['clients', orgId],
  ]);
}

/**
 * Todo lo que mueve dinero: saldos de cuentas, resumen, deudas, transacciones,
 * caja esperada, arrastre al día siguiente, ventas y los saldos de comisiones y
 * adelantos. Pagar comisiones desde Personal mueve la misma plata que un egreso
 * en Flujo, pero refrescaba menos consultas, así que el arrastre de caja y la
 * sesión quedaban viejos hasta recargar.
 */
export function invalidateFinance(qc: QueryClient, branchId?: string): void {
  const keys: unknown[][] = [
    ['fin-accounts'],
    ['fin-summary'],
    ['fin-exp7'],
    ['fin-debts'],
    ['transactions'],
    ['cash-expected'],
    ['cash-carryover'],
    ['commission-balance'],
    ['payable-summary'],
    ['sales'],
  ];
  if (branchId) keys.push([...qk.cashSession(branchId)]);
  invalidateAll(qc, keys);
}

/** Una venta cerrada: además del dinero, mueve facturación y el dashboard. */
export function invalidateSales(qc: QueryClient, branchId?: string): void {
  invalidateFinance(qc, branchId);
  invalidateAll(qc, [['invoice-kanban'], ['dashboard-metrics']]);
}
