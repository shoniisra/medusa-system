-- Índices para las consultas más frecuentes de la app (rendimiento).
--
-- La agenda, el dashboard, Tareas, la caja y Flujo filtran por sucursal + fecha
-- (`appointment.start_at`, `sale.sold_at`, `expense.expense_date`) y cruzan
-- citas/ventas con sus líneas y pagos por FK. Sin índice en esas columnas cada
-- carga recorre la tabla completa en Turso. Las consultas ya comparan las fechas
-- como rango (`start_at >= ? AND start_at < ?`) para poder usarlos.
--
-- Idempotente (IF NOT EXISTS), reejecutable con:
--   npm run migrate -- docs/migrations/2026-10-30-perf-indexes.sql

CREATE INDEX IF NOT EXISTS ix_appointment_branch_start
  ON appointment (branch_id, start_at);

CREATE INDEX IF NOT EXISTS ix_appointment_customer
  ON appointment (customer_id, start_at);

CREATE INDEX IF NOT EXISTS ix_appointment_item_appointment
  ON appointment_item (appointment_id);

CREATE INDEX IF NOT EXISTS ix_sale_branch_sold
  ON sale (branch_id, sold_at);

CREATE INDEX IF NOT EXISTS ix_sale_customer
  ON sale (customer_id);

CREATE INDEX IF NOT EXISTS ix_sale_appointment
  ON sale (appointment_id);

CREATE INDEX IF NOT EXISTS ix_sale_item_sale
  ON sale_item (sale_id);

CREATE INDEX IF NOT EXISTS ix_sale_service_staff_item
  ON sale_service_staff (sale_item_id);

CREATE INDEX IF NOT EXISTS ix_payment_sale
  ON payment (sale_id);

CREATE INDEX IF NOT EXISTS ix_payment_appointment
  ON payment (appointment_id);

CREATE INDEX IF NOT EXISTS ix_cash_movement_session
  ON cash_movement (cash_session_id);

CREATE INDEX IF NOT EXISTS ix_expense_branch_date
  ON expense (branch_id, expense_date);

CREATE INDEX IF NOT EXISTS ix_customer_org
  ON customer (organization_id);
