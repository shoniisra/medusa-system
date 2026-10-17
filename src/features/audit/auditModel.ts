export interface AuditEntry {
  id: number;
  occurred_at: string;
  request_id: string | null;
  actor_id: string | null;
  actor_name: string;
  actor_role: string | null;
  source: string;
  entity_type: string;
  entity_id: string;
  table_name: string;
  record_id: string;
  action: string;
  before_data: string | null;
  after_data: string | null;
}

export const ENTITY_LABELS: Record<string, string> = {
  appointment: 'Citas', sale: 'Ventas POS', payment: 'Cobros', transaction: 'Transacciones', customer: 'Clientes',
};
export const ACTION_LABELS: Record<string, string> = { create: 'Creó', update: 'Modificó', delete: 'Eliminó' };
export const TABLE_LABELS: Record<string, string> = {
  appointment: 'Cita', appointment_item: 'Servicio de cita', sale: 'Venta', sale_item: 'Detalle de venta',
  sale_service_staff: 'Asignación / comisión', payment: 'Cobro', cash_movement: 'Movimiento de caja',
  cash_session: 'Apertura / cierre de caja', expense: 'Gasto', account_transfer: 'Transferencia',
  debt_credit: 'Deuda / crédito', staff_payment: 'Pago a colaboradora', staff_advance: 'Adelanto',
  customer: 'Cliente', customer_color_record: 'Proceso de color', customer_manicure_record: 'Proceso de manicura',
  customer_credit_ledger: 'Saldo a favor de cliente',
};

const FIELD_LABELS: Record<string, string> = {
  id: 'Identificador', organization_id: 'Organización', branch_id: 'Sucursal', customer_id: 'Cliente',
  start_at: 'Inicio', end_at: 'Fin', status: 'Estado', deposit_required: 'Requiere abono', deposit_amount: 'Abono',
  notes: 'Observaciones', created_by: 'Registrado por', created_at: 'Creado', updated_at: 'Actualizado',
  assigned_staff_id: 'Colaboradora asignada', staff_member_id: 'Colaboradora', description: 'Descripción',
  service_id: 'Servicio', product_id: 'Producto', category: 'Categoría', quantity: 'Cantidad',
  list_unit_price: 'Precio de lista', discount_amount: 'Descuento', final_unit_price: 'Precio final',
  line_total: 'Total de línea', sale_number: 'Número de venta', sold_at: 'Fecha de venta', subtotal: 'Subtotal',
  discount_total: 'Descuento total', tax_total: 'Impuestos', total: 'Total', requires_invoice: 'Requiere factura',
  sale_id: 'Venta', appointment_id: 'Cita', sale_item_id: 'Línea de venta', participation_role: 'Participación',
  basis_amount: 'Base de comisión', commission_rate: 'Tasa de comisión', commission_amount: 'Comisión',
  commission_basis: 'Criterio de comisión', commission_type: 'Tipo de comisión', assist_label: 'Asistencia',
  reduces_primary_amount: 'Descuenta a principal', payment_method_id: 'Método de pago', bank_account_id: 'Cuenta bancaria',
  paid_at: 'Fecha de cobro', amount: 'Monto', reference: 'Referencia', receipt_file_url: 'Comprobante',
  cash_session_id: 'Sesión de caja', movement_type: 'Tipo de movimiento', direction: 'Dirección',
  movement_at: 'Fecha de movimiento', expense_id: 'Gasto', staff_payment_id: 'Pago a colaboradora',
  first_name: 'Nombres', last_name: 'Apellidos', phone: 'Teléfono', email: 'Correo', birth_date: 'Nacimiento',
  allergies: 'Alergias', hair_notes: 'Notas de cabello', nickname: 'Apodo', imported_name: 'Nombre importado',
  tax_id: 'Identificación fiscal', deposit_exempt: 'Exento de abono', active: 'Activo', preferred_staff_id: 'Colaboradora preferida',
  record_date: 'Fecha del proceso', technique: 'Técnica', products: 'Productos', shade: 'Tono', formula: 'Fórmula',
  brand: 'Marca', developer: 'Oxidante', result: 'Resultado', opening_cash: 'Efectivo inicial', counted_cash: 'Efectivo contado',
  expected_cash: 'Efectivo esperado', difference: 'Diferencia', opened_by: 'Abierto por', closed_by: 'Cerrado por',
  opened_at: 'Apertura', closed_at: 'Cierre', transfer_date: 'Fecha de transferencia', expense_date: 'Fecha del gasto',
  from_kind: 'Origen', to_kind: 'Destino', from_bank_account_id: 'Cuenta de origen', to_bank_account_id: 'Cuenta de destino',
  counterparty: 'Contraparte', due_date: 'Vencimiento', paid_amount: 'Monto pagado', note: 'Nota', kind: 'Tipo',
};

export function auditChanges(entry: Pick<AuditEntry, 'before_data' | 'after_data'>) {
  const before = JSON.parse(entry.before_data ?? '{}') as Record<string, unknown>;
  const after = JSON.parse(entry.after_data ?? '{}') as Record<string, unknown>;
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    .map((key) => ({ key, label: FIELD_LABELS[key] ?? key, before: before[key], after: after[key] }));
}

export function auditValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  return typeof value === 'object' ? JSON.stringify(value) : typeof value === 'string' ? value : JSON.stringify(value);
}
