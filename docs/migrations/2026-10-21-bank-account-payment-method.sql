-- Ancla cada cuenta bancaria a un método de pago concreto.
-- Antes el sistema asumía "banco = transferencia", que mezclaba POS de tarjeta,
-- MercadoPago y cuentas de ahorro. Las cuentas internas (is_internal=1) no
-- cobran al cliente, así que su payment_method_id queda NULL por diseño.
ALTER TABLE bank_account ADD COLUMN payment_method_id TEXT REFERENCES payment_method(id);

-- Cuentas existentes no internas: fallback a "transferencia" para no romper
-- cobros en curso. El usuario reasigna caso por caso desde Settings.
UPDATE bank_account
   SET payment_method_id = (
         SELECT pm.id
           FROM payment_method pm
          WHERE pm.organization_id = bank_account.organization_id
            AND pm.method_type = 'transfer'
            AND pm.active = 1
          LIMIT 1
       )
 WHERE COALESCE(is_internal, 0) = 0
   AND payment_method_id IS NULL;
