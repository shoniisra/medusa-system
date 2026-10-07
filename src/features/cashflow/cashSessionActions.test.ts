import { describe, it, expect } from 'vitest';
import { buildCloseCashStatements, type CashCtx } from './cashSessionActions';

/**
 * Cierre de caja: el orden de las sentencias es parte del contrato con el
 * trigger `trg_cash_session_validate_close`. Si alguien reordena el batch,
 * el cierre falla con un constraint error en producción (incidente del
 * 2026-10-07).
 */

const ctx: CashCtx = {
  branchId: 'branch-1',
  orgId: 'org-1',
  userId: 'user-1',
};
const SESSION_ID = 'sess-1';
const NOW = '2026-10-07T20:00:00.000Z';

describe('buildCloseCashStatements', () => {
  it('siempre coloca el UPDATE de cash_session en la primera posición', () => {
    const { stmts } = buildCloseCashStatements(
      ctx,
      SESSION_ID,
      100,
      { counted: 150, withdraw: 50, destination: 'bank-1' },
      NOW,
    );
    expect(stmts[0].sql).toMatch(/^\s*UPDATE cash_session/);
  });

  it('sin descuadre ni retiro: solo el UPDATE', () => {
    const { stmts, difference } = buildCloseCashStatements(
      ctx,
      SESSION_ID,
      100,
      { counted: 100, withdraw: 0, destination: null },
      NOW,
    );
    expect(stmts).toHaveLength(1);
    expect(difference).toBe(0);
  });

  it('con descuadre inserta un movement adjustment después del UPDATE', () => {
    const { stmts, difference } = buildCloseCashStatements(
      ctx,
      SESSION_ID,
      100,
      { counted: 95, withdraw: 0, destination: null },
      NOW,
    );
    expect(difference).toBe(-5);
    expect(stmts).toHaveLength(2);
    expect(stmts[1].sql).toContain('cash_movement');
    expect(stmts[1].sql).toContain("'adjustment'");
    // El valor absoluto se almacena en `amount` y la dirección queda en
    // `direction` (out porque hubo menos de lo esperado).
    const args = stmts[1].args as unknown[];
    expect(args).toContain('out');
    expect(args).toContain(5);
  });

  it('con retiro inserta transfer + cash_movement cash_out', () => {
    const { stmts } = buildCloseCashStatements(
      ctx,
      SESSION_ID,
      100,
      { counted: 100, withdraw: 40, destination: 'bank-1' },
      NOW,
    );
    expect(stmts).toHaveLength(3); // UPDATE + transfer + cash_out
    expect(stmts[1].sql).toContain('account_transfer');
    expect(stmts[2].sql).toContain("'cash_out'");
  });

  it('con descuadre y retiro: UPDATE → adjustment → transfer → cash_out', () => {
    const { stmts, difference } = buildCloseCashStatements(
      ctx,
      SESSION_ID,
      100,
      { counted: 110, withdraw: 40, destination: 'bank-1' },
      NOW,
    );
    expect(difference).toBe(10);
    expect(stmts).toHaveLength(4);
    expect(stmts[0].sql).toMatch(/^\s*UPDATE cash_session/);
    expect(stmts[1].sql).toContain("'adjustment'");
    expect(stmts[2].sql).toContain('account_transfer');
    expect(stmts[3].sql).toContain("'cash_out'");
  });

  it('retiro sin destino no genera transfer ni cash_out', () => {
    const { stmts } = buildCloseCashStatements(
      ctx,
      SESSION_ID,
      100,
      { counted: 100, withdraw: 40, destination: null },
      NOW,
    );
    expect(stmts).toHaveLength(1);
  });

  it('el UPDATE escribe el expected_cash sin tocar valores previos (= se cumple el trigger)', () => {
    const { stmts } = buildCloseCashStatements(
      ctx,
      SESSION_ID,
      250,
      { counted: 300, withdraw: 0, destination: null },
      NOW,
    );
    const args = stmts[0].args as unknown[];
    // posición 2 (0-indexed) corresponde a `expected_cash=?`
    expect(args[2]).toBe(250);
    expect(args[3]).toBe(300); // counted_cash
    expect(args[4]).toBe(50); // difference
  });
});
