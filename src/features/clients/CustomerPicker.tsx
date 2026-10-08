import type { ReactNode, Ref } from 'react';
import { Search, UserPlus, UserRound, X } from 'lucide-react';
import { customerName, fullName } from '@/lib/format';
import { PhoneInput } from '@/components/ui';
import { DuplicatePhoneNotice, type PhoneOwner } from './DuplicatePhoneNotice';
import type { Customer } from '@/types';

/**
 * Picker de cliente común a Agendar (AppointmentPage) y POS (NewSaleTab):
 * banner del seleccionado / buscador con alta rápida, campo WhatsApp y aviso
 * de teléfono duplicado.
 *
 * Es un componente controlado: la fuente de verdad vive en el padre, que
 * decide cuándo crear la ficha. Agendar la crea apenas se confirma el alta
 * (para que quede listada aunque se abandone la cita), POS la crea recién al
 * confirmar la venta. Las partes variables (campos de nombre, botón guardar,
 * aviso cuando no hay búsqueda) entran por `newClientBefore`, `newClientAfter`
 * y `emptyHint`.
 */
export function CustomerPicker({
  customerId,
  newClient,
  selectedCustomer,
  firstName,
  lastName,
  phone,
  clientSearch,
  clientMatches,
  phoneTaken,
  renameTo,
  useExistingBusy,
  searchPlaceholder,
  phoneUseHint,
  emptyHint,
  newClientBefore,
  newClientAfter,
  searchRef,
  phoneRef,
  onSearchChange,
  onPhoneChange,
  onPickExisting,
  onStartNewClient,
  onClear,
  onUseExisting,
}: {
  customerId: string;
  newClient: boolean;
  selectedCustomer: Customer | undefined;
  firstName: string;
  lastName: string;
  phone: string;
  clientSearch: string;
  clientMatches: Customer[];
  phoneTaken: PhoneOwner | null;
  renameTo: string | null;
  useExistingBusy: boolean;
  searchPlaceholder: string;
  phoneUseHint: string;
  emptyHint?: ReactNode;
  newClientBefore?: ReactNode;
  newClientAfter?: ReactNode;
  searchRef?: Ref<HTMLInputElement>;
  phoneRef?: Ref<HTMLInputElement>;
  onSearchChange: (v: string) => void;
  onPhoneChange: (v: string) => void;
  onPickExisting: (c: Customer) => void;
  onStartNewClient: () => void;
  onClear: () => void;
  onUseExisting: () => void;
}) {
  const hasClient = !!customerId || newClient;
  const displayName = newClient
    ? fullName(firstName, lastName) || 'Cliente nuevo'
    : selectedCustomer
      ? customerName(selectedCustomer)
      : '';
  const subline = newClient
    ? 'Se creará como cliente nuevo'
    : selectedCustomer?.phone || 'Sin WhatsApp';

  if (hasClient) {
    return (
      <>
        <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gold/15 text-gold-200">
              {newClient ? <UserPlus className="h-4 w-4" /> : <UserRound className="h-4 w-4" />}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-white">{displayName}</p>
              <p className="truncate text-xs text-white/40">{subline}</p>
            </div>
          </div>
          <button
            onClick={onClear}
            className="shrink-0 rounded-lg p-2 text-white/40 hover:bg-white/10 hover:text-white"
            title="Cambiar cliente"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {newClient && (
          <div className="mt-3 space-y-3">
            {newClientBefore}
            <PhoneInput
              ref={phoneRef}
              label="WhatsApp"
              value={phone}
              onChange={onPhoneChange}
            />
            <DuplicatePhoneNotice
              owner={phoneTaken}
              renameTo={renameTo}
              busy={useExistingBusy}
              onUse={onUseExisting}
              useHint={phoneUseHint}
            />
            {newClientAfter}
          </div>
        )}
      </>
    );
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
        <input
          ref={searchRef}
          value={clientSearch}
          onChange={(e) => onSearchChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (clientMatches.length > 0) onPickExisting(clientMatches[0]);
              else if (clientSearch.trim()) onStartNewClient();
            }
          }}
          placeholder={searchPlaceholder}
          className="input-base w-full pl-9"
        />
      </div>

      {clientSearch.trim() && (
        <ul className="max-h-64 divide-y divide-white/5 overflow-y-auto rounded-xl border border-white/10">
          {clientMatches.map((c) => (
            <li key={c.id}>
              <button
                onClick={() => onPickExisting(c)}
                className="flex w-full items-center justify-between gap-3 px-3 py-3.5 text-left hover:bg-white/10"
              >
                <span className="truncate text-sm text-white/90">{customerName(c)}</span>
                {c.phone && (
                  <span className="shrink-0 text-xs text-white/40">{c.phone}</span>
                )}
              </button>
            </li>
          ))}
          <li>
            <button
              onClick={onStartNewClient}
              className="flex w-full items-center gap-2 px-3 py-3.5 text-left text-gold-200 hover:bg-white/10"
            >
              <UserPlus className="h-4 w-4 shrink-0" />
              <span className="truncate text-sm">
                Crear «{clientSearch.trim()}» como cliente nuevo
              </span>
            </button>
          </li>
        </ul>
      )}

      {!clientSearch.trim() && emptyHint}
    </div>
  );
}
