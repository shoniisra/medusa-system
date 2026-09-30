/**
 * Normalización de texto para comparar y buscar.
 *
 * Los contactos entran tecleados a mano, importados de la libreta y copiados de
 * WhatsApp: "Ana Paúl", "ANA PAUL" y "ana  paul" son la misma persona. Estas
 * dos funciones son la única forma de comparar texto en la app, así el buscador
 * del POS, las categorías de agenda y la detección de duplicados usan
 * exactamente el mismo criterio.
 */

/** Quita las marcas diacríticas combinantes (acentos, diéresis, tildes). */
export const deburr = (s: string): string =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Clave de comparación: sin acentos, minúsculas, espacios colapsados. */
export const normalizeText = (s: string): string =>
  deburr(s).toLowerCase().replace(/\s+/g, ' ').trim();
