import {
  forwardRef,
  Children,
  isValidElement,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import { ChevronsUpDown, Check, Search } from 'lucide-react';
import { cn } from '@/lib/cn';

interface FieldProps {
  label?: string;
  error?: string;
}

export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & FieldProps
>(({ label, error, className, ...props }, ref) => (
  <label className="block">
    {label && (
      <span className="mb-1 block text-xs font-medium text-white/60">
        {label}
      </span>
    )}
    <input ref={ref} className={cn('input-base', className)} {...props} />
    {error && <span className="mt-1 block text-xs text-danger">{error}</span>}
  </label>
));
Input.displayName = 'Input';

/* ───────────────────────── Select con búsqueda ───────────────────────── */

interface Opt {
  value: string;
  label: string;
  disabled?: boolean;
}

/** Convierte los children de un <option> a texto plano. */
function toText(node: ReactNode): string {
  if (node == null || node === false) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(toText).join('');
  if (isValidElement(node)) {
    return toText((node.props as { children?: ReactNode }).children);
  }
  return '';
}

/** Extrae las opciones de los <option> pasados como children. */
function extractOptions(children: ReactNode): Opt[] {
  const out: Opt[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement(child) || child.type !== 'option') return;
    const props = child.props as {
      value?: string | number;
      disabled?: boolean;
      children?: ReactNode;
    };
    out.push({
      value: String(props.value ?? ''),
      label: toText(props.children),
      disabled: props.disabled,
    });
  });
  return out;
}

/** ¿Puntero grueso (dedo)? Se consulta al abrir: hay equipos híbridos. */
const isTouch = (): boolean =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(pointer: coarse)').matches;

/**
 * Select con buscador. Mantiene la misma API que un <select> nativo
 * (children de <option>, `value`, `onChange(e => e.target.value)`), así que es
 * reemplazo directo en todo el sistema. El menú se renderiza en un portal para
 * que no lo recorte el scroll de un modal.
 */
export const Select = forwardRef<
  HTMLSelectElement,
  SelectHTMLAttributes<HTMLSelectElement> & FieldProps
>(({ label, error, className, children, value, onChange, disabled }, _ref) => {
  const options = useMemo(() => extractOptions(children), [children]);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [rect, setRect] = useState<DOMRect | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const currentValue = String(value ?? '');
  const current = options.find((o) => o.value === currentValue);
  const placeholder =
    options.find((o) => o.value === '')?.label ?? 'Seleccionar…';

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, search]);

  const place = () => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (r) setRect(r);
  };

  useLayoutEffect(() => {
    if (open) place();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    // El buscador solo toma el foco con mouse: en un teléfono abre el teclado,
    // el navegador desplaza la página para acomodarlo y el menú se cerraba solo
    // (se veía como un parpadeo al tocar el select).
    if (!isTouch()) searchRef.current?.focus();

    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (
        !menuRef.current?.contains(t) &&
        !triggerRef.current?.contains(t)
      ) {
        setOpen(false);
      }
    };
    // Al desplazar, el menú sigue al disparador en lugar de cerrarse.
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(place);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
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
  }, [open]);

  // Abre hacia arriba si abajo no entra (campo al pie de la pantalla, teclado…).
  const gap = 4;
  const spaceBelow = rect ? window.innerHeight - rect.bottom - 8 : 0;
  const spaceAbove = rect ? rect.top - 8 : 0;
  const openUp = !!rect && spaceBelow < 240 && spaceAbove > spaceBelow;
  const maxHeight = Math.max(168, Math.min(340, openUp ? spaceAbove : spaceBelow));
  // Ancho fijo del menú: así se puede alinear sin que un nombre largo lo empuje
  // fuera de la pantalla.
  const menuWidth = rect
    ? Math.min(Math.max(rect.width, 240), window.innerWidth - 16, 460)
    : 0;
  const menuLeft = rect
    ? Math.max(8, Math.min(rect.left, window.innerWidth - 8 - menuWidth))
    : 0;
  // Con pocas opciones el buscador estorba (y en móvil abre el teclado).
  const showSearch = options.length > 8;

  function choose(val: string) {
    onChange?.({
      target: { value: val },
    } as unknown as ChangeEvent<HTMLSelectElement>);
    setOpen(false);
    setSearch('');
  }

  return (
    // Un <label> reenvía el clic a su control (acá, el botón): el menú se abría
    // y se cerraba en el mismo toque. Por eso este contenedor es un <div>.
    <div className="block">
      {label && (
        <span className="mb-1 block text-xs font-medium text-white/60">
          {label}
        </span>
      )}
      <button
        type="button"
        ref={triggerRef}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'input-base flex items-center justify-between gap-2 text-left',
          disabled && 'cursor-not-allowed opacity-50',
          className,
        )}
      >
        <span className={cn('truncate', !current && 'text-white/40')}>
          {current ? current.label : placeholder}
        </span>
        <ChevronsUpDown className="h-4 w-4 shrink-0 text-white/40" />
      </button>

      {open &&
        rect &&
        createPortal(
          <div
            ref={menuRef}
            style={{
              position: 'fixed',
              ...(openUp
                ? { bottom: window.innerHeight - rect.top + gap }
                : { top: rect.bottom + gap }),
              left: menuLeft,
              width: menuWidth,
              maxHeight,
              zIndex: 60,
            }}
            className="flex flex-col overflow-hidden rounded-xl border border-white/10 bg-ink-800 shadow-glass"
          >
            {showSearch && (
              <div className="relative shrink-0 border-b border-white/10 p-2">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
                <input
                  ref={searchRef}
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar…"
                  className="w-full rounded-lg bg-ink-900 py-1.5 pl-9 pr-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-1 focus:ring-gold/40"
                />
              </div>
            )}
            <ul className="min-h-0 flex-1 overflow-y-auto py-1">
              {filtered.length === 0 ? (
                <li className="px-3 py-2 text-sm text-white/40">
                  Sin coincidencias
                </li>
              ) : (
                filtered.map((o) => (
                  <li key={o.value}>
                    <button
                      type="button"
                      disabled={o.disabled}
                      onClick={() => choose(o.value)}
                      className={cn(
                        'flex min-h-[44px] w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-white/10',
                        o.disabled && 'cursor-not-allowed opacity-40',
                        o.value === currentValue
                          ? 'text-gold-200'
                          : 'text-white/80',
                      )}
                    >
                      <span className="break-words">
                        {o.label || <span className="text-white/40">—</span>}
                      </span>
                      {o.value === currentValue && (
                        <Check className="h-4 w-4 shrink-0" />
                      )}
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>,
          document.body,
        )}

      {error && <span className="mt-1 block text-xs text-danger">{error}</span>}
    </div>
  );
});
Select.displayName = 'Select';
