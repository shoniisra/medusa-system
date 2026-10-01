import { useRef } from 'react';
import { cn } from '@/lib/cn';
import { EMAIL_DOMAINS, validateEmail } from '@/lib/email';

interface EmailInputProps {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  placeholder?: string;
  disabled?: boolean;
  /** Valida el formato y muestra el error abajo (prendido por defecto). */
  validate?: boolean;
}

/**
 * Input de email con atajos de dominio.
 *
 * En varias computadoras del salón el `@` no está donde la usuaria lo busca (o
 * el teclado está en otra distribución) y terminaba escribiéndose la palabra
 * «arroba». Los botones ponen el @ y el dominio de un toque, conservando lo que
 * ya haya escrito antes del @, y el formato se valida en el mismo campo.
 */
export function EmailInput({
  label,
  value,
  onChange,
  error,
  placeholder = 'nombre@gmail.com',
  disabled,
  validate = true,
}: EmailInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const formatError = validate ? validateEmail(value) : null;
  // El error propio del formulario manda sobre el de formato.
  const shownError = error || formatError;

  /** Devuelve el foco al campo; `caret` al inicio cuando falta el nombre. */
  const refocus = (caret?: number) => {
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      const pos = caret ?? el.value.length;
      el.setSelectionRange(pos, pos);
    });
  };


  /** Pone (o cambia) el dominio sin tocar lo que haya antes del @. */
  const pickDomain = (domain: string) => {
    const local = value.split('@')[0].trim();
    onChange(local + domain);
    // Sin nombre todavía: el cursor queda al principio para escribirlo.
    refocus(local ? undefined : 0);
  };

  const addAt = () => {
    if (!value.includes('@')) onChange(`${value.trim()}@`);
    refocus();
  };

  return (
    <label className="block">
      {label && (
        <span className="mb-1 block text-xs font-medium text-white/60">
          {label}
        </span>
      )}
      <input
        ref={inputRef}
        // `text` y no `email`: el navegador no deja mover el cursor en un input
        // de tipo email (setSelectionRange tira error) y los botones de dominio
        // necesitan dejarlo donde va el nombre. El formato lo valida el campo.
        type="text"
        inputMode="email"
        autoComplete="email"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        disabled={disabled}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={shownError ? true : undefined}
        className={cn(
          'input-base',
          shownError && 'border-danger/60 focus:ring-danger/30',
        )}
      />
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        <button
          type="button"
          disabled={disabled}
          onClick={addAt}
          aria-label="Insertar arroba"
          className="shrink-0 rounded-lg border border-white/10 px-2.5 py-1 text-xs font-semibold text-white/70 transition hover:bg-white/5 hover:text-white active:scale-[0.97] disabled:opacity-40"
        >
          @
        </button>
        {EMAIL_DOMAINS.map((d) => (
          <button
            key={d}
            type="button"
            disabled={disabled}
            onClick={() => pickDomain(d)}
            className="shrink-0 rounded-lg border border-white/10 px-2.5 py-1 text-xs text-white/60 transition hover:bg-white/5 hover:text-white active:scale-[0.97] disabled:opacity-40"
          >
            {d}
          </button>
        ))}
      </div>
      {shownError && (
        <span className="mt-1 block text-xs text-danger">{shownError}</span>
      )}
    </label>
  );
}
