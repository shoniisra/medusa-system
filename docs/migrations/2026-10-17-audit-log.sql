-- Auditoría por fila. Aplicar antes de desplegar el código que escribe el contexto.
-- Cada bloque es una sentencia completa, incluidos los triggers.
CREATE TABLE IF NOT EXISTS app_audit_context (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  request_id TEXT NOT NULL,
  actor_id TEXT,
  actor_name TEXT NOT NULL,
  actor_role TEXT,
  organization_id TEXT,
  source TEXT NOT NULL
);

-- statement-breakpoint

CREATE TABLE IF NOT EXISTS app_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  occurred_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  request_id TEXT,
  organization_id TEXT,
  branch_id TEXT,
  actor_id TEXT,
  actor_name TEXT NOT NULL,
  actor_role TEXT,
  source TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  table_name TEXT NOT NULL,
  record_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('create','update','delete')),
  before_data TEXT CHECK (before_data IS NULL OR json_valid(before_data)),
  after_data TEXT CHECK (after_data IS NULL OR json_valid(after_data))
);

-- statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_app_audit_org_id ON app_audit_log (organization_id, id DESC);

-- statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_app_audit_entity ON app_audit_log (organization_id, entity_type, entity_id, id DESC);

-- statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_app_audit_actor ON app_audit_log (organization_id, actor_id, id DESC);

-- statement-breakpoint

CREATE TRIGGER IF NOT EXISTS app_audit_log_no_update BEFORE UPDATE ON app_audit_log
BEGIN SELECT RAISE(ABORT, 'El historial de auditoría no se puede editar'); END;

-- statement-breakpoint

CREATE TRIGGER IF NOT EXISTS app_audit_log_no_delete BEFORE DELETE ON app_audit_log
BEGIN SELECT RAISE(ABORT, 'El historial de auditoría no se puede eliminar'); END;

-- statement-breakpoint

CREATE TRIGGER IF NOT EXISTS app_audit_appointment_create AFTER INSERT ON "appointment"
BEGIN
  INSERT INTO app_audit_log (request_id, organization_id, branch_id, actor_id, actor_name, actor_role, source, entity_type, entity_id, table_name, record_id, action, before_data, after_data)
  VALUES (
    (SELECT request_id FROM app_audit_context WHERE id=1),
    COALESCE(NEW.organization_id, (SELECT organization_id FROM app_audit_context WHERE id=1)),
    NEW.branch_id,
    (SELECT actor_id FROM app_audit_context WHERE id=1),
    COALESCE((SELECT actor_name FROM app_audit_context WHERE id=1), 'Sin identificar (escritura externa)'),
    (SELECT actor_role FROM app_audit_context WHERE id=1),
    COALESCE((SELECT source FROM app_audit_context WHERE id=1), 'external'),
    'appointment', COALESCE(NEW.id, NEW.id), 'appointment', NEW.id, 'create',
    NULL,
    json_object('id', NEW."id", 'organization_id', NEW."organization_id", 'branch_id', NEW."branch_id", 'customer_id', NEW."customer_id", 'start_at', NEW."start_at", 'end_at', NEW."end_at", 'status', NEW."status", 'deposit_required', NEW."deposit_required", 'notes', NEW."notes", 'google_calendar_id', NEW."google_calendar_id", 'google_calendar_event_id', NEW."google_calendar_event_id", 'created_by', NEW."created_by", 'created_at', NEW."created_at", 'updated_at', NEW."updated_at", 'deposit_amount', NEW."deposit_amount", 'google_color_id', NEW."google_color_id", 'google_color_hex', NEW."google_color_hex")
  );
END;

-- statement-breakpoint

CREATE TRIGGER IF NOT EXISTS app_audit_appointment_update AFTER UPDATE ON "appointment"
WHEN json_object('id', OLD."id", 'organization_id', OLD."organization_id", 'branch_id', OLD."branch_id", 'customer_id', OLD."customer_id", 'start_at', OLD."start_at", 'end_at', OLD."end_at", 'status', OLD."status", 'deposit_required', OLD."deposit_required", 'notes', OLD."notes", 'google_calendar_id', OLD."google_calendar_id", 'google_calendar_event_id', OLD."google_calendar_event_id", 'created_by', OLD."created_by", 'created_at', OLD."created_at", 'updated_at', OLD."updated_at", 'deposit_amount', OLD."deposit_amount", 'google_color_id', OLD."google_color_id", 'google_color_hex', OLD."google_color_hex") IS NOT json_object('id', NEW."id", 'organization_id', NEW."organization_id", 'branch_id', NEW."branch_id", 'customer_id', NEW."customer_id", 'start_at', NEW."start_at", 'end_at', NEW."end_at", 'status', NEW."status", 'deposit_required', NEW."deposit_required", 'notes', NEW."notes", 'google_calendar_id', NEW."google_calendar_id", 'google_calendar_event_id', NEW."google_calendar_event_id", 'created_by', NEW."created_by", 'created_at', NEW."created_at", 'updated_at', NEW."updated_at", 'deposit_amount', NEW."deposit_amount", 'google_color_id', NEW."google_color_id", 'google_color_hex', NEW."google_color_hex")
BEGIN
  INSERT INTO app_audit_log (request_id, organization_id, branch_id, actor_id, actor_name, actor_role, source, entity_type, entity_id, table_name, record_id, action, before_data, after_data)
  VALUES (
    (SELECT request_id FROM app_audit_context WHERE id=1),
    COALESCE(NEW.organization_id, (SELECT organization_id FROM app_audit_context WHERE id=1)),
    NEW.branch_id,
    (SELECT actor_id FROM app_audit_context WHERE id=1),
    COALESCE((SELECT actor_name FROM app_audit_context WHERE id=1), 'Sin identificar (escritura externa)'),
    (SELECT actor_role FROM app_audit_context WHERE id=1),
    COALESCE((SELECT source FROM app_audit_context WHERE id=1), 'external'),
    'appointment', COALESCE(NEW.id, NEW.id), 'appointment', NEW.id, 'update',
    json_object('id', OLD."id", 'organization_id', OLD."organization_id", 'branch_id', OLD."branch_id", 'customer_id', OLD."customer_id", 'start_at', OLD."start_at", 'end_at', OLD."end_at", 'status', OLD."status", 'deposit_required', OLD."deposit_required", 'notes', OLD."notes", 'google_calendar_id', OLD."google_calendar_id", 'google_calendar_event_id', OLD."google_calendar_event_id", 'created_by', OLD."created_by", 'created_at', OLD."created_at", 'updated_at', OLD."updated_at", 'deposit_amount', OLD."deposit_amount", 'google_color_id', OLD."google_color_id", 'google_color_hex', OLD."google_color_hex"),
    json_object('id', NEW."id", 'organization_id', NEW."organization_id", 'branch_id', NEW."branch_id", 'customer_id', NEW."customer_id", 'start_at', NEW."start_at", 'end_at', NEW."end_at", 'status', NEW."status", 'deposit_required', NEW."deposit_required", 'notes', NEW."notes", 'google_calendar_id', NEW."google_calendar_id", 'google_calendar_event_id', NEW."google_calendar_event_id", 'created_by', NEW."created_by", 'created_at', NEW."created_at", 'updated_at', NEW."updated_at", 'deposit_amount', NEW."deposit_amount", 'google_color_id', NEW."google_color_id", 'google_color_hex', NEW."google_color_hex")
  );
END;

-- statement-breakpoint

CREATE TRIGGER IF NOT EXISTS app_audit_appointment_delete BEFORE DELETE ON "appointment"
BEGIN
  INSERT INTO app_audit_log (request_id, organization_id, branch_id, actor_id, actor_name, actor_role, source, entity_type, entity_id, table_name, record_id, action, before_data, after_data)
  VALUES (
    (SELECT request_id FROM app_audit_context WHERE id=1),
    COALESCE(OLD.organization_id, (SELECT organization_id FROM app_audit_context WHERE id=1)),
    OLD.branch_id,
    (SELECT actor_id FROM app_audit_context WHERE id=1),
    COALESCE((SELECT actor_name FROM app_audit_context WHERE id=1), 'Sin identificar (escritura externa)'),
    (SELECT actor_role FROM app_audit_context WHERE id=1),
    COALESCE((SELECT source FROM app_audit_context WHERE id=1), 'external'),
    'appointment', COALESCE(OLD.id, OLD.id), 'appointment', OLD.id, 'delete',
    json_object('id', OLD."id", 'organization_id', OLD."organization_id", 'branch_id', OLD."branch_id", 'customer_id', OLD."customer_id", 'start_at', OLD."start_at", 'end_at', OLD."end_at", 'status', OLD."status", 'deposit_required', OLD."deposit_required", 'notes', OLD."notes", 'google_calendar_id', OLD."google_calendar_id", 'google_calendar_event_id', OLD."google_calendar_event_id", 'created_by', OLD."created_by", 'created_at', OLD."created_at", 'updated_at', OLD."updated_at", 'deposit_amount', OLD."deposit_amount", 'google_color_id', OLD."google_color_id", 'google_color_hex', OLD."google_color_hex"),
    NULL
  );
END;

-- statement-breakpoint

CREATE TRIGGER IF NOT EXISTS app_audit_appointment_item_create AFTER INSERT ON "appointment_item"
BEGIN
  INSERT INTO app_audit_log (request_id, organization_id, branch_id, actor_id, actor_name, actor_role, source, entity_type, entity_id, table_name, record_id, action, before_data, after_data)
  VALUES (
    (SELECT request_id FROM app_audit_context WHERE id=1),
    COALESCE((SELECT organization_id FROM appointment WHERE id=NEW.appointment_id), (SELECT organization_id FROM app_audit_context WHERE id=1)),
    (SELECT branch_id FROM appointment WHERE id=NEW.appointment_id),
    (SELECT actor_id FROM app_audit_context WHERE id=1),
    COALESCE((SELECT actor_name FROM app_audit_context WHERE id=1), 'Sin identificar (escritura externa)'),
    (SELECT actor_role FROM app_audit_context WHERE id=1),
    COALESCE((SELECT source FROM app_audit_context WHERE id=1), 'external'),
    'appointment', COALESCE(NEW.appointment_id, NEW.id), 'appointment_item', NEW.id, 'create',
    NULL,
    json_object('id', NEW."id", 'appointment_id', NEW."appointment_id", 'service_id', NEW."service_id", 'product_id', NEW."product_id", 'category', NEW."category", 'description', NEW."description", 'quantity', NEW."quantity", 'list_unit_price', NEW."list_unit_price", 'discount_amount', NEW."discount_amount", 'final_unit_price', NEW."final_unit_price", 'assigned_staff_id', NEW."assigned_staff_id", 'notes', NEW."notes")
  );
END;

-- statement-breakpoint

CREATE TRIGGER IF NOT EXISTS app_audit_appointment_item_update AFTER UPDATE ON "appointment_item"
WHEN json_object('id', OLD."id", 'appointment_id', OLD."appointment_id", 'service_id', OLD."service_id", 'product_id', OLD."product_id", 'category', OLD."category", 'description', OLD."description", 'quantity', OLD."quantity", 'list_unit_price', OLD."list_unit_price", 'discount_amount', OLD."discount_amount", 'final_unit_price', OLD."final_unit_price", 'assigned_staff_id', OLD."assigned_staff_id", 'notes', OLD."notes") IS NOT json_object('id', NEW."id", 'appointment_id', NEW."appointment_id", 'service_id', NEW."service_id", 'product_id', NEW."product_id", 'category', NEW."category", 'description', NEW."description", 'quantity', NEW."quantity", 'list_unit_price', NEW."list_unit_price", 'discount_amount', NEW."discount_amount", 'final_unit_price', NEW."final_unit_price", 'assigned_staff_id', NEW."assigned_staff_id", 'notes', NEW."notes")
BEGIN
  INSERT INTO app_audit_log (request_id, organization_id, branch_id, actor_id, actor_name, actor_role, source, entity_type, entity_id, table_name, record_id, action, before_data, after_data)
  VALUES (
    (SELECT request_id FROM app_audit_context WHERE id=1),
    COALESCE((SELECT organization_id FROM appointment WHERE id=NEW.appointment_id), (SELECT organization_id FROM app_audit_context WHERE id=1)),
    (SELECT branch_id FROM appointment WHERE id=NEW.appointment_id),
    (SELECT actor_id FROM app_audit_context WHERE id=1),
    COALESCE((SELECT actor_name FROM app_audit_context WHERE id=1), 'Sin identificar (escritura externa)'),
    (SELECT actor_role FROM app_audit_context WHERE id=1),
    COALESCE((SELECT source FROM app_audit_context WHERE id=1), 'external'),
    'appointment', COALESCE(NEW.appointment_id, NEW.id), 'appointment_item', NEW.id, 'update',
    json_object('id', OLD."id", 'appointment_id', OLD."appointment_id", 'service_id', OLD."service_id", 'product_id', OLD."product_id", 'category', OLD."category", 'description', OLD."description", 'quantity', OLD."quantity", 'list_unit_price', OLD."list_unit_price", 'discount_amount', OLD."discount_amount", 'final_unit_price', OLD."final_unit_price", 'assigned_staff_id', OLD."assigned_staff_id", 'notes', OLD."notes"),
    json_object('id', NEW."id", 'appointment_id', NEW."appointment_id", 'service_id', NEW."service_id", 'product_id', NEW."product_id", 'category', NEW."category", 'description', NEW."description", 'quantity', NEW."quantity", 'list_unit_price', NEW."list_unit_price", 'discount_amount', NEW."discount_amount", 'final_unit_price', NEW."final_unit_price", 'assigned_staff_id', NEW."assigned_staff_id", 'notes', NEW."notes")
  );
END;

-- statement-breakpoint

