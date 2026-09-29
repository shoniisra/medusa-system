import { lazy, type ComponentType } from 'react';

/**
 * Recuperación de builds viejos.
 *
 * Cada `vite build` renombra los chunks con un hash nuevo y el deploy borra los
 * anteriores. Una pestaña abierta (o el service worker con la precaché vieja)
 * sigue apuntando a `/assets/CalendarViewPage-<hash viejo>.js`; al entrar a esa
 * ruta el import dinámico falla con "Failed to fetch dynamically imported
 * module". La única salida real es recargar contra el build nuevo, así que lo
 * hacemos solos en vez de mostrarle el error al usuario.
 */

const RECOVERY_KEY = 'medusa:stale-build-recovery';
/** Si vuelve a fallar dentro de esta ventana, el reload no alcanzó. */
const RECOVERY_WINDOW_MS = 60_000;
/** 1º: reload. 2º: purgar caché + SW y reload. 3º: rendirse y avisar. */
const MAX_ATTEMPTS = 2;

interface RecoveryState {
  at: number;
  attempts: number;
}

function readState(): RecoveryState | null {
  try {
    const raw = sessionStorage.getItem(RECOVERY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RecoveryState;
    if (typeof parsed?.at !== 'number' || typeof parsed?.attempts !== 'number') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeState(state: RecoveryState) {
  try {
    sessionStorage.setItem(RECOVERY_KEY, JSON.stringify(state));
  } catch {
    // Modo privado / storage bloqueado: seguimos sin memoria de intentos.
  }
}

/** Se llama cuando un chunk carga bien: el build ya está sano. */
export function clearStaleBuildRecovery() {
  try {
    sessionStorage.removeItem(RECOVERY_KEY);
  } catch {
    // Sin storage no hay nada que limpiar.
  }
}

export function isStaleBuildError(error: unknown): boolean {
  const message =
    error instanceof Error ? `${error.name}: ${error.message}` : String(error ?? '');
  return /dynamically imported module|Importing a module script failed|error loading dynamically imported|ChunkLoadError|Failed to fetch.*\.(js|css|mjs)/i.test(
    message,
  );
}

async function purgeAppCaches() {
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
  } catch {
    // Si no se puede desregistrar, igual intentamos con las cachés.
  }
  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch {
    // Nada más que hacer; el reload duro sigue siendo la jugada.
  }
}

/**
 * Intenta recuperarse de un build viejo recargando la página.
 * Devuelve `false` cuando ya se agotaron los intentos (ahí conviene mostrar UI).
 */
export async function recoverFromStaleBuild(): Promise<boolean> {
  const prev = readState();
  const now = Date.now();
  const attempts =
    prev && now - prev.at < RECOVERY_WINDOW_MS ? prev.attempts : 0;

  if (attempts >= MAX_ATTEMPTS) return false;

  writeState({ at: now, attempts: attempts + 1 });

  // El primer reload alcanza si el service worker ya sirve el build nuevo; si
  // volvió a fallar, la precaché vieja es la culpable y hay que barrerla.
  if (attempts >= 1) await purgeAppCaches();

  window.location.reload();
  return true;
}

/** Purga caché + service worker y recarga, sin contar intentos. */
export async function hardReload() {
  await purgeAppCaches();
  clearStaleBuildRecovery();
  window.location.reload();
}

/** Igual que `lazy`, pero recarga la app si el chunk quedó de un build viejo. */
export function lazyPage<T extends ComponentType<any>>(
  loader: () => Promise<{ default: T }>,
) {
  return lazy(async () => {
    try {
      const mod = await loader();
      clearStaleBuildRecovery();
      return mod;
    } catch (error) {
      if (isStaleBuildError(error) && (await recoverFromStaleBuild())) {
        // Reload en curso: no resolvemos para que quede el fallback de Suspense
        // en pantalla en vez del error boundary.
        return new Promise<{ default: T }>(() => {});
      }
      throw error;
    }
  });
}

/**
 * Engancha los errores de precarga de módulos de Vite (`vite:preloadError`),
 * que se disparan antes de que el import llegue al componente lazy.
 */
export function installStaleBuildListener() {
  window.addEventListener('vite:preloadError', (event) => {
    event.preventDefault();
    void recoverFromStaleBuild();
  });
}
