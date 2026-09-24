import { createElement, type ReactNode } from 'react';
import {
  Scissors,
  Package,
  Users,
  Building2,
  UserRound,
  CreditCard,
  Tags,
  Landmark,
  Calculator,
  type LucideIcon,
} from 'lucide-react';
import { money, fullName } from '@/lib/format';
import { PAYMENT_METHOD_LABELS, SERVICE_CATEGORIES } from '@/config/constants';

const CATEGORY_OPTIONS = SERVICE_CATEGORIES.map((c) => ({
  value: c,
  label: c,
}));

/* ─────────────────────────── Tipos del motor CRUD ────────────────────────── */

export type FieldType =
  | 'text'
  | 'number'
  | 'money'
  | 'textarea'
  | 'date'
  | 'select'
  | 'checkbox'
  | 'color';

export interface Field {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  placeholder?: string;
  options?: { value: string; label: string }[];
  /** Carga dinámica de opciones (FK). Solo 'branches' por ahora. */
  optionsKey?: 'branches';
  colSpan?: 1 | 2;
}

export interface Column {
  header: string;
  render: (row: Record<string, unknown>) => ReactNode;
  align?: 'left' | 'right';
}

export interface ResourceConfig {
  key: string;
  label: string;
  singular: string;
  icon: LucideIcon;
  table: string;
  /** Inyecta organization_id al crear y filtra el listado por organización. */
  autoScopeOrg: boolean;
  /** SQL de listado alternativo (para joins). Recibe orgId. */
  listSql?: (orgId: string) => { sql: string; args: (string | number)[] };
  orderBy: string;
  /** La tabla tiene columna `active` (soft-delete por desactivación). */
  hasActive: boolean;
  /** La tabla tiene `updated_at` (se setea al editar). */
  hasUpdatedAt: boolean;
  /**
   * Impide crear más de un registro por cada valor de esta columna.
   * Ej: 'branch_id' → una sola caja registradora por sucursal.
   */
  uniqueScope?: { column: string; message: string };
  columns: Column[];
  fields: Field[];
}

/* ─────────────────────────────── Helpers UI ──────────────────────────────── */

const PAY_CYCLE_OPTIONS = [
  { value: 'weekly', label: 'Semanal' },
  { value: 'biweekly', label: 'Quincenal' },
  { value: 'monthly', label: 'Mensual' },
];

const METHOD_TYPE_OPTIONS = (
  Object.keys(PAYMENT_METHOD_LABELS) as (keyof typeof PAYMENT_METHOD_LABELS)[]
).map((k) => ({ value: k, label: PAYMENT_METHOD_LABELS[k] }));

const s = (v: unknown) => (v == null ? '—' : String(v));

/** Muestra un círculo con el color del colaborador. */
const colorDot = (hex: string | null): ReactNode =>
  hex
    ? createElement('span', {
        className: 'inline-block h-4 w-4 rounded-full border border-white/20',
        style: { backgroundColor: hex },
        title: hex,
      })
    : '—';

/* ────────────────────────── Definición de recursos ───────────────────────── */