CREATE TRIGGER IF NOT EXISTS app_audit_appointment_item_delete BEFORE DELETE ON "appointment_item"
BEGIN
  INSERT INTO app_audit_log (request_id, organization_id, branch_id, actor_id, actor_name, actor_role, source, entity_type, entity_id, table_name, record_id, action, before_data, after_data)
  VALUES (
    (SELECT request_id FROM app_audit_context WHERE id=1),
    COALESCE((SELECT organization_id FROM appointment WHERE id=OLD.appointment_id), (SELECT organization_id FROM app_audit_context WHERE id=1)),
    (SELECT branch_id FROM appointment WHERE id=OLD.appointment_id),
    (SELECT actor_id FROM app_audit_context WHERE id=1),
    COALESCE((SELECT actor_name FROM app_audit_context WHERE id=1), 'Sin identificar (escritura externa)'),
    (SELECT actor_role FROM app_audit_context WHERE id=1),
    COALESCE((SELECT source FROM app_audit_context WHERE id=1), 'external'),
    'appointment', COALESCE(OLD.appointment_id, OLD.id), 'appointment_item', OLD.id, 'delete',
    json_object('id', OLD."id", 'appointment_id', OLD."appointment_id", 'service_id', OLD."service_id", 'product_id', OLD."product_id", 'category', OLD."category", 'description', OLD."description", 'quantity', OLD."quantity", 'list_unit_price', OLD."list_unit_price", 'discount_amount', OLD."discount_amount", 'final_unit_price', OLD."final_unit_price", 'assigned_staff_id', OLD."assigned_staff_id", 'notes', OLD."notes"),
    NULL
  );
END;

-- statement-breakpoint

CREATE TRIGGER IF NOT EXISTS app_audit_sale_create AFTER INSERT ON "sale"
BEGIN
  INSERT INTO app_audit_log (request_id, organization_id, branch_id, actor_id, actor_name, actor_role, source, entity_type, entity_id, table_name, record_id, action, before_data, after_data)
  VALUES (
    (SELECT request_id FROM app_audit_context WHERE id=1),
    COALESCE(NEW.organization_id, (SELECT organization_id FROM app_audit_context WHERE id=1)),
    NEW.branch_id,
    (SELECT actor_id FROM app_audit_context WHERE id=1),
    COALESCE((SELECT actor_name FROM app_audit_context WHERE id=1), 'Sin identificar (escritura externa)'),
    (SELECT actor_role FROM app_audit_context WHERE id=1),
    COALESCE((SELECT source FROM app_audit_context WHERE id=1), 'external'),
    'sale', COALESCE(NEW.id, NEW.id), 'sale', NEW.id, 'create',
    NULL,
    json_object('id', NEW."id", 'organization_id', NEW."organization_id", 'branch_id', NEW."branch_id", 'customer_id', NEW."customer_id", 'appointment_id', NEW."appointment_id", 'sale_number', NEW."sale_number", 'sold_at', NEW."sold_at", 'status', NEW."status", 'subtotal', NEW."subtotal", 'discount_total', NEW."discount_total", 'tax_total', NEW."tax_total", 'total', NEW."total", 'requires_invoice', NEW."requires_invoice", 'notes', NEW."notes", 'created_by', NEW."created_by", 'created_at', NEW."created_at", 'updated_at', NEW."updated_at")
  );
END;

-- statement-breakpoint

CREATE TRIGGER IF NOT EXISTS app_audit_sale_update AFTER UPDATE ON "sale"
WHEN json_object('id', OLD."id", 'organization_id', OLD."organization_id", 'branch_id', OLD."branch_id", 'customer_id', OLD."customer_id", 'appointment_id', OLD."appointment_id", 'sale_number', OLD."sale_number", 'sold_at', OLD."sold_at", 'status', OLD."status", 'subtotal', OLD."subtotal", 'discount_total', OLD."discount_total", 'tax_total', OLD."tax_total", 'total', OLD."total", 'requires_invoice', OLD."requires_invoice", 'notes', OLD."notes", 'created_by', OLD."created_by", 'created_at', OLD."created_at", 'updated_at', OLD."updated_at") IS NOT json_object('id', NEW."id", 'organization_id', NEW."organization_id", 'branch_id', NEW."branch_id", 'customer_id', NEW."customer_id", 'appointment_id', NEW."appointment_id", 'sale_number', NEW."sale_number", 'sold_at', NEW."sold_at", 'status', NEW."status", 'subtotal', NEW."subtotal", 'discount_total', NEW."discount_total", 'tax_total', NEW."tax_total", 'total', NEW."total", 'requires_invoice', NEW."requires_invoice", 'notes', NEW."notes", 'created_by', NEW."created_by", 'created_at', NEW."created_at", 'updated_at', NEW."updated_at")
BEGIN
  INSERT INTO app_audit_log (request_id, organization_id, branch_id, actor_id, actor_name, actor_role, source, entity_type, entity_id, table_name, record_id, action, before_data, after_data)
  VALUES (
    (SELECT request_id FROM app_audit_context WHERE id=1),
    COALESCE(NEW.organization_id, (SELECT organization_id FROM app_audit_context WHERE id=1)),
    NEW.branch_id,
    (SELECT actor_id FROM app_audit_context WHERE id=1),
    COALESCE((SELECT actor_name FROM app_audit_context WHERE id=1), 'Sin identificar (escritura externa)'),
    (SELECT actor_role FROM app_audit_context WHERE id=1),
    COALESCE((SELECT source FROM app_audit_context WHERE id=1), 'external'),
    'sale', COALESCE(NEW.id, NEW.id), 'sale', NEW.id, 'update',
    json_object('id', OLD."id", 'organization_id', OLD."organization_id", 'branch_id', OLD."branch_id", 'customer_id', OLD."customer_id", 'appointment_id', OLD."appointment_id", 'sale_number', OLD."sale_number", 'sold_at', OLD."sold_at", 'status', OLD."status", 'subtotal', OLD."subtotal", 'discount_total', OLD."discount_total", 'tax_total', OLD."tax_total", 'total', OLD."total", 'requires_invoice', OLD."requires_invoice", 'notes', OLD."notes", 'created_by', OLD."created_by", 'created_at', OLD."created_at", 'updated_at', OLD."updated_at"),
    json_object('id', NEW."id", 'organization_id', NEW."organization_id", 'branch_id', NEW."branch_id", 'customer_id', NEW."customer_id", 'appointment_id', NEW."appointment_id", 'sale_number', NEW."sale_number", 'sold_at', NEW."sold_at", 'status', NEW."status", 'subtotal', NEW."subtotal", 'discount_total', NEW."discount_total", 'tax_total', NEW."tax_total", 'total', NEW."total", 'requires_invoice', NEW."requires_invoice", 'notes', NEW."notes", 'created_by', NEW."created_by", 'created_at', NEW."created_at", 'updated_at', NEW."updated_at")
  );
END;

-- statement-breakpoint

CREATE TRIGGER IF NOT EXISTS app_audit_sale_delete BEFORE DELETE ON "sale"
BEGIN
  INSERT INTO app_audit_log (request_id, organization_id, branch_id, actor_id, actor_name, actor_role, source, entity_type, entity_id, table_name, record_id, action, before_data, after_data)
  VALUES (
    (SELECT request_id FROM app_audit_context WHERE id=1),
    COALESCE(OLD.organization_id, (SELECT organization_id FROM app_audit_context WHERE id=1)),
    OLD.branch_id,
    (SELECT actor_id FROM app_audit_context WHERE id=1),
    COALESCE((SELECT actor_name FROM app_audit_context WHERE id=1), 'Sin identificar (escritura externa)'),
    (SELECT actor_role FROM app_audit_context WHERE id=1),
    COALESCE((SELECT source FROM app_audit_context WHERE id=1), 'external'),
    'sale', COALESCE(OLD.id, OLD.id), 'sale', OLD.id, 'delete',
    json_object('id', OLD."id", 'organization_id', OLD."organization_id", 'branch_id', OLD."branch_id", 'customer_id', OLD."customer_id", 'appointment_id', OLD."appointment_id", 'sale_number', OLD."sale_number", 'sold_at', OLD."sold_at", 'status', OLD."status", 'subtotal', OLD."subtotal", 'discount_total', OLD."discount_total", 'tax_total', OLD."tax_total", 'total', OLD."total", 'requires_invoice', OLD."requires_invoice", 'notes', OLD."notes", 'created_by', OLD."created_by", 'created_at', OLD."created_at", 'updated_at', OLD."updated_at"),
    NULL
  );
END;

-- statement-breakpoint

CREATE TRIGGER IF NOT EXISTS app_audit_sale_item_create AFTER INSERT ON "sale_item"
BEGIN
  INSERT INTO app_audit_log (request_id, organization_id, branch_id, actor_id, actor_name, actor_role, source, entity_type, entity_id, table_name, record_id, action, before_data, after_data)
  VALUES (
    (SELECT request_id FROM app_audit_context WHERE id=1),
    COALESCE((SELECT organization_id FROM sale WHERE id=NEW.sale_id), (SELECT organization_id FROM app_audit_context WHERE id=1)),
    (SELECT branch_id FROM sale WHERE id=NEW.sale_id),
    (SELECT actor_id FROM app_audit_context WHERE id=1),
    COALESCE((SELECT actor_name FROM app_audit_context WHERE id=1), 'Sin identificar (escritura externa)'),
    (SELECT actor_role FROM app_audit_context WHERE id=1),
    COALESCE((SELECT source FROM app_audit_context WHERE id=1), 'external'),
    'sale', COALESCE(NEW.sale_id, NEW.id), 'sale_item', NEW.id, 'create',
    NULL,
    json_object('id', NEW."id", 'sale_id', NEW."sale_id", 'service_id', NEW."service_id", 'product_id', NEW."product_id", 'description', NEW."description", 'quantity', NEW."quantity", 'list_unit_price', NEW."list_unit_price", 'discount_amount', NEW."discount_amount", 'final_unit_price', NEW."final_unit_price", 'line_total', NEW."line_total", 'promotion_id', NEW."promotion_id", 'notes', NEW."notes")
  );
END;

-- statement-breakpoint

CREATE TRIGGER IF NOT EXISTS app_audit_sale_item_update AFTER UPDATE ON "sale_item"
WHEN json_object('id', OLD."id", 'sale_id', OLD."sale_id", 'service_id', OLD."service_id", 'product_id', OLD."product_id", 'description', OLD."description", 'quantity', OLD."quantity", 'list_unit_price', OLD."list_unit_price", 'discount_amount', OLD."discount_amount", 'final_unit_price', OLD."final_unit_price", 'line_total', OLD."line_total", 'promotion_id', OLD."promotion_id", 'notes', OLD."notes") IS NOT json_object('id', NEW."id", 'sale_id', NEW."sale_id", 'service_id', NEW."service_id", 'product_id', NEW."product_id", 'description', NEW."description", 'quantity', NEW."quantity", 'list_unit_price', NEW."list_unit_price", 'discount_amount', NEW."discount_amount", 'final_unit_price', NEW."final_unit_price", 'line_total', NEW."line_total", 'promotion_id', NEW."promotion_id", 'notes', NEW."notes")
BEGIN
  INSERT INTO app_audit_log (request_id, organization_id, branch_id, actor_id, actor_name, actor_role, source, entity_type, entity_id, table_name, record_id, action, before_data, after_data)
  VALUES (
    (SELECT request_id FROM app_audit_context WHERE id=1),
    COALESCE((SELECT organization_id FROM sale WHERE id=NEW.sale_id), (SELECT organization_id FROM app_audit_context WHERE id=1)),
    (SELECT branch_id FROM sale WHERE id=NEW.sale_id),
    (SELECT actor_id FROM app_audit_context WHERE id=1),
    COALESCE((SELECT actor_name FROM app_audit_context WHERE id=1), 'Sin identificar (escritura externa)'),
    (SELECT actor_role FROM app_audit_context WHERE id=1),
    COALESCE((SELECT source FROM app_audit_context WHERE id=1), 'external'),
    'sale', COALESCE(NEW.sale_id, NEW.id), 'sale_item', NEW.id, 'update',
    json_object('id', OLD."id", 'sale_id', OLD."sale_id", 'service_id', OLD."service_id", 'product_id', OLD."product_id", 'description', OLD."description", 'quantity', OLD."quantity", 'list_unit_price', OLD."list_unit_price", 'discount_amount', OLD."discount_amount", 'final_unit_price', OLD."final_unit_price", 'line_total', OLD."line_total", 'promotion_id', OLD."promotion_id", 'notes', OLD."notes"),
    json_object('id', NEW."id", 'sale_id', NEW."sale_id", 'service_id', NEW."service_id", 'product_id', NEW."product_id", 'description', NEW."description", 'quantity', NEW."quantity", 'list_unit_price', NEW."list_unit_price", 'discount_amount', NEW."discount_amount", 'final_unit_price', NEW."final_unit_price", 'line_total', NEW."line_total", 'promotion_id', NEW."promotion_id", 'notes', NEW."notes")
  );
END;

-- statement-breakpoint

CREATE TRIGGER IF NOT EXISTS app_audit_sale_item_delete BEFORE DELETE ON "sale_item"
BEGIN
  INSERT INTO app_audit_log (request_id, organization_id, branch_id, actor_id, actor_name, actor_role, source, entity_type, entity_id, table_name, record_id, action, before_data, after_data)
  VALUES (
    (SELECT request_id FROM app_audit_context WHERE id=1),
    COALESCE((SELECT organization_id FROM sale WHERE id=OLD.sale_id), (SELECT organization_id FROM app_audit_context WHERE id=1)),
    (SELECT branch_id FROM sale WHERE id=OLD.sale_id),
    (SELECT actor_id FROM app_audit_context WHERE id=1),
    COALESCE((SELECT actor_name FROM app_audit_context WHERE id=1), 'Sin identificar (escritura externa)'),
    (SELECT actor_role FROM app_audit_context WHERE id=1),
    COALESCE((SELECT source FROM app_audit_context WHERE id=1), 'external'),
    'sale', COALESCE(OLD.sale_id, OLD.id), 'sale_item', OLD.id, 'delete',
    json_object('id', OLD."id", 'sale_id', OLD."sale_id", 'service_id', OLD."service_id", 'product_id', OLD."product_id", 'description', OLD."description", 'quantity', OLD."quantity", 'list_unit_price', OLD."list_unit_price", 'discount_amount', OLD."discount_amount", 'final_unit_price', OLD."final_unit_price", 'line_total', OLD."line_total", 'promotion_id', OLD."promotion_id", 'notes', OLD."notes"),
    NULL
  );
