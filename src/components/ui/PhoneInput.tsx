import { forwardRef, useMemo } from 'react';
import { COUNTRIES, DEFAULT_COUNTRY, normalizePhone, parsePhone } from '@/lib/phone';

interface PhoneInputProps {
  label?: string;
  /** Valor canónico E.164 (`+5939…`) o vacío. */
  value: string;
  /** Recibe el valor canónico ya normalizado. */
  onChange: (canonical: string) => void;
  error?: string;
  placeholder?: string;
  disabled?: boolean;
}

/**
 * Input de teléfono con select de país (bandera + código), Ecuador por defecto.
 * Emite siempre el valor en formato único E.164 para que no haya duplicados ni
 * formatos mezclados en la base.
 */
export const PhoneInput = forwardRef<HTMLInputElement, PhoneInputProps>(
  ({ label, value, onChange, error, placeholder = '99 123 4567', disabled }, ref) => {
    const { dial, local } = useMemo(() => parsePhone(value), [value]);
    // dial === '' → número internacional de un país fuera de la lista: se
    // preserva completo (el usuario escribe con su código).
    const isIntl = value.trim().startsWith('+') && dial === '';
    const activeDial = isIntl ? '' : dial || DEFAULT_COUNTRY.dial;
    const localValue = isIntl ? `+${local}` : local;

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
            className="input-base w-full flex-1"
          />
        </div>
        {error && <span className="mt-1 block text-xs text-danger">{error}</span>}
      </label>
    );
  },
);
PhoneInput.displayName = 'PhoneInput';
