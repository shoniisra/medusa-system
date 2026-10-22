-- Presupuesto por categoría/mes. El tope lo define el admin o gerente por sucursal,
-- y el consumo se calcula de `expense` (status<>'voided') del mismo mes. Un
-- índice único evita duplicar presupuesto para la misma categoría-mes.
CREATE TABLE IF NOT EXISTS budget (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organization(id),
  branch_id TEXT NOT NULL REFERENCES branch(id),
  expense_category_id TEXT NOT NULL REFERENCES expense_category(id),
  period_month TEXT NOT NULL, -- "YYYY-MM"
  amount REAL NOT NULL,
  note TEXT,
  created_by TEXT REFERENCES app_user(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_budget_cat_month
  ON budget(branch_id, expense_category_id, period_month);

CREATE INDEX IF NOT EXISTS ix_budget_branch_month
  ON budget(branch_id, period_month);