END;

-- statement-breakpoint

CREATE TRIGGER IF NOT EXISTS app_audit_sale_service_staff_create AFTER INSERT ON "sale_service_staff"
BEGIN
  INSERT INTO app_audit_log (request_id, organization_id, branch_id, actor_id, actor_name, actor_role, source, entity_type, entity_id, table_name, record_id, action, before_data, after_data)
  VALUES (
    (SELECT request_id FROM app_audit_context WHERE id=1),
    COALESCE((SELECT organization_id FROM sale WHERE id=(SELECT sale_id FROM sale_item WHERE id=NEW.sale_item_id)), (SELECT organization_id FROM app_audit_context WHERE id=1)),
    (SELECT branch_id FROM sale WHERE id=(SELECT sale_id FROM sale_item WHERE id=NEW.sale_item_id)),
    (SELECT actor_id FROM app_audit_context WHERE id=1),
    COALESCE((SELECT actor_name FROM app_audit_context WHERE id=1), 'Sin identificar (escritura externa)'),
    (SELECT actor_role FROM app_audit_context WHERE id=1),
    COALESCE((SELECT source FROM app_audit_context WHERE id=1), 'external'),
    'sale', COALESCE((SELECT sale_id FROM sale_item WHERE id=NEW.sale_item_id), NEW.id), 'sale_service_staff', NEW.id, 'create',
    NULL,
    json_object('id', NEW."id", 'sale_item_id', NEW."sale_item_id", 'staff_member_id', NEW."staff_member_id", 'participation_role', NEW."participation_role", 'commission_basis', NEW."commission_basis", 'basis_amount', NEW."basis_amount", 'commission_type', NEW."commission_type", 'commission_rate', NEW."commission_rate", 'commission_amount', NEW."commission_amount", 'reduces_primary_amount', NEW."reduces_primary_amount", 'notes', NEW."notes", 'assist_label', NEW."assist_label")
  );
END;

-- statement-breakpoint

CREATE TRIGGER IF NOT EXISTS app_audit_sale_service_staff_update AFTER UPDATE ON "sale_service_staff"
WHEN json_object('id', OLD."id", 'sale_item_id', OLD."sale_item_id", 'staff_member_id', OLD."staff_member_id", 'participation_role', OLD."participation_role", 'commission_basis', OLD."commission_basis", 'basis_amount', OLD."basis_amount", 'commission_type', OLD."commission_type", 'commission_rate', OLD."commission_rate", 'commission_amount', OLD."commission_amount", 'reduces_primary_amount', OLD."reduces_primary_amount", 'notes', OLD."notes", 'assist_label', OLD."assist_label") IS NOT json_object('id', NEW."id", 'sale_item_id', NEW."sale_item_id", 'staff_member_id', NEW."staff_member_id", 'participation_role', NEW."participation_role", 'commission_basis', NEW."commission_basis", 'basis_amount', NEW."basis_amount", 'commission_type', NEW."commission_type", 'commission_rate', NEW."commission_rate", 'commission_amount', NEW."commission_amount", 'reduces_primary_amount', NEW."reduces_primary_amount", 'notes', NEW."notes", 'assist_label', NEW."assist_label")
BEGIN
  INSERT INTO app_audit_log (request_id, organization_id, branch_id, actor_id, actor_name, actor_role, source, entity_type, entity_id, table_name, record_id, action, before_data, after_data)
  VALUES (
    (SELECT request_id FROM app_audit_context WHERE id=1),
    COALESCE((SELECT organization_id FROM sale WHERE id=(SELECT sale_id FROM sale_item WHERE id=NEW.sale_item_id)), (SELECT organization_id FROM app_audit_context WHERE id=1)),
    (SELECT branch_id FROM sale WHERE id=(SELECT sale_id FROM sale_item WHERE id=NEW.sale_item_id)),
    (SELECT actor_id FROM app_audit_context WHERE id=1),
    COALESCE((SELECT actor_name FROM app_audit_context WHERE id=1), 'Sin identificar (escritura externa)'),
    (SELECT actor_role FROM app_audit_context WHERE id=1),
    COALESCE((SELECT source FROM app_audit_context WHERE id=1), 'external'),
    'sale', COALESCE((SELECT sale_id FROM sale_item WHERE id=NEW.sale_item_id), NEW.id), 'sale_service_staff', NEW.id, 'update',
    json_object('id', OLD."id", 'sale_item_id', OLD."sale_item_id", 'staff_member_id', OLD."staff_member_id", 'participation_role', OLD."participation_role", 'commission_basis', OLD."commission_basis", 'basis_amount', OLD."basis_amount", 'commission_type', OLD."commission_type", 'commission_rate', OLD."commission_rate", 'commission_amount', OLD."commission_amount", 'reduces_primary_amount', OLD."reduces_primary_amount", 'notes', OLD."notes", 'assist_label', OLD."assist_label"),
    json_object('id', NEW."id", 'sale_item_id', NEW."sale_item_id", 'staff_member_id', NEW."staff_member_id", 'participation_role', NEW."participation_role", 'commission_basis', NEW."commission_basis", 'basis_amount', NEW."basis_amount", 'commission_type', NEW."commission_type", 'commission_rate', NEW."commission_rate", 'commission_amount', NEW."commission_amount", 'reduces_primary_amount', NEW."reduces_primary_amount", 'notes', NEW."notes", 'assist_label', NEW."assist_label")
  );
END;

-- statement-breakpoint

CREATE TRIGGER IF NOT EXISTS app_audit_sale_service_staff_delete BEFORE DELETE ON "sale_service_staff"
BEGIN
  INSERT INTO app_audit_log (request_id, organization_id, branch_id, actor_id, actor_name, actor_role, source, entity_type, entity_id, table_name, record_id, action, before_data, after_data)
  VALUES (
    (SELECT request_id FROM app_audit_context WHERE id=1),
    COALESCE((SELECT organization_id FROM sale WHERE id=(SELECT sale_id FROM sale_item WHERE id=OLD.sale_item_id)), (SELECT organization_id FROM app_audit_context WHERE id=1)),
    (SELECT branch_id FROM sale WHERE id=(SELECT sale_id FROM sale_item WHERE id=OLD.sale_item_id)),
    (SELECT actor_id FROM app_audit_context WHERE id=1),
    COALESCE((SELECT actor_name FROM app_audit_context WHERE id=1), 'Sin identificar (escritura externa)'),
    (SELECT actor_role FROM app_audit_context WHERE id=1),
    COALESCE((SELECT source FROM app_audit_context WHERE id=1), 'external'),
    'sale', COALESCE((SELECT sale_id FROM sale_item WHERE id=OLD.sale_item_id), OLD.id), 'sale_service_staff', OLD.id, 'delete',
    json_object('id', OLD."id", 'sale_item_id', OLD."sale_item_id", 'staff_member_id', OLD."staff_member_id", 'participation_role', OLD."participation_role", 'commission_basis', OLD."commission_basis", 'basis_amount', OLD."basis_amount", 'commission_type', OLD."commission_type", 'commission_rate', OLD."commission_rate", 'commission_amount', OLD."commission_amount", 'reduces_primary_amount', OLD."reduces_primary_amount", 'notes', OLD."notes", 'assist_label', OLD."assist_label"),
    NULL
  );
END;

-- statement-breakpoint

CREATE TRIGGER IF NOT EXISTS app_audit_payment_create AFTER INSERT ON "payment"
BEGIN
  INSERT INTO app_audit_log (request_id, organization_id, branch_id, actor_id, actor_name, actor_role, source, entity_type, entity_id, table_name, record_id, action, before_data, after_data)
  VALUES (
    (SELECT request_id FROM app_audit_context WHERE id=1),
    COALESCE(NEW.organization_id, (SELECT organization_id FROM app_audit_context WHERE id=1)),
    NEW.branch_id,
    (SELECT actor_id FROM app_audit_context WHERE id=1),
    COALESCE((SELECT actor_name FROM app_audit_context WHERE id=1), 'Sin identificar (escritura externa)'),
    (SELECT actor_role FROM app_audit_context WHERE id=1),
    COALESCE((SELECT source FROM app_audit_context WHERE id=1), 'external'),
    'payment', COALESCE(NEW.id, NEW.id), 'payment', NEW.id, 'create',
    NULL,
    json_object('id', NEW."id", 'organization_id', NEW."organization_id", 'branch_id', NEW."branch_id", 'sale_id', NEW."sale_id", 'appointment_id', NEW."appointment_id", 'payment_method_id', NEW."payment_method_id", 'bank_account_id', NEW."bank_account_id", 'paid_at', NEW."paid_at", 'amount', NEW."amount", 'status', NEW."status", 'reference', NEW."reference", 'receipt_file_url', NEW."receipt_file_url", 'notes', NEW."notes", 'created_by', NEW."created_by", 'created_at', NEW."created_at", 'updated_at', NEW."updated_at")
  );
END;

-- statement-breakpoint

CREATE TRIGGER IF NOT EXISTS app_audit_payment_update AFTER UPDATE ON "payment"
WHEN json_object('id', OLD."id", 'organization_id', OLD."organization_id", 'branch_id', OLD."branch_id", 'sale_id', OLD."sale_id", 'appointment_id', OLD."appointment_id", 'payment_method_id', OLD."payment_method_id", 'bank_account_id', OLD."bank_account_id", 'paid_at', OLD."paid_at", 'amount', OLD."amount", 'status', OLD."status", 'reference', OLD."reference", 'receipt_file_url', OLD."receipt_file_url", 'notes', OLD."notes", 'created_by', OLD."created_by", 'created_at', OLD."created_at", 'updated_at', OLD."updated_at") IS NOT json_object('id', NEW."id", 'organization_id', NEW."organization_id", 'branch_id', NEW."branch_id", 'sale_id', NEW."sale_id", 'appointment_id', NEW."appointment_id", 'payment_method_id', NEW."payment_method_id", 'bank_account_id', NEW."bank_account_id", 'paid_at', NEW."paid_at", 'amount', NEW."amount", 'status', NEW."status", 'reference', NEW."reference", 'receipt_file_url', NEW."receipt_file_url", 'notes', NEW."notes", 'created_by', NEW."created_by", 'created_at', NEW."created_at", 'updated_at', NEW."updated_at")
BEGIN
  INSERT INTO app_audit_log (request_id, organization_id, branch_id, actor_id, actor_name, actor_role, source, entity_type, entity_id, table_name, record_id, action, before_data, after_data)
  VALUES (
    (SELECT request_id FROM app_audit_context WHERE id=1),
    COALESCE(NEW.organization_id, (SELECT organization_id FROM app_audit_context WHERE id=1)),
    NEW.branch_id,
    (SELECT actor_id FROM app_audit_context WHERE id=1),
    COALESCE((SELECT actor_name FROM app_audit_context WHERE id=1), 'Sin identificar (escritura externa)'),
    (SELECT actor_role FROM app_audit_context WHERE id=1),
    COALESCE((SELECT source FROM app_audit_context WHERE id=1), 'external'),
    'payment', COALESCE(NEW.id, NEW.id), 'payment', NEW.id, 'update',
    json_object('id', OLD."id", 'organization_id', OLD."organization_id", 'branch_id', OLD."branch_id", 'sale_id', OLD."sale_id", 'appointment_id', OLD."appointment_id", 'payment_method_id', OLD."payment_method_id", 'bank_account_id', OLD."bank_account_id", 'paid_at', OLD."paid_at", 'amount', OLD."amount", 'status', OLD."status", 'reference', OLD."reference", 'receipt_file_url', OLD."receipt_file_url", 'notes', OLD."notes", 'created_by', OLD."created_by", 'created_at', OLD."created_at", 'updated_at', OLD."updated_at"),
    json_object('id', NEW."id", 'organization_id', NEW."organization_id", 'branch_id', NEW."branch_id", 'sale_id', NEW."sale_id", 'appointment_id', NEW."appointment_id", 'payment_method_id', NEW."payment_method_id", 'bank_account_id', NEW."bank_account_id", 'paid_at', NEW."paid_at", 'amount', NEW."amount", 'status', NEW."status", 'reference', NEW."reference", 'receipt_file_url', NEW."receipt_file_url", 'notes', NEW."notes", 'created_by', NEW."created_by", 'created_at', NEW."created_at", 'updated_at', NEW."updated_at")
  );
END;

-- statement-breakpoint

CREATE TRIGGER IF NOT EXISTS app_audit_payment_delete BEFORE DELETE ON "payment"
BEGIN
  INSERT INTO app_audit_log (request_id, organization_id, branch_id, actor_id, actor_name, actor_role, source, entity_type, entity_id, table_name, record_id, action, before_data, after_data)
  VALUES (
    (SELECT request_id FROM app_audit_context WHERE id=1),
    COALESCE(OLD.organization_id, (SELECT organization_id FROM app_audit_context WHERE id=1)),
    OLD.branch_id,
    (SELECT actor_id FROM app_audit_context WHERE id=1),
    COALESCE((SELECT actor_name FROM app_audit_context WHERE id=1), 'Sin identificar (escritura externa)'),
    (SELECT actor_role FROM app_audit_context WHERE id=1),
    COALESCE((SELECT source FROM app_audit_context WHERE id=1), 'external'),
    'payment', COALESCE(OLD.id, OLD.id), 'payment', OLD.id, 'delete',
    json_object('id', OLD."id", 'organization_id', OLD."organization_id", 'branch_id', OLD."branch_id", 'sale_id', OLD."sale_id", 'appointment_id', OLD."appointment_id", 'payment_method_id', OLD."payment_method_id", 'bank_account_id', OLD."bank_account_id", 'paid_at', OLD."paid_at", 'amount', OLD."amount", 'status', OLD."status", 'reference', OLD."reference", 'receipt_file_url', OLD."receipt_file_url", 'notes', OLD."notes", 'created_by', OLD."created_by", 'created_at', OLD."created_at", 'updated_at', OLD."updated_at"),
    NULL
  );
