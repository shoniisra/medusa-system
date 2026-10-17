import { Suspense } from 'react';
import { createBrowserRouter } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { AppLayout } from '@/layouts/AppLayout';
import { HomePage } from '@/layouts/HomePage';
import { lazyPage } from '@/lib/staleBuild';
import { ProtectedRoute } from './ProtectedRoute';
import { RequirePermission } from './RequirePermission';
import { RouteError } from './RouteError';
import { ROUTES } from '@/config/constants';
import { LoginPage } from '@/features/auth/LoginPage';
import { DashboardPage } from '@/features/dashboard/DashboardPage';

// Rutas pesadas o secundarias cargadas bajo demanda (code-splitting).
const PosPage = lazyPage(() =>
  import('@/features/pos/PosPage').then((m) => ({ default: m.PosPage })),
);
const CashflowPage = lazyPage(() =>
  import('@/features/cashflow/CashflowPage').then((m) => ({
    default: m.CashflowPage,
  })),
);
const StaffPage = lazyPage(() =>
  import('@/features/staff/StaffPage').then((m) => ({ default: m.StaffPage })),
);
const StaffTeamPage = lazyPage(() =>
  import('@/features/staff/StaffTeamPage').then((m) => ({ default: m.StaffTeamPage })),
);
const AbsencesPage = lazyPage(() =>
  import('@/features/staff/AbsencesPage').then((m) => ({
    default: m.AbsencesPage,
  })),
);
const ClientsPage = lazyPage(() =>
  import('@/features/clients/ClientsPage').then((m) => ({
    default: m.ClientsPage,
  })),
);
const ClientDetailPage = lazyPage(() =>
  import('@/features/clients/ClientsPage').then((m) => ({
    default: m.ClientDetailPage,
  })),
);
const CalendarPage = lazyPage(() =>
  import('@/features/calendar/CalendarPage').then((m) => ({
    default: m.CalendarPage,
  })),
);
const CalendarViewPage = lazyPage(() =>
  import('@/features/calendar/CalendarViewPage').then((m) => ({
    default: m.CalendarViewPage,
  })),
);
const AppointmentPage = lazyPage(() =>
  import('@/features/calendar/AppointmentPage').then((m) => ({
    default: m.AppointmentPage,
  })),
);
const TasksPage = lazyPage(() =>
  import('@/features/tasks/TasksPage').then((m) => ({ default: m.TasksPage })),
);
const RemindersPage = lazyPage(() =>
  import('@/features/reminders/RemindersPage').then((m) => ({
    default: m.RemindersPage,
  })),
);
const InvoicesPage = lazyPage(() =>
  import('@/features/invoices/InvoicesPage').then((m) => ({
    default: m.InvoicesPage,
  })),
);
const SettingsPage = lazyPage(() =>
  import('@/features/settings/SettingsPage').then((m) => ({
    default: m.SettingsPage,
  })),
);
function PageFallback() {
  return (
    <div className="flex h-64 items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-gold-300" />
    </div>
  );
}

const lazyRoute = (el: React.ReactNode) => (
  <Suspense fallback={<PageFallback />}>{el}</Suspense>
);

export const router = createBrowserRouter([
  { path: ROUTES.login, element: <LoginPage />, errorElement: <RouteError /> },
  {
    element: <ProtectedRoute />,
    errorElement: <RouteError />,
    children: [
      {
        element: <AppLayout />,
        errorElement: <RouteError />,
        children: [
          // Rutas disponibles para todos los roles autenticados.
          { path: ROUTES.dashboard, element: <HomePage /> },
          { path: ROUTES.calendar, element: lazyRoute(<CalendarPage />) },
          { path: ROUTES.calendarView, element: lazyRoute(<CalendarViewPage />) },
          { path: ROUTES.appointmentNew, element: lazyRoute(<AppointmentPage />) },
          { path: `${ROUTES.appointment}/:id`, element: lazyRoute(<AppointmentPage />) },
          { path: ROUTES.tasks, element: lazyRoute(<TasksPage />) },
          { path: ROUTES.reminders, element: lazyRoute(<RemindersPage />) },
          { path: ROUTES.clients, element: lazyRoute(<ClientsPage />) },
          { path: `${ROUTES.client}/:id`, element: lazyRoute(<ClientDetailPage />) },

          // POS: requiere use_pos.
          {
            element: <RequirePermission permission="use_pos" />,
            children: [
              { path: ROUTES.pos, element: lazyRoute(<PosPage />) },
            ],
          },

          // Métricas: requiere view_metrics.
          {
            element: <RequirePermission permission="view_metrics" />,
            children: [
              { path: ROUTES.metrics, element: <DashboardPage /> },
            ],
          },

          // Finanzas: requiere view_finance.
          {
            element: <RequirePermission permission="view_finance" />,
            children: [
              { path: ROUTES.cashflow, element: lazyRoute(<CashflowPage />) },
              { path: ROUTES.cashflowResumen, element: lazyRoute(<CashflowPage />) },
              { path: ROUTES.cashflowTransacciones, element: lazyRoute(<CashflowPage />) },
              { path: ROUTES.cashflowCuentas, element: lazyRoute(<CashflowPage />) },
              { path: ROUTES.cashflowDeudas, element: lazyRoute(<CashflowPage />) },
              { path: ROUTES.cashflowTransferencias, element: lazyRoute(<CashflowPage />) },
            ],
          },

          // Comisiones y ausencias: requiere view_staff_finance.
          {
            element: <RequirePermission permission="view_staff_finance" />,
            children: [
              { path: ROUTES.staff, element: lazyRoute(<StaffPage />) },
              { path: ROUTES.staffAbsences, element: lazyRoute(<AbsencesPage />) },
            ],
          },

          // Miembros del equipo: requiere manage_staff.
          {
            element: <RequirePermission permission="manage_staff" />,
            children: [
              { path: ROUTES.staffTeam, element: lazyRoute(<StaffTeamPage />) },
            ],
          },

          // Facturación: requiere view_invoices.
          {
            element: <RequirePermission permission="view_invoices" />,
            children: [
              { path: ROUTES.invoices, element: lazyRoute(<InvoicesPage />) },
            ],
          },

          // Configuración: requiere manage_settings.
          {
            element: <RequirePermission permission="manage_settings" />,
            children: [
              { path: ROUTES.settings, element: lazyRoute(<SettingsPage />) },
            ],
          },
        ],
      },
    ],
  },
]);
