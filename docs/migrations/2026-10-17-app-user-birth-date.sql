-- Migración: cumpleaños en app_user
-- Reejecutable solo manualmente: SQLite ignora la nueva ALTER si la columna existe.
--
-- Motivo: /personal/equipo muestra cumpleaños y los admins sin perfil de staff
-- (p. ej. Michelle, Johnny-futuro-admin-only) no tenían dónde guardarlo. Antes
-- forzábamos crearles un staff_member solo para el birthday; ahora el dato vive
-- junto al usuario.

ALTER TABLE app_user ADD COLUMN birth_date TEXT;
