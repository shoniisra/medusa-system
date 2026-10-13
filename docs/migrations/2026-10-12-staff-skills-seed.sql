-- Carga inicial de especialidades según lo declarado por el salón (2026-10-12):
--   Gis (staff_giss): Maquillajes, Manicura, Pedicura (primaria en las tres).
--   Lesly (staff_leslie): Cortes/Color/Tratamientos/Cejas/Pestañas/Depilaciones/
--     Maquillajes como primaria, y Manicura/Pedicura como SECUNDARIA (respaldo de
--     Gis cuando no tiene cupo).
-- Maquillajes queda como primaria para ambas (las dos lo hacen; sin jerarquía
-- declarada entre ellas).
--
-- Idempotente: ids fijos + INSERT OR IGNORE (la unicidad es por
-- staff_member_id + category). Reejecutable por scripts/migrate.mjs.

INSERT OR IGNORE INTO staff_category (id, staff_member_id, category, priority) VALUES
  ('sc_giss_maquillajes', 'staff_giss', 'Maquillajes', 1),
  ('sc_giss_manicura',    'staff_giss', 'Manicura',    1),
  ('sc_giss_pedicura',    'staff_giss', 'Pedicura',    1),
  ('sc_lesly_cortes',       'staff_leslie', 'Cortes de Cabello', 1),
  ('sc_lesly_color',        'staff_leslie', 'Color',             1),
  ('sc_lesly_tratamientos', 'staff_leslie', 'Tratamientos',      1),
  ('sc_lesly_cejas',        'staff_leslie', 'Cejas',             1),
  ('sc_lesly_pestanas',     'staff_leslie', 'Pestañas',          1),
  ('sc_lesly_depilaciones', 'staff_leslie', 'Depilaciones',      1),
  ('sc_lesly_maquillajes',  'staff_leslie', 'Maquillajes',       1),
  ('sc_lesly_manicura',     'staff_leslie', 'Manicura',          2),
  ('sc_lesly_pedicura',     'staff_leslie', 'Pedicura',          2);