END;

-- statement-breakpoint

CREATE TRIGGER IF NOT EXISTS app_audit_cash_movement_create AFTER INSERT ON "cash_movement"
BEGIN
  INSERT INTO app_audit_log (request_id, organization_id, branch_id, actor_id, actor_name, actor_role, source, entity_type, entity_id, table_name, record_id, action, before_data, after_data)
  VALUES (
    (SELECT request_id FROM app_audit_context WHERE id=1),
    COALESCE((SELECT organization_id FROM branch WHERE id=NEW.branch_id), (SELECT organization_id FROM app_audit_context WHERE id=1)),
    NEW.branch_id,
    (SELECT actor_id FROM app_audit_context WHERE id=1),
    COALESCE((SELECT actor_name FROM app_audit_context WHERE id=1), 'Sin identificar (escritura externa)'),
    (SELECT actor_role FROM app_audit_context WHERE id=1),
    COALESCE((SELECT source FROM app_audit_context WHERE id=1), 'external'),
    'transaction', COALESCE(NEW.id, NEW.id), 'cash_movement', NEW.id, 'create',
    NULL,
    json_object('id', NEW."id", 'cash_session_id', NEW."cash_session_id", 'branch_id', NEW."branch_id", 'movement_type', NEW."movement_type", 'direction', NEW."direction", 'amount', NEW."amount", 'movement_at', NEW."movement_at", 'sale_id', NEW."sale_id", 'payment_id', NEW."payment_id", 'expense_id', NEW."expense_id", 'staff_payment_id', NEW."staff_payment_id", 'description', NEW."description", 'created_by', NEW."created_by")
  );
END;

-- statement-breakpoint

CREATE TRIGGER IF NOT EXISTS app_audit_cash_movement_update AFTER UPDATE ON "cash_movement"
WHEN json_object('id', OLD."id", 'cash_session_id', OLD."cash_session_id", 'branch_id', OLD."branch_id", 'movement_type', OLD."movement_type", 'direction', OLD."direction", 'amount', OLD."amount", 'movement_at', OLD."movement_at", 'sale_id', OLD."sale_id", 'payment_id', OLD."payment_id", 'expense_id', OLD."expense_id", 'staff_payment_id', OLD."staff_payment_id", 'description', OLD."description", 'created_by', OLD."created_by") IS NOT json_object('id', NEW."id", 'cash_session_id', NEW."cash_session_id", 'branch_id', NEW."branch_id", 'movement_type', NEW."movement_type", 'direction', NEW."direction", 'amount', NEW."amount", 'movement_at', NEW."movement_at", 'sale_id', NEW."sale_id", 'payment_id', NEW."payment_id", 'expense_id', NEW."expense_id", 'staff_payment_id', NEW."staff_payment_id", 'description', NEW."description", 'created_by', NEW."created_by")
BEGIN
  INSERT INTO app_audit_log (request_id, organization_id, branch_id, actor_id, actor_name, actor_role, source, entity_type, entity_id, table_name, record_id, action, before_data, after_data)
  VALUES (
    (SELECT request_id FROM app_audit_context WHERE id=1),
    COALESCE((SELECT organization_id FROM branch WHERE id=NEW.branch_id), (SELECT organization_id FROM app_audit_context WHERE id=1)),
    NEW.branch_id,
    (SELECT actor_id FROM app_audit_context WHERE id=1),
    COALESCE((SELECT actor_name FROM app_audit_context WHERE id=1), 'Sin identificar (escritura externa)'),
    (SELECT actor_role FROM app_audit_context WHERE id=1),
    COALESCE((SELECT source FROM app_audit_context WHERE id=1), 'external'),
    'transaction', COALESCE(NEW.id, NEW.id), 'cash_movement', NEW.id, 'update',
    json_object('id', OLD."id", 'cash_session_id', OLD."cash_session_id", 'branch_id', OLD."branch_id", 'movement_type', OLD."movement_type", 'direction', OLD."direction", 'amount', OLD."amount", 'movement_at', OLD."movement_at", 'sale_id', OLD."sale_id", 'payment_id', OLD."payment_id", 'expense_id', OLD."expense_id", 'staff_payment_id', OLD."staff_payment_id", 'description', OLD."description", 'created_by', OLD."created_by"),
    json_object('id', NEW."id", 'cash_session_id', NEW."cash_session_id", 'branch_id', NEW."branch_id", 'movement_type', NEW."movement_type", 'direction', NEW."direction", 'amount', NEW."amount", 'movement_at', NEW."movement_at", 'sale_id', NEW."sale_id", 'payment_id', NEW."payment_id", 'expense_id', NEW."expense_id", 'staff_payment_id', NEW."staff_payment_id", 'description', NEW."description", 'created_by', NEW."created_by")
  );
END;

-- statement-breakpoint

CREATE TRIGGER IF NOT EXISTS app_audit_cash_movement_delete BEFORE DELETE ON "cash_movement"
BEGIN
  INSERT INTO app_audit_log (request_id, organization_id, branch_id, actor_id, actor_name, actor_role, source, entity_type, entity_id, table_name, record_id, action, before_data, after_data)
  VALUES (
    (SELECT request_id FROM app_audit_context WHERE id=1),
    COALESCE((SELECT organization_id FROM branch WHERE id=OLD.branch_id), (SELECT organization_id FROM app_audit_context WHERE id=1)),
    OLD.branch_id,
    (SELECT actor_id FROM app_audit_context WHERE id=1),
    COALESCE((SELECT actor_name FROM app_audit_context WHERE id=1), 'Sin identificar (escritura externa)'),
    (SELECT actor_role FROM app_audit_context WHERE id=1),
    COALESCE((SELECT source FROM app_audit_context WHERE id=1), 'external'),
    'transaction', COALESCE(OLD.id, OLD.id), 'cash_movement', OLD.id, 'delete',
    json_object('id', OLD."id", 'cash_session_id', OLD."cash_session_id", 'branch_id', OLD."branch_id", 'movement_type', OLD."movement_type", 'direction', OLD."direction", 'amount', OLD."amount", 'movement_at', OLD."movement_at", 'sale_id', OLD."sale_id", 'payment_id', OLD."payment_id", 'expense_id', OLD."expense_id", 'staff_payment_id', OLD."staff_payment_id", 'description', OLD."description", 'created_by', OLD."created_by"),
    NULL
  );
END;

-- statement-breakpoint

CREATE TRIGGER IF NOT EXISTS app_audit_cash_session_create AFTER INSERT ON "cash_session"
BEGIN
  INSERT INTO app_audit_log (request_id, organization_id, branch_id, actor_id, actor_name, actor_role, source, entity_type, entity_id, table_name, record_id, action, before_data, after_data)
  VALUES (
    (SELECT request_id FROM app_audit_context WHERE id=1),
    COALESCE((SELECT b.organization_id FROM cash_register cr JOIN branch b ON b.id=cr.branch_id WHERE cr.id=NEW.cash_register_id), (SELECT organization_id FROM app_audit_context WHERE id=1)),
    (SELECT branch_id FROM cash_register WHERE id=NEW.cash_register_id),
    (SELECT actor_id FROM app_audit_context WHERE id=1),
    COALESCE((SELECT actor_name FROM app_audit_context WHERE id=1), 'Sin identificar (escritura externa)'),
    (SELECT actor_role FROM app_audit_context WHERE id=1),
    COALESCE((SELECT source FROM app_audit_context WHERE id=1), 'external'),
    'transaction', COALESCE(NEW.id, NEW.id), 'cash_session', NEW.id, 'create',
    NULL,
    json_object('id', NEW."id", 'cash_register_id', NEW."cash_register_id", 'opened_by', NEW."opened_by", 'opened_at', NEW."opened_at", 'opening_cash', NEW."opening_cash", 'closed_by', NEW."closed_by", 'closed_at', NEW."closed_at", 'expected_cash', NEW."expected_cash", 'counted_cash', NEW."counted_cash", 'difference', NEW."difference", 'status', NEW."status", 'notes', NEW."notes")
  );
END;

-- statement-breakpoint

CREATE TRIGGER IF NOT EXISTS app_audit_cash_session_update AFTER UPDATE ON "cash_session"
WHEN json_object('id', OLD."id", 'cash_register_id', OLD."cash_register_id", 'opened_by', OLD."opened_by", 'opened_at', OLD."opened_at", 'opening_cash', OLD."opening_cash", 'closed_by', OLD."closed_by", 'closed_at', OLD."closed_at", 'expected_cash', OLD."expected_cash", 'counted_cash', OLD."counted_cash", 'difference', OLD."difference", 'status', OLD."status", 'notes', OLD."notes") IS NOT json_object('id', NEW."id", 'cash_register_id', NEW."cash_register_id", 'opened_by', NEW."opened_by", 'opened_at', NEW."opened_at", 'opening_cash', NEW."opening_cash", 'closed_by', NEW."closed_by", 'closed_at', NEW."closed_at", 'expected_cash', NEW."expected_cash", 'counted_cash', NEW."counted_cash", 'difference', NEW."difference", 'status', NEW."status", 'notes', NEW."notes")
BEGIN
  INSERT INTO app_audit_log (request_id, organization_id, branch_id, actor_id, actor_name, actor_role, source, entity_type, entity_id, table_name, record_id, action, before_data, after_data)
  VALUES (
    (SELECT request_id FROM app_audit_context WHERE id=1),
    COALESCE((SELECT b.organization_id FROM cash_register cr JOIN branch b ON b.id=cr.branch_id WHERE cr.id=NEW.cash_register_id), (SELECT organization_id FROM app_audit_context WHERE id=1)),
    (SELECT branch_id FROM cash_register WHERE id=NEW.cash_register_id),
    (SELECT actor_id FROM app_audit_context WHERE id=1),
    COALESCE((SELECT actor_name FROM app_audit_context WHERE id=1), 'Sin identificar (escritura externa)'),
    (SELECT actor_role FROM app_audit_context WHERE id=1),
    COALESCE((SELECT source FROM app_audit_context WHERE id=1), 'external'),
    'transaction', COALESCE(NEW.id, NEW.id), 'cash_session', NEW.id, 'update',
    json_object('id', OLD."id", 'cash_register_id', OLD."cash_register_id", 'opened_by', OLD."opened_by", 'opened_at', OLD."opened_at", 'opening_cash', OLD."opening_cash", 'closed_by', OLD."closed_by", 'closed_at', OLD."closed_at", 'expected_cash', OLD."expected_cash", 'counted_cash', OLD."counted_cash", 'difference', OLD."difference", 'status', OLD."status", 'notes', OLD."notes"),
    json_object('id', NEW."id", 'cash_register_id', NEW."cash_register_id", 'opened_by', NEW."opened_by", 'opened_at', NEW."opened_at", 'opening_cash', NEW."opening_cash", 'closed_by', NEW."closed_by", 'closed_at', NEW."closed_at", 'expected_cash', NEW."expected_cash", 'counted_cash', NEW."counted_cash", 'difference', NEW."difference", 'status', NEW."status", 'notes', NEW."notes")
  );
END;

-- statement-breakpoint

CREATE TRIGGER IF NOT EXISTS app_audit_cash_session_delete BEFORE DELETE ON "cash_session"
BEGIN
  INSERT INTO app_audit_log (request_id, organization_id, branch_id, actor_id, actor_name, actor_role, source, entity_type, entity_id, table_name, record_id, action, before_data, after_data)
  VALUES (
    (SELECT request_id FROM app_audit_context WHERE id=1),
    COALESCE((SELECT b.organization_id FROM cash_register cr JOIN branch b ON b.id=cr.branch_id WHERE cr.id=OLD.cash_register_id), (SELECT organization_id FROM app_audit_context WHERE id=1)),
    (SELECT branch_id FROM cash_register WHERE id=OLD.cash_register_id),
    (SELECT actor_id FROM app_audit_context WHERE id=1),
    COALESCE((SELECT actor_name FROM app_audit_context WHERE id=1), 'Sin identificar (escritura externa)'),
    (SELECT actor_role FROM app_audit_context WHERE id=1),
    COALESCE((SELECT source FROM app_audit_context WHERE id=1), 'external'),
    'transaction', COALESCE(OLD.id, OLD.id), 'cash_session', OLD.id, 'delete',
    json_object('id', OLD."id", 'cash_register_id', OLD."cash_register_id", 'opened_by', OLD."opened_by", 'opened_at', OLD."opened_at", 'opening_cash', OLD."opening_cash", 'closed_by', OLD."closed_by", 'closed_at', OLD."closed_at", 'expected_cash', OLD."expected_cash", 'counted_cash', OLD."counted_cash", 'difference', OLD."difference", 'status', OLD."status", 'notes', OLD."notes"),
    NULL
  );
END;

-- statement-breakpoint

CREATE TRIGGER IF NOT EXISTS app_audit_expense_create AFTER INSERT ON "expense"
BEGIN
  INSERT INTO app_audit_log (request_id, organization_id, branch_id, actor_id, actor_name, actor_role, source, entity_type, entity_id, table_name, record_id, action, before_data, after_data)
  VALUES (
    (SELECT request_id FROM app_audit_context WHERE id=1),
    COALESCE(NEW.organization_id, (SELECT organization_id FROM app_audit_context WHERE id=1)),
    NEW.branch_id,
    (SELECT actor_id FROM app_audit_context WHERE id=1),
    COALESCE((SELECT actor_name FROM app_audit_context WHERE id=1), 'Sin identificar (escritura externa)'),
    (SELECT actor_role FROM app_audit_context WHERE id=1),
    COALESCE((SELECT source FROM app_audit_context WHERE id=1), 'external'),
    'transaction', COALESCE(NEW.id, NEW.id), 'expense', NEW.id, 'create',
    NULL,
    json_object('id', NEW."id", 'organization_id', NEW."organization_id", 'branch_id', NEW."branch_id", 'expense_category_id', NEW."expense_category_id", 'payment_method_id', NEW."payment_method_id", 'bank_account_id', NEW."bank_account_id", 'expense_date', NEW."expense_date", 'description', NEW."description", 'amount', NEW."amount", 'vendor_name', NEW."vendor_name", 'receipt_number', NEW."receipt_number", 'receipt_file_url', NEW."receipt_file_url", 'status', NEW."status", 'created_by', NEW."created_by", 'created_at', NEW."created_at", 'updated_at', NEW."updated_at")
  );
