import { queryOne } from '@/lib/db';

/**
 * Categoría de egreso con la que se contabiliza un pago a personal.
 *
 * Un pago de comisiones acepta también una categoría llamada "Comisiones"; un
 * adelanto de sueldo no, para no contabilizarlo ahí. Si la organización no tiene
 * ninguna categoría de personal, cae en la primera activa antes de fallar.
 */
export async function staffExpenseCategoryId(
  orgId: string,
  kind: 'commission' | 'advance',
): Promise<string> {
  const names =
    kind === 'commission'
      ? "name LIKE '%personal%' OR name LIKE '%sueldo%' OR name LIKE '%comisi%' OR name LIKE '%nómina%'"
      : "name LIKE '%personal%' OR name LIKE '%sueldo%' OR name LIKE '%nómina%'";

  const cat = await queryOne<{ id: string }>(
    `SELECT id FROM expense_category
      WHERE organization_id = ? AND active = 1 AND (${names})
      ORDER BY name LIMIT 1`,
    [orgId],
  );
  const fallback = cat
    ? null
    : await queryOne<{ id: string }>(
        'SELECT id FROM expense_category WHERE organization_id = ? AND active = 1 ORDER BY name LIMIT 1',
        [orgId],
      );

  const id = cat?.id ?? fallback?.id;
  if (!id) throw new Error('No hay una categoría de egreso configurada.');
  return id;
}
