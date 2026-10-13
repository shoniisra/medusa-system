-- Carga inicial del catálogo de ayudas (2026-10-12), según los pasos que el
-- salón maneja internamente al asistir un servicio de color/tratamiento:
--   1. Lavar cabello
--   2. Asistencia / sujetar
--   3. Secar cabello
--   4. Cepillar cabello
--
-- Se siembra para TODA organización existente (normalmente una sola). Idempotente:
-- id aleatorio + WHERE NOT EXISTS por (organization_id, name), así reejecutar no
-- duplica. El monto de cada ayuda NO vive acá: se tipea por caso al registrarla
-- (valor editable que se resta de la comisión del principal).

INSERT INTO assist_type (id, organization_id, name, sort_order)
SELECT lower(hex(randomblob(16))), o.id, v.name, v.sort_order
  FROM organization o
  CROSS JOIN (
    SELECT 'Lavar cabello'         AS name, 1 AS sort_order
    UNION ALL SELECT 'Asistencia / sujetar', 2
    UNION ALL SELECT 'Secar cabello',        3
    UNION ALL SELECT 'Cepillar cabello',     4
  ) v
 WHERE NOT EXISTS (
   SELECT 1 FROM assist_type a
    WHERE a.organization_id = o.id AND a.name = v.name
 );
