// Verificación de contraseña client-side. Replica exactamente el algoritmo de
// worker/auth.ts (PBKDF2-SHA256, 100k iter, salt 16B, hash 32B, formato "salt:hash" en base64).
// Solo se usa en dev: en prod, el Worker /api/login hace la verificación segura.

const PBKDF2_ITERATIONS = 100_000;

function fromB64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltB64, hashB64] = stored.split(':');
  if (!saltB64 || !hashB64) return false;

  const salt = fromB64(saltB64);
  const expected = fromB64(hashB64);

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS },
    key,
    256,
  );
  const actual = new Uint8Array(bits);

  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
  return diff === 0;
}
