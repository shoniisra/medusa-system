import type { UserRole } from '@/types';

/**
 * Capacidades del sistema. Fuente única de verdad para el gating de rutas,
 * navegación y acciones sensibles.
 *
 * - `manage_staff` deja VER el equipo (admin/gerente).
 * - `manage_team_roles` deja EDITAR/CREAR miembros y cambiar roles (solo admin).
 * - `view_diagnostics` es el panel de errores del Worker (solo admin), aparte
 *   de `manage_settings` para que un gerente pueda tocar catálogos sin ver logs.
 */
export type Permission =
  | 'view_audit'
  | 'view_dashboard'
  | 'view_metrics'
  | 'manage_appointments'
  | 'attend_appointments'
  | 'use_pos'
  | 'use_cash_register'
  | 'view_finance'
  | 'view_staff_finance'
  | 'manage_clients'
  | 'manage_settings'
  | 'manage_staff'
  | 'manage_team_roles'
  | 'view_diagnostics'
  | 'view_invoices'
  | 'view_reminders'
  | 'view_tasks';

const ALL: Permission[] = [
  'view_audit',
  'view_dashboard',
  'view_metrics',
  'manage_appointments',
  'attend_appointments',
  'use_pos',
  'use_cash_register',
  'view_finance',
  'view_staff_finance',
  'manage_clients',
  'manage_settings',
  'manage_staff',
  'manage_team_roles',
  'view_diagnostics',
  'view_invoices',
  'view_reminders',
  'view_tasks',
];

/** Permisos operativos del día a día: agenda, POS, caja, clientes, tareas. */
const FRONT_DESK: Permission[] = [
  'view_dashboard',
  'manage_appointments',
  'attend_appointments',
  'use_pos',
  'use_cash_register',
  'manage_clients',
  'view_tasks',
  'view_reminders',
];

const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  admin: ALL,
  // Gerente: acceso total funcional, sin diagnóstico ni edición de miembros.
  manager: ALL.filter(
    (p) => p !== 'view_diagnostics' && p !== 'manage_team_roles',
  ),
  // Caja/Recepción: fusión de los antiguos roles cashier + reception.
  cashier: FRONT_DESK,
  // Colaboradora de servicio: agenda, atiende, cobra, POS, caja, resumen propio.
  staff: FRONT_DESK.filter((p) => p !== 'manage_clients'),
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

/**
 * Etiquetas visibles del rol. Es la única fuente de verdad para mostrar el rol
 * al usuario (badges del topbar, menú móvil, tabla de equipo, selector de rol).
 */
export const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Admin',
  manager: 'Gerente',
  cashier: 'Caja/Recepción',
  staff: 'Colaboradora',
};

export function roleLabel(role: UserRole | null | undefined): string {
  if (!role) return '—';
  return ROLE_LABELS[role] ?? role;
}
