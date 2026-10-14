import type { UserRole } from '@/types';

/**
 * Capacidades del sistema. Fuente única de verdad para el gating de rutas,
 * navegación y acciones sensibles.
 */
export type Permission =
  | 'view_dashboard'
  | 'view_metrics'
  | 'manage_appointments'
  | 'attend_appointments'
  | 'use_pos'
  | 'use_cash_register'
  | 'view_own_summary'
  | 'view_finance'
  | 'view_staff_finance'
  | 'manage_clients'
  | 'view_history'
  | 'manage_settings'
  | 'manage_staff'
  | 'view_invoices'
  | 'view_reminders'
  | 'view_tasks';

const ALL: Permission[] = [
  'view_dashboard',
  'view_metrics',
  'manage_appointments',
  'attend_appointments',
  'use_pos',
  'use_cash_register',
  'view_own_summary',
  'view_finance',
  'view_staff_finance',
  'manage_clients',
  'view_history',
  'manage_settings',
  'manage_staff',
  'view_invoices',
  'view_reminders',
  'view_tasks',
];

const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  owner: ALL,
  admin: ALL,
  manager: ALL.filter((p) => p !== 'manage_settings'),
  cashier: [
    'view_dashboard',
    'manage_appointments',
    'attend_appointments',
    'use_pos',
    'use_cash_register',
    'view_own_summary',
    'manage_clients',
    'view_history',
    'view_tasks',
    'view_reminders',
  ],
  reception: [
    'view_dashboard',
    'manage_appointments',
    'manage_clients',
    'view_tasks',
    'view_reminders',
    'view_own_summary',
  ],
  /** Colaboradora de servicio: agenda, atiende, cobra, POS, caja, resumen propio. */
  staff: [
    'view_dashboard',
    'manage_appointments',
    'attend_appointments',
    'use_pos',
    'use_cash_register',
    'view_own_summary',
    'manage_clients',
    'view_history',
    'view_tasks',
    'view_reminders',
  ],
  viewer: ['view_dashboard', 'view_metrics', 'view_own_summary'],
};

const PERMISSION_SETS = Object.fromEntries(
  (Object.entries(ROLE_PERMISSIONS) as [UserRole, Permission[]][]).map(
    ([role, perms]) => [role, new Set(perms)],
  ),
) as unknown as Record<UserRole, ReadonlySet<Permission>>;

export function hasPermission(
  role: UserRole | null | undefined,
  permission: Permission,
): boolean {
  if (!role) return false;
  return PERMISSION_SETS[role]?.has(permission) ?? false;
}

export function useHasPermission(
  role: UserRole | null | undefined,
): (p: Permission) => boolean {
  return (p: Permission) => hasPermission(role, p);
}
