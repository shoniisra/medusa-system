-- Un evento de Google Calendar no puede corresponder a dos citas de la misma
-- sucursal. Es la red final contra el duplicado del round-trip
-- app → Google Calendar → sync: si algo vuelve a intentar insertar una cita
-- con un google_calendar_event_id ya usado, la base lo rechaza en vez de
-- dejar dos citas (una con el cliente real y otra con el nombre adivinado del
-- título del evento).
--
-- Aplicar con:
--   npm run migrate -- docs/migrations/2026-10-01-gcal-evento-unico.sql

-- 1) Diagnóstico previo. Si devuelve filas, el CREATE de abajo va a fallar:
--    resolvé primero cada grupo desde la app (borrar la cita de más) o dejando
--    en NULL el id del evento de la que no corresponda.
SELECT google_calendar_event_id, branch_id, COUNT(*) AS citas,
       GROUP_CONCAT(id, ' | ') AS ids
  FROM appointment
 WHERE google_calendar_event_id IS NOT NULL
 GROUP BY branch_id, google_calendar_event_id
HAVING COUNT(*) > 1;

-- 2) Fichas de cliente que creó el parser del título antes del arreglo
--    (nombres con "(abono ...)"). Revisar y combinar/borrar desde Clientes.
SELECT id, first_name, last_name, created_at
  FROM customer
 WHERE first_name LIKE '%abono%'
    OR first_name LIKE '%(abono%'
 ORDER BY created_at DESC;

-- 3) El índice.
CREATE UNIQUE INDEX IF NOT EXISTS ux_appointment_gcal_event
    ON appointment (branch_id, google_calendar_event_id)
 WHERE google_calendar_event_id IS NOT NULL;