END;

-- statement-breakpoint

CREATE TRIGGER IF NOT EXISTS app_audit_expense_update AFTER UPDATE ON "expense"
WHEN json_object('id', OLD."id", 'organization_id', OLD."organization_id", 'branch_id', OLD."branch_id", 'expense_category_id', OLD."expense_category_id", 'payment_method_id', OLD."payment_method_id", 'bank_account_id', OLD."bank_account_id", 'expense_date', OLD."expense_date", 'description', OLD."description", 'amount', OLD."amount", 'vendor_name', OLD."vendor_name", 'receipt_number', OLD."receipt_number", 'receipt_file_url', OLD."receipt_file_url", 'status', OLD."status", 'created_by', OLD."created_by", 'created_at', OLD."created_at", 'updated_at', OLD."updated_at") IS NOT json_object('id', NEW."id", 'organization_id', NEW."organization_id", 'branch_id', NEW."branch_id", 'expense_category_id', NEW."expense_category_id", 'payment_method_id', NEW."payment_method_id", 'bank_account_id', NEW."bank_account_id", 'expense_date', NEW."expense_date", 'description', NEW."description", 'amount', NEW."amount", 'vendor_name', NEW."vendor_name", 'receipt_number', NEW."receipt_number", 'receipt_file_url', NEW."receipt_file_url", 'status', NEW."status", 'created_by', NEW."created_by", 'created_at', NEW."created_at", 'updated_at', NEW."updated_at")
BEGIN
  INSERT INTO app_audit_log (request_id, organization_id, branch_id, actor_id, actor_name, actor_role, source, entity_type, entity_id, table_name, record_id, action, before_data, after_data)
  VALUES (
    (SELECT request_id FROM app_audit_context WHERE id=1),
    COALESCE(NEW.organization_id, (SELECT organization_id FROM app_audit_context WHERE id=1)),
    NEW.branch_id,
    (SELECT actor_id FROM app_audit_context WHERE id=1),
    COALESCE((SELECT actor_name FROM app_audit_context WHERE id=1), 'Sin identificar (escritura externa)'),
    (SELECT actor_role FROM app_audit_context WHERE id=1),
    COALESCE((SELECT source FROM app_audit_context WHERE id=1), 'external'),
    'transaction', COALESCE(NEW.id, NEW.id), 'expense', NEW.id, 'update',
    json_object('id', OLD."id", 'organization_id', OLD."organization_id", 'branch_id', OLD."branch_id", 'expense_category_id', OLD."expense_category_id", 'payment_method_id', OLD."payment_method_id", 'bank_account_id', OLD."bank_account_id", 'expense_date', OLD."expense_date", 'description', OLD."description", 'amount', OLD."amount", 'vendor_name', OLD."vendor_name", 'receipt_number', OLD."receipt_number", 'receipt_file_url', OLD."receipt_file_url", 'status', OLD."status", 'created_by', OLD."created_by", 'created_at', OLD."created_at", 'updated_at', OLD."updated_at"),
    json_object('id', NEW."id", 'organization_id', NEW."organization_id", 'branch_id', NEW."branch_id", 'expense_category_id', NEW."expense_category_id", 'payment_method_id', NEW."payment_method_id", 'bank_account_id', NEW."bank_account_id", 'expense_date', NEW."expense_date", 'description', NEW."description", 'amount', NEW."amount", 'vendor_name', NEW."vendor_name", 'receipt_number', NEW."receipt_number", 'receipt_file_url', NEW."receipt_file_url", 'status', NEW."status", 'created_by', NEW."created_by", 'created_at', NEW."created_at", 'updated_at', NEW."updated_at")
  );
END;

-- statement-breakpoint

CREATE TRIGGER IF NOT EXISTS app_audit_expense_delete BEFORE DELETE ON "expense"
BEGIN
  INSERT INTO app_audit_log (request_id, organization_id, branch_id, actor_id, actor_name, actor_role, source, entity_type, entity_id, table_name, record_id, action, before_data, after_data)
  VALUES (
    (SELECT request_id FROM app_audit_context WHERE id=1),
    COALESCE(OLD.organization_id, (SELECT organization_id FROM app_audit_context WHERE id=1)),
    OLD.branch_id,
    (SELECT actor_id FROM app_audit_context WHERE id=1),
    COALESCE((SELECT actor_name FROM app_audit_context WHERE id=1), 'Sin identificar (escritura externa)'),
    (SELECT actor_role FROM app_audit_context WHERE id=1),
    COALESCE((SELECT source FROM app_audit_context WHERE id=1), 'external'),
    'transaction', COALESCE(OLD.id, OLD.id), 'expense', OLD.id, 'delete',
    json_object('id', OLD."id", 'organization_id', OLD."organization_id", 'branch_id', OLD."branch_id", 'expense_category_id', OLD."expense_category_id", 'payment_method_id', OLD."payment_method_id", 'bank_account_id', OLD."bank_account_id", 'expense_date', OLD."expense_date", 'description', OLD."description", 'amount', OLD."amount", 'vendor_name', OLD."vendor_name", 'receipt_number', OLD."receipt_number", 'receipt_file_url', OLD."receipt_file_url", 'status', OLD."status", 'created_by', OLD."created_by", 'created_at', OLD."created_at", 'updated_at', OLD."updated_at"),
    NULL
  );
END;

-- statement-breakpoint

CREATE TRIGGER IF NOT EXISTS app_audit_account_transfer_create AFTER INSERT ON "account_transfer"
BEGIN
  INSERT INTO app_audit_log (request_id, organization_id, branch_id, actor_id, actor_name, actor_role, source, entity_type, entity_id, table_name, record_id, action, before_data, after_data)
  VALUES (
    (SELECT request_id FROM app_audit_context WHERE id=1),
    COALESCE(NEW.organization_id, (SELECT organization_id FROM app_audit_context WHERE id=1)),
    NEW.branch_id,
    (SELECT actor_id FROM app_audit_context WHERE id=1),
    COALESCE((SELECT actor_name FROM app_audit_context WHERE id=1), 'Sin identificar (escritura externa)'),
    (SELECT actor_role FROM app_audit_context WHERE id=1),
    COALESCE((SELECT source FROM app_audit_context WHERE id=1), 'external'),
    'transaction', COALESCE(NEW.id, NEW.id), 'account_transfer', NEW.id, 'create',
    NULL,
    json_object('id', NEW."id", 'organization_id', NEW."organization_id", 'branch_id', NEW."branch_id", 'transfer_date', NEW."transfer_date", 'amount', NEW."amount", 'from_kind', NEW."from_kind", 'from_bank_account_id', NEW."from_bank_account_id", 'to_kind', NEW."to_kind", 'to_bank_account_id', NEW."to_bank_account_id", 'cash_session_id', NEW."cash_session_id", 'description', NEW."description", 'created_by', NEW."created_by", 'created_at', NEW."created_at")
  );
END;

-- statement-breakpoint

CREATE TRIGGER IF NOT EXISTS app_audit_account_transfer_update AFTER UPDATE ON "account_transfer"
WHEN json_object('id', OLD."id", 'organization_id', OLD."organization_id", 'branch_id', OLD."branch_id", 'transfer_date', OLD."transfer_date", 'amount', OLD."amount", 'from_kind', OLD."from_kind", 'from_bank_account_id', OLD."from_bank_account_id", 'to_kind', OLD."to_kind", 'to_bank_account_id', OLD."to_bank_account_id", 'cash_session_id', OLD."cash_session_id", 'description', OLD."description", 'created_by', OLD."created_by", 'created_at', OLD."created_at") IS NOT json_object('id', NEW."id", 'organization_id', NEW."organization_id", 'branch_id', NEW."branch_id", 'transfer_date', NEW."transfer_date", 'amount', NEW."amount", 'from_kind', NEW."from_kind", 'from_bank_account_id', NEW."from_bank_account_id", 'to_kind', NEW."to_kind", 'to_bank_account_id', NEW."to_bank_account_id", 'cash_session_id', NEW."cash_session_id", 'description', NEW."description", 'created_by', NEW."created_by", 'created_at', NEW."created_at")
BEGIN
  INSERT INTO app_audit_log (request_id, organization_id, branch_id, actor_id, actor_name, actor_role, source, entity_type, entity_id, table_name, record_id, action, before_data, after_data)
  VALUES (
    (SELECT request_id FROM app_audit_context WHERE id=1),
    COALESCE(NEW.organization_id, (SELECT organization_id FROM app_audit_context WHERE id=1)),
    NEW.branch_id,
    (SELECT actor_id FROM app_audit_context WHERE id=1),
    COALESCE((SELECT actor_name FROM app_audit_context WHERE id=1), 'Sin identificar (escritura externa)'),
    (SELECT actor_role FROM app_audit_context WHERE id=1),
    COALESCE((SELECT source FROM app_audit_context WHERE id=1), 'external'),
    'transaction', COALESCE(NEW.id, NEW.id), 'account_transfer', NEW.id, 'update',
    json_object('id', OLD."id", 'organization_id', OLD."organization_id", 'branch_id', OLD."branch_id", 'transfer_date', OLD."transfer_date", 'amount', OLD."amount", 'from_kind', OLD."from_kind", 'from_bank_account_id', OLD."from_bank_account_id", 'to_kind', OLD."to_kind", 'to_bank_account_id', OLD."to_bank_account_id", 'cash_session_id', OLD."cash_session_id", 'description', OLD."description", 'created_by', OLD."created_by", 'created_at', OLD."created_at"),
    json_object('id', NEW."id", 'organization_id', NEW."organization_id", 'branch_id', NEW."branch_id", 'transfer_date', NEW."transfer_date", 'amount', NEW."amount", 'from_kind', NEW."from_kind", 'from_bank_account_id', NEW."from_bank_account_id", 'to_kind', NEW."to_kind", 'to_bank_account_id', NEW."to_bank_account_id", 'cash_session_id', NEW."cash_session_id", 'description', NEW."description", 'created_by', NEW."created_by", 'created_at', NEW."created_at")
  );
END;

-- statement-breakpoint

CREATE TRIGGER IF NOT EXISTS app_audit_account_transfer_delete BEFORE DELETE ON "account_transfer"
BEGIN
  INSERT INTO app_audit_log (request_id, organization_id, branch_id, actor_id, actor_name, actor_role, source, entity_type, entity_id, table_name, record_id, action, before_data, after_data)
  VALUES (
    (SELECT request_id FROM app_audit_context WHERE id=1),
    COALESCE(OLD.organization_id, (SELECT organization_id FROM app_audit_context WHERE id=1)),
    OLD.branch_id,
    (SELECT actor_id FROM app_audit_context WHERE id=1),
    COALESCE((SELECT actor_name FROM app_audit_context WHERE id=1), 'Sin identificar (escritura externa)'),
    (SELECT actor_role FROM app_audit_context WHERE id=1),
    COALESCE((SELECT source FROM app_audit_context WHERE id=1), 'external'),
    'transaction', COALESCE(OLD.id, OLD.id), 'account_transfer', OLD.id, 'delete',
    json_object('id', OLD."id", 'organization_id', OLD."organization_id", 'branch_id', OLD."branch_id", 'transfer_date', OLD."transfer_date", 'amount', OLD."amount", 'from_kind', OLD."from_kind", 'from_bank_account_id', OLD."from_bank_account_id", 'to_kind', OLD."to_kind", 'to_bank_account_id', OLD."to_bank_account_id", 'cash_session_id', OLD."cash_session_id", 'description', OLD."description", 'created_by', OLD."created_by", 'created_at', OLD."created_at"),
    NULL
  );
END;

-- statement-breakpoint

CREATE TRIGGER IF NOT EXISTS app_audit_debt_credit_create AFTER INSERT ON "debt_credit"
BEGIN
  INSERT INTO app_audit_log (request_id, organization_id, branch_id, actor_id, actor_name, actor_role, source, entity_type, entity_id, table_name, record_id, action, before_data, after_data)
  VALUES (
    (SELECT request_id FROM app_audit_context WHERE id=1),
    COALESCE(NEW.organization_id, (SELECT organization_id FROM app_audit_context WHERE id=1)),
    NEW.branch_id,
    (SELECT actor_id FROM app_audit_context WHERE id=1),
    COALESCE((SELECT actor_name FROM app_audit_context WHERE id=1), 'Sin identificar (escritura externa)'),
    (SELECT actor_role FROM app_audit_context WHERE id=1),
    COALESCE((SELECT source FROM app_audit_context WHERE id=1), 'external'),
    'transaction', COALESCE(NEW.id, NEW.id), 'debt_credit', NEW.id, 'create',
    NULL,
    json_object('id', NEW."id", 'organization_id', NEW."organization_id", 'branch_id', NEW."branch_id", 'kind', NEW."kind", 'counterparty', NEW."counterparty", 'description', NEW."description", 'amount', NEW."amount", 'paid_amount', NEW."paid_amount", 'due_date', NEW."due_date", 'status', NEW."status", 'created_by', NEW."created_by", 'created_at', NEW."created_at", 'updated_at', NEW."updated_at")
  );
END;

-- statement-breakpoint

