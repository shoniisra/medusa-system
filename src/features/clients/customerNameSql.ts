/**
 * Nombre del cliente armado en SQL, igual que `customerName` de lib/format:
 * nombre real + alias entre paréntesis.
 *
 * Las consultas que listan citas, recordatorios y cumpleaños traen el nombre ya
 * concatenado (no la fila del cliente), así que el alias tiene que entrar acá o
 * esas pantallas muestran solo el nombre real y dejan de ser reconocibles.
 * Estaba copiado en cinco lugares; `t` es el alias de la tabla customer en la
 * consulta ('c' en los JOIN, 'customer' cuando se consulta directo).
 */
export const customerNameSql = (t = 'c'): string =>
  `${t}.first_name` +
  ` || CASE WHEN ${t}.last_name IS NOT NULL THEN ' ' || ${t}.last_name ELSE '' END` +
  ` || CASE WHEN COALESCE(TRIM(${t}.nickname), '') <> ''` +
  ` THEN ' (' || TRIM(${t}.nickname) || ')' ELSE '' END`;
