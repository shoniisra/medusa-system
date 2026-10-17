/** Requiere un servicio activo de la especialidad que no esté excluido.
 * Los alias sc y sm corresponden a staff_category y staff_member.
 * La asignación depende de capacidades, independientemente del rol de acceso.
 */
export const AVAILABLE_CATEGORY_SERVICE_SQL = `EXISTS (
  SELECT 1 FROM service sv
   WHERE sv.organization_id = sm.organization_id AND sv.active = 1
     AND sv.category = sc.category
     AND NOT EXISTS (
       SELECT 1 FROM staff_service_exclusion se
        WHERE se.staff_member_id = sm.id AND se.service_id = sv.id AND se.active = 1
     )
)`;

export const ASSIGNABLE_STAFF_SQL = `SELECT sm.* FROM staff_member sm
 WHERE sm.organization_id = ? AND sm.active = 1
   AND EXISTS (
     SELECT 1 FROM staff_category sc
      WHERE sc.staff_member_id = sm.id AND sc.active = 1
        AND ${AVAILABLE_CATEGORY_SERVICE_SQL}
   )
 ORDER BY sm.first_name`;
