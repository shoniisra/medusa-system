import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarPlus,
  ClipboardCheck,
  ClipboardList,
  LayoutGrid,
  List,
  Receipt,
} from "lucide-react";
import { execute, query } from "@/lib/db";
import { ROUTES } from "@/config/constants";
import { Button, useToast } from "@/components/ui";
import { money, timeShort } from "@/lib/format";
import { useBranchId } from "@/store/session";
import { useStaff } from "@/features/pos/useCatalog";
import {
  type AppointmentRow,
  KanbanView,
  ListView,
  STATUS_ORDER,
  startAttention,
} from "@/features/calendar/appointmentBoard";
import { AppointmentActionsModal } from "@/features/calendar/AppointmentActions";
import { FilterBar } from "@/features/calendar/FilterBar";
import { useAppointmentListFilters } from "@/features/calendar/useAppointmentListFilters";
import { AppointmentsEmptyState } from "@/features/calendar/AppointmentsEmptyState";
import { customerNameSql } from "@/features/clients/customerNameSql";
import { SaleDetailModal } from "@/features/sales/SaleDetailModal";
import { CloseOverdueModal, useOverduePending } from "./CloseOverdueModal";
import type { AppointmentStatus } from "@/types";
import { invalidateAppointments } from "@/lib/queryClient";

/**
 * Ventas sin cita (POS directo) en el rango visible. Antes vivían en /historial;
 * ahora se muestran acá debajo del Kanban para que /tareas sea la vista única de
 * "lo que ya pasó + lo que falta hacer".
 */
interface PosSaleRow {
  id: string;
  sold_at: string;
  customer_name: string | null;
  detail: string | null;
  staff_names: string | null;
  staff_ids: string | null;
  total: number | null;
}

function useStandalonePosSales(from: string, to: string) {
  const branchId = useBranchId();
  return useQuery({
    queryKey: ["pos-sales-no-appt", branchId, from, to],
    enabled: !!branchId,
    queryFn: () =>
      query<PosSaleRow>(
        `SELECT s.id AS id, s.sold_at AS sold_at,
                ${customerNameSql()} AS customer_name,
                (SELECT GROUP_CONCAT(si.description, ' · ')
                   FROM sale_item si WHERE si.sale_id = s.id) AS detail,
                (SELECT GROUP_CONCAT(DISTINCT sm.first_name)
                   FROM sale_item si
                   JOIN sale_service_staff sss ON sss.sale_item_id = si.id
                   JOIN staff_member sm ON sm.id = sss.staff_member_id
                  WHERE si.sale_id = s.id) AS staff_names,
                (SELECT GROUP_CONCAT(DISTINCT sss.staff_member_id)
                   FROM sale_item si
                   JOIN sale_service_staff sss ON sss.sale_item_id = si.id
                  WHERE si.sale_id = s.id) AS staff_ids,
                s.total AS total
           FROM sale s
           LEFT JOIN customer c ON c.id = s.customer_id
          WHERE s.branch_id = ? AND s.appointment_id IS NULL
            AND s.status <> 'voided'
            AND date(s.sold_at) BETWEEN ? AND ?
          ORDER BY s.sold_at DESC`,
        [branchId, from, to],
      ),
  });
}

/** Aviso al mover una tarjeta de columna en el tablero. */
const MOVE_TOAST: Partial<Record<AppointmentStatus, string>> = {
  reserved: "Cita devuelta a Reservadas",
  confirmed: "Cita en atención",
  cancelled: "Cita cancelada",
  no_show: "Marcada como no asistió",
};

/**
 * Tablero de tareas tipo Trello: las citas del rango agrupadas por estado.
 * Se opera arrastrando entre columnas o con el menú de acciones al hacer click
 * en una tarjeta. Resalta las citas vencidas (reservadas de días pasados).
 */
