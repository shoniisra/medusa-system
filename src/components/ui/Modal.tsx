import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  className?: string;
}

/**
 * Diálogo centrado en escritorio y hoja inferior (bottom sheet) en móvil: entra
 * desde abajo, con el encabezado fijo para que cerrar siempre quede a mano y el
 * contenido desplazable sin tapar el área segura del teléfono.
 */
export function Modal({ open, onClose, title, children, className }: ModalProps) {
  // Solo cerramos si el gesto EMPEZÓ y TERMINÓ sobre el fondo. Así evitamos el
  // cierre accidental al arrastrar/soltar desde dentro (ej. seleccionar texto
  // en un input y soltar el mouse fuera del modal).
  const pressedBackdrop = useRef(false);

  // Bloquea el scroll del fondo mientras la hoja está abierta (en móvil, si no,
  // el dedo arrastra la página de atrás).
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;
  // Portal a <body>: evita que un ancestro con backdrop-filter/overflow (ej.
  // .glass-card) actúe como containing block y confine/recorte el modal.
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/85 backdrop-blur-md sm:items-center sm:p-4"
      onMouseDown={(e) => {
        pressedBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && pressedBackdrop.current) onClose();
        pressedBackdrop.current = false;
      }}
    >
      <div
        className={cn(
          'glass-card w-full sm:max-w-lg',
          // Fondo sólido: sin esto el panel es casi transparente y se mezcla
          // con lo que hay detrás.
          'bg-ink-900',
          'max-h-[92vh] overflow-y-auto rounded-b-none rounded-t-3xl sm:max-h-[90vh] sm:rounded-3xl',
          className,
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Encabezado pegajoso: el botón de cerrar nunca se va con el scroll. */}
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-white/5 bg-ink-900/95 px-5 py-3.5 backdrop-blur sm:px-6">
          {title && (
            <h2 className="truncate text-base font-semibold text-white sm:text-lg">
              {title}
            </h2>
          )}
          <button
            onClick={onClose}
            aria-label="Cerrar"
            className="tap ml-auto flex items-center justify-center rounded-xl text-white/50 hover:bg-white/10 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div
          className="px-5 pt-4 sm:px-6"
          style={{ paddingBottom: 'calc(1.25rem + env(safe-area-inset-bottom))' }}
        >
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}
