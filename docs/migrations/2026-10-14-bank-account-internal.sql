-- Marca cuentas bancarias como internas (no visibles para cobros directos al cliente).
-- Las cuentas internas se usan solo para movimientos entre cuentas del negocio
-- y no aparecen en los selectores de cobro de citas o POS.
ALTER TABLE bank_account ADD COLUMN is_internal INTEGER NOT NULL DEFAULT 0;

-- Marcar cuentas internas conocidas (ajustar nombres según los registros reales).
UPDATE bank_account
   SET is_internal = 1
 WHERE LOWER(name) LIKE '%ahorro efectivo%'
    OR LOWER(name) LIKE '%ahorro programado%';
