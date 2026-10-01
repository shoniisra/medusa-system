import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';

/**
 * Encabezado de una pantalla de detalle: flecha para volver, título y acciones
 * a la derecha. Lo tenían copiado la ficha de cliente y la de cita, cada una
 * con su propio `Header` idéntico.
 */
export function PageHeader({
  title,
  onBack,
  right,
}: {
  title: string;
  onBack: () => void;
  right?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="rounded-lg p-2 text-white/60 hover:bg-white/10 hover:text-white"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="text-2xl font-semibold text-white">{title}</h1>
      </div>
      {right}
    </div>
  );
}
