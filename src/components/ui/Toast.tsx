import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, Info, Sparkles, X, XCircle } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Notificaciones flotantes ("toasts") compartidas por toda la app.
 *
 * Una sola pila viva a nivel de aplicación: cualquier pantalla pide un aviso
 * con `useToast()` y el aviso sobrevive a la navegación (guardar y salir sigue
 * mostrando "Cambios guardados" ya en la pantalla anterior).
 *
 * Ubicación: arriba y centrado, debajo de la barra superior, en móvil a lo
 * ancho y en escritorio en una columna angosta. Arriba no pelea con la
 * navegación inferior ni con las barras de acción fijas de los flujos
 * (agendar / atender / POS); centrado no tapa los botones de acción de cada
 * pantalla ("Nuevo cliente", "Agendar cita"), que viven arriba a la derecha.
 */

export type ToastTone = 'success' | 'danger' | 'info' | 'gold';

export interface ToastAction {
  /** Texto del botón ("Deshacer", "Ver"). */
  label: string;
  /** Handler. El aviso se cierra solo después de dispararlo. */
  onClick: () => void;
}

export interface ToastOptions {
  /** Línea principal, corta y en pasado: "Cambios guardados", "Cita creada". */
  title: string;
  /** Detalle opcional de una línea. */
  description?: string;
  tone?: ToastTone;
  /** Milisegundos en pantalla. 0 = queda hasta que se cierre a mano. */
  duration?: number;
  /** Botón opcional dentro del aviso (ej. "Deshacer" tras reprogramar). */
  action?: ToastAction;
}

interface ToastItem extends ToastOptions {
  id: number;
  tone: ToastTone;
  duration: number;
  leaving?: boolean;
}

interface ToastApi {
  show: (opts: ToastOptions) => number;
  success: (title: string, description?: string) => number;
  error: (title: string, description?: string) => number;
  info: (title: string, description?: string) => number;
  dismiss: (id: number) => void;
}

/** Cuánto vive cada tono: los errores necesitan tiempo para leerse. */
const DURATION: Record<ToastTone, number> = {
  success: 3200,
  gold: 3600,
  info: 3600,
  danger: 6000,
};

/** Máximo de avisos visibles: más que esto tapa la pantalla en móvil. */
const MAX_VISIBLE = 3;
const EXIT_MS = 220;

const noop: ToastApi = {
  show: () => 0,
  success: () => 0,
  error: () => 0,
  info: () => 0,
  dismiss: () => {},
};

const ToastContext = createContext<ToastApi>(noop);

