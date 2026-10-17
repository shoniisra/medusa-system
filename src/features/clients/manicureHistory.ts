import type { Stmt } from '@/lib/db';
import { normalizeText } from '@/lib/text';

export const MANICURE_SYSTEMS = {
  polygel: 'Poligel', acrylic: 'Acrílico', calcium: 'Base de calcio', rubber: 'Rubber',
  japanese: 'Japonés', regular: 'Esmaltado normal', semi: 'Semipermanente', softgel: 'Soft gel',
} as const;
export type ManicureSystem = keyof typeof MANICURE_SYSTEMS;
export interface ManicureServiceRow {
  appointmentId: string;
  startAt: string;
  description: string | null;
  serviceName: string | null;
  category: string | null;
  staffName: string | null;
}
export interface ManicureVisit {
  appointmentId: string;
  startAt: string;
  services: string[];
  staffNames: string[];
  systems: ManicureSystem[];
  finishes: ManicureSystem[];
  removedSystems: ManicureSystem[];
  hasRemoval: boolean;
}
export interface ManicureHistory {
  visits: ManicureVisit[];
  usual: { system: ManicureSystem; visits: number }[];
}

/** A service snapshot takes precedence over the current, editable catalog. */
export function manicureHistoryQuery(orgId: string, customerId: string): Stmt {
  return {
    sql: `SELECT a.id AS appointmentId, a.start_at AS startAt,
          ai.description, sv.name AS serviceName,
          COALESCE(NULLIF(TRIM(ai.category), ''), sv.category) AS category,
          TRIM(st.first_name || ' ' || COALESCE(st.last_name, '')) AS staffName
        FROM appointment a
        JOIN appointment_item ai ON ai.appointment_id = a.id
        LEFT JOIN service sv ON sv.id = ai.service_id AND sv.organization_id = a.organization_id
        LEFT JOIN staff_member st ON st.id = ai.assigned_staff_id AND st.organization_id = a.organization_id
        WHERE a.organization_id = ? AND a.customer_id = ? AND a.status = 'attended'
          AND ai.product_id IS NULL AND COALESCE(ai.quantity, 1) > 0
          AND (COALESCE(NULLIF(TRIM(ai.category), ''), sv.category, '') = ''
            OR LOWER(COALESCE(NULLIF(TRIM(ai.category), ''), sv.category)) = 'manicura')
        ORDER BY a.start_at DESC, a.id DESC, ai.id`,
    args: [orgId, customerId],
  };
}

const FINISHES = new Set<ManicureSystem>(['regular', 'semi']);
function systemsIn(text: string): ManicureSystem[] {
  const systems: ManicureSystem[] = [];
  if (/\b(?:poli|poly)\s?gel\b/.test(text)) systems.push('polygel');
  if (/\b(?:acrilic[oa]s?|acrylics?)\b/.test(text)) systems.push('acrylic');
  if (/\bcalcio\b/.test(text)) systems.push('calcium');
  if (/\brub{1,2}er\b/.test(text)) systems.push('rubber');
  // The actual catalog calls the same service "Base Calcio (Japones)".
  if (!systems.includes('calcium') && /\bjapones(?:a|es|as)?\b/.test(text)) systems.push('japanese');
  if (/\bsoft\s?gel\b/.test(text)) systems.push('softgel');
  if (/\bsemipermanente\b|\bsemi\b/.test(text)) systems.push('semi');
  if (/\b(?:esmaltado|esmalte)\s+(?:normal|tradicional|clasico)\b/.test(text)) systems.push('regular');
  return systems;
}
function parseService(text: string) {
  const applied = new Set<ManicureSystem>();
  const removed = new Set<ManicureSystem>();
  let hasRemoval = false;
  // A removal and a new application may appear in one combined service.
  for (const part of text.split(/\s*(?:\+|;|\by\b)\s*/)) {
    const removal = /\bretiro\b|\bretir(?:ar|ado)\b/.test(part);
    if (removal) hasRemoval = true;
    for (const system of systemsIn(part)) (removal ? removed : applied).add(system);
  }
  return { applied: [...applied], removed: [...removed], hasRemoval };
}
function classify(row: ManicureServiceRow) {
  const category = normalizeText(row.category ?? '');
  if (category && category !== 'manicura') return null;
  const snapshot = normalizeText(row.description ?? '').replace(/[^a-z0-9+;]+/g, ' ');
  const catalog = normalizeText(row.serviceName ?? '').replace(/[^a-z0-9+;]+/g, ' ');
  let detection = parseService(snapshot);
  const explicitSnapshot = detection.applied.length || detection.hasRemoval || /\blimpieza\b/.test(snapshot);
  const text = explicitSnapshot ? snapshot : catalog || snapshot;
  if (!explicitSnapshot) detection = parseService(text);
  if (/\b(?:pedicura|pedicure|pies)\b/.test(text) && !/\b(?:manicura|manos)\b/.test(text)) return null;
  if (!category && (/\b(?:cabello|capilar|pestanas|cejas|masaje)\b/.test(text)
    || (!/\b(?:manicura|unas|esmalte|esmaltado)\b/.test(text) && !detection.applied.length && !detection.removed.length))) return null;
  return { ...detection, service: (explicitSnapshot ? row.description : row.serviceName || row.description)?.trim() || 'Manicura sin detalle' };
}

/** Counts each applied system once per attended visit, never quantities or removals. */
export function summarizeManicureHistory(rows: readonly ManicureServiceRow[]): ManicureHistory {
  const grouped = new Map<string, ManicureVisit>();
  for (const row of rows) {
    const detection = classify(row);
    if (!detection) continue;
    const visit = grouped.get(row.appointmentId) ?? {
      appointmentId: row.appointmentId, startAt: row.startAt, services: [], staffNames: [],
      systems: [], finishes: [], removedSystems: [], hasRemoval: false,
    };
    visit.services = [...new Set([...visit.services, detection.service])];
    if (row.staffName) visit.staffNames = [...new Set([...visit.staffNames, row.staffName])];
    visit.systems = [...new Set([...visit.systems, ...detection.applied])];
    visit.removedSystems = [...new Set([...visit.removedSystems, ...detection.removed])];
    visit.hasRemoval ||= detection.hasRemoval;
    grouped.set(row.appointmentId, visit);
  }
  const visits = [...grouped.values()].sort((a, b) => b.startAt.localeCompare(a.startAt) || b.appointmentId.localeCompare(a.appointmentId));
  const frequency = new Map<ManicureSystem, number>();
  for (const visit of visits) {
    const structural = visit.systems.filter((system) => !FINISHES.has(system));
    if (structural.length) {
      visit.finishes = visit.systems.filter((system) => FINISHES.has(system));
      visit.systems = structural;
    }
    for (const system of visit.systems) frequency.set(system, (frequency.get(system) ?? 0) + 1);
  }
  const max = Math.max(0, ...frequency.values());
  const usual = [...frequency].filter(([, count]) => count === max && count >= 2)
    .map(([system, count]) => ({ system, visits: count }));
  return { visits, usual };
}
