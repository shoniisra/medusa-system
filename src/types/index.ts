/**
 * Contrato de datos del frontend, espejo del esquema SQLite (Turso).
 *
 * Convenciones del esquema:
 *  - Todos los IDs son TEXT (uuid/cuid generados en cliente o servidor).
 *  - Los timestamps son TEXT ISO-8601 (ej: "2026-09-23T14:30:00Z").
 *  - Los booleanos se guardan como 0/1 → aquí los exponemos como `BoolInt`.
 *  - Montos son NUMERIC → number en TS (centavos NO; son decimales).
 *
 * Regla de negocio central:
 *  VENTA (lo que se cobra al cliente)  ≠  PAGO (cómo/cuándo ingresa el dinero).
 *  Una `Sale` puede tener 0..N `Payment`. El saldo = total - Σ pagos confirmados.
 */

export type ID = string;
export type ISODate = string; // "YYYY-MM-DD"
export type ISODateTime = string; // ISO-8601 completo
export type BoolInt = 0 | 1;

/* ────────────────────────── Organización / sucursales ────────────────────── */

export interface Organization {
  id: ID;
  name: string;
  legal_name: string | null;
  tax_id: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  timezone: string; // default 'America/Guayaquil'
  currency_code: string; // default 'USD'
  active: BoolInt;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

export interface Branch {
  id: ID;
  organization_id: ID;
  code: string;
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  timezone: string | null;
  /** Calendario de Google al que van las citas de esta sucursal. */
  google_calendar_id: string | null;
  active: BoolInt;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

/* ────────────────────────────── Usuarios / auth ──────────────────────────── */

export type UserRole =
  | 'owner'
  | 'admin'
  | 'manager'
  | 'cashier'
  | 'reception'
  | 'staff'
  | 'viewer';

export interface AppUser {
  id: ID;
  organization_id: ID;
  username: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  role: UserRole;
  active: BoolInt;
  last_login_at: ISODateTime | null;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

/* ─────────────────────────── Catálogo / precios ──────────────────────────── */

export interface Service {
  id: ID;
  organization_id: ID;
  code: string | null;
  name: string;
  description: string | null;
  duration_minutes: number | null;
  base_price: number;
  category: string | null;
  active: BoolInt;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

export interface Product {
  id: ID;
  organization_id: ID;
  sku: string | null;
  name: string;
  description: string | null;
  unit: string; // 'unit', 'ml', etc.
  cost_price: number;
  base_price: number;
  active: BoolInt;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

export type PaymentMethodType = 'cash' | 'transfer' | 'card' | 'other';

export interface PaymentMethod {
  id: ID;
  organization_id: ID;
  code: string;
  name: string;
  method_type: PaymentMethodType;
  active: BoolInt;
}

export interface BankAccount {
  id: ID;
  organization_id: ID;
  name: string;
  bank_name: string | null;
  account_number: string | null;
  account_type: string | null;
  active: BoolInt;
}

/* ──────────────────────────────── Clientes ───────────────────────────────── */

export interface Customer {
  id: ID;
  organization_id: ID;
  first_name: string;
  last_name: string | null;
  phone: string | null; // WhatsApp
  email: string | null;
  birth_date: ISODate | null; // cumpleaños
  notes: string | null;
  /** Alergias / sensibilidades a productos. */
  allergies: string | null;
  /** Notas capilares: condición, historial químico, advertencias. */
  hair_notes: string | null;
  preferred_staff_id: ID | null;
  first_visit_at: ISODateTime | null;
  last_visit_at: ISODateTime | null;
  active: BoolInt;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

/** Registro de proceso de color de un cliente (ficha capilar). */
export interface CustomerColorRecord {
  id: ID;
  organization_id: ID;
  customer_id: ID;
  record_date: ISODate;
  formula: string | null;
  brand: string | null;
  developer: string | null;
  result: string | null;
  notes: string | null;
  staff_member_id: ID | null;
  created_by: ID | null;
  created_at: ISODateTime;
}

/* ──────────────────────────────── Personal ───────────────────────────────── */

export type PayCycle = 'weekly' | 'biweekly' | 'monthly';

export interface StaffMember {
  id: ID;
  organization_id: ID;
  app_user_id: ID | null;
  employee_code: string | null;
  first_name: string;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  birth_date: ISODate | null;
  hire_date: ISODate | null;
  termination_date: ISODate | null;
  default_pay_cycle: PayCycle;
  notes: string | null;
  /** Color identificador del colaborador (hex, ej #F59E0B). */
  color: string | null;
  active: BoolInt;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

export type CommissionType = 'percentage' | 'fixed';

/** Comisión configurada por colaborador+servicio (tarifa base). */
export interface StaffServiceCommission {
  id: ID;
  staff_member_id: ID;
  service_id: ID;
  commission_type: CommissionType;
  commission_value: number; // % (<=100) o monto fijo
  effective_from: ISODate;
  effective_to: ISODate | null;
  active: BoolInt;
}

/* ─────────────────────────── Ventas y comisiones ─────────────────────────── */

export type SaleStatus =
  | 'draft'
  | 'completed'
  | 'voided'
  | 'refunded'
  | 'partially_refunded';

export interface Sale {
  id: ID;
  organization_id: ID;
  branch_id: ID;
  customer_id: ID | null;
  appointment_id: ID | null;
  sale_number: string;
  sold_at: ISODateTime;
  status: SaleStatus;
  subtotal: number;
  discount_total: number;
  tax_total: number;
  total: number;
  requires_invoice: BoolInt; // → dispara invoice_request
  notes: string | null;
  created_by: ID | null;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

export interface SaleItem {
  id: ID;
  sale_id: ID;
  service_id: ID | null;
  product_id: ID | null;
  description: string;
  quantity: number;
  list_unit_price: number;
  discount_amount: number;
  final_unit_price: number;
  line_total: number;
  promotion_id: ID | null;
  notes: string | null;
}

export type ParticipationRole = 'primary' | 'assistant';
export type CommissionBasis = 'list_price' | 'final_service_value' | 'custom';

/**
 * Distribución de comisión por línea de servicio.
 * Ej: Color $80 → primary (colaborador) + opcional assistant (ayudante),
 * cada uno con su monto/porcentaje. `reduces_primary_amount = 1` indica que
 * lo del ayudante se descuenta de lo del principal (no suma extra al costo).
 */
export interface SaleServiceStaff {
  id: ID;
  sale_item_id: ID;
  staff_member_id: ID;
  participation_role: ParticipationRole;
  commission_basis: CommissionBasis;
  basis_amount: number;
  commission_type: CommissionType;
  commission_rate: number;
  commission_amount: number;
  reduces_primary_amount: BoolInt;
  notes: string | null;
}

/* ─────────────────────────────────── Pagos ───────────────────────────────── */

export type PaymentStatus = 'pending' | 'confirmed' | 'voided' | 'refunded';

/** Un ingreso de dinero contra una venta (o abono a una cita). */
export interface Payment {
  id: ID;
  organization_id: ID;
  branch_id: ID;
  sale_id: ID | null;
  appointment_id: ID | null;
  payment_method_id: ID;
  bank_account_id: ID | null;
  paid_at: ISODateTime;
  amount: number;
  status: PaymentStatus;
  reference: string | null;
  receipt_file_url: string | null;
  notes: string | null;
  created_by: ID | null;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

/* ─────────────────────────────── Caja / finanzas ─────────────────────────── */

export interface CashRegister {
  id: ID;
  branch_id: ID;
  name: string;
  active: BoolInt;
  created_at: ISODateTime;
}

export type CashSessionStatus = 'open' | 'closed' | 'reopened';

export interface CashSession {
  id: ID;
  cash_register_id: ID;
  opened_by: ID | null;
  opened_at: ISODateTime;
  opening_cash: number;
  closed_by: ID | null;
  closed_at: ISODateTime | null;
  expected_cash: number | null; // esperado (calculado)
  counted_cash: number | null; // contado (físico)
  difference: number | null; // contado - esperado
  status: CashSessionStatus;
  notes: string | null;
}

export type CashMovementType =
  | 'sale'
  | 'expense'
  | 'staff_payment'
  | 'cash_in'
  | 'cash_out'
  | 'refund'
  | 'adjustment';
export type CashDirection = 'in' | 'out';

export interface CashMovement {
  id: ID;
  cash_session_id: ID;
  branch_id: ID;
  movement_type: CashMovementType;
  direction: CashDirection;
  amount: number;
  movement_at: ISODateTime;
  sale_id: ID | null;
  payment_id: ID | null;
  expense_id: ID | null;
  staff_payment_id: ID | null;
  description: string | null;
  created_by: ID | null;
}

export type ExpenseStatus = 'pending' | 'confirmed' | 'voided';

/** Dónde vive el dinero: caja física o una cuenta bancaria. */
export type AccountKind = 'cash' | 'bank';

/** Transferencia de dinero entre caja y/o cuentas bancarias. */
export interface AccountTransfer {
  id: ID;
  organization_id: ID;
  branch_id: ID;
  transfer_date: ISODate;
  amount: number;
  from_kind: AccountKind;
  from_bank_account_id: ID | null;
  to_kind: AccountKind;
  to_bank_account_id: ID | null;
  cash_session_id: ID | null;
  description: string | null;
  created_by: ID | null;
  created_at: ISODateTime;
}

/** 'debt' = por pagar (le debemos); 'credit' = por cobrar (nos deben). */
export type DebtCreditKind = 'debt' | 'credit';
export type DebtCreditStatus = 'open' | 'settled' | 'voided';

/** Cuenta por pagar o por cobrar. */
export interface DebtCredit {
  id: ID;
  organization_id: ID;
  branch_id: ID;
  kind: DebtCreditKind;
  counterparty: string;
  description: string | null;
  amount: number;
  paid_amount: number;
  due_date: ISODate | null;
  status: DebtCreditStatus;
  created_by: ID | null;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

export interface ExpenseCategory {
  id: ID;
  organization_id: ID;
  code: string;
  name: string;
  parent_id: ID | null;
  active: BoolInt;
}

/**
 * Egreso. Si el método es efectivo → afecta caja física.
 * Si es transferencia → solo afecta flujo bancario (no caja física).
 */
export interface Expense {
  id: ID;
  organization_id: ID;
  branch_id: ID;
  expense_category_id: ID;
  payment_method_id: ID;
  bank_account_id: ID | null;
  expense_date: ISODate;
  description: string;
  amount: number;
  vendor_name: string | null;
  receipt_number: string | null;
  receipt_file_url: string | null;
  status: ExpenseStatus;
  created_by: ID | null;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

/* ─────────────────────────── Nómina / liquidaciones ──────────────────────── */

export type PayPeriodStatus =
  | 'open'
  | 'calculated'
  | 'approved'
  | 'paid'
  | 'closed';

export interface PayPeriod {
  id: ID;
  organization_id: ID;
  branch_id: ID | null;
  period_type: PayCycle;
  start_date: ISODate;
  end_date: ISODate;
  status: PayPeriodStatus;
  notes: string | null;
  created_by: ID | null;
  created_at: ISODateTime;
}

/** Adelanto de sueldo a un colaborador. */
export interface StaffAdvance {
  id: ID;
  organization_id: ID;
  branch_id: ID;
  staff_member_id: ID;
  advance_date: ISODate;
  amount: number;
  payment_method_id: ID;
  bank_account_id: ID | null;
  cash_session_id: ID | null;
  notes: string | null;
  status: ExpenseStatus;
  created_by: ID | null;
  created_at: ISODateTime;
}

/** Liquidación de comisiones por periodo: neto = comisiones - adelantos - otras. */
export interface StaffCommissionPeriod {
  id: ID;
  pay_period_id: ID;
  staff_member_id: ID;
  commission_total: number;
  advances_total: number;
  other_deductions: number;
  net_payable: number;
  calculated_at: ISODateTime | null;
  notes: string | null;
}

export interface StaffPayment {
  id: ID;
  organization_id: ID;
  branch_id: ID;
  staff_member_id: ID;
  pay_period_id: ID | null;
  paid_at: ISODateTime;
  gross_commission: number;
  advances_discount: number;
  other_deductions: number;
  net_paid: number;
  payment_method_id: ID;
  bank_account_id: ID | null;
  cash_session_id: ID | null;
  status: ExpenseStatus;
  reference: string | null;
  notes: string | null;
  created_by: ID | null;
  created_at: ISODateTime;
}

/* ───────────────────────────────── Agenda ────────────────────────────────── */

export type AppointmentStatus =
  | 'reserved'
  | 'confirmed'
  | 'attended'
  | 'cancelled'
  | 'no_show';

export interface Appointment {
  id: ID;
  organization_id: ID;
  branch_id: ID;
  customer_id: ID | null;
  start_at: ISODateTime;
  end_at: ISODateTime;
  status: AppointmentStatus;
  deposit_required: BoolInt;
  /** Abono / seña pagado al reservar. */
  deposit_amount: number;
  notes: string | null;
  google_calendar_id: string | null;
  google_calendar_event_id: string | null; // sync futura
  created_by: ID | null;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

export interface AppointmentItem {
  id: ID;
  appointment_id: ID;
  service_id: ID | null;
  product_id: ID | null;
  description: string;
  quantity: number;
  list_unit_price: number;
  discount_amount: number;
  final_unit_price: number;
  assigned_staff_id: ID | null;
  notes: string | null;
}

/* ────────────────────────────── Facturación ──────────────────────────────── */

export type InvoiceRequestStatus =
  | 'pending'
  | 'in_progress'
  | 'done'
  | 'cancelled';

/** Solicitud de factura (alimenta el Kanban). Una por venta. */
export interface InvoiceRequest {
  id: ID;
  organization_id: ID;
  branch_id: ID;
  sale_id: ID;
  customer_id: ID | null;
  status: InvoiceRequestStatus;
  requested_at: ISODateTime;
  processed_at: ISODateTime | null;
  processed_by: ID | null;
  notes: string | null;
}

export type InvoiceStatus =
  | 'draft'
  | 'manual_issued'
  | 'voided'
  | 'electronic_pending'
  | 'electronic_issued'
  | 'electronic_voided';

export interface Invoice {
  id: ID;
  organization_id: ID;
  branch_id: ID;
  sale_id: ID;
  invoice_request_id: ID | null;
  customer_id: ID | null;
  invoice_number: string | null;
  issue_date: ISODate;
  status: InvoiceStatus;
  subtotal: number;
  tax_total: number;
  total: number;
  sri_authorization: string | null; // SRI Ecuador
  sri_access_key: string | null;
  pdf_file_url: string | null;
  notes: string | null;
  created_by: ID | null;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

/* ──────────────────────────── Vistas (read-model) ────────────────────────── */
/* Estas mapean 1:1 con las VIEW del esquema. Solo lectura. */

export interface VDailySales {
  organization_id: ID;
  branch_id: ID;
  day: ISODate;
  sales_count: number;
  subtotal: number;
  discounts: number;
  taxes: number;
  total_sales: number;
}

export interface VDailyCollections {
  organization_id: ID;
  branch_id: ID;
  day: ISODate;
  cash_received: number;
  transfer_received: number;
  card_received: number;
  total_received: number;
}

export interface VDailyExpenses {
  organization_id: ID;
  branch_id: ID;
  day: ISODate;
  total_expenses: number;
}

export interface VDailyCommissions {
  organization_id: ID;
  branch_id: ID;
  day: ISODate;
  total_commissions: number;
}

export interface VInvoiceKanban {
  id: ID;
  organization_id: ID;
  branch_id: ID;
  sale_id: ID;
  customer_id: ID | null;
  status: InvoiceRequestStatus;
  requested_at: ISODateTime;
  processed_at: ISODateTime | null;
  sale_number: string;
  sale_total: number;
  customer_name: string | null;
  phone: string | null;
}

export interface VStaffPayableSummary {
  id: ID;
  pay_period_id: ID;
  start_date: ISODate;
  end_date: ISODate;
  pay_period_status: PayPeriodStatus;
  staff_member_id: ID;
  staff_name: string;
  commission_total: number;
  advances_total: number;
  other_deductions: number;
  net_payable: number;
}

/* ───────────────────────── Tipos compuestos de UI ────────────────────────── */

/** Línea de venta en construcción en el POS, con su distribución de comisión. */
export interface DraftSaleItem {
  tempId: string;
  service_id: ID | null;
  product_id: ID | null;
  description: string;
  quantity: number;
  list_unit_price: number;
  discount_amount: number;
  final_unit_price: number;
  /** Estilista responsable de la línea (solo servicios); define la comisión. */
  assigned_staff_id: ID | null;
  commissions: DraftCommission[];
}

export interface DraftCommission {
  tempId: string;
  staff_member_id: ID;
  participation_role: ParticipationRole;
  commission_type: CommissionType;
  commission_rate: number; // % o monto fijo según type
  commission_amount: number; // resuelto
  reduces_primary_amount: boolean;
}

/** Venta con saldo calculado (venta - pagos confirmados). */
export interface SaleWithBalance extends Sale {
  paid_amount: number;
  balance: number;
}