export function TasksPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();

  const [selected, setSelected] = useState<AppointmentRow | null>(null);
  const [openSale, setOpenSale] = useState<string | null>(null);
  // Cita atendida que queremos VER (info modal + botón de ampliar), no operar.
  // La ficha de acciones se reserva para citas que todavía se pueden mover.
  const [openAttendedApptId, setOpenAttendedApptId] = useState<string | null>(null);
  const [closeOverdue, setCloseOverdue] = useState(false);
  const [notice, setNotice] = useState("");

  // Vista "Tablero" (kanban) por defecto; "Lista" como alternativa persistida
  // por navegador — es una preferencia personal, no un filtro de la agenda.
  const [view, setView] = useState<"board" | "list">(() => {
    try {
      return localStorage.getItem("medusa-tasks-view") === "list"
        ? "list"
        : "board";
    } catch {
      return "board";
    }
  });
  const changeView = (v: "board" | "list") => {
    setView(v);
    try {
      localStorage.setItem("medusa-tasks-view", v);
    } catch {
      /* localStorage no disponible: queda solo para la sesión actual */
    }
  };

  // Click en una tarjeta del tablero: una atendida abre el modal de información
  // (como el de ventas POS); el resto cae en el menú de acciones.
  const handleSelect = (a: AppointmentRow) => {
    if (a.status === "attended") setOpenAttendedApptId(a.id);
    else setSelected(a);
  };

  const staff = useStaff();
  const { filters, patch, from, to, label, appts, filteredRows, overdueInView } =
    useAppointmentListFilters();

  // Ventas sin cita (POS directo). Antes vivían en /historial; ahora caen
  // como tarjetas distintas en la columna "Atendido" del tablero.
  const posSales = useStandalonePosSales(from, to);
  const posRows = useMemo(() => {
    let rows = posSales.data ?? [];
    if (filters.staffId)
      rows = rows.filter((r) => (r.staff_ids ?? "").split(",").includes(filters.staffId));
    const q = filters.q.trim().toLowerCase();
    if (q) {
      rows = rows.filter((r) =>
        [r.customer_name, r.detail, r.staff_names].some((v) =>
          (v ?? "").toLowerCase().includes(q),
        ),
      );
    }
    return rows;
  }, [posSales.data, filters.staffId, filters.q]);

  // Tarjeta POS: estilo distinto (borde dorado punteado + chip "POS") para
  // marcar que es una venta sin cita y no una cita atendida.
  const posCards = useMemo(
    () =>
      posRows.map((r) => (
        <button
          key={`pos-${r.id}`}
          type="button"
          onClick={() => setOpenSale(r.id)}
          className="min-h-[76px] w-full cursor-pointer rounded-xl border border-dashed border-gold-400/40 bg-gold-400/5 p-3 text-left hover:border-gold-300/70 hover:bg-gold-400/10"
        >
          <div className="flex items-start gap-1.5">
            <Receipt className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gold-300" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <p className="kpi-gold text-xs">{timeShort(r.sold_at)}</p>
                <span className="rounded bg-gold-400/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gold-200">
                  POS
                </span>
                <span className="ml-auto text-xs font-semibold text-white">
                  {r.total == null ? "—" : money(r.total)}
                </span>
              </div>
              <p className="mt-0.5 truncate text-sm font-medium text-white">
                {r.customer_name?.trim() || "Consumidor final"}
              </p>
              <p className="truncate text-xs text-white/40">
                {r.detail ?? "Venta sin detalle"}
                {r.staff_names ? ` · ${r.staff_names.split(",").join(", ")}` : ""}
              </p>
            </div>
          </div>
        </button>
      )),
    [posRows],
  );

  // Pila total de vencidas (independiente del rango): habilita el cierre masivo.
  const overduePending = useOverduePending();

  const invalidate = () => invalidateAppointments(qc);

  const overdueTotal = overduePending.data?.length ?? 0;

  // Columnas visibles: filtrar por estado es mostrar solo esas listas.
  const columns = useMemo(
    () =>
      filters.statuses.length
        ? STATUS_ORDER.filter((s) => filters.statuses.includes(s))
        : STATUS_ORDER,
    [filters.statuses],
  );

  // "Empezar a Atender" desde la vista lista: la cita pasa a "Atendiendo" y
  // seguimos en la agenda (el detalle se abre al finalizar y cobrar).
  const beginAttention = (a: { id: string }) => {
    void startAttention(qc, a.id).catch(() => {
      /* si falla, el estado sigue como estaba */
    });
  };

  // Arrastrar a "Atendido" no marca la cita: abre la ficha para confirmar el
  // detalle y cobrar (igual que "Finalizar y Cobrar" del menú de acciones).
  const finishAttention = (a: AppointmentRow) => {
    if (a.status === "reserved") {
      execute(
        "UPDATE appointment SET status = 'confirmed', updated_at = ? WHERE id = ?",
        [new Date().toISOString(), a.id],
      )
        .then(invalidate)
        .catch(() => {
          /* si falla, igual seguimos a la ficha */
        });
    }
    navigate(`${ROUTES.appointment}/${a.id}?atender=1`);
  };

  const toast = useToast();

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: AppointmentStatus }) =>
      execute(
        "UPDATE appointment SET status = ?, updated_at = ? WHERE id = ?",
        [status, new Date().toISOString(), id],
      ),
    onSuccess: (_r, { status }) => {
      invalidate();
      // Arrastrar una tarjeta no deja rastro en pantalla más que el movimiento:
      // el aviso confirma que el cambio llegó a la base.
      toast.success(MOVE_TOAST[status] ?? "Cita actualizada");
    },
    onError: (e: Error) => toast.error("No se pudo mover la cita", e.message),
  });

  /**
   * Arrastrar una tarjeta a otra columna:
   * - A "Atendido" nunca se marca directo: abre la ficha para confirmar
   *   servicios, valor y registrar el cobro (Confirmar Venta).
   * - Una cita ya atendida no se puede mover (evita desajustar finanzas).
   * - El resto de estados se cambian en el acto.
   */
  const handleMove = (a: AppointmentRow, toStatus: AppointmentStatus) => {
    setNotice("");
    if (a.status === toStatus) return;
    if (a.status === "attended") {
      setNotice(
        "Una cita atendida ya tiene venta y cobro: no se puede mover de columna.",
      );
      return;
    }
    if (toStatus === "attended") {
      finishAttention(a);
      return;
    }
    setStatus.mutate({ id: a.id, status: toStatus });
  };

  return (
    <div className="mx-auto max-w-[1500px] space-y-3">
      {/* Encabezado compacto: título + pila de vencidas + acciones. */}
      <div className="flex items-center gap-2">
        <h1 className="text-xl font-semibold text-white sm:text-2xl">Agenda</h1>
        <div
          className="inline-flex rounded-full border border-white/10 bg-white/[0.03] p-0.5 text-xs"
          role="tablist"
          aria-label="Vista de la agenda"
        >
          <button
            type="button"
            role="tab"
            aria-selected={view === "board"}
            onClick={() => changeView("board")}
            className={
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 transition-colors " +
              (view === "board"
                ? "bg-gold-400/20 text-gold-200"
                : "text-white/50 hover:text-white/80")
            }
          >
            <LayoutGrid className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Tablero</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === "list"}
            onClick={() => changeView("list")}
            className={
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 transition-colors " +
              (view === "list"
                ? "bg-gold-400/20 text-gold-200"
                : "text-white/50 hover:text-white/80")
            }
          >
            <List className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Lista</span>
          </button>
        </div>
        {overdueTotal > 0 && (
          <span className="rounded-full bg-danger/20 px-2 py-0.5 text-xs font-medium text-danger">
            {overdueTotal} vencida{overdueTotal > 1 ? "s" : ""}
          </span>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {overdueTotal > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCloseOverdue(true)}
            >
              <ClipboardCheck className="h-4 w-4" />
              <span className="hidden sm:inline">Cerrar vencidas</span>
            </Button>
          )}
          <Button size="sm" onClick={() => navigate(ROUTES.appointmentNew)}>
            <CalendarPlus className="h-4 w-4" />
            <span className="hidden sm:inline">Agendar Cita</span>
          </Button>
        </div>
      </div>

      <FilterBar
        filters={filters}
        onChange={patch}
        rangeLabel={label}
        staff={staff.data ?? []}
        overdueInView={overdueInView}
        resultCount={filteredRows.length}
        resultNoun="tareas"
      />

      {notice && (
        <p className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-center text-xs text-amber-200">
          {notice}
        </p>
      )}

      {appts.isLoading ? (
        <div className="flex gap-3 overflow-hidden">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-40 w-[82vw] max-w-xs shrink-0 animate-pulse rounded-xl border border-white/5 bg-white/[0.03] sm:w-64"
            />
          ))}
        </div>
      ) : filteredRows.length === 0 ? (
        <AppointmentsEmptyState
          icon={ClipboardList}
          title="Sin tareas"
          totalRows={appts.data?.length ?? 0}
          filters={filters}
          filteredHint="Ninguna cita coincide con los filtros."
          emptyHint="No hay citas para el rango seleccionado."
        />
      ) : view === "list" ? (
        <ListView
          rows={filteredRows}
          showDate={filters.mode !== "today"}
          onStart={beginAttention}
          onFinish={finishAttention}
          onOpen={handleSelect}
        />
      ) : (
        <KanbanView
          rows={filteredRows}
          columns={columns}
          onSelect={handleSelect}
          onMove={handleMove}
          extras={{ attended: posCards }}
          extraCounts={{ attended: posRows.length }}
        />
      )}

      {selected && (
        <AppointmentActionsModal
          appt={selected}
          onClose={() => setSelected(null)}
        />
      )}

      {openSale && (
        <SaleDetailModal saleId={openSale} onClose={() => setOpenSale(null)} />
      )}

      {openAttendedApptId && (
        <SaleDetailModal
          appointmentId={openAttendedApptId}
          onClose={() => setOpenAttendedApptId(null)}
        />
      )}

      {closeOverdue && (
        <CloseOverdueModal onClose={() => setCloseOverdue(false)} />
      )}
    </div>
  );
}
