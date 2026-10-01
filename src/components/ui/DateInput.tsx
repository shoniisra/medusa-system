import { useCallback, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Calendar, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useAnchoredPanel } from './useAnchoredPanel';
import {
  addMonths,
  ageFrom,
  fromISO,
  maskDMY,
  MONTHS_ES,
  monthGrid,
  MONTHS_ES_SHORT,
  parseLooseDate,
  toDMY,
  todayISO,
  WEEKDAYS_ES,
  ymd,
} from '@/lib/date';

type Mode = 'date' | 'birthday';
type View = 'days' | 'months' | 'years';

interface DateInputProps {
  label?: string;
  /** Valor en "YYYY-MM-DD" o '' (el formato que guarda la base). */
  value: string;
  /** Emite "YYYY-MM-DD" o '' al borrar. */
  onChange: (iso: string) => void;
  /** Límites inclusive, también en "YYYY-MM-DD". */
  min?: string;
  max?: string;
  error?: string;
  disabled?: boolean;
  /**
   * `birthday`: el calendario abre eligiendo el año (nadie quiere pasar 30 años
   * mes a mes), no acepta fechas futuras y muestra la edad al lado del campo.
   */
  mode?: Mode;
  /** Botón para dejar el campo vacío (prendido por defecto). */
  clearable?: boolean;
  /** Campo compacto, para barras de filtros. */
  size?: 'sm' | 'md';
  className?: string;
}

const PANEL_W = 320;

/**
 * Campo de fecha con calendario propio.
 *
 * El `<input type="date">` del navegador no se puede escribir (hay que pelear
 * con la ruedita del año) y se ve distinto en cada equipo. Acá la fecha se
 * escribe directo en dd/mm/aaaa —con las barras puestas sola y tolerante con
 * lo que se tipee— y el calendario es un panel propio donde el año y el mes se
 * eligen de una cuadrícula, no de flecha en flecha.
 */
