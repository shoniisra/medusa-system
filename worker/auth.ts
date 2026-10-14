/**
 * Autenticación del Worker: PBKDF2 para contraseñas/PINs, HMAC-SHA256 para tokens
 * de sesión. Todo corre en el runtime de Cloudflare Workers (SubtleCrypto nativo).
 */

const PBKDF2_ITERATIONS = 100_000;
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 h

/* ─── Contraseña / PIN ────────────────────────────────────────────────────── */

function b64(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

function fromB64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS },
    key,
    256,
  );
  return `${b64(salt.buffer)}:${b64(bits)}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
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
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS },
    key,
    256,
  );
  const actual = new Uint8Array(bits);

  // Comparación de tiempo constante para evitar timing attacks.
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
  return diff === 0;
}

/* ─── Token de sesión (HMAC-SHA256) ──────────────────────────────────────── */

export interface TokenPayload {
  userId: string;
  orgId: string;
  branchId: string;
  role: string;
  exp: number;
}

async function hmacKey(secret: string) {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export async function signToken(
  payload: Omit<TokenPayload, 'exp'>,
  secret: string,
): Promise<string> {
  const full: TokenPayload = { ...payload, exp: Date.now() + TOKEN_TTL_MS };
  const body = btoa(JSON.stringify(full));
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(body),
  );
  return `${body}.${b64(sig)}`;
}

export async function verifyToken(
  token: string,
  secret: string,
): Promise<TokenPayload | null> {
  const dot = token.lastIndexOf('.');
  if (dot < 0) return null;

  const body = token.slice(0, dot);
  const sigB64 = token.slice(dot + 1);

  const key = await hmacKey(secret);
  try {
    const ok = await crypto.subtle.verify(
      'HMAC',
      key,
      fromB64(sigB64),
      new TextEncoder().encode(body),
    );
    if (!ok) return null;
  } catch {
    return null;
  }

  try {
    const payload = JSON.parse(atob(body)) as TokenPayload;
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

/* ─── Cookie de sesión ────────────────────────────────────────────────────── */

export const SESSION_COOKIE = 'medusa_session';

export function sessionCookie(token: string, secure: boolean): string {
  const maxAge = TOKEN_TTL_MS / 1000;
  return [
    `${SESSION_COOKIE}=${token}`,
    `Max-Age=${maxAge}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    secure ? 'Secure' : '',
  ]
    .filter(Boolean)
    .join('; ');
}

export function clearCookie(secure: boolean): string {
  return [
    `${SESSION_COOKIE}=`,
    'Max-Age=0',
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    secure ? 'Secure' : '',
  ]
    .filter(Boolean)
    .join('; ');
}

export function parseCookieToken(req: Request): string | null {
  const header = req.headers.get('Cookie') ?? '';
  for (const part of header.split(';')) {
    const [k, v] = part.trim().split('=');
    if (k === SESSION_COOKIE && v) return v;
  }
  return null;
}
