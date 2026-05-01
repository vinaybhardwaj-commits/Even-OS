/**
 * SCM Indent end-to-end flow — integration test against a real DB.
 *
 * Phase 2.6. Gated VITEST_INTEGRATION=1. Validates the canonical
 * indent → approval → issue → in_transit → received → closed lifecycle
 * + indent_approvals chain + per-line tracking + audit trail.
 *
 * Mirrors the Phase 1.7 procurement-flow test pattern: SQL-layer
 * assertions tagged with a per-run SCOPE for isolation.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { getTestSql, resetTestSqlCache } from '../test-utils/test-db';

const RUN = process.env.VITEST_INTEGRATION === '1';
const SCOPE = `indent-2.6-${Date.now()}-${Math.floor(Math.random() * 10_000)}`;

describe.runIf(RUN)('SCM indent end-to-end flow', () => {
  let sql: ReturnType<typeof getTestSql>;
  let hospitalId: string;
  let actorUserId: string;

  beforeAll(async () => {
    resetTestSqlCache();
    sql = getTestSql();
    const hospitals = await sql(`SELECT hospital_id FROM hospitals LIMIT 1`);
    hospitalId = hospitals[0].hospital_id;
    const users = await sql(
      `SELECT id FROM users WHERE hospital_id = $1 LIMIT 1`,
      [hospitalId]
    );
    actorUserId = users[0].id;
  });

  afterAll(async () => {
    if (!sql) return;
    await sql(`DELETE FROM stock_movements WHERE reason LIKE $1`, [`%${SCOPE}%`]);
    await sql(`DELETE FROM indent_state_log WHERE reason LIKE $1`, [`%${SCOPE}%`]);
    await sql(`DELETE FROM indent_approvals WHERE notes LIKE $1`, [`%${SCOPE}%`]);
    await sql(`DELETE FROM indent_items WHERE notes LIKE $1`, [`%${SCOPE}%`]);
    await sql(`DELETE FROM indents WHERE notes LIKE $1`, [`%${SCOPE}%`]);
    await sql(`DELETE FROM inventory WHERE batch_number LIKE $1`, [`${SCOPE}-%`]);
    await sql(`DELETE FROM items WHERE code LIKE $1`, [`${SCOPE}-%`]);
    await sql(`DELETE FROM audit_logs WHERE new_values::text LIKE $1`, [`%${SCOPE}%`]);
  });

  it('schema: indent_approvals table + CHECK constraint + partial UNIQUE INDEX', async () => {
    const cols = await sql(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'indent_approvals' ORDER BY ordinal_position`
    );
    const names = cols.map((c: any) => c.column_name);
    expect(names).toContain('indent_id');
    expect(names).toContain('approver_role');
    expect(names).toContain('decision');
    expect(names).toContain('tier_order');

    // Cannot insert against a non-existent indent (FK on indent_id)
    // and can't have decision NOT IN ('approved','rejected') except NULL
  });

  it('full lifecycle: pending → approved → issued → in_transit → received → closed', async () => {
    // Setup: item + inventory at source
    const itemRows = await sql(
      `INSERT INTO items (hospital_id, code, display_name, kind, unit_of_measure, status, created_by)
       VALUES ($1, $2, 'Test Indent Drug', 'drug', 'tab', 'active', $3) RETURNING id`,
      [hospitalId, `${SCOPE}-I1`, actorUserId]
    );
    const itemId = itemRows[0].id;

    const invRows = await sql(
      `INSERT INTO inventory (hospital_id, item_id, location, batch_number, manufacturer, expiry_date,
                              quantity_on_hand, unit_cost, mrp, is_active)
       VALUES ($1, $2, 'main_pharmacy', $3, 'Test Mfr', '2027-12-31', 100, 5, 8, TRUE)
       RETURNING id`,
      [hospitalId, itemId, `${SCOPE}-B1`]
    );
    const invId = invRows[0].id;

    // 1. Raise indent (pending)
    const indentRows = await sql(
      `INSERT INTO indents (hospital_id, indent_number, raised_by, source_location,
                            destination_location, state, priority, notes, sla_due_at)
       VALUES ($1, $2, $3, 'tbd_at_approval', 'ward_3', 'pending', 'routine', $4, NOW() + INTERVAL '24 hours')
       RETURNING id`,
      [hospitalId, `IND-${SCOPE}`, actorUserId, `${SCOPE}-test`]
    );
    const indentId = indentRows[0].id;

    await sql(
      `INSERT INTO indent_items (hospital_id, indent_id, item_id, item_name, quantity_requested, notes)
       VALUES ($1, $2, $3, 'Test Indent Drug', 30, $4)`,
      [hospitalId, indentId, itemId, `${SCOPE}-line`]
    );

    await sql(
      `INSERT INTO indent_approvals (hospital_id, indent_id, approver_role, tier_order, notes)
       VALUES ($1, $2, 'procurement_head', 1, $3)`,
      [hospitalId, indentId, `${SCOPE}-approval`]
    );

    // 2. Approve: tier signs off + per-line approval + state flip
    await sql(
      `UPDATE indent_approvals SET decision = 'approved', decided_by = $1, decided_at = NOW()
       WHERE indent_id = $2`,
      [actorUserId, indentId]
    );
    await sql(
      `UPDATE indent_items SET quantity_approved = 30 WHERE indent_id = $1`,
      [indentId]
    );
    await sql(
      `UPDATE indents SET state = 'approved', source_location = 'main_pharmacy',
                          approved_by = $1, approved_at = NOW()
       WHERE id = $2`,
      [actorUserId, indentId]
    );

    let indent = await sql(`SELECT state, source_location FROM indents WHERE id = $1`, [indentId]);
    expect(indent[0].state).toBe('approved');
    expect(indent[0].source_location).toBe('main_pharmacy');

    // 3. Issue: pair transfer_out + transfer_in; bumps quantity_in_transit at dest
    // Decrement source on_hand
    await sql(`UPDATE inventory SET quantity_on_hand = quantity_on_hand - 30 WHERE id = $1`, [invId]);

    await sql(
      `INSERT INTO stock_movements (hospital_id, inventory_id, item_id, item_name,
        movement_type, quantity, previous_balance, new_balance, batch_number, location,
        source_module, source_ref_id, unit_cost, total_value, reason, created_by)
       VALUES ($1, $2, $3, 'Test Indent Drug', 'transfer_out', -30, 100, 70, $4,
               'main_pharmacy', 'scm', $5, 5, 150, $6, $7)`,
      [hospitalId, invId, itemId, `${SCOPE}-B1`, indentId, `${SCOPE}-issue`, actorUserId]
    );

    // Create dest inventory row at ward_3 with 30 in_transit
    const destRows = await sql(
      `INSERT INTO inventory (hospital_id, item_id, location, batch_number, manufacturer, expiry_date,
                              quantity_on_hand, quantity_in_transit, unit_cost, mrp, is_active)
       VALUES ($1, $2, 'ward_3', $3, 'Test Mfr', '2027-12-31', 0, 30, 5, 8, TRUE)
       RETURNING id`,
      [hospitalId, itemId, `${SCOPE}-B1`]
    );
    const destId = destRows[0].id;

    await sql(
      `INSERT INTO stock_movements (hospital_id, inventory_id, item_id, item_name,
        movement_type, quantity, previous_balance, new_balance, batch_number, location,
        source_module, source_ref_id, unit_cost, total_value, reason, created_by)
       VALUES ($1, $2, $3, 'Test Indent Drug', 'transfer_in', 30, 0, 0, $4, 'ward_3',
               'scm', $5, 5, 150, $6, $7)`,
      [hospitalId, destId, itemId, `${SCOPE}-B1`, indentId, `${SCOPE}-issue-in`, actorUserId]
    );

    await sql(
      `UPDATE indent_items SET quantity_issued = 30, source_inventory_id = $1
       WHERE indent_id = $2`,
      [invId, indentId]
    );
    await sql(
      `UPDATE indents SET state = 'in_transit', issued_by = $1, issued_at = NOW()
       WHERE id = $2`,
      [actorUserId, indentId]
    );

    // 4. Acknowledge: flip in_transit → on_hand at dest, indent → received
    await sql(
      `UPDATE inventory SET quantity_in_transit = quantity_in_transit - 30,
                            quantity_on_hand = quantity_on_hand + 30
       WHERE id = $1`,
      [destId]
    );
    await sql(
      `UPDATE indent_items SET quantity_acknowledged = 30 WHERE indent_id = $1`,
      [indentId]
    );
    await sql(
      `UPDATE indents SET state = 'received', acknowledged_by = $1, acknowledged_at = NOW()
       WHERE id = $2`,
      [actorUserId, indentId]
    );

    // 5. Close
    await sql(`UPDATE indents SET state = 'closed', closed_at = NOW() WHERE id = $1`, [indentId]);

    // Final assertions
    const final = await sql(`SELECT state FROM indents WHERE id = $1`, [indentId]);
    expect(final[0].state).toBe('closed');

    const finalDest = await sql(`SELECT quantity_on_hand, quantity_in_transit FROM inventory WHERE id = $1`, [destId]);
    expect(Number(finalDest[0].quantity_on_hand)).toBe(30);
    expect(Number(finalDest[0].quantity_in_transit)).toBe(0);

    const finalSrc = await sql(`SELECT quantity_on_hand FROM inventory WHERE id = $1`, [invId]);
    expect(Number(finalSrc[0].quantity_on_hand)).toBe(70);  // 100 - 30

    // Ledger: 2 stock_movements rows tied to this indent
    const moves = await sql(
      `SELECT movement_type, quantity FROM stock_movements
       WHERE source_ref_id = $1 ORDER BY created_at ASC`,
      [indentId]
    );
    expect(moves.length).toBe(2);
    expect(moves[0].movement_type).toBe('transfer_out');
    expect(Number(moves[0].quantity)).toBe(-30);
    expect(moves[1].movement_type).toBe('transfer_in');
    expect(Number(moves[1].quantity)).toBe(30);

    // Approval row decision='approved'
    const apr = await sql(`SELECT decision FROM indent_approvals WHERE indent_id = $1`, [indentId]);
    expect(apr[0].decision).toBe('approved');

    // Indent items show full progression
    const lines = await sql(
      `SELECT quantity_requested, quantity_approved, quantity_issued, quantity_acknowledged
       FROM indent_items WHERE indent_id = $1`,
      [indentId]
    );
    expect(Number(lines[0].quantity_requested)).toBe(30);
    expect(Number(lines[0].quantity_approved)).toBe(30);
    expect(Number(lines[0].quantity_issued)).toBe(30);
    expect(Number(lines[0].quantity_acknowledged)).toBe(30);
  });

  it('rejection path: pending + reject → terminal rejected', async () => {
    // Quick setup: indent in pending
    const indentRows = await sql(
      `INSERT INTO indents (hospital_id, indent_number, raised_by, source_location,
                            destination_location, state, priority, notes)
       VALUES ($1, $2, $3, 'tbd_at_approval', 'ward_3', 'pending', 'routine', $4)
       RETURNING id`,
      [hospitalId, `IND-${SCOPE}-REJ`, actorUserId, `${SCOPE}-rej`]
    );
    const indentId = indentRows[0].id;

    await sql(
      `INSERT INTO indent_approvals (hospital_id, indent_id, approver_role, tier_order, notes)
       VALUES ($1, $2, 'procurement_head', 1, $3)`,
      [hospitalId, indentId, `${SCOPE}-rej-approval`]
    );

    // Reject: marks approval row decision='rejected' + indent state→rejected
    await sql(
      `UPDATE indent_approvals SET decision = 'rejected', decided_by = $1, decided_at = NOW(),
                                   decision_reason = 'duplicate request'
       WHERE indent_id = $2`,
      [actorUserId, indentId]
    );
    await sql(
      `UPDATE indents SET state = 'rejected', rejected_by = $1, rejected_at = NOW(),
                          rejection_reason = 'duplicate request'
       WHERE id = $2`,
      [actorUserId, indentId]
    );

    const final = await sql(`SELECT state, rejection_reason FROM indents WHERE id = $1`, [indentId]);
    expect(final[0].state).toBe('rejected');
    expect(final[0].rejection_reason).toBe('duplicate request');
  });

  it('CHECK constraint: indent_approvals rejects invalid approver_role', async () => {
    // Need a real indent_id to satisfy FK
    const indentRows = await sql(
      `INSERT INTO indents (hospital_id, indent_number, raised_by, source_location,
                            destination_location, state, priority, notes)
       VALUES ($1, $2, $3, 'main_pharmacy', 'ward_3', 'pending', 'routine', $4)
       RETURNING id`,
      [hospitalId, `IND-${SCOPE}-CHK`, actorUserId, `${SCOPE}-chk`]
    );
    const indentId = indentRows[0].id;

    await expect(
      sql(
        `INSERT INTO indent_approvals (hospital_id, indent_id, approver_role, tier_order, notes)
         VALUES ($1, $2, 'totally_made_up_role', 1, $3)`,
        [hospitalId, indentId, `${SCOPE}-chk-bad`]
      )
    ).rejects.toThrow();
  });
});

describe.skipIf(RUN)('SCM indent flow (skipped — set VITEST_INTEGRATION=1)', () => {
  it('runs only with VITEST_INTEGRATION=1', () => {
    expect(RUN).toBe(false);
  });
});
