-- Ausencias de colaboradoras y cierres del local, para que el agendado los
-- respete (bloqueo duro: no se puede reservar sobre una ausencia/cierre).
--
-- time_off: un rango de fechas [start_date, end_date] (inclusivo, YYYY-MM-DD) en
--   el que NO se agenda.
--     · staff_member_id NULL  → cierre del local (feriado, evento): nadie trabaja.
--     · staff_member_id puesto → ausencia de esa colaboradora (vacaciones, permiso);
--       el resto del equipo sigue disponible.
--   `reason` es la etiqueta ('vacaciones' | 'permiso' | 'feriado' | 'cierre' | libre)
--   y `note` un detalle opcional.
--
-- Scope por organización/sucursal con columnas propias (a diferencia de
-- staff_category, acá el cierre del local no cuelga de ningún staff del que sacar
-- el scope). La disponibilidad del agendado filtra por branch_id. Idempotente
-- (CREATE TABLE IF NOT EXISTS), reejecutable por scripts/migrate.mjs.

CREATE TABLE IF NOT EXISTS time_off (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organization(id),
  branch_id       TEXT REFERENCES branch(id),
  staff_member_id TEXT REFERENCES staff_member(id),
  start_date      TEXT NOT NULL,
  end_date        TEXT NOT NULL,
  reason          TEXT,
  note            TEXT,
  active          INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT
);

CREATE INDEX IF NOT EXISTS time_off_branch_idx
  ON time_off (branch_id, start_date, end_date);

CREATE INDEX IF NOT EXISTS time_off_staff_idx
  ON time_off (staff_member_id, start_date, end_date);