export const RESOURCES: ResourceConfig[] = [
  {
    key: 'services',
    label: 'Servicios',
    singular: 'servicio',
    icon: Scissors,
    table: 'service',
    autoScopeOrg: true,
    orderBy: 'name',
    hasActive: true,
    hasUpdatedAt: true,
    columns: [
      { header: 'Nombre', render: (r) => s(r.name) },
      { header: 'Categoría', render: (r) => s(r.category) },
      { header: 'Código', render: (r) => s(r.code) },
      {
        header: 'Duración',
        render: (r) => (r.duration_minutes ? `${r.duration_minutes} min` : '—'),
      },
      {
        header: 'Precio',
        align: 'right',
        render: (r) => money(Number(r.base_price)),
      },
    ],
    fields: [
      { name: 'name', label: 'Nombre', type: 'text', required: true, colSpan: 2 },
      {
        name: 'category',
        label: 'Categoría',
        type: 'select',
        options: CATEGORY_OPTIONS,
        colSpan: 2,
      },
      { name: 'code', label: 'Código', type: 'text' },
      { name: 'duration_minutes', label: 'Duración (min)', type: 'number' },
      { name: 'base_price', label: 'Precio base', type: 'money', required: true },
      { name: 'description', label: 'Descripción', type: 'textarea', colSpan: 2 },
    ],
  },
  {
    key: 'products',
    label: 'Productos',
    singular: 'producto',
    icon: Package,
    table: 'product',
    autoScopeOrg: true,
    orderBy: 'name',
    hasActive: true,
    hasUpdatedAt: true,
    columns: [
      { header: 'Nombre', render: (r) => s(r.name) },
      { header: 'SKU', render: (r) => s(r.sku) },
      { header: 'Unidad', render: (r) => s(r.unit) },
      {
        header: 'Costo',
        align: 'right',
        render: (r) => money(Number(r.cost_price)),
      },
      {
        header: 'Precio',
        align: 'right',
        render: (r) => money(Number(r.base_price)),
      },
    ],
    fields: [
      { name: 'name', label: 'Nombre', type: 'text', required: true, colSpan: 2 },
      { name: 'sku', label: 'SKU', type: 'text' },
      { name: 'unit', label: 'Unidad', type: 'text', placeholder: 'unit, ml, g…' },
      { name: 'cost_price', label: 'Precio costo', type: 'money' },
      { name: 'base_price', label: 'Precio venta', type: 'money' },
      { name: 'description', label: 'Descripción', type: 'textarea', colSpan: 2 },
    ],
  },
  {
    key: 'staff',
    label: 'Colaboradores',
    singular: 'colaborador',
    icon: Users,
    table: 'staff_member',
    autoScopeOrg: true,
    orderBy: 'first_name',
    hasActive: true,
    hasUpdatedAt: true,
    columns: [
      {
        header: 'Nombre',
        render: (r) => fullName(String(r.first_name), r.last_name as string),
      },
      {
        header: 'Color',
        render: (r) => colorDot(r.color as string | null),
      },
      { header: 'Código', render: (r) => s(r.employee_code) },
      { header: 'Teléfono', render: (r) => s(r.phone) },
      {
        header: 'Ciclo',
        render: (r) =>
          PAY_CYCLE_OPTIONS.find((o) => o.value === r.default_pay_cycle)?.label ??
          s(r.default_pay_cycle),
      },
    ],
    fields: [
      { name: 'first_name', label: 'Nombre', type: 'text', required: true },
      { name: 'last_name', label: 'Apellido', type: 'text' },
      { name: 'color', label: 'Color identificador', type: 'color' },
      { name: 'employee_code', label: 'Código empleado', type: 'text' },
      { name: 'phone', label: 'Teléfono', type: 'text' },
      { name: 'email', label: 'Email', type: 'text' },
      { name: 'birth_date', label: 'Cumpleaños', type: 'date' },
      { name: 'hire_date', label: 'Ingreso', type: 'date' },
      {
        name: 'default_pay_cycle',
        label: 'Ciclo de pago',
        type: 'select',
        options: PAY_CYCLE_OPTIONS,
      },
      { name: 'notes', label: 'Notas', type: 'textarea', colSpan: 2 },
    ],
  },
  {
    key: 'branches',
    label: 'Sucursales',
    singular: 'sucursal',
    icon: Building2,
    table: 'branch',
    autoScopeOrg: true,
    orderBy: 'name',
    hasActive: true,
    hasUpdatedAt: true,
    columns: [
      { header: 'Nombre', render: (r) => s(r.name) },
      { header: 'Código', render: (r) => s(r.code) },
      { header: 'Teléfono', render: (r) => s(r.phone) },
    ],
    fields: [
      { name: 'name', label: 'Nombre', type: 'text', required: true },
      { name: 'code', label: 'Código', type: 'text', required: true },
      { name: 'address', label: 'Dirección', type: 'text', colSpan: 2 },
      { name: 'phone', label: 'Teléfono', type: 'text' },
      { name: 'email', label: 'Email', type: 'text' },
      {
        name: 'google_calendar_id',
        label: 'ID de Google Calendar',
        type: 'text',
        colSpan: 2,
        placeholder: 'ej: abc123@group.calendar.google.com (vacío = primary)',
      },
    ],
  },
  {
    key: 'customers',
    label: 'Clientes',
    singular: 'cliente',
    icon: UserRound,
    table: 'customer',
    autoScopeOrg: true,
    orderBy: 'first_name',
    hasActive: true,
    hasUpdatedAt: true,
    columns: [
      {
        header: 'Nombre',
        render: (r) => fullName(String(r.first_name), r.last_name as string),
      },
      { header: 'WhatsApp', render: (r) => s(r.phone) },
      { header: 'Email', render: (r) => s(r.email) },
    ],
    fields: [
      { name: 'first_name', label: 'Nombre', type: 'text', required: true },
      { name: 'last_name', label: 'Apellido', type: 'text' },
      { name: 'phone', label: 'WhatsApp', type: 'text' },
      { name: 'email', label: 'Email', type: 'text' },
      { name: 'birth_date', label: 'Cumpleaños', type: 'date' },
      { name: 'notes', label: 'Notas', type: 'textarea', colSpan: 2 },
    ],
  },
  {
    key: 'payment_methods',
    label: 'Métodos de pago',
    singular: 'método',
    icon: CreditCard,
    table: 'payment_method',
    autoScopeOrg: true,
    orderBy: 'name',
    hasActive: true,
    hasUpdatedAt: false,
    columns: [
      { header: 'Nombre', render: (r) => s(r.name) },
      { header: 'Código', render: (r) => s(r.code) },
      {
        header: 'Tipo',
        render: (r) =>
          PAYMENT_METHOD_LABELS[
            r.method_type as keyof typeof PAYMENT_METHOD_LABELS
          ] ?? s(r.method_type),
      },
    ],
    fields: [
      { name: 'name', label: 'Nombre', type: 'text', required: true },
      { name: 'code', label: 'Código', type: 'text', required: true },
      {
        name: 'method_type',
        label: 'Tipo',
        type: 'select',
        required: true,
        options: METHOD_TYPE_OPTIONS,
      },
    ],
  },
  {
    key: 'expense_categories',
    label: 'Categorías de gasto',
    singular: 'categoría',
    icon: Tags,
    table: 'expense_category',
    autoScopeOrg: true,
    orderBy: 'name',
    hasActive: true,
    hasUpdatedAt: false,
    columns: [
      { header: 'Nombre', render: (r) => s(r.name) },
      { header: 'Código', render: (r) => s(r.code) },
    ],
    fields: [
      { name: 'name', label: 'Nombre', type: 'text', required: true },
      { name: 'code', label: 'Código', type: 'text', required: true },
    ],
  },
  {
    key: 'bank_accounts',
    label: 'Cuentas bancarias',
    singular: 'cuenta',
    icon: Landmark,
    table: 'bank_account',
    autoScopeOrg: true,
    orderBy: 'name',
    hasActive: true,
    hasUpdatedAt: false,
    columns: [
      { header: 'Nombre', render: (r) => s(r.name) },
      { header: 'Banco', render: (r) => s(r.bank_name) },
      { header: 'Nº cuenta', render: (r) => s(r.account_number) },
    ],
    fields: [
      { name: 'name', label: 'Nombre', type: 'text', required: true },
      { name: 'bank_name', label: 'Banco', type: 'text' },
      { name: 'account_number', label: 'Nº de cuenta', type: 'text' },
      { name: 'account_type', label: 'Tipo', type: 'text', placeholder: 'ahorros, corriente…' },
    ],
  },
  {
    key: 'cash_registers',
    label: 'Cajas registradoras',
    singular: 'caja',
    icon: Calculator,
    table: 'cash_register',
    autoScopeOrg: false,
    listSql: (orgId) => ({
      sql: `SELECT cr.*, b.name AS branch_name
              FROM cash_register cr
              JOIN branch b ON b.id = cr.branch_id
             WHERE b.organization_id = ?
             ORDER BY b.name, cr.name`,
      args: [orgId],
    }),
    orderBy: 'name',
    hasActive: true,
    hasUpdatedAt: false,
    uniqueScope: {
      column: 'branch_id',
      message: 'Esta sucursal ya tiene una caja registradora. Solo se permite una por local.',
    },
    columns: [
      { header: 'Nombre', render: (r) => s(r.name) },
      { header: 'Sucursal', render: (r) => s(r.branch_name) },
    ],
    fields: [
      { name: 'name', label: 'Nombre', type: 'text', required: true },
      {
        name: 'branch_id',
        label: 'Sucursal',
        type: 'select',
        required: true,
        optionsKey: 'branches',
      },
    ],
  },
];
