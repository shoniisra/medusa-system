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
    searchRef.current?.focus();
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (
        !menuRef.current?.contains(t) &&
        !triggerRef.current?.contains(t)
      ) {
        setOpen(false);
      }
    };
    const onScroll = () => setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function choose(val: string) {
    onChange?.({
      target: { value: val },
    } as unknown as ChangeEvent<HTMLSelectElement>);
    setOpen(false);
    setSearch('');
  }

  return (
    <label className="block">
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
              top: rect.bottom + 4,
              left: Math.max(
                8,
                Math.min(rect.left, window.innerWidth - 8 - Math.max(rect.width, 240)),
              ),
              minWidth: rect.width,
              maxWidth: 'min(92vw, 460px)',
              zIndex: 60,
            }}
            className="overflow-hidden rounded-xl border border-white/10 bg-ink-800 shadow-glass"
          >
            <div className="relative border-b border-white/10 p-2">
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
            <ul className="max-h-60 overflow-y-auto py-1">
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
                        'flex w-full items-start justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-white/10',
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
                        <Check className="mt-0.5 h-4 w-4 shrink-0" />
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
    </label>
  );
});
Select.displayName = 'Select';
