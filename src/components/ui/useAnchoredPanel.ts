import {
  useEffect,
  useLayoutEffect,
  useState,
  type RefObject,
} from 'react';

/**
 * Panel flotante anclado a un disparador (menú del select, popover de filtros,
 * calendario). Devuelve el rectángulo del ancla —con el que el panel se ubica—
 * y se encarga de lo que los tres hacían por su cuenta: seguirla al desplazar
 * o redimensionar, y cerrarse con Escape o al tocar afuera.
 *
 * `keepOpen` es un contenedor que tampoco cuenta como "afuera" (p. ej. el campo
 * entero, no solo la caja que se mide).
 */
export function useAnchoredPanel(
  open: boolean,
  close: () => void,
  anchor: RefObject<HTMLElement | null>,
  panel: RefObject<HTMLElement | null>,
  keepOpen?: RefObject<HTMLElement | null>,
): DOMRect | null {
  const [rect, setRect] = useState<DOMRect | null>(null);

  const place = () => {
    const r = anchor.current?.getBoundingClientRect();
    if (r) setRect(r);
  };

  // Primera medición: antes de pintar, para que el panel no aparezca corrido.
  // Es justamente lo que un layout effect hace —leer el DOM ya montado—, no un
  // estado derivable del render: hasta que el ancla no existe no hay medida.
  useLayoutEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open) place();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (
        !panel.current?.contains(t) &&
        !anchor.current?.contains(t) &&
        !keepOpen?.current?.contains(t)
      ) {
        close();
      }
    };
    // Al desplazar, el panel sigue al disparador en lugar de cerrarse.
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(place);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    window.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
      window.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, close, anchor, panel, keepOpen]);

  return rect;
}
