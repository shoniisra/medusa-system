import type { LucideIcon } from 'lucide-react';
import { Card, EmptyState } from '@/components/ui';
import { activeFilterCount, type AppointmentFilters } from './FilterBar';

/**
 * Vacío de la agenda / tablero: distingue "no hay nada en el rango" de "los
 * filtros no dejan ver nada". Elegir la frase correcta evita que el usuario
 * crea que no hay citas cuando en realidad están filtradas.
 */
export function AppointmentsEmptyState({
  icon,
  title,
  totalRows,
  filters,
  filteredHint,
  emptyHint,
}: {
  icon: LucideIcon;
  title: string;
  totalRows: number;
  filters: AppointmentFilters;
  filteredHint: string;
  emptyHint: string;
}) {
  const filtered = totalRows > 0 || activeFilterCount(filters) > 0;
  return (
    <Card>
      <EmptyState
        icon={icon}
        title={title}
        description={filtered ? filteredHint : emptyHint}
      />
    </Card>
  );
}
