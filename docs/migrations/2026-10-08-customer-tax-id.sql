-- Documento tributario del cliente: cédula, RUC o pasaporte.
--
-- Es opcional: muchas ventas quedan como Consumidor Final o se dan de alta
-- rápido en el POS sin cargar documento. Lo guardamos como texto libre: con
-- 10 dígitos pasa por cédula, con 13 por RUC. El sistema no valida el dígito
-- verificador — la factura electrónica ya lo rechaza si está mal.
--
-- Aplicar con:
--   node scripts/migrate.mjs docs/migrations/2026-10-08-customer-tax-id.sql

ALTER TABLE customer ADD COLUMN tax_id TEXT;