CREATE TRIGGER IF NOT EXISTS app_audit_debt_credit_update AFTER UPDATE ON "debt_credit"
WHEN json_object('id', OLD."id", 'organization_id', OLD."organization_id", 'branch_id', OLD."branch_id", 'kind', OLD."kind", 'counterparty', OLD."counterparty", 'description', OLD."description", 'amount', OLD."amount", 'paid_amount', OLD."paid_amount", 'due_date', OLD."due_date", 'status', OLD."status", 'created_by', OLD."created_by", 'created_at', OLD."created_at", 'updated_at', OLD."updated_at") IS NOT json_object('id', NEW."id", 'organization_id', NEW."organization_id", 'branch_id', NEW."branch_id", 'kind', NEW."kind", 'counterparty', NEW."counterparty", 'description', NEW."description", 'amount', NEW."amount", 'paid_amount', NEW."paid_amount", 'due_date', NEW."due_date", 'status', NEW."status", 'created_by', NEW."created_by", 'created_at', NEW."created_at", 'updated_at', NEW."updated_at")
BEGIN
  INSERT INTO app_audit_log (request_id, organization_id, branch_id, actor_id, actor_name, actor_role, source, entity_type, entity_id, table_name, record_id, action, before_data, after_data)
  VALUES (
    (SELECT request_id FROM app_audit_context WHERE id=1),
    COALESCE(NEW.organization_id, (SELECT organization_id FROM app_audit_context WHERE id=1)),
    NEW.branch_id,
    (SELECT actor_id FROM app_audit_context WHERE id=1),
    COALESCE((SELECT actor_name FROM app_audit_context WHERE id=1), 'Sin identificar (escritura externa)'),
    (SELECT actor_role FROM app_audit_context WHERE id=1),
    COALESCE((SELECT source FROM app_audit_context WHERE id=1), 'external'),
    'transaction', COALESCE(NEW.id, NEW.id), 'debt_credit', NEW.id, 'update',
    json_object('id', OLD."id", 'organization_id', OLD."organization_id", 'branch_id', OLD."branch_id", 'kind', OLD."kind", 'counterparty', OLD."counterparty", 'description', OLD."description", 'amount', OLD."amount", 'paid_amount', OLD."paid_amount", 'due_date', OLD."due_date", 'status', OLD."status", 'created_by', OLD."created_by", 'created_at', OLD."created_at", 'updated_at', OLD."updated_at"),
    json_object('id', NEW."id", 'organization_id', NEW."organization_id", 'branch_id', NEW."branch_id", 'kind', NEW."kind", 'counterparty', NEW."counterparty", 'description', NEW."description", 'amount', NEW."amount", 'paid_amount', NEW."paid_amount", 'due_date', NEW."due_date", 'status', NEW."status", 'created_by', NEW."created_by", 'created_at', NEW."created_at", 'updated_at', NEW."updated_at")
  );
END;

-- statement-breakpoint

CREATE TRIGGER IF NOT EXISTS app_audit_debt_credit_delete BEFORE DELETE ON "debt_credit"
BEGIN
  INSERT INTO app_audit_log (request_id, organization_id, branch_id, actor_id, actor_name, actor_role, source, entity_type, entity_id, table_name, record_id, action, before_data, after_data)
  VALUES (
    (SELECT request_id FROM app_audit_context WHERE id=1),
    COALESCE(OLD.organization_id, (SELECT organization_id FROM app_audit_context WHERE id=1)),
    OLD.branch_id,
    (SELECT actor_id FROM app_audit_context WHERE id=1),
    COALESCE((SELECT actor_name FROM app_audit_context WHERE id=1), 'Sin identificar (escritura externa)'),
    (SELECT actor_role FROM app_audit_context WHERE id=1),
    COALESCE((SELECT source FROM app_audit_context WHERE id=1), 'external'),
    'transaction', COALESCE(OLD.id, OLD.id), 'debt_credit', OLD.id, 'delete',
    json_object('id', OLD."id", 'organization_id', OLD."organization_id", 'branch_id', OLD."branch_id", 'kind', OLD."kind", 'counterparty', OLD."counterparty", 'description', OLD."description", 'amount', OLD."amount", 'paid_amount', OLD."paid_amount", 'due_date', OLD."due_date", 'status', OLD."status", 'created_by', OLD."created_by", 'created_at', OLD."created_at", 'updated_at', OLD."updated_at"),
    NULL
  );
END;

-- statement-breakpoint

CREATE TRIGGER IF NOT EXISTS app_audit_staff_payment_create AFTER INSERT ON "staff_payment"
BEGIN
  INSERT INTO app_audit_log (request_id, organization_id, branch_id, actor_id, actor_name, actor_role, source, entity_type, entity_id, table_name, record_id, action, before_data, after_data)
  VALUES (
    (SELECT request_id FROM app_audit_context WHERE id=1),
    COALESCE(NEW.organization_id, (SELECT organization_id FROM app_audit_context WHERE id=1)),
    NEW.branch_id,
    (SELECT actor_id FROM app_audit_context WHERE id=1),
    COALESCE((SELECT actor_name FROM app_audit_context WHERE id=1), 'Sin identificar (escritura externa)'),
    (SELECT actor_role FROM app_audit_context WHERE id=1),
    COALESCE((SELECT source FROM app_audit_context WHERE id=1), 'external'),
    'transaction', COALESCE(NEW.id, NEW.id), 'staff_payment', NEW.id, 'create',
    NULL,
    json_object('id', NEW."id", 'organization_id', NEW."organization_id", 'branch_id', NEW."branch_id", 'staff_member_id', NEW."staff_member_id", 'pay_period_id', NEW."pay_period_id", 'paid_at', NEW."paid_at", 'gross_commission', NEW."gross_commission", 'advances_discount', NEW."advances_discount", 'other_deductions', NEW."other_deductions", 'net_paid', NEW."net_paid", 'payment_method_id', NEW."payment_method_id", 'bank_account_id', NEW."bank_account_id", 'cash_session_id', NEW."cash_session_id", 'status', NEW."status", 'reference', NEW."reference", 'notes', NEW."notes", 'created_by', NEW."created_by", 'created_at', NEW."created_at")
  );
END;

-- statement-breakpoint

CREATE TRIGGER IF NOT EXISTS app_audit_staff_payment_update AFTER UPDATE ON "staff_payment"
WHEN json_object('id', OLD."id", 'organization_id', OLD."organization_id", 'branch_id', OLD."branch_id", 'staff_member_id', OLD."staff_member_id", 'pay_period_id', OLD."pay_period_id", 'paid_at', OLD."paid_at", 'gross_commission', OLD."gross_commission", 'advances_discount', OLD."advances_discount", 'other_deductions', OLD."other_deductions", 'net_paid', OLD."net_paid", 'payment_method_id', OLD."payment_method_id", 'bank_account_id', OLD."bank_account_id", 'cash_session_id', OLD."cash_session_id", 'status', OLD."status", 'reference', OLD."reference", 'notes', OLD."notes", 'created_by', OLD."created_by", 'created_at', OLD."created_at") IS NOT json_object('id', NEW."id", 'organization_id', NEW."organization_id", 'branch_id', NEW."branch_id", 'staff_member_id', NEW."staff_member_id", 'pay_period_id', NEW."pay_period_id", 'paid_at', NEW."paid_at", 'gross_commission', NEW."gross_commission", 'advances_discount', NEW."advances_discount", 'other_deductions', NEW."other_deductions", 'net_paid', NEW."net_paid", 'payment_method_id', NEW."payment_method_id", 'bank_account_id', NEW."bank_account_id", 'cash_session_id', NEW."cash_session_id", 'status', NEW."status", 'reference', NEW."reference", 'notes', NEW."notes", 'created_by', NEW."created_by", 'created_at', NEW."created_at")
BEGIN
  INSERT INTO app_audit_log (request_id, organization_id, branch_id, actor_id, actor_name, actor_role, source, entity_type, entity_id, table_name, record_id, action, before_data, after_data)
  VALUES (
    (SELECT request_id FROM app_audit_context WHERE id=1),
    COALESCE(NEW.organization_id, (SELECT organization_id FROM app_audit_context WHERE id=1)),
    NEW.branch_id,
    (SELECT actor_id FROM app_audit_context WHERE id=1),
    COALESCE((SELECT actor_name FROM app_audit_context WHERE id=1), 'Sin identificar (escritura externa)'),
    (SELECT actor_role FROM app_audit_context WHERE id=1),
    COALESCE((SELECT source FROM app_audit_context WHERE id=1), 'external'),
    'transaction', COALESCE(NEW.id, NEW.id), 'staff_payment', NEW.id, 'update',
    json_object('id', OLD."id", 'organization_id', OLD."organization_id", 'branch_id', OLD."branch_id", 'staff_member_id', OLD."staff_member_id", 'pay_period_id', OLD."pay_period_id", 'paid_at', OLD."paid_at", 'gross_commission', OLD."gross_commission", 'advances_discount', OLD."advances_discount", 'other_deductions', OLD."other_deductions", 'net_paid', OLD."net_paid", 'payment_method_id', OLD."payment_method_id", 'bank_account_id', OLD."bank_account_id", 'cash_session_id', OLD."cash_session_id", 'status', OLD."status", 'reference', OLD."reference", 'notes', OLD."notes", 'created_by', OLD."created_by", 'created_at', OLD."created_at"),
    json_object('id', NEW."id", 'organization_id', NEW."organization_id", 'branch_id', NEW."branch_id", 'staff_member_id', NEW."staff_member_id", 'pay_period_id', NEW."pay_period_id", 'paid_at', NEW."paid_at", 'gross_commission', NEW."gross_commission", 'advances_discount', NEW."advances_discount", 'other_deductions', NEW."other_deductions", 'net_paid', NEW."net_paid", 'payment_method_id', NEW."payment_method_id", 'bank_account_id', NEW."bank_account_id", 'cash_session_id', NEW."cash_session_id", 'status', NEW."status", 'reference', NEW."reference", 'notes', NEW."notes", 'created_by', NEW."created_by", 'created_at', NEW."created_at")
  );
END;

-- statement-breakpoint

CREATE TRIGGER IF NOT EXISTS app_audit_staff_payment_delete BEFORE DELETE ON "staff_payment"
BEGIN
  INSERT INTO app_audit_log (request_id, organization_id, branch_id, actor_id, actor_name, actor_role, source, entity_type, entity_id, table_name, record_id, action, before_data, after_data)
  VALUES (
    (SELECT request_id FROM app_audit_context WHERE id=1),
    COALESCE(OLD.organization_id, (SELECT organization_id FROM app_audit_context WHERE id=1)),
    OLD.branch_id,
    (SELECT actor_id FROM app_audit_context WHERE id=1),
    COALESCE((SELECT actor_name FROM app_audit_context WHERE id=1), 'Sin identificar (escritura externa)'),
    (SELECT actor_role FROM app_audit_context WHERE id=1),
    COALESCE((SELECT source FROM app_audit_context WHERE id=1), 'external'),
    'transaction', COALESCE(OLD.id, OLD.id), 'staff_payment', OLD.id, 'delete',
    json_object('id', OLD."id", 'organization_id', OLD."organization_id", 'branch_id', OLD."branch_id", 'staff_member_id', OLD."staff_member_id", 'pay_period_id', OLD."pay_period_id", 'paid_at', OLD."paid_at", 'gross_commission', OLD."gross_commission", 'advances_discount', OLD."advances_discount", 'other_deductions', OLD."other_deductions", 'net_paid', OLD."net_paid", 'payment_method_id', OLD."payment_method_id", 'bank_account_id', OLD."bank_account_id", 'cash_session_id', OLD."cash_session_id", 'status', OLD."status", 'reference', OLD."reference", 'notes', OLD."notes", 'created_by', OLD."created_by", 'created_at', OLD."created_at"),
    NULL
  );
END;

-- statement-breakpoint

CREATE TRIGGER IF NOT EXISTS app_audit_staff_advance_create AFTER INSERT ON "staff_advance"
BEGIN
  INSERT INTO app_audit_log (request_id, organization_id, branch_id, actor_id, actor_name, actor_role, source, entity_type, entity_id, table_name, record_id, action, before_data, after_data)
  VALUES (
    (SELECT request_id FROM app_audit_context WHERE id=1),
    COALESCE(NEW.organization_id, (SELECT organization_id FROM app_audit_context WHERE id=1)),
    NEW.branch_id,
    (SELECT actor_id FROM app_audit_context WHERE id=1),
    COALESCE((SELECT actor_name FROM app_audit_context WHERE id=1), 'Sin identificar (escritura externa)'),
    (SELECT actor_role FROM app_audit_context WHERE id=1),
    COALESCE((SELECT source FROM app_audit_context WHERE id=1), 'external'),
    'transaction', COALESCE(NEW.id, NEW.id), 'staff_advance', NEW.id, 'create',
    NULL,
    json_object('id', NEW."id", 'organization_id', NEW."organization_id", 'branch_id', NEW."branch_id", 'staff_member_id', NEW."staff_member_id", 'advance_date', NEW."advance_date", 'amount', NEW."amount", 'payment_method_id', NEW."payment_method_id", 'bank_account_id', NEW."bank_account_id", 'cash_session_id', NEW."cash_session_id", 'notes', NEW."notes", 'status', NEW."status", 'created_by', NEW."created_by", 'created_at', NEW."created_at")
  );
END;

-- statement-breakpoint

