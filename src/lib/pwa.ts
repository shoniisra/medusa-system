import { registerSW } from 'virtual:pwa-register';

/**
 * Registro del service worker con auto-actualización agresiva.
 *
 * El build usa `registerType: 'autoUpdate'`: en cuanto el navegador detecta un
 * service worker nuevo, la página recarga sola contra el build fresco. El
 * problema es *cuándo* lo detecta: un PWA instalado puede quedar abierto horas
 * (o reabrirse desde la caché) sin pedirle al navegador que chequee si hay build
 * nuevo, y el usuario queda atascado en una versión vieja — teniendo que borrar
 * la caché a mano. Acá forzamos ese chequeo al abrir, al volver a la pestaña,
 * al recuperar conexión y cada hora, para que la app se cure sola.
 */

/** Cada cuánto preguntamos al navegador si hay un service worker nuevo. */
const UPDATE_INTERVAL_MS = 60 * 60 * 1000; // 1 h

export function registerPwa(): void {
  // En desarrollo (`devOptions.enabled: false`) el plugin expone un
  // `registerSW` no-op, así que esto no hace nada y no estorba al HMR.
  registerSW({
    immediate: true,
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;

      // Solo tiene sentido chequear con la pestaña visible y online: evita
      // pegarle al servidor en segundo plano y respeta el modo offline.
      const checkForUpdate = () => {
        if (document.visibilityState === 'visible' && navigator.onLine) {
          void registration.update();
        }
      };

      // Chequeo inmediato: si esta carga vino de una caché vieja, el SW nuevo
      // se detecta ahora y `autoUpdate` recarga sola hacia el build sano.
      checkForUpdate();
      setInterval(checkForUpdate, UPDATE_INTERVAL_MS);
      document.addEventListener('visibilitychange', checkForUpdate);
      window.addEventListener('online', checkForUpdate);
    },
  });
}
