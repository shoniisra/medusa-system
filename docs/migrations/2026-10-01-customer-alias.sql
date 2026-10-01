-- Nombre real + alias + nombre de la agenda del teléfono.
--
-- first_name/last_name pasan a ser el nombre REAL (el que sirve para
-- identificar y facturar). Lo que antes se usaba como nombre —el alias con el
-- que entró el contacto de la agenda— se conserva en dos campos nuevos:
--
--   nickname       alias / como se le dice en el salón.
--   imported_name  nombre tal como está en la agenda del teléfono, para poder
--                  encontrar ahí el contacto después de normalizar el nombre.
--
-- El esquema vive en Turso (no hay herramienta de migraciones todavía, ver
-- docs/BACKLOG.md). Aplicar con:
--   turso db shell <base> < docs/migrations/2026-10-01-customer-alias.sql

ALTER TABLE customer ADD COLUMN nickname TEXT;
ALTER TABLE customer ADD COLUMN imported_name TEXT;

-- Backfill: los 1411 contactos del 2026-09-24 son la importación del .vcf de la
-- agenda, así que el nombre que tienen hoy ES el de la agenda. Los posteriores
-- los creó la app (alta manual o sync de Google Calendar) y no están en la
-- agenda del teléfono: quedan en NULL a propósito.
UPDATE customer
   SET imported_name = TRIM(first_name || ' ' || COALESCE(last_name, ''))
 WHERE imported_name IS NULL
   AND created_at < '2026-09-25';