CREATE TRIGGER IF NOT EXISTS app_audit_staff_advance_update AFTER UPDATE ON "staff_advance"
WHEN json_object('id', OLD."id", 'organization_id', OLD."organization_id", 'branch_id', OLD."branch_id", 'staff_member_id', OLD."staff_member_id", 'advance_date', OLD."advance_date", 'amount', OLD."amount", 'payment_method_id', OLD."payment_method_id", 'bank_account_id', OLD."bank_account_id", 'cash_session_id', OLD."cash_session_id", 'notes', OLD."notes", 'status', OLD."status", 'created_by', OLD."created_by", 'created_at', OLD."created_at") IS NOT json_object('id', NEW."id", 'organization_id', NEW."organization_id", 'branch_id', NEW."branch_id", 'staff_member_id', NEW."staff_member_id", 'advance_date', NEW."advance_date", 'amount', NEW."amount", 'payment_method_id', NEW."payment_method_id", 'bank_account_id', NEW."bank_account_id", 'cash_session_id', NEW."cash_session_id", 'notes', NEW."notes", 'status', NEW."status", 'created_by', NEW."created_by", 'created_at', NEW."created_at")
BEGIN
  INSERT INTO app_audit_log (request_id, organization_id, branch_id, actor_id, actor_name, actor_role, source, entity_type, entity_id, table_name, record_id, action, before_data, after_data)
  VALUES (
    (SELECT request_id FROM app_audit_context WHERE id=1),
    COALESCE(NEW.organization_id, (SELECT organization_id FROM app_audit_context WHERE id=1)),
    NEW.branch_id,
    (SELECT actor_id FROM app_audit_context WHERE id=1),
    COALESCE((SELECT actor_name FROM app_audit_context WHERE id=1), 'Sin identificar (escritura externa)'),
    (SELECT actor_role FROM app_audit_context WHERE id=1),
    COALESCE((SELECT source FROM app_audit_context WHERE id=1), 'external'),
    'transaction', COALESCE(NEW.id, NEW.id), 'staff_advance', NEW.id, 'update',
    json_object('id', OLD."id", 'organization_id', OLD."organization_id", 'branch_id', OLD."branch_id", 'staff_member_id', OLD."staff_member_id", 'advance_date', OLD."advance_date", 'amount', OLD."amount", 'payment_method_id', OLD."payment_method_id", 'bank_account_id', OLD."bank_account_id", 'cash_session_id', OLD."cash_session_id", 'notes', OLD."notes", 'status', OLD."status", 'created_by', OLD."created_by", 'created_at', OLD."created_at"),
    json_object('id', NEW."id", 'organization_id', NEW."organization_id", 'branch_id', NEW."branch_id", 'staff_member_id', NEW."staff_member_id", 'advance_date', NEW."advance_date", 'amount', NEW."amount", 'payment_method_id', NEW."payment_method_id", 'bank_account_id', NEW."bank_account_id", 'cash_session_id', NEW."cash_session_id", 'notes', NEW."notes", 'status', NEW."status", 'created_by', NEW."created_by", 'created_at', NEW."created_at")
  );
END;

-- statement-breakpoint

CREATE TRIGGER IF NOT EXISTS app_audit_staff_advance_delete BEFORE DELETE ON "staff_advance"
BEGIN
  INSERT INTO app_audit_log (request_id, organization_id, branch_id, actor_id, actor_name, actor_role, source, entity_type, entity_id, table_name, record_id, action, before_data, after_data)
  VALUES (
    (SELECT request_id FROM app_audit_context WHERE id=1),
    COALESCE(OLD.organization_id, (SELECT organization_id FROM app_audit_context WHERE id=1)),
    OLD.branch_id,
    (SELECT actor_id FROM app_audit_context WHERE id=1),
    COALESCE((SELECT actor_name FROM app_audit_context WHERE id=1), 'Sin identificar (escritura externa)'),
    (SELECT actor_role FROM app_audit_context WHERE id=1),
    COALESCE((SELECT source FROM app_audit_context WHERE id=1), 'external'),
    'transaction', COALESCE(OLD.id, OLD.id), 'staff_advance', OLD.id, 'delete',
    json_object('id', OLD."id", 'organization_id', OLD."organization_id", 'branch_id', OLD."branch_id", 'staff_member_id', OLD."staff_member_id", 'advance_date', OLD."advance_date", 'amount', OLD."amount", 'payment_method_id', OLD."payment_method_id", 'bank_account_id', OLD."bank_account_id", 'cash_session_id', OLD."cash_session_id", 'notes', OLD."notes", 'status', OLD."status", 'created_by', OLD."created_by", 'created_at', OLD."created_at"),
    NULL
  );
END;

-- statement-breakpoint

CREATE TRIGGER IF NOT EXISTS app_audit_customer_create AFTER INSERT ON "customer"
BEGIN
  INSERT INTO app_audit_log (request_id, organization_id, branch_id, actor_id, actor_name, actor_role, source, entity_type, entity_id, table_name, record_id, action, before_data, after_data)
  VALUES (
    (SELECT request_id FROM app_audit_context WHERE id=1),
    COALESCE(NEW.organization_id, (SELECT organization_id FROM app_audit_context WHERE id=1)),
    NULL,
    (SELECT actor_id FROM app_audit_context WHERE id=1),
    COALESCE((SELECT actor_name FROM app_audit_context WHERE id=1), 'Sin identificar (escritura externa)'),
    (SELECT actor_role FROM app_audit_context WHERE id=1),
    COALESCE((SELECT source FROM app_audit_context WHERE id=1), 'external'),
    'customer', COALESCE(NEW.id, NEW.id), 'customer', NEW.id, 'create',
    NULL,
    json_object('id', NEW."id", 'organization_id', NEW."organization_id", 'first_name', NEW."first_name", 'last_name', NEW."last_name", 'phone', NEW."phone", 'email', NEW."email", 'birth_date', NEW."birth_date", 'notes', NEW."notes", 'preferred_staff_id', NEW."preferred_staff_id", 'first_visit_at', NEW."first_visit_at", 'last_visit_at', NEW."last_visit_at", 'active', NEW."active", 'created_at', NEW."created_at", 'updated_at', NEW."updated_at", 'allergies', NEW."allergies", 'hair_notes', NEW."hair_notes", 'nickname', NEW."nickname", 'imported_name', NEW."imported_name", 'tax_id', NEW."tax_id", 'deposit_exempt', NEW."deposit_exempt")
  );
END;

-- statement-breakpoint

CREATE TRIGGER IF NOT EXISTS app_audit_customer_update AFTER UPDATE ON "customer"
WHEN json_object('id', OLD."id", 'organization_id', OLD."organization_id", 'first_name', OLD."first_name", 'last_name', OLD."last_name", 'phone', OLD."phone", 'email', OLD."email", 'birth_date', OLD."birth_date", 'notes', OLD."notes", 'preferred_staff_id', OLD."preferred_staff_id", 'first_visit_at', OLD."first_visit_at", 'last_visit_at', OLD."last_visit_at", 'active', OLD."active", 'created_at', OLD."created_at", 'updated_at', OLD."updated_at", 'allergies', OLD."allergies", 'hair_notes', OLD."hair_notes", 'nickname', OLD."nickname", 'imported_name', OLD."imported_name", 'tax_id', OLD."tax_id", 'deposit_exempt', OLD."deposit_exempt") IS NOT json_object('id', NEW."id", 'organization_id', NEW."organization_id", 'first_name', NEW."first_name", 'last_name', NEW."last_name", 'phone', NEW."phone", 'email', NEW."email", 'birth_date', NEW."birth_date", 'notes', NEW."notes", 'preferred_staff_id', NEW."preferred_staff_id", 'first_visit_at', NEW."first_visit_at", 'last_visit_at', NEW."last_visit_at", 'active', NEW."active", 'created_at', NEW."created_at", 'updated_at', NEW."updated_at", 'allergies', NEW."allergies", 'hair_notes', NEW."hair_notes", 'nickname', NEW."nickname", 'imported_name', NEW."imported_name", 'tax_id', NEW."tax_id", 'deposit_exempt', NEW."deposit_exempt")
BEGIN
  INSERT INTO app_audit_log (request_id, organization_id, branch_id, actor_id, actor_name, actor_role, source, entity_type, entity_id, table_name, record_id, action, before_data, after_data)
  VALUES (
    (SELECT request_id FROM app_audit_context WHERE id=1),
    COALESCE(NEW.organization_id, (SELECT organization_id FROM app_audit_context WHERE id=1)),
    NULL,
    (SELECT actor_id FROM app_audit_context WHERE id=1),
    COALESCE((SELECT actor_name FROM app_audit_context WHERE id=1), 'Sin identificar (escritura externa)'),
    (SELECT actor_role FROM app_audit_context WHERE id=1),
    COALESCE((SELECT source FROM app_audit_context WHERE id=1), 'external'),
    'customer', COALESCE(NEW.id, NEW.id), 'customer', NEW.id, 'update',
    json_object('id', OLD."id", 'organization_id', OLD."organization_id", 'first_name', OLD."first_name", 'last_name', OLD."last_name", 'phone', OLD."phone", 'email', OLD."email", 'birth_date', OLD."birth_date", 'notes', OLD."notes", 'preferred_staff_id', OLD."preferred_staff_id", 'first_visit_at', OLD."first_visit_at", 'last_visit_at', OLD."last_visit_at", 'active', OLD."active", 'created_at', OLD."created_at", 'updated_at', OLD."updated_at", 'allergies', OLD."allergies", 'hair_notes', OLD."hair_notes", 'nickname', OLD."nickname", 'imported_name', OLD."imported_name", 'tax_id', OLD."tax_id", 'deposit_exempt', OLD."deposit_exempt"),
    json_object('id', NEW."id", 'organization_id', NEW."organization_id", 'first_name', NEW."first_name", 'last_name', NEW."last_name", 'phone', NEW."phone", 'email', NEW."email", 'birth_date', NEW."birth_date", 'notes', NEW."notes", 'preferred_staff_id', NEW."preferred_staff_id", 'first_visit_at', NEW."first_visit_at", 'last_visit_at', NEW."last_visit_at", 'active', NEW."active", 'created_at', NEW."created_at", 'updated_at', NEW."updated_at", 'allergies', NEW."allergies", 'hair_notes', NEW."hair_notes", 'nickname', NEW."nickname", 'imported_name', NEW."imported_name", 'tax_id', NEW."tax_id", 'deposit_exempt', NEW."deposit_exempt")
  );
END;

-- statement-breakpoint

CREATE TRIGGER IF NOT EXISTS app_audit_customer_delete BEFORE DELETE ON "customer"
BEGIN
  INSERT INTO app_audit_log (request_id, organization_id, branch_id, actor_id, actor_name, actor_role, source, entity_type, entity_id, table_name, record_id, action, before_data, after_data)
  VALUES (
    (SELECT request_id FROM app_audit_context WHERE id=1),
    COALESCE(OLD.organization_id, (SELECT organization_id FROM app_audit_context WHERE id=1)),
    NULL,
    (SELECT actor_id FROM app_audit_context WHERE id=1),
    COALESCE((SELECT actor_name FROM app_audit_context WHERE id=1), 'Sin identificar (escritura externa)'),
    (SELECT actor_role FROM app_audit_context WHERE id=1),
    COALESCE((SELECT source FROM app_audit_context WHERE id=1), 'external'),
    'customer', COALESCE(OLD.id, OLD.id), 'customer', OLD.id, 'delete',
    json_object('id', OLD."id", 'organization_id', OLD."organization_id", 'first_name', OLD."first_name", 'last_name', OLD."last_name", 'phone', OLD."phone", 'email', OLD."email", 'birth_date', OLD."birth_date", 'notes', OLD."notes", 'preferred_staff_id', OLD."preferred_staff_id", 'first_visit_at', OLD."first_visit_at", 'last_visit_at', OLD."last_visit_at", 'active', OLD."active", 'created_at', OLD."created_at", 'updated_at', OLD."updated_at", 'allergies', OLD."allergies", 'hair_notes', OLD."hair_notes", 'nickname', OLD."nickname", 'imported_name', OLD."imported_name", 'tax_id', OLD."tax_id", 'deposit_exempt', OLD."deposit_exempt"),
    NULL
  );
END;

-- statement-breakpoint

CREATE TRIGGER IF NOT EXISTS app_audit_customer_color_record_create AFTER INSERT ON "customer_color_record"
BEGIN
  INSERT INTO app_audit_log (request_id, organization_id, branch_id, actor_id, actor_name, actor_role, source, entity_type, entity_id, table_name, record_id, action, before_data, after_data)
  VALUES (
    (SELECT request_id FROM app_audit_context WHERE id=1),
    COALESCE(NEW.organization_id, (SELECT organization_id FROM app_audit_context WHERE id=1)),
    NULL,
    (SELECT actor_id FROM app_audit_context WHERE id=1),
    COALESCE((SELECT actor_name FROM app_audit_context WHERE id=1), 'Sin identificar (escritura externa)'),
    (SELECT actor_role FROM app_audit_context WHERE id=1),
    COALESCE((SELECT source FROM app_audit_context WHERE id=1), 'external'),
    'customer', COALESCE(NEW.customer_id, NEW.id), 'customer_color_record', NEW.id, 'create',
    NULL,
    json_object('id', NEW."id", 'organization_id', NEW."organization_id", 'customer_id', NEW."customer_id", 'record_date', NEW."record_date", 'formula', NEW."formula", 'brand', NEW."brand", 'developer', NEW."developer", 'result', NEW."result", 'notes', NEW."notes", 'staff_member_id', NEW."staff_member_id", 'created_by', NEW."created_by", 'created_at', NEW."created_at")
  );
END;

-- statement-breakpoint

