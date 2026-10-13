-- Ayudas (asistencias internas) en una línea de servicio.
--
-- Una "ayuda" es un paso que otra colaboradora hace dentro de un servicio
-- principal (lavar el cabello, sujetar para el pintado, secar, cepillar...).
-- NO es un servicio que se factura aparte: se modela como una fila `assistant`
-- en sale_service_staff cuyo monto de comisión se DESCUENTA del principal
-- (reduces_primary_amount = 1). Así la comisión total de la línea se reparte
-- entre N colaboradores sin cambiar lo que paga el cliente ni el costo total.
--
--   assist_label: qué ayuda fue (p. ej. "Lavar cabello"), denormalizada en la
--     fila para poder auditarla en /personal aunque el catálogo cambie después.
--
-- assist_type: catálogo (configurable) que solo alimenta el selector de ayudas.
-- El scope por organización sale de organization_id. Idempotente
-- (ADD COLUMN reejecutable: migrate.mjs trata "duplicate column" como aplicada;
-- CREATE TABLE IF NOT EXISTS), reejecutable por scripts/migrate.mjs.

ALTER TABLE sale_service_staff ADD COLUMN assist_label TEXT;

CREATE TABLE IF NOT EXISTS assist_type (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organization(id),
  name            TEXT NOT NULL,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  active          INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS assist_type_unq
  ON assist_type (organization_id, name);

CREATE INDEX IF NOT EXISTS assist_type_org_idx
  ON assist_type (organization_id, active, sort_order);
