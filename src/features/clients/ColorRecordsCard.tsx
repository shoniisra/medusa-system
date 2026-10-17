import { ManicureHistoryCard } from './ManicureHistoryCard';
import { CustomerProcessRecordsCard } from './CustomerProcessRecordsCard';

export function ColorRecordsCard({ customerId, compact = false, readOnly = false }: { customerId: string; compact?: boolean; readOnly?: boolean }) {
  return <CustomerProcessRecordsCard customerId={customerId} kind="color" compact={compact} readOnly={readOnly} />;
}

export function ManicureRecordsCard({ customerId, compact = false, readOnly = false }: { customerId: string; compact?: boolean; readOnly?: boolean }) {
  return <ManicureHistoryCard customerId={customerId} compact={compact} readOnly={readOnly} />;
}
