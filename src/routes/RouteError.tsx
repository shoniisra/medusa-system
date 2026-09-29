import { useEffect, useState } from 'react';
import { isRouteErrorResponse, useRouteError } from 'react-router-dom';
import { Loader2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui';
import { hardReload, isStaleBuildError, recoverFromStaleBuild } from '@/lib/staleBuild';

/**
 * Error boundary de las rutas. Si el fallo viene de un chunk de un build viejo
 * intenta recargar solo; si no, muestra el error con un botón de recarga dura
 * en vez del cartel crudo de react-router.
 */
export function RouteError() {
  const error = useRouteError();
  const stale = isStaleBuildError(error);
  const [recovering, setRecovering] = useState(stale);

  useEffect(() => {
    if (!stale) return;
    void recoverFromStaleBuild().then((ok) => setRecovering(ok));
  }, [stale]);

  if (recovering) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-6 text-center">
        <Loader2 className="h-6 w-6 animate-spin text-gold-300" />
        <p className="text-sm text-white/60">Actualizando a la versión nueva…</p>
      </div>
    );
  }

  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : '';

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-lg font-semibold text-white">No se pudo abrir la pantalla</h1>
      <p className="max-w-md text-sm text-white/60">
        {stale
          ? 'Hay una versión nueva del sistema. Recargá para terminar de actualizar.'
          : isRouteErrorResponse(error) && error.status === 404
            ? 'Esa dirección no existe.'
            : 'Ocurrió un error inesperado. Recargá; si sigue igual, avisá con este detalle.'}
      </p>
      {message && (
        <pre className="max-w-md overflow-x-auto rounded-xl border border-white/10 bg-white/5 p-3 text-left text-xs text-white/50">
          {message}
        </pre>
      )}
      <Button onClick={() => void hardReload()}>
        <RotateCcw className="h-4 w-4" />
        Recargar
      </Button>
    </div>
  );
}
