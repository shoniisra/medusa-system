-- Clienta de confianza: no se le pide abono al reservar.
--
-- Algunas clientas antiguas ya se ganaron la confianza del salón y pedirles
-- seña al agendar resulta incómodo. Con este flag el asistente de citas deja el
-- abono en cero y no obliga a elegir un monto para ellas. Por defecto 0: a todo
-- el mundo se le sigue pidiendo abono como hasta ahora.
--
-- Aplicar con:
--   node scripts/migrate.mjs docs/migrations/2026-10-12-customer-deposit-exempt.sql

ALTER TABLE customer ADD COLUMN deposit_exempt INTEGER NOT NULL DEFAULT 0;
