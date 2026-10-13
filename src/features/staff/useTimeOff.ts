import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { execute, query } from '@/lib/db';
import { genId } from '@/lib/format';
import { useBranchId, useOrgId } from '@/store/session';
import type { TimeOff } from '@/types';

/**
 * Ausencias y cierres de la sucursal (tabla time_off). Alimenta tanto la
 * gestión en /personal como el bloqueo del agendado. Una sola consulta por
 * sucursal; el agendado la reusa para no volver a pegarle a la base.
 *
 * Trae cierres del local (staff_member_id NULL) y ausencias por colaboradora;
 * cada pantalla filtra lo que necesita.
 */
export function useTimeOff() {
  const orgId = useOrgId();
  const branchId = useBranchId();
  return useQuery({
    queryKey: ['time-off', branchId],
    enabled: !!orgId,
    queryFn: () =>
      query<TimeOff>(
        `SELECT * FROM time_off
          WHERE organization_id = ?
            AND active = 1
            AND (branch_id = ? OR branch_id IS NULL)
          ORDER BY start_date`,
        [orgId, branchId],
      ),
  });
}

export interface NewTimeOff {
  /** NULL = cierre del local; con valor = ausencia de esa colaboradora. */
  staffMemberId: string | null;
  startDate: string; // "YYYY-MM-DD"
  endDate: string; // "YYYY-MM-DD"
  reason: string | null;
  note: string | null;
}

/** Registra una ausencia/cierre y refresca agendado y gestión. */
export function useAddTimeOff() {
  const orgId = useOrgId();
  const branchId = useBranchId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (t: NewTimeOff) => {
      await execute(
        `INSERT INTO time_off
           (id, organization_id, branch_id, staff_member_id,
            start_date, end_date, reason, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          genId(),
          orgId,
          branchId || null,
          t.staffMemberId,
          t.startDate,
          t.endDate,
          t.reason,
          t.note,
        ],
      );
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['time-off'] });
      void qc.invalidateQueries({ queryKey: ['week-availability'] });
    },
  });
}

/** Baja lógica de una ausencia/cierre (active = 0). */
export function useDeleteTimeOff() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await execute(
        `UPDATE time_off
            SET active = 0,
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
          WHERE id = ?`,
        [id],
      );
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['time-off'] });
      void qc.invalidateQueries({ queryKey: ['week-availability'] });
    },
  });
}
