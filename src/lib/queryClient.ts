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
