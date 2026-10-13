-- Saldo a favor (gift card / bono) por cliente.
--
-- Es un libro de movimientos append-only: cada fila suma (carga) o resta (canje)
-- saldo. El saldo disponible de un cliente es SUM(amount) de sus filas. No se
-- guarda un "balance" materializado para que nunca se desincronice del detalle.
--
-- Flujo de plata (sin descuadrar caja ni banco):
--   • Carga  → movimiento APARTE, no es una venta. Entra plata real hoy: se
--              registra un `payment` (sin sale ni cita) + su `cash_movement` si
--              es efectivo, y acá una fila kind='load' con amount > 0.
--   • Canje  → medio de pago "Saldo a favor". NO mueve plata real: el `payment`
--              va sin bank_account y sin cash_movement, y acá una fila
--              kind='redeem' con amount < 0. Puede ser parcial (el resto se
--              cobra en efectivo/transferencia) y sirve como abono al reservar.
--
-- Aplicar con:
--   node scripts/migrate.mjs docs/migrations/2026-10-12-customer-credit.sql

CREATE TABLE IF NOT EXISTS customer_credit_ledger (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  customer_id     TEXT NOT NULL,
  -- Firmado: + carga saldo, - lo consume. El saldo es la suma de esta columna.
  amount          REAL NOT NULL,
  -- load = recarga · redeem = canje · adjustment = ajuste manual · refund = devolución.
  kind            TEXT NOT NULL,
  -- Enlaces opcionales según el movimiento (venta canjeada, cita, pago que lo movió).
  sale_id         TEXT,
  appointment_id  TEXT,
  payment_id      TEXT,
  note            TEXT,
  created_by      TEXT,
  created_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_credit_customer
  ON customer_credit_ledger (customer_id);

-- Método de pago "Saldo a favor": con esto el canje se registra como un pago más
-- de la venta, pero `method_type='other'` lo deja fuera de los totales de
-- efectivo y banco (que miran 'cash'/'transfer'), así no infla ningún arqueo.
INSERT INTO payment_method (id, organization_id, code, name, method_type, active)
SELECT lower(hex(randomblob(16))), o.id, 'store_credit', 'Saldo a favor', 'other', 1
  FROM organization o
 WHERE NOT EXISTS (
   SELECT 1 FROM payment_method pm
    WHERE pm.organization_id = o.id AND pm.code = 'store_credit'
 );
