import { createBrowserRouter } from 'react-router-dom';
import { AppLayout } from '@/layouts/AppLayout';
import { ProtectedRoute } from './ProtectedRoute';
import { ROUTES } from '@/config/constants';

import { LoginPage } from '@/features/auth/LoginPage';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { PosPage } from '@/features/pos/PosPage';
import { CashflowPage } from '@/features/cashflow/CashflowPage';
import { StaffPage } from '@/features/staff/StaffPage';
import { ClientsPage, ClientDetailPage } from '@/features/clients/ClientsPage';
import { CalendarPage } from '@/features/calendar/CalendarPage';
import { AppointmentPage } from '@/features/calendar/AppointmentPage';
import { InvoicesPage } from '@/features/invoices/InvoicesPage';
import { SettingsPage } from '@/features/settings/SettingsPage';

export const router = createBrowserRouter([
  { path: ROUTES.login, element: <LoginPage /> },
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { path: ROUTES.dashboard, element: <DashboardPage /> },
          { path: ROUTES.pos, element: <PosPage /> },
          { path: ROUTES.cashflow, element: <CashflowPage /> },
          { path: ROUTES.calendar, element: <CalendarPage /> },
          { path: ROUTES.appointmentNew, element: <AppointmentPage /> },
          { path: `${ROUTES.appointment}/:id`, element: <AppointmentPage /> },
          { path: ROUTES.staff, element: <StaffPage /> },
          { path: ROUTES.clients, element: <ClientsPage /> },
          { path: `${ROUTES.client}/:id`, element: <ClientDetailPage /> },
          { path: ROUTES.invoices, element: <InvoicesPage /> },
          { path: ROUTES.settings, element: <SettingsPage /> },
        ],
      },
    ],
  },
]);
