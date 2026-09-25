import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays,
  CalendarPlus,
  CalendarRange,
  List,
  Download,
} from "lucide-react";
import type { View } from "react-big-calendar";
import { query, execute } from "@/lib/db";
import { toLocalNaive, fullName } from "@/lib/format";
import { useBranchId, useSession } from "@/store/session";
import { ROUTES } from "@/config/constants";
import {
  isGoogleCalendarEnabled,
  updateCalendarEvent,
  listCalendarEvents,
  normalizeEvents,
} from "@/lib/googleCalendar";
import { Card, Button, EmptyState, Select } from "@/components/ui";
import { useStaff } from "@/features/pos/useCatalog";
import { GoogleCalendarEmbed } from "./GoogleCalendarEmbed";
import { AgendaCalendar, type AgendaEvent } from "./AgendaCalendar";
import {
  type AppointmentRow,
  type RangeMode,
  FALLBACK_COLOR,
  ymd,
  rangeFor,
  ToggleBtn,
  ListView,
} from "./appointmentBoard";

type ViewMode = "list" | "calendar";

/* ─────────────────────────── Rango de fechas ─────────────────────────── */

/** Ventana amplia (mes ± 1 semana) alrededor de una fecha, para la vista calendario. */
function windowFor(d: Date): { from: string; to: string; label: string } {
  const from = new Date(d.getFullYear(), d.getMonth(), 1);
  from.setDate(from.getDate() - 7);
  const to = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  to.setDate(to.getDate() + 7);
  return {
    from: ymd(from),
    to: ymd(to),
    label: d.toLocaleDateString("es-EC", { month: "long", year: "numeric" }),
  };
}

/* ─────────────────────────────── Página ─────────────────────────────── */

