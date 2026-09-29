/**
 * `TimeGrid` es el motor de las vistas de tiempo de react-big-calendar. No se
 * exporta en el índice público, pero sí se publica en `lib/` y es la vía
 * documentada para armar vistas propias (ej. la de 3 días del móvil).
 */
declare module 'react-big-calendar/lib/TimeGrid' {
  import type { ComponentType } from 'react';

  const TimeGrid: ComponentType<Record<string, unknown>>;
  export default TimeGrid;
}
