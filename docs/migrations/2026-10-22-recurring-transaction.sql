-- Transacciones recurrentes: alquiler, luz, internet, sueldos fijos, aportes
-- de capital periódicos. Al correr una recurrente se crea un `expense` o
-- `payment` real (igual que un gasto/ingreso manual) y se avanza next_run_date.
-- No hay cron: la UI muestra "pendientes" (next_run_date <= hoy) y el usuario
-- confirma su generación en un clic.
CREATE TABLE IF NOT EXISTS recurring_transaction (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organization(id),
  branch_id TEXT NOT NULL REFERENCES branch(id),
  kind TEXT NOT NULL CHECK (kind IN ('expense','income')),
  description TEXT NOT NULL,
  amount REAL NOT NULL,
  -- Para kind='expense'. NULL en ingresos.
  expense_category_id TEXT REFERENCES expense_category(id),
  -- Para kind='income': motivo libre (seña, aporte, préstamo recibido, otro).
  income_reason TEXT,
  payment_method_id TEXT NOT NULL REFERENCES payment_method(id),
  bank_account_id TEXT REFERENCES bank_account(id), -- NULL = efectivo
  frequency TEXT NOT NULL CHECK (frequency IN ('weekly','biweekly','monthly','yearly')),
  -- Día del mes (1-31) para monthly/yearly. Si cae en un mes más corto se
  -- recorta al último día del mes.
  day_of_month INTEGER,
  -- Día de la semana (0=domingo, 6=sábado) para weekly/biweekly.
  weekday INTEGER,
  next_run_date TEXT NOT NULL,   -- YYYY-MM-DD
  last_run_date TEXT,
  start_date TEXT NOT NULL,
  end_date TEXT,                 -- NULL = sin fin
  active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT REFERENCES app_user(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_recurring_due
  ON recurring_transaction(branch_id, next_run_date)
  WHERE active = 1;

CREATE INDEX IF NOT EXISTS ix_recurring_branch
  ON recurring_transaction(branch_id, active);
