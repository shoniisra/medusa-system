import { ColorRecordsCard, ManicureRecordsCard } from '@/features/clients/ColorRecordsCard';

/** Planning context follows the selected customer through every booking step. */
export function BookingCustomerHistory({ customerId }: { customerId: string }) {
  if (!customerId) return null;
  return (
    <section aria-label="Últimos procesos del cliente" className="mt-4 space-y-3 border-t border-white/10 pt-4">
      <p className="text-xs text-white/50">Referencia para estimar el tiempo y preparar la cita.</p>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="min-w-0 rounded-xl border border-white/10 bg-white/[0.02] p-4">
          <ManicureRecordsCard key={`manicure-${customerId}`} customerId={customerId} compact readOnly />
        </div>
        <div className="min-w-0 rounded-xl border border-white/10 bg-white/[0.02] p-4">
          <ColorRecordsCard key={`color-${customerId}`} customerId={customerId} compact readOnly />
        </div>
      </div>
    </section>
  );
}
