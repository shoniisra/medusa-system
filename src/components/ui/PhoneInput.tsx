import { forwardRef, useMemo } from 'react';
import { cn } from '@/lib/cn';
import {
  COUNTRIES,
  DEFAULT_COUNTRY,
  normalizePhone,
  parsePhone,
  validatePhone,
} from '@/lib/phone';

interface PhoneInputProps {
  label?: string;
  /** Valor canónico E.164 (`+5939…`) o vacío. */
  value: string;
  /** Recibe el valor canónico ya normalizado. */
  onChange: (canonical: string) => void;
  error?: string;
  placeholder?: string;
  disabled?: boolean;
  /**
   * Valida el largo del número según el país y muestra el error abajo.
   * Se desactiva solo donde haga falta aceptar números sueltos (por defecto va
   * prendido: quien guarda debe cortar con `validatePhone`).
   */
  validate?: boolean;
}

/**
 * Input de teléfono con select de país (bandera + código), Ecuador por defecto.
 * Emite siempre el valor en formato único E.164 para que no haya duplicados ni
 * formatos mezclados en la base.
 */
export const PhoneInput = forwardRef<HTMLInputElement, PhoneInputProps>(
  (
    {
      label,
      value,
      onChange,
      error,
      placeholder = '99 123 4567',
      disabled,
      validate = true,
    },
    ref,
  ) => {
    const { dial, local } = useMemo(() => parsePhone(value), [value]);
    // dial === '' → número internacional de un país fuera de la lista: se
    // preserva completo (el usuario escribe con su código).
    const isIntl = value.trim().startsWith('+') && dial === '';
    const activeDial = isIntl ? '' : dial || DEFAULT_COUNTRY.dial;
    const localValue = isIntl ? `+${local}` : local;
    // El error propio del formulario manda sobre el de formato.
    const formatError = validate ? validatePhone(value) : null;
    const shownError = error || formatError;

    return (
      <label className="block">
        {label && (
          <span className="mb-1 block text-xs font-medium text-white/60">
            {label}
          </span>
        )}
        <div className="flex gap-2">
          <select
            aria-label="País"
            disabled={disabled}
            value={activeDial}
            onChange={(e) => onChange(normalizePhone(local, e.target.value))}
            className="input-base w-[7.5rem] shrink-0 px-2"
          >
            {COUNTRIES.map((c) => (
              <option key={c.iso} value={c.dial}>
                {c.flag} +{c.dial}
              </option>
            ))}
            <option value="">🌐 Otro</option>
          </select>
          <input
            ref={ref}
            type="tel"
            inputMode="tel"
            disabled={disabled}
            value={localValue}
            placeholder={isIntl ? '+00 000 000' : placeholder}
            onChange={(e) => onChange(normalizePhone(e.target.value, activeDial))}
            aria-invalid={shownError ? true : undefined}
            className={cn(
              'input-base w-full flex-1',
              shownError && 'border-danger/60 focus:ring-danger/30',
            )}
          />
        </div>
        {shownError && (
          <span className="mt-1 block text-xs text-danger">{shownError}</span>
        )}
      </label>
    );
  },
);
PhoneInput.displayName = 'PhoneInput';
