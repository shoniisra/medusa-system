import { Suspense, lazy } from 'react';
import { createBrowserRouter } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { AppLayout } from '@/layouts/AppLayout';
import { ProtectedRoute } from './ProtectedRoute';
import { ROUTES } from '@/config/constants';
import { LoginPage } from '@/features/auth/LoginPage';
import { DashboardPage } from '@/features/dashboard/DashboardPage';

// Rutas pesadas o secundarias cargadas bajo demanda (code-splitting).
const PosPage = lazy(() =>
  import('@/features/pos/PosPage').then((m) => ({ default: m.PosPage })),
);
const CashflowPage = lazy(() =>
  import('@/features/cashflow/CashflowPage').then((m) => ({
    default: m.CashflowPage,
  })),
);
const StaffPage = lazy(() =>
  import('@/features/staff/StaffPage').then((m) => ({ default: m.StaffPage })),
);
const ClientsPage = lazy(() =>
  import('@/features/clients/ClientsPage').then((m) => ({
    default: m.ClientsPage,
  })),
);
const ClientDetailPage = lazy(() =>
  import('@/features/clients/ClientsPage').then((m) => ({
    default: m.ClientDetailPage,
  })),
);
const CalendarPage = lazy(() =>
  import('@/features/calendar/CalendarPage').then((m) => ({
    default: m.CalendarPage,
  })),
);
const AppointmentPage = lazy(() =>
  import('@/features/calendar/AppointmentPage').then((m) => ({
    default: m.AppointmentPage,
  })),
);
const TasksPage = lazy(() =>
  import('@/features/tasks/TasksPage').then((m) => ({ default: m.TasksPage })),
);
const RemindersPage = lazy(() =>
  import('@/features/reminders/RemindersPage').then((m) => ({
    default: m.RemindersPage,
  })),
);
const InvoicesPage = lazy(() =>
  import('@/features/invoices/InvoicesPage').then((m) => ({
    default: m.InvoicesPage,
  })),
);
const SettingsPage = lazy(() =>
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
  { path: ROUTES.login, element: <LoginPage /> },
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { path: ROUTES.dashboard, element: <DashboardPage /> },
          { path: ROUTES.pos, element: lazyRoute(<PosPage />) },
          { path: ROUTES.cashflow, element: lazyRoute(<CashflowPage />) },
          { path: ROUTES.calendar, element: lazyRoute(<CalendarPage />) },
          { path: ROUTES.tasks, element: lazyRoute(<TasksPage />) },
          { path: ROUTES.reminders, element: lazyRoute(<RemindersPage />) },
          {
            path: ROUTES.appointmentNew,
            element: lazyRoute(<AppointmentPage />),
          },
          {
            path: `${ROUTES.appointment}/:id`,
            element: lazyRoute(<AppointmentPage />),
          },
          { path: ROUTES.staff, element: lazyRoute(<StaffPage />) },
          { path: ROUTES.clients, element: lazyRoute(<ClientsPage />) },
          {
            path: `${ROUTES.client}/:id`,
            element: lazyRoute(<ClientDetailPage />),
          },
          { path: ROUTES.invoices, element: lazyRoute(<InvoicesPage />) },
          { path: ROUTES.settings, element: lazyRoute(<SettingsPage />) },
        ],
      },
    ],
  },
]);