/** Acceso a las notificaciones flotantes. Sin provider no hace nada. */
export function useToast(): ToastApi {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  // Los timers viven en un ref: así el auto-cierre no se reinicia en cada
  // render ni se pierde al desmontar la pantalla que pidió el aviso.
  const timers = useRef(new Map<number, number>());

  const remove = useCallback((id: number) => {
    setItems((list) => list.filter((t) => t.id !== id));
  }, []);

  const dismiss = useCallback(
    (id: number) => {
      const t = timers.current.get(id);
      if (t) {
        window.clearTimeout(t);
        timers.current.delete(id);
      }
      // Marcamos la salida para que la animación corra antes de desmontar.
      setItems((list) =>
        list.map((it) => (it.id === id ? { ...it, leaving: true } : it)),
      );
      window.setTimeout(() => remove(id), EXIT_MS);
    },
    [remove],
  );

  const show = useCallback(
    (opts: ToastOptions) => {
      const id = ++seq.current;
      const tone = opts.tone ?? 'success';
      const duration = opts.duration ?? DURATION[tone];
      setItems((list) => {
        const next = [...list, { ...opts, id, tone, duration }];
        // Descarta los más viejos si se acumulan (p. ej. guardados en ráfaga).
        return next.slice(-MAX_VISIBLE);
      });
      if (duration > 0) {
        timers.current.set(
          id,
          window.setTimeout(() => dismiss(id), duration),
        );
      }
      return id;
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      show,
      dismiss,
      success: (title, description) =>
        show({ title, description, tone: 'success' }),
      error: (title, description) =>
        show({ title, description, tone: 'danger' }),
      info: (title, description) => show({ title, description, tone: 'info' }),
    }),
    [show, dismiss],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastViewport items={items} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

/* ───────────────────────────── Presentación ───────────────────────────── */

const TONE_STYLE: Record<
  ToastTone,
  { ring: string; icon: string; bar: string; glow: string }
> = {
  success: {
    ring: 'border-success/40',
    icon: 'bg-success/15 text-success border-success/30',
    bar: 'bg-success',
    glow: '0 0 45px -8px rgba(62, 207, 142, 0.55)',
  },
  danger: {
    ring: 'border-danger/45',
    icon: 'bg-danger/15 text-danger border-danger/30',
    bar: 'bg-danger',
    glow: '0 0 45px -8px rgba(239, 95, 95, 0.55)',
  },
  info: {
    ring: 'border-info/45',
    icon: 'bg-info/15 text-info border-info/30',
    bar: 'bg-info',
    glow: '0 0 45px -8px rgba(76, 127, 255, 0.55)',
  },
  gold: {
    ring: 'border-gold/45',
    icon: 'bg-gold/15 text-gold-200 border-gold/30',
    bar: 'bg-gold-300',
    glow: '0 0 45px -8px rgba(217, 173, 58, 0.6)',
  },
};

const TONE_ICON: Record<ToastTone, typeof CheckCircle2> = {
  success: CheckCircle2,
  danger: XCircle,
  info: Info,
  gold: Sparkles,
};

function ToastViewport({
  items,
  onDismiss,
}: {
  items: ToastItem[];
  onDismiss: (id: number) => void;
}) {
  if (items.length === 0) return null;
  // Portal a <body> y z-index por encima del Modal (z-50): un aviso lanzado
  // desde un diálogo tiene que verse igual.
  return createPortal(
    <div
      aria-live="polite"
      aria-atomic="false"
      className={cn(
        // z alto: por encima del Modal (z-50) y de las barras de acción (z-30).
        'pointer-events-none fixed z-[100] flex flex-col gap-2',
        // Móvil: a lo ancho, debajo de la barra superior (h-14) + notch.
        'inset-x-3 top-[calc(3.5rem+0.5rem+env(safe-area-inset-top))]',
        // Escritorio: columna angosta centrada, bajo el Topbar (h-16).
        'lg:mx-auto lg:top-20 lg:w-[24rem]',
      )}
    >
      {items.map((t) => (
        <ToastCard key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>,
    document.body,
  );
}

function ToastCard({
  toast,
  onDismiss,
}: {
  toast: ToastItem;
  onDismiss: (id: number) => void;
}) {
  const style = TONE_STYLE[toast.tone];
  const Icon = TONE_ICON[toast.tone];

  return (
    <div
      role={toast.tone === 'danger' ? 'alert' : 'status'}
      onClick={() => onDismiss(toast.id)}
      className={cn(
        'glass-card pointer-events-auto relative cursor-pointer rounded-2xl border bg-ink-900/95 p-3 pr-10',
        'flex items-start gap-3',
        style.ring,
        toast.leaving ? 'animate-toast-out' : 'animate-toast-in',
      )}
      style={{ boxShadow: `0 18px 40px -20px rgba(0,0,0,0.8), ${style.glow}` }}
    >
      <span
        className={cn(
          'mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border',
          style.icon,
        )}
      >
        <Icon className="h-[18px] w-[18px]" />
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold leading-snug text-white">
          {toast.title}
        </p>
        {toast.description && (
          <p className="mt-0.5 text-xs leading-snug text-white/55">
            {toast.description}
          </p>
        )}
        {toast.action && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              toast.action!.onClick();
              onDismiss(toast.id);
            }}
            className={cn(
              'mt-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold uppercase tracking-wide',
              style.ring,
              'text-white hover:bg-white/5',
            )}
          >
            {toast.action.label}
          </button>
        )}
      </div>

      <button
        type="button"
        aria-label="Cerrar aviso"
        onClick={(e) => {
          e.stopPropagation();
          onDismiss(toast.id);
        }}
        className="absolute right-2 top-2 rounded-lg p-1.5 text-white/35 transition hover:bg-white/10 hover:text-white"
      >
        <X className="h-4 w-4" />
      </button>

      {/* Barra de tiempo restante: deja ver que el aviso se va solo. */}
      {toast.duration > 0 && !toast.leaving && (
        <span className="absolute inset-x-3 bottom-0 h-0.5 overflow-hidden rounded-full bg-white/10">
          <span
            className={cn('block h-full origin-left animate-toast-bar', style.bar)}
            style={{ animationDuration: `${toast.duration}ms` }}
          />
        </span>
      )}
    </div>
  );
}