CREATE TRIGGER IF NOT EXISTS app_audit_customer_color_record_update AFTER UPDATE ON "customer_color_record"
WHEN json_object('id', OLD."id", 'organization_id', OLD."organization_id", 'customer_id', OLD."customer_id", 'record_date', OLD."record_date", 'formula', OLD."formula", 'brand', OLD."brand", 'developer', OLD."developer", 'result', OLD."result", 'notes', OLD."notes", 'staff_member_id', OLD."staff_member_id", 'created_by', OLD."created_by", 'created_at', OLD."created_at") IS NOT json_object('id', NEW."id", 'organization_id', NEW."organization_id", 'customer_id', NEW."customer_id", 'record_date', NEW."record_date", 'formula', NEW."formula", 'brand', NEW."brand", 'developer', NEW."developer", 'result', NEW."result", 'notes', NEW."notes", 'staff_member_id', NEW."staff_member_id", 'created_by', NEW."created_by", 'created_at', NEW."created_at")
BEGIN
  INSERT INTO app_audit_log (request_id, organization_id, branch_id, actor_id, actor_name, actor_role, source, entity_type, entity_id, table_name, record_id, action, before_data, after_data)
  VALUES (
    (SELECT request_id FROM app_audit_context WHERE id=1),
    COALESCE(NEW.organization_id, (SELECT organization_id FROM app_audit_context WHERE id=1)),
    NULL,
    (SELECT actor_id FROM app_audit_context WHERE id=1),
    COALESCE((SELECT actor_name FROM app_audit_context WHERE id=1), 'Sin identificar (escritura externa)'),
    (SELECT actor_role FROM app_audit_context WHERE id=1),
    COALESCE((SELECT source FROM app_audit_context WHERE id=1), 'external'),
    'customer', COALESCE(NEW.customer_id, NEW.id), 'customer_color_record', NEW.id, 'update',
    json_object('id', OLD."id", 'organization_id', OLD."organization_id", 'customer_id', OLD."customer_id", 'record_date', OLD."record_date", 'formula', OLD."formula", 'brand', OLD."brand", 'developer', OLD."developer", 'result', OLD."result", 'notes', OLD."notes", 'staff_member_id', OLD."staff_member_id", 'created_by', OLD."created_by", 'created_at', OLD."created_at"),
    json_object('id', NEW."id", 'organization_id', NEW."organization_id", 'customer_id', NEW."customer_id", 'record_date', NEW."record_date", 'formula', NEW."formula", 'brand', NEW."brand", 'developer', NEW."developer", 'result', NEW."result", 'notes', NEW."notes", 'staff_member_id', NEW."staff_member_id", 'created_by', NEW."created_by", 'created_at', NEW."created_at")
  );
END;

-- statement-breakpoint

CREATE TRIGGER IF NOT EXISTS app_audit_customer_color_record_delete BEFORE DELETE ON "customer_color_record"
BEGIN
  INSERT INTO app_audit_log (request_id, organization_id, branch_id, actor_id, actor_name, actor_role, source, entity_type, entity_id, table_name, record_id, action, before_data, after_data)
  VALUES (
    (SELECT request_id FROM app_audit_context WHERE id=1),
    COALESCE(OLD.organization_id, (SELECT organization_id FROM app_audit_context WHERE id=1)),
    NULL,
    (SELECT actor_id FROM app_audit_context WHERE id=1),
    COALESCE((SELECT actor_name FROM app_audit_context WHERE id=1), 'Sin identificar (escritura externa)'),
    (SELECT actor_role FROM app_audit_context WHERE id=1),
    COALESCE((SELECT source FROM app_audit_context WHERE id=1), 'external'),
    'customer', COALESCE(OLD.customer_id, OLD.id), 'customer_color_record', OLD.id, 'delete',
    json_object('id', OLD."id", 'organization_id', OLD."organization_id", 'customer_id', OLD."customer_id", 'record_date', OLD."record_date", 'formula', OLD."formula", 'brand', OLD."brand", 'developer', OLD."developer", 'result', OLD."result", 'notes', OLD."notes", 'staff_member_id', OLD."staff_member_id", 'created_by', OLD."created_by", 'created_at', OLD."created_at"),
    NULL
  );
END;

-- statement-breakpoint

CREATE TRIGGER IF NOT EXISTS app_audit_customer_manicure_record_create AFTER INSERT ON "customer_manicure_record"
BEGIN
  INSERT INTO app_audit_log (request_id, organization_id, branch_id, actor_id, actor_name, actor_role, source, entity_type, entity_id, table_name, record_id, action, before_data, after_data)
  VALUES (
    (SELECT request_id FROM app_audit_context WHERE id=1),
    COALESCE(NEW.organization_id, (SELECT organization_id FROM app_audit_context WHERE id=1)),
    NULL,
    (SELECT actor_id FROM app_audit_context WHERE id=1),
    COALESCE((SELECT actor_name FROM app_audit_context WHERE id=1), 'Sin identificar (escritura externa)'),
    (SELECT actor_role FROM app_audit_context WHERE id=1),
    COALESCE((SELECT source FROM app_audit_context WHERE id=1), 'external'),
    'customer', COALESCE(NEW.customer_id, NEW.id), 'customer_manicure_record', NEW.id, 'create',
    NULL,
    json_object('id', NEW."id", 'organization_id', NEW."organization_id", 'customer_id', NEW."customer_id", 'record_date', NEW."record_date", 'technique', NEW."technique", 'products', NEW."products", 'shade', NEW."shade", 'notes', NEW."notes", 'staff_member_id', NEW."staff_member_id", 'created_by', NEW."created_by", 'created_at', NEW."created_at")
  );
END;

-- statement-breakpoint

CREATE TRIGGER IF NOT EXISTS app_audit_customer_manicure_record_update AFTER UPDATE ON "customer_manicure_record"
WHEN json_object('id', OLD."id", 'organization_id', OLD."organization_id", 'customer_id', OLD."customer_id", 'record_date', OLD."record_date", 'technique', OLD."technique", 'products', OLD."products", 'shade', OLD."shade", 'notes', OLD."notes", 'staff_member_id', OLD."staff_member_id", 'created_by', OLD."created_by", 'created_at', OLD."created_at") IS NOT json_object('id', NEW."id", 'organization_id', NEW."organization_id", 'customer_id', NEW."customer_id", 'record_date', NEW."record_date", 'technique', NEW."technique", 'products', NEW."products", 'shade', NEW."shade", 'notes', NEW."notes", 'staff_member_id', NEW."staff_member_id", 'created_by', NEW."created_by", 'created_at', NEW."created_at")
BEGIN
  INSERT INTO app_audit_log (request_id, organization_id, branch_id, actor_id, actor_name, actor_role, source, entity_type, entity_id, table_name, record_id, action, before_data, after_data)
  VALUES (
    (SELECT request_id FROM app_audit_context WHERE id=1),
    COALESCE(NEW.organization_id, (SELECT organization_id FROM app_audit_context WHERE id=1)),
    NULL,
    (SELECT actor_id FROM app_audit_context WHERE id=1),
    COALESCE((SELECT actor_name FROM app_audit_context WHERE id=1), 'Sin identificar (escritura externa)'),
    (SELECT actor_role FROM app_audit_context WHERE id=1),
    COALESCE((SELECT source FROM app_audit_context WHERE id=1), 'external'),
    'customer', COALESCE(NEW.customer_id, NEW.id), 'customer_manicure_record', NEW.id, 'update',
    json_object('id', OLD."id", 'organization_id', OLD."organization_id", 'customer_id', OLD."customer_id", 'record_date', OLD."record_date", 'technique', OLD."technique", 'products', OLD."products", 'shade', OLD."shade", 'notes', OLD."notes", 'staff_member_id', OLD."staff_member_id", 'created_by', OLD."created_by", 'created_at', OLD."created_at"),
    json_object('id', NEW."id", 'organization_id', NEW."organization_id", 'customer_id', NEW."customer_id", 'record_date', NEW."record_date", 'technique', NEW."technique", 'products', NEW."products", 'shade', NEW."shade", 'notes', NEW."notes", 'staff_member_id', NEW."staff_member_id", 'created_by', NEW."created_by", 'created_at', NEW."created_at")
  );
END;

-- statement-breakpoint

CREATE TRIGGER IF NOT EXISTS app_audit_customer_manicure_record_delete BEFORE DELETE ON "customer_manicure_record"
BEGIN
  INSERT INTO app_audit_log (request_id, organization_id, branch_id, actor_id, actor_name, actor_role, source, entity_type, entity_id, table_name, record_id, action, before_data, after_data)
  VALUES (
    (SELECT request_id FROM app_audit_context WHERE id=1),
    COALESCE(OLD.organization_id, (SELECT organization_id FROM app_audit_context WHERE id=1)),
    NULL,
    (SELECT actor_id FROM app_audit_context WHERE id=1),
    COALESCE((SELECT actor_name FROM app_audit_context WHERE id=1), 'Sin identificar (escritura externa)'),
    (SELECT actor_role FROM app_audit_context WHERE id=1),
    COALESCE((SELECT source FROM app_audit_context WHERE id=1), 'external'),
    'customer', COALESCE(OLD.customer_id, OLD.id), 'customer_manicure_record', OLD.id, 'delete',
    json_object('id', OLD."id", 'organization_id', OLD."organization_id", 'customer_id', OLD."customer_id", 'record_date', OLD."record_date", 'technique', OLD."technique", 'products', OLD."products", 'shade', OLD."shade", 'notes', OLD."notes", 'staff_member_id', OLD."staff_member_id", 'created_by', OLD."created_by", 'created_at', OLD."created_at"),
    NULL
  );
END;

-- statement-breakpoint

CREATE TRIGGER IF NOT EXISTS app_audit_customer_credit_ledger_create AFTER INSERT ON "customer_credit_ledger"
BEGIN
  INSERT INTO app_audit_log (request_id, organization_id, branch_id, actor_id, actor_name, actor_role, source, entity_type, entity_id, table_name, record_id, action, before_data, after_data)
  VALUES (
    (SELECT request_id FROM app_audit_context WHERE id=1),
    COALESCE(NEW.organization_id, (SELECT organization_id FROM app_audit_context WHERE id=1)),
    NULL,
    (SELECT actor_id FROM app_audit_context WHERE id=1),
    COALESCE((SELECT actor_name FROM app_audit_context WHERE id=1), 'Sin identificar (escritura externa)'),
    (SELECT actor_role FROM app_audit_context WHERE id=1),
    COALESCE((SELECT source FROM app_audit_context WHERE id=1), 'external'),
    'transaction', COALESCE(NEW.id, NEW.id), 'customer_credit_ledger', NEW.id, 'create',
    NULL,
    json_object('id', NEW."id", 'organization_id', NEW."organization_id", 'customer_id', NEW."customer_id", 'amount', NEW."amount", 'kind', NEW."kind", 'sale_id', NEW."sale_id", 'appointment_id', NEW."appointment_id", 'payment_id', NEW."payment_id", 'note', NEW."note", 'created_by', NEW."created_by", 'created_at', NEW."created_at")
  );
END;

-- statement-breakpoint

CREATE TRIGGER IF NOT EXISTS app_audit_customer_credit_ledger_update AFTER UPDATE ON "customer_credit_ledger"
WHEN json_object('id', OLD."id", 'organization_id', OLD."organization_id", 'customer_id', OLD."customer_id", 'amount', OLD."amount", 'kind', OLD."kind", 'sale_id', OLD."sale_id", 'appointment_id', OLD."appointment_id", 'payment_id', OLD."payment_id", 'note', OLD."note", 'created_by', OLD."created_by", 'created_at', OLD."created_at") IS NOT json_object('id', NEW."id", 'organization_id', NEW."organization_id", 'customer_id', NEW."customer_id", 'amount', NEW."amount", 'kind', NEW."kind", 'sale_id', NEW."sale_id", 'appointment_id', NEW."appointment_id", 'payment_id', NEW."payment_id", 'note', NEW."note", 'created_by', NEW."created_by", 'created_at', NEW."created_at")
BEGIN
  INSERT INTO app_audit_log (request_id, organization_id, branch_id, actor_id, actor_name, actor_role, source, entity_type, entity_id, table_name, record_id, action, before_data, after_data)
  VALUES (
    (SELECT request_id FROM app_audit_context WHERE id=1),
    COALESCE(NEW.organization_id, (SELECT organization_id FROM app_audit_context WHERE id=1)),
    NULL,
    (SELECT actor_id FROM app_audit_context WHERE id=1),
    COALESCE((SELECT actor_name FROM app_audit_context WHERE id=1), 'Sin identificar (escritura externa)'),
    (SELECT actor_role FROM app_audit_context WHERE id=1),
    COALESCE((SELECT source FROM app_audit_context WHERE id=1), 'external'),
    'transaction', COALESCE(NEW.id, NEW.id), 'customer_credit_ledger', NEW.id, 'update',
    json_object('id', OLD."id", 'organization_id', OLD."organization_id", 'customer_id', OLD."customer_id", 'amount', OLD."amount", 'kind', OLD."kind", 'sale_id', OLD."sale_id", 'appointment_id', OLD."appointment_id", 'payment_id', OLD."payment_id", 'note', OLD."note", 'created_by', OLD."created_by", 'created_at', OLD."created_at"),
    json_object('id', NEW."id", 'organization_id', NEW."organization_id", 'customer_id', NEW."customer_id", 'amount', NEW."amount", 'kind', NEW."kind", 'sale_id', NEW."sale_id", 'appointment_id', NEW."appointment_id", 'payment_id', NEW."payment_id", 'note', NEW."note", 'created_by', NEW."created_by", 'created_at', NEW."created_at")
  );
END;

-- statement-breakpoint

CREATE TRIGGER IF NOT EXISTS app_audit_customer_credit_ledger_delete BEFORE DELETE ON "customer_credit_ledger"
BEGIN
  INSERT INTO app_audit_log (request_id, organization_id, branch_id, actor_id, actor_name, actor_role, source, entity_type, entity_id, table_name, record_id, action, before_data, after_data)
  VALUES (
    (SELECT request_id FROM app_audit_context WHERE id=1),
    COALESCE(OLD.organization_id, (SELECT organization_id FROM app_audit_context WHERE id=1)),
    NULL,
    (SELECT actor_id FROM app_audit_context WHERE id=1),
    COALESCE((SELECT actor_name FROM app_audit_context WHERE id=1), 'Sin identificar (escritura externa)'),
    (SELECT actor_role FROM app_audit_context WHERE id=1),
    COALESCE((SELECT source FROM app_audit_context WHERE id=1), 'external'),
    'transaction', COALESCE(OLD.id, OLD.id), 'customer_credit_ledger', OLD.id, 'delete',
    json_object('id', OLD."id", 'organization_id', OLD."organization_id", 'customer_id', OLD."customer_id", 'amount', OLD."amount", 'kind', OLD."kind", 'sale_id', OLD."sale_id", 'appointment_id', OLD."appointment_id", 'payment_id', OLD."payment_id", 'note', OLD."note", 'created_by', OLD."created_by", 'created_at', OLD."created_at"),
    NULL
  );
END;
