import { describe, expect, it } from 'vitest';
import { maskCustomerPhone, maskCustomerEmail } from './contactPrivacy';

describe('contactos enmascarados', () => {
  it('oculta los dígitos centrales y conserva los últimos cuatro', () => {
    expect(maskCustomerPhone('+593991234567')).toBe('+593 9•• •• 4567');
    expect(maskCustomerPhone('0991234567')).toBe(maskCustomerPhone('+593991234567'));
    expect(maskCustomerPhone('+5939912342345')).toBe('+593 9•• ••• 2345');
    expect(maskCustomerPhone('+14155552671')).toBe('+1 4•• ••• 2671');
  });
  it('no expone números cortos ni números de países desconocidos', () => {
    expect(maskCustomerPhone('123')).toBe('••••');
    expect(maskCustomerPhone('+819012345678')).toBe('+••• ••• 5678');
    expect(maskCustomerPhone(null)).toBe('');
  });
  it('oculta tanto la cuenta como el dominio del correo', () => {
    expect(maskCustomerEmail('maria@example.com')).toBe('m•••@e•••.com');
    expect(maskCustomerEmail('a@b.ec')).toBe('a•••@b•••.ec');
    expect(maskCustomerEmail('incorrecto')).toBe('•••');
    expect(maskCustomerEmail('')).toBe('');
  });
});
