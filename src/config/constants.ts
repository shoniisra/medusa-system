import type {
  AppointmentStatus,
  InvoiceRequestStatus,
  PaymentMethodType,
} from '@/types';

export const APP_NAME = 'Medusa Estudio';

/** Categorías de servicios del salón. */
export const SERVICE_CATEGORIES = [
  'Manicura',
  'Pedicura',
  'Cortes de Cabello',
  'Tratamientos',
  'Peinados',
  'Color',
  'Maquillajes',
  'Depilaciones',
  'Cejas',
  'Pestañas',
] as const;

/** Comisión por defecto (%) para el colaborador principal de un servicio. */
export const DEFAULT_COMMISSION_RATE = 40;

export const CURRENCY = 'USD';
export const LOCALE = 'es-EC';
export const DEFAULT_TIMEZONE = 'America/Guayaquil';

/** Etiquetas y colores por estado de cita. */
export const APPOINTMENT_STATUS: Record<
  AppointmentStatus,
  { label: string; tone: 'gold' | 'success' | 'danger' | 'info' | 'muted' }
> = {
  reserved: { label: 'Reservado', tone: 'info' },
  confirmed: { label: 'Atendiendo', tone: 'gold' },
  attended: { label: 'Atendido', tone: 'success' },
  cancelled: { label: 'Cancelado', tone: 'danger' },
  no_show: { label: 'No asistió', tone: 'muted' },
};

/** Columnas del Kanban de facturación (orden visual). */
export const INVOICE_COLUMNS: {
  status: InvoiceRequestStatus;
  label: string;
}[] = [
  { status: 'pending', label: 'Pendiente' },
  { status: 'in_progress', label: 'En proceso' },
  { status: 'done', label: 'Hecho' },
];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethodType, string> = {
  cash: 'Efectivo',
  transfer: 'Transferencia',
  card: 'Tarjeta',
  other: 'Otro',
};

/** Rutas centralizadas para evitar strings sueltos. */
export const ROUTES = {
  login: '/login',
  dashboard: '/',
  pos: '/pos',
  cashflow: '/finanzas',
  staff: '/personal',
  clients: '/clientes',
  client: '/clientes', // + /:id
  calendar: '/agenda',
  tasks: '/tareas',
  reminders: '/recordatorios',
  appointmentNew: '/agenda/cita/nueva',
  appointment: '/agenda/cita', // + /:id
  invoices: '/facturacion',
  settings: '/configuracion',
} as const;