export function CalendarPage() {
  const branchId = useBranchId();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [range, setRange] = useState<RangeMode>("today");
  const [view, setView] = useState<ViewMode>("list");
  const [calDate, setCalDate] = useState(new Date());
  const [calView, setCalView] = useState<View>("week");

  const branch = useSession((s) => s.branch);
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState("");

  // Filtros de la lista/kanban: por colaborador y por estado.
  const staff = useStaff();
  const [staffFilter, setStaffFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "attended" | "reserved"
  >("all");

  // "Atender": al iniciar la atención, una cita reservada pasa a "Atendiendo"
  // (confirmed) y se abre la ficha en modo atención para confirmar y cobrar.
  const startAttention = (a: AppointmentRow) => {
    if (a.status === "reserved") {
      execute(
        "UPDATE appointment SET status = 'confirmed', updated_at = ? WHERE id = ?",
        [new Date().toISOString(), a.id],
      )
        .then(() => qc.invalidateQueries({ queryKey: ["appointments"] }))
        .catch(() => {
          /* si falla, igual seguimos a la ficha */
        });
    }
    navigate(`${ROUTES.appointment}/${a.id}?atender=1`);
  };

  // Exporta los eventos del calendario de Google (de la sucursal) a un JSON
  // descargable. El mapeo color→estilista y título→servicio se hace fuera de
  // la app (análisis manual/importación), no con IA en runtime.
  async function exportGoogleJson() {
    setExportMsg("");
    setExporting(true);
    try {
      const now = new Date();
      const timeMin = new Date(now);
      timeMin.setDate(timeMin.getDate() - 120);
      const timeMax = new Date(now);
      timeMax.setDate(timeMax.getDate() + 180);
      const raw = await listCalendarEvents({
        calendarId: branch?.google_calendar_id,
        timeMinIso: timeMin.toISOString(),
        timeMaxIso: timeMax.toISOString(),
      });
      const payload = {
        exported_at: new Date().toISOString(),
        organization_id: branch?.organization_id ?? null,
        branch_id: branch?.id ?? null,
        branch_name: branch?.name ?? null,
        calendar_id: branch?.google_calendar_id ?? "primary",
        range: { from: timeMin.toISOString(), to: timeMax.toISOString() },
        count: raw.length,
        events: normalizeEvents(raw),
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `gcal-eventos-${branch?.code ?? "sucursal"}-${ymd(now)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setExportMsg(`Exportados ${payload.count} eventos.`);
    } catch (e) {
      setExportMsg(
        e instanceof Error ? e.message : "No se pudo exportar de Google.",
      );
    } finally {
      setExporting(false);
    }
  }

  const { from, to, label } = useMemo(
    () => (view === "calendar" ? windowFor(calDate) : rangeFor(range)),
    [view, range, calDate],
  );

  const appts = useQuery({
    queryKey: ["appointments", branchId, from, to],
    enabled: !!branchId,
    queryFn: () =>
      query<AppointmentRow>(
        `SELECT a.id, a.start_at, a.end_at, a.status, a.notes,
                a.google_calendar_id, a.google_calendar_event_id,
                c.first_name || CASE WHEN c.last_name IS NOT NULL THEN ' ' || c.last_name ELSE '' END AS customer_name,
                c.phone,
                s.id AS staff_id,
                s.first_name || CASE WHEN s.last_name IS NOT NULL THEN ' ' || s.last_name ELSE '' END AS staff_name,
                s.color AS staff_color,
                COALESCE(sv.name, ai.category) AS service_name
           FROM appointment a
           LEFT JOIN customer c ON c.id = a.customer_id
           LEFT JOIN appointment_item ai
                  ON ai.id = (SELECT ai2.id FROM appointment_item ai2
                               WHERE ai2.appointment_id = a.id LIMIT 1)
           LEFT JOIN staff_member s ON s.id = ai.assigned_staff_id
           LEFT JOIN service sv ON sv.id = ai.service_id
          WHERE a.branch_id = ? AND date(a.start_at) BETWEEN ? AND ?
          ORDER BY a.start_at ASC`,
        [branchId, from, to],
      ),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["appointments"] });

  // Aplica los filtros de colaborador + estado a las citas del rango.
  const filteredRows = useMemo(() => {
    let rows = appts.data ?? [];
    if (staffFilter) rows = rows.filter((a) => a.staff_id === staffFilter);
    if (statusFilter === "attended") {
      rows = rows.filter((a) => a.status === "attended");
    } else if (statusFilter === "reserved") {
      rows = rows.filter(
        (a) => a.status === "reserved" || a.status === "confirmed",
      );
    }
    return rows;
  }, [appts.data, staffFilter, statusFilter]);

  const events: AgendaEvent[] = useMemo(
    () =>
      filteredRows.map((a) => ({
        id: a.id,
        title: `${a.customer_name ?? "Sin cliente"}${
          a.service_name ? " · " + a.service_name : ""
        }`,
        start: new Date(a.start_at),
        end: new Date(a.end_at),
        color: a.staff_color || FALLBACK_COLOR,
      })),
    [filteredRows],
  );

  // Arrastrar/redimensionar en el calendario reprograma la cita (y su evento).
  const reschedule = useMutation({
    mutationFn: async ({
      id,
      start,
      end,
    }: {
      id: string;
      start: Date;
      end: Date;
    }) => {
      const row = appts.data?.find((a) => a.id === id);
      const startLocal = toLocalNaive(start);
      const endLocal = toLocalNaive(end);
      await execute(
        "UPDATE appointment SET start_at = ?, end_at = ?, updated_at = ? WHERE id = ?",
        [startLocal, endLocal, new Date().toISOString(), id],
      );
      if (row?.google_calendar_event_id && isGoogleCalendarEnabled()) {
        try {
          await updateCalendarEvent(
            row.google_calendar_event_id,
            row.google_calendar_id,
            { startLocal, endLocal },
          );
        } catch {
          /* la reprogramación local ya quedó guardada */
        }
      }
    },
    onSuccess: invalidate,
  });

  return (
    <div className="mx-auto max-w-[1500px] space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-white">Agenda</h1>
        <div className="flex items-center gap-2">
          {isGoogleCalendarEnabled() && (
            <Button
              variant="ghost"
              onClick={exportGoogleJson}
              disabled={exporting}
              title="Exporta los eventos de Google a un JSON para importarlos"
            >
              <Download className="h-4 w-4" />
              {exporting ? "Exportando…" : "Exportar de Google"}
            </Button>
          )}
          <Button onClick={() => navigate(ROUTES.appointmentNew)}>
            <CalendarPlus className="h-4 w-4" /> Nueva cita
          </Button>
        </div>
      </div>
      {exportMsg && <p className="text-sm text-white/60">{exportMsg}</p>}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        {/* Izquierda: Google Calendar embebido (se mantiene visible al hacer scroll) */}
        <div className="space-y-2 xl:sticky xl:top-4 xl:self-start">
          <h2 className="text-sm font-medium text-white/50">Google Calendar</h2>
          <GoogleCalendarEmbed
            className="h-[78vh]"
            mode={
              view === "calendar"
                ? "WEEK"
                : range === "today"
                  ? "WEEK"
                  : range === "week"
                    ? "WEEK"
                    : "MONTH"
            }
          />
        </div>

        {/* Derecha: agenda del sistema */}
        <div className="space-y-4">
          {/* Rango + vista */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            {view === "calendar" ? (
              <span />
            ) : (
              <div className="flex gap-1 rounded-xl bg-ink-800/60 p-1">
                <ToggleBtn
                  active={range === "today"}
                  onClick={() => setRange("today")}
                >
                  Hoy
                </ToggleBtn>
                <ToggleBtn
                  active={range === "week"}
                  onClick={() => setRange("week")}
                >
                  Esta semana
                </ToggleBtn>
                <ToggleBtn
                  active={range === "month"}
                  onClick={() => setRange("month")}
                >
                  Este mes
                </ToggleBtn>
              </div>
            )}
            <div className="flex gap-1 rounded-xl bg-ink-800/60 p-1">
              <ToggleBtn
                active={view === "list"}
                onClick={() => setView("list")}
              >
                <List className="h-4 w-4" />
              </ToggleBtn>
              <ToggleBtn
                active={view === "calendar"}
                onClick={() => setView("calendar")}
              >
                <CalendarRange className="h-4 w-4" />
              </ToggleBtn>
            </div>
          </div>

          {view === "calendar" ? (
            <AgendaCalendar
              events={events}
              date={calDate}
              view={calView}
              onNavigate={setCalDate}
              onView={setCalView}
              onSelectEvent={(id) => navigate(`${ROUTES.appointment}/${id}`)}
              onDrop={(id, start, end) => {
                const row = appts.data?.find((a) => a.id === id);
                const staffId = row?.staff_id;
                const conflict = staffId
                  ? (appts.data ?? []).find(
                      (a) =>
                        a.id !== id &&
                        a.staff_id === staffId &&
                        new Date(a.start_at) < end &&
                        start < new Date(a.end_at),
                    )
                  : undefined;
                if (
                  conflict &&
                  !window.confirm(
                    `Se solapa con otra cita de ${
                      row?.staff_name ?? "la estilista"
                    } (${
                      conflict.customer_name ?? "sin cliente"
                    }). ¿Reprogramar de todas formas?`,
                  )
                ) {
                  return;
                }
                reschedule.mutate({ id, start, end });
              }}
              onSelectSlot={(start) =>
                navigate(`${ROUTES.appointmentNew}?date=${ymd(start)}`)
              }
            />
          ) : (
            <>
              <p className="text-center text-sm capitalize text-white/60">
                {label}
              </p>

              {/* Filtros: por colaborador y por estado */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="min-w-[180px] flex-1">
                  <Select
                    value={staffFilter}
                    onChange={(e) => setStaffFilter(e.target.value)}
                  >
                    <option value="">Todos los colaboradores</option>
                    {(staff.data ?? []).map((s) => (
                      <option key={s.id} value={s.id}>
                        {fullName(s.first_name, s.last_name ?? "")}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="flex gap-1 rounded-xl bg-ink-800/60 p-1">
                  <ToggleBtn
                    active={statusFilter === "all"}
                    onClick={() => setStatusFilter("all")}
                  >
                    Todos
                  </ToggleBtn>
                  <ToggleBtn
                    active={statusFilter === "reserved"}
                    onClick={() => setStatusFilter("reserved")}
                  >
                    Reservados
                  </ToggleBtn>
                  <ToggleBtn
                    active={statusFilter === "attended"}
                    onClick={() => setStatusFilter("attended")}
                  >
                    Atendidos
                  </ToggleBtn>
                </div>
              </div>

              {filteredRows.length === 0 ? (
                <Card>
                  <EmptyState
                    icon={CalendarDays}
                    title="Sin citas"
                    description={
                      (appts.data?.length ?? 0) > 0
                        ? "Ninguna cita coincide con los filtros."
                        : "No hay reservas para el rango seleccionado."
                    }
                  />
                </Card>
              ) : (
                <ListView
                  rows={filteredRows}
                  showDate={range !== "today"}
                  onAttend={startAttention}
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
