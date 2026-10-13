-- Habilidades de cada colaborador, base para el auto-agendado de clientes.
--
-- staff_category: qué CATEGORÍAS de servicio atiende cada colaborador, con
--   prioridad (1 = primaria, 2 = secundaria, ...). El auto-agendado ofrecerá la
--   secundaria solo cuando la primaria no tenga cupo (caso uñas/pedicure: Gis
--   primaria, Lesly secundaria).
-- staff_service_exclusion: servicios puntuales que, dentro de una categoría que
--   el colaborador sí atiende, ese colaborador NO hace. Permite "hace la
--   categoría salvo este servicio".
--
-- Sin columna organization_id a propósito: igual que staff_service_commission,
-- el scope por organización sale del join a staff_member. Idempotente
-- (CREATE TABLE IF NOT EXISTS), reejecutable por scripts/migrate.mjs.

CREATE TABLE IF NOT EXISTS staff_category (
  id              TEXT PRIMARY KEY,
  staff_member_id TEXT NOT NULL REFERENCES staff_member(id),
  category        TEXT NOT NULL,
  priority        INTEGER NOT NULL DEFAULT 1,
  active          INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS staff_category_unq
  ON staff_category (staff_member_id, category);

CREATE INDEX IF NOT EXISTS staff_category_cat_idx
  ON staff_category (category, priority);

CREATE TABLE IF NOT EXISTS staff_service_exclusion (
  id              TEXT PRIMARY KEY,
  staff_member_id TEXT NOT NULL REFERENCES staff_member(id),
  service_id      TEXT NOT NULL REFERENCES service(id),
  active          INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS staff_service_exclusion_unq
  ON staff_service_exclusion (staff_member_id, service_id);
