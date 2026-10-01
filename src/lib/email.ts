/**
 * Email: normalización y validación mínima.
 *
 * El email se usa para facturación y para avisos, así que importa que esté bien
 * escrito. En el salón se tipea desde el celular o desde un teclado que no
 * siempre tiene `@` a mano, y entraban cosas como `nombrearrobahotmail.com`:
 * la validación corta eso antes de guardar y el input ofrece los dominios de
 * siempre con un toque (ver `EmailInput`).
 */

/** Dominios que se ofrecen como atajo (cubren casi toda la libreta). */
export const EMAIL_DOMAINS = [
  '@gmail.com',
  '@hotmail.com',
  '@outlook.com',
  '@yahoo.com',
  '@icloud.com',
] as const;

/**
 * Forma canónica: sin espacios y en minúsculas. Los servidores tratan el
 * dominio sin distinguir mayúsculas y los buzones reales tampoco, así que
 * guardar todo igual evita fichas duplicadas por `Ana@` vs `ana@`.
 */
export function normalizeEmail(raw: string | null | undefined): string {
  return (raw ?? '').trim().toLowerCase();
}

// Local sin espacios ni @, dominio con al menos un punto y TLD de 2+ letras.
const EMAIL_RE =
  /^[^\s@]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*\.[A-Za-z]{2,}$/;

/**
 * Valida un email. Devuelve el mensaje de error, o `null` si está bien. Vacío
 * se considera válido: el email es opcional.
 */
export function validateEmail(value: string | null | undefined): string | null {
  const v = (value ?? '').trim();
  if (!v) return null;
  const ats = v.split('@').length - 1;
  if (ats === 0) {
    return /arroba/i.test(v)
      ? 'Escribiste «arroba» en letras: usá el botón @ o el de @gmail.com.'
      : 'Falta el @: el email va como nombre@gmail.com.';
  }
  if (ats > 1) return 'El email no puede llevar dos @.';
  const [local, domain] = [v.slice(0, v.indexOf('@')), v.slice(v.indexOf('@') + 1)];
  if (!local) return 'Falta el nombre antes del @.';
  if (!domain) return 'Falta el dominio después del @ (ej. gmail.com).';
  if (!domain.includes('.')) {
    return 'Al dominio le falta el punto (ej. gmail.com).';
  }
  if (!EMAIL_RE.test(v)) return 'Email inválido: tiene que ser como nombre@gmail.com.';
  return null;
}
