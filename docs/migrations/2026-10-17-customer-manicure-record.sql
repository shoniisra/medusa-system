-- Registro técnico de manicura por visita, independiente de las ventas.
-- Aplicar antes de publicar la nueva pantalla de atención:
-- npm run migrate -- docs/migrations/2026-10-17-customer-manicure-record.sql
CREATE TABLE IF NOT EXISTS customer_manicure_record (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organization(id),
  customer_id TEXT NOT NULL REFERENCES customer(id) ON DELETE CASCADE,
  record_date TEXT NOT NULL,
  technique TEXT,
  products TEXT,
  shade TEXT,
  notes TEXT,
  staff_member_id TEXT REFERENCES staff_member(id) ON DELETE SET NULL,
  created_by TEXT REFERENCES app_user(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (length(trim(coalesce(technique, '') || coalesce(products, '') || coalesce(shade, '') || coalesce(notes, ''))) > 0)
);
CREATE INDEX IF NOT EXISTS idx_manicure_customer_date
  ON customer_manicure_record (organization_id, customer_id, record_date DESC, created_at DESC);
