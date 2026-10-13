import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { query } from '@/lib/db';
import { useOrgId } from '@/store/session';

/** Estilista habilitada para una categoría, con su prioridad (1 = primaria). */
export interface EligibleStaff {
  staffId: string;
  priority: number;
}

/**
 * Especialidades del salón: qué estilistas atienden cada categoría (tabla
 * `staff_category`). Fuente única para preseleccionar la estilista al agendar
 * (AppointmentPage) y al cobrar en POS (NewSaleTab): misma queryKey, mismo
 * criterio de auto-asignado.
 */
export function useCategorySkills() {
  const orgId = useOrgId();
  const q = useQuery({
    queryKey: ['staff-category-skills', orgId],
    enabled: !!orgId,
    queryFn: () =>
      query<{ category: string; staff_member_id: string; priority: number }>(
        `SELECT sc.category, sc.staff_member_id, sc.priority
           FROM staff_category sc
           JOIN staff_member sm ON sm.id = sc.staff_member_id
          WHERE sm.organization_id = ? AND sc.active = 1 AND sm.active = 1
          ORDER BY sc.category, sc.priority`,
        [orgId],
      ),
  });

  const eligibleByCat = useMemo(() => {
    const m = new Map<string, EligibleStaff[]>();
    for (const r of q.data ?? []) {
      const arr = m.get(r.category) ?? [];
      arr.push({ staffId: r.staff_member_id, priority: r.priority });
      m.set(r.category, arr);
    }
    return m;
  }, [q.data]);

  /**
   * Estilista a preseleccionar para una categoría: si hay una sola primaria (o
   * una sola candidata), se asigna sola; si hay varias primarias se deja en
   * blanco para que la usuaria elija por disponibilidad.
   */
  const defaultStaffForCategory = useMemo(() => {
    return (category: string | null | undefined): string => {
      if (!category) return '';
      const elig = eligibleByCat.get(category) ?? [];
      if (elig.length === 0) return '';
      const primaries = elig.filter((e) => e.priority === 1);
      if (primaries.length === 1) return primaries[0].staffId;
      if (elig.length === 1) return elig[0].staffId;
      return '';
    };
  }, [eligibleByCat]);

  return {
    /** Datos crudos; útil como disparador estable de efectos. */
    data: q.data,
    eligibleByCat,
    defaultStaffForCategory,
    isLoading: q.isLoading,
  };
}