export function DateInput({
  label,
  value,
  onChange,
  min,
  max,
  error,
  disabled,
  mode = 'date',
  clearable = true,
  size = 'md',
  className,
}: DateInputProps) {
  const hardMax = mode === 'birthday' ? (max ?? todayISO()) : max;
  const hardMin = mode === 'birthday' ? (min ?? '1900-01-01') : min;

  // Lo que se está escribiendo. `null` = no se está editando y el campo muestra
  // el valor que manda el formulario (puede cambiar desde afuera: cargar la
  // ficha, combinar contactos…), así no hay estado que sincronizar.
  const [draft, setDraft] = useState<string | null>(null);
  const [blurred, setBlurred] = useState(false);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>('days');
  // Dónde se cuelga el panel (ver el createPortal de más abajo).
  const [host, setHost] = useState<Element | null>(null);

  const text = draft ?? toDMY(value);

  const wrapRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Mes que muestra el panel.
  const anchor = fromISO(value) ?? fromISO(hardMax) ?? new Date();
  const [cursor, setCursor] = useState({
    year: anchor.getFullYear(),
    month: anchor.getMonth(),
  });

  /** Deja el año activo a la vista apenas se monta la lista. */
  const centerActiveYear = useCallback((box: HTMLDivElement | null) => {
    const active = box?.querySelector<HTMLElement>('[data-active]');
    if (!box || !active) return;
    box.scrollTop =
      active.offsetTop - box.clientHeight / 2 + active.offsetHeight / 2;
  }, []);

  const closePanel = useCallback(() => setOpen(false), []);
  const rect = useAnchoredPanel(open, closePanel, fieldRef, panelRef, wrapRef);

  /** Abre el panel en el mes del valor (o en el año, si es un cumpleaños nuevo). */
  const openPanel = () => {
    if (disabled) return;
    const newBirthday = mode === 'birthday' && !value;
    const base = fromISO(value) ?? fromISO(hardMax) ?? new Date();
    setCursor({
      // Cumpleaños en blanco: la lista arranca alrededor de los 30 años, que es
      // el centro de la clientela; desde ahí se desliza poco en cualquier
      // dirección.
      year: base.getFullYear() - (newBirthday ? 30 : 0),
      month: base.getMonth(),
    });
    setView(newBirthday ? 'years' : 'days');
    // Si el campo vive dentro de un popover, el panel se cuelga de ahí: de otro
    // modo el popover lo toma como un clic afuera y se cierra en el mismo
    // toque. `position: fixed` se sigue midiendo contra la ventana, así que la
    // posición no cambia.
    setHost(wrapRef.current?.closest('[data-floating]') ?? document.body);
    setOpen(true);
  };

  const outOfRange = (iso: string): boolean =>
    (!!hardMin && iso < hardMin) || (!!hardMax && iso > hardMax);

  /** Deja el valor elegido y suelta el texto a medio escribir. */
  const commit = (iso: string) => {
    setDraft(null);
    setBlurred(false);
    onChange(iso);
  };

  const handleType = (raw: string) => {
    const masked = maskDMY(raw);
    setDraft(masked);
    setBlurred(false);
    if (!masked) {
      if (value) onChange('');
      return;
    }
    // Solo se avisa al formulario cuando la fecha ya está completa y en rango;
    // a medio escribir ("15/0") no hay nada que guardar.
    const iso = parseLooseDate(masked);
    if (iso && !outOfRange(iso)) {
      onChange(iso);
      setCursor({
        year: Number(iso.slice(0, 4)),
        month: Number(iso.slice(5, 7)) - 1,
      });
    } else if (value && masked.replace(/\D/g, '').length >= 8) {
      // Ya escribió una fecha entera y no sirve: el formulario se queda sin
      // fecha. Si no, se guardaría la anterior, que ya no es la que se ve.
      onChange('');
    }
  };

  const handleBlur = () => {
    const typed = (draft ?? '').trim();
    if (draft === null) return;
    if (!typed) {
      setDraft(null);
      setBlurred(false);
      if (value) onChange('');
      return;
    }
    const iso = parseLooseDate(typed);
    // Lo escrito se conserva aunque no sirva: si se borrara, la usuaria no
    // sabría qué corregir. El valor sí se suelta: lo que se ve es lo que se
    // guarda.
    if (iso && !outOfRange(iso)) {
      commit(iso);
    } else {
      setBlurred(true);
      if (value) onChange('');
    }
  };

  /**
   * El error de formato aparece recién cuando ya hay algo que juzgar: los ocho
   * dígitos escritos, o el campo abandonado a medias.
   */
  const typedISO = draft !== null ? parseLooseDate(draft) : null;
  const badText =
    draft !== null &&
    draft.trim() !== '' &&
    (!typedISO || outOfRange(typedISO)) &&
    (blurred || draft.replace(/\D/g, '').length >= 8);

  const rangeHint = !badText
    ? null
    : typedISO && outOfRange(typedISO)
      ? mode === 'birthday'
        ? 'Esa fecha todavía no llegó'
        : hardMin && typedISO < hardMin
          ? `No antes del ${toDMY(hardMin)}`
          : `No después del ${toDMY(hardMax)}`
      : 'Fecha inválida (dd/mm/aaaa)';

  const shownError = error || rangeHint;
  const age = mode === 'birthday' ? ageFrom(value) : null;

  /* ── Posición del panel ── */
  const gap = 6;
  // Alto real del panel de días (cabecera + 6 semanas + pie): con esto solo
  // abre hacia arriba cuando de verdad no entra abajo.
  const panelH = 348;
  const spaceBelow = rect ? window.innerHeight - rect.bottom - 8 : 0;
  const spaceAbove = rect ? rect.top - 8 : 0;
  const openUp = !!rect && spaceBelow < panelH && spaceAbove > spaceBelow;
  const width = rect ? Math.min(PANEL_W, window.innerWidth - 16) : 0;
  const left = rect
    ? Math.max(8, Math.min(rect.left, window.innerWidth - 8 - width))
    : 0;

  const todayStr = todayISO();
  const grid = useMemo(
    () => monthGrid(cursor.year, cursor.month),
    [cursor.year, cursor.month],
  );

  const minYear = hardMin ? Number(hardMin.slice(0, 4)) : 1900;
  const maxYear = hardMax ? Number(hardMax.slice(0, 4)) : 2100;
  // Todos los años de corrido (no de a páginas de 12): para un cumpleaños
  // llegar a 1990 pasando página por página son diez toques; con la lista se
  // desliza y listo. Al abrirla, el año activo queda a la vista.
  const years = Array.from(
    { length: maxYear - minYear + 1 },
    (_, i) => minYear + i,
  );

  const monthBlocked = (y: number, m: number): boolean => {
    const first = `${y}-${String(m + 1).padStart(2, '0')}-01`;
    const last = `${y}-${String(m + 1).padStart(2, '0')}-${String(
      new Date(y, m + 1, 0).getDate(),
    ).padStart(2, '0')}`;
    return (!!hardMax && first > hardMax) || (!!hardMin && last < hardMin);
  };

  const canPrev =
    view === 'days'
      ? !monthBlocked(...prevMonth(cursor))
      : view === 'months'
        ? cursor.year > minYear
        : false;
  const canNext =
    view === 'days'
      ? !monthBlocked(...nextMonth(cursor))
      : view === 'months'
        ? cursor.year < maxYear
        : false;

  const step = (delta: number) => {
    if (view === 'months') {
      setCursor((c) => ({ ...c, year: c.year + delta }));
      return;
    }
    setCursor((c) => addMonths(c.year, c.month, delta));
  };

  return (
    <div className={cn('block', className)} ref={wrapRef}>
      {label && (
        <span className="mb-1 flex items-baseline gap-2">
          <span className="text-xs font-medium text-white/60">{label}</span>
          {age !== null && (
            <span className="text-xs text-gold-300/80">{age} años</span>
          )}
        </span>
      )}

      <div ref={fieldRef} className="relative">
        <input
          ref={inputRef}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          disabled={disabled}
          value={text}
          placeholder="dd/mm/aaaa"
          onChange={(e) => handleType(e.target.value)}
          onBlur={handleBlur}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleBlur();
              setOpen(false);
            }
            if (e.key === 'ArrowDown' && !open) {
              e.preventDefault();
              openPanel();
            }
          }}
          aria-invalid={shownError ? true : undefined}
          className={cn(
            // La X solo ocupa lugar cuando se está usando el campo: en una
            // columna angosta ("Desde"/"Hasta"), con los dos botones fijos la
            // fecha se cortaba a la mitad.
            'input-base peer tabular-nums pr-11',
            clearable && (value || text) && 'focus:pr-20',
            size === 'sm' && 'min-h-0 h-9 py-1.5 text-sm',
            shownError && 'border-danger/60 focus:ring-danger/30',
          )}
        />

        <div className="absolute inset-y-0 right-1 flex items-center gap-0.5">
          {clearable && (value || text) && !disabled && (
            <button
              type="button"
              aria-label="Borrar fecha"
              onClick={() => commit('')}
              className="hidden h-8 w-8 place-items-center rounded-lg text-white/40 transition hover:bg-white/10 hover:text-white peer-focus:grid peer-hover:grid hover:grid"
            >
              <X className="h-4 w-4" />
            </button>
          )}
          <button
            type="button"
            aria-label="Abrir calendario"
            aria-expanded={open}
            disabled={disabled}
            onClick={() => (open ? setOpen(false) : openPanel())}
            className={cn(
              'grid h-8 w-8 place-items-center rounded-lg transition hover:bg-white/10',
              open ? 'bg-gold/15 text-gold-200' : 'text-white/45 hover:text-white',
              disabled && 'opacity-40',
            )}
          >
            <Calendar className="h-4 w-4" />
          </button>
        </div>
      </div>

      {open &&
        rect &&
        host &&
        createPortal(
          <div
            ref={panelRef}
            data-floating
            style={{
              position: 'fixed',
              ...(openUp
                ? { bottom: window.innerHeight - rect.top + gap }
                : { top: rect.bottom + gap }),
              left,
              width,
              zIndex: 60,
            }}
            className="overflow-hidden rounded-2xl border border-white/10 bg-ink-800 shadow-glass"
          >
            {/* Cabecera: mes/año al centro cambia de vista */}
            <div className="flex items-center gap-1 border-b border-white/10 p-2">
              <button
                type="button"
                aria-label="Anterior"
                disabled={!canPrev}
                onClick={() => step(-1)}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-white/60 transition hover:bg-white/10 hover:text-white disabled:opacity-25"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <div className="flex flex-1 items-center justify-center gap-1">
                {view === 'days' ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setView('months')}
                      className="rounded-lg px-2 py-1.5 text-sm font-semibold capitalize text-white transition hover:bg-white/10"
                    >
                      {MONTHS_ES[cursor.month]}
                    </button>
                    <button
                      type="button"
                      onClick={() => setView('years')}
                      className="rounded-lg px-2 py-1.5 text-sm font-semibold text-gold-200 transition hover:bg-white/10"
                    >
                      {cursor.year}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setView('days')}
                    className="rounded-lg px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-white/10"
                  >
                    {view === 'months' ? cursor.year : 'Elegí el año'}
                  </button>
                )}
              </div>
              <button
                type="button"
                aria-label="Siguiente"
                disabled={!canNext}
                onClick={() => step(1)}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-white/60 transition hover:bg-white/10 hover:text-white disabled:opacity-25"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>

            {view === 'days' && (
              <div className="p-2">
                <div className="mb-1 grid grid-cols-7">
                  {WEEKDAYS_ES.map((w, i) => (
                    <span
                      key={i}
                      className="py-1 text-center text-[11px] font-medium text-white/35"
                    >
                      {w}
                    </span>
                  ))}
                </div>
                <div className="grid grid-cols-7 gap-0.5">
                  {grid.map((d) => {
                    const iso = ymd(d);
                    const other = d.getMonth() !== cursor.month;
                    const blocked = outOfRange(iso);
                    const selected = iso === value;
                    const isToday = iso === todayStr;
                    return (
                      <button
                        key={iso}
                        type="button"
                        disabled={blocked}
                        onClick={() => {
                          commit(iso);
                          setOpen(false);
                        }}
                        className={cn(
                          'grid h-10 place-items-center rounded-lg text-sm tabular-nums transition',
                          other ? 'text-white/20' : 'text-white/80',
                          !blocked && !selected && 'hover:bg-white/10 hover:text-white',
                          isToday && !selected && 'ring-1 ring-inset ring-gold/40',
                          selected &&
                            'bg-gold text-ink-950 font-semibold shadow-gold-glow',
                          blocked && 'cursor-not-allowed text-white/10 hover:bg-transparent',
                        )}
                      >
                        {d.getDate()}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {view === 'months' && (
              <div className="grid grid-cols-3 gap-1 p-2">
                {MONTHS_ES_SHORT.map((m, i) => {
                  const blocked = monthBlocked(cursor.year, i);
                  const current =
                    value.slice(0, 4) === String(cursor.year) &&
                    Number(value.slice(5, 7)) - 1 === i;
                  return (
                    <button
                      key={m}
                      type="button"
                      disabled={blocked}
                      onClick={() => {
                        setCursor((c) => ({ ...c, month: i }));
                        setView('days');
                      }}
                      className={cn(
                        'h-11 rounded-lg text-sm capitalize transition',
                        current
                          ? 'bg-gold text-ink-950 font-semibold'
                          : 'text-white/75 hover:bg-white/10 hover:text-white',
                        blocked && 'cursor-not-allowed text-white/15 hover:bg-transparent',
                      )}
                    >
                      {m}
                    </button>
                  );
                })}
              </div>
            )}

            {view === 'years' && (
              <div
                ref={centerActiveYear}
                className="grid max-h-[260px] grid-cols-4 gap-1 overflow-y-auto p-2"
              >
                {years.map((y) => {
                  const active = y === cursor.year;
                  return (
                    <button
                      key={y}
                      type="button"
                      data-active={active || undefined}
                      onClick={() => {
                        setCursor((c) => ({ ...c, year: y }));
                        setView('months');
                      }}
                      className={cn(
                        'h-11 rounded-lg text-sm tabular-nums transition',
                        String(y) === value.slice(0, 4)
                          ? 'bg-gold font-semibold text-ink-950'
                          : active
                            ? 'bg-white/10 text-white'
                            : 'text-white/75 hover:bg-white/10 hover:text-white',
                      )}
                    >
                      {y}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Pie: atajos */}
            <div className="flex items-center justify-between gap-2 border-t border-white/10 p-2">
              {mode === 'birthday' ? (
                <span className="px-1 text-[11px] text-white/35">
                  Se puede escribir: 15/03/1990
                </span>
              ) : (
                <div className="flex gap-1">
                  {[
                    { label: 'Hoy', iso: todayStr },
                    { label: 'Ayer', iso: shift(todayStr, -1) },
                    { label: 'Mañana', iso: shift(todayStr, 1) },
                  ]
                    .filter((s) => !outOfRange(s.iso))
                    .map((s) => (
                      <button
                        key={s.label}
                        type="button"
                        onClick={() => {
                          commit(s.iso);
                          setOpen(false);
                        }}
                        className="rounded-lg border border-white/10 px-2.5 py-1 text-xs text-white/70 transition hover:bg-white/10 hover:text-white"
                      >
                        {s.label}
                      </button>
                    ))}
                </div>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg px-2.5 py-1 text-xs font-semibold text-gold-200 transition hover:bg-white/10"
              >
                Cerrar
              </button>
            </div>
          </div>,
          host,
        )}

      {shownError && (
        <span className="mt-1 block text-xs text-danger">{shownError}</span>
      )}
    </div>
  );
}

/* ───────────────────────────── helpers locales ───────────────────────────── */

const prevMonth = (c: { year: number; month: number }): [number, number] => {
  const { year, month } = addMonths(c.year, c.month, -1);
  return [year, month];
};
const nextMonth = (c: { year: number; month: number }): [number, number] => {
  const { year, month } = addMonths(c.year, c.month, 1);
  return [year, month];
};

/** ISO ± días. */
function shift(iso: string, days: number): string {
  const d = fromISO(iso);
  if (!d) return iso;
  d.setDate(d.getDate() + days);
  return ymd(d);
}
