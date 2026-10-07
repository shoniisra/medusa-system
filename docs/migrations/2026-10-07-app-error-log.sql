-- Observabilidad propia: el Worker escribe acá los errores 5xx y timeouts del
-- proxy SQL para no depender de wrangler tail / Cloudflare Observability a la
-- hora de hacer forensia de incidentes (ej. el hang de Turso del 2026-10-07).
--
-- Idempotente (CREATE TABLE IF NOT EXISTS), reejecutable por scripts/migrate.mjs.

CREATE TABLE IF NOT EXISTS app_error_log (
  id          TEXT PRIMARY KEY,
  occurred_at TEXT NOT NULL,            -- ISO 8601 UTC
  source      TEXT NOT NULL,            -- 'worker:api/db', 'worker:api/gcal', ...
  status      INTEGER NOT NULL,         -- status HTTP devuelto
  message     TEXT NOT NULL,            -- e.message (truncado a 500 chars)
  context     TEXT                      -- JSON opcional (ruta, duración, etc.)
);

CREATE INDEX IF NOT EXISTS app_error_log_occurred_idx
  ON app_error_log (occurred_at DESC);

CREATE INDEX IF NOT EXISTS app_error_log_source_idx
  ON app_error_log (source, occurred_at DESC);
