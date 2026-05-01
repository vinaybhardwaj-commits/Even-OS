/**
 * SCM end-to-end procurement flow — integration test against a real DB.
 *
 * Phase 1.7. Gated behind VITEST_INTEGRATION=1. Requires:
 *   - TEST_DATABASE_URL pointing to an ephemeral Neon branch / dedicated test DB
 *   - Migrations 0060 + 0061 applied to that DB
 *   - At least one hospital row + at least one user row available for FKs
 *
 * The test exercises the FULL procurement workflow at the SQL layer to
 * validate the canonical schema (items / inventory / vendors / purchase_orders
 * / purchase_order_items / stock_movements / auto_reorder_drafts /
 * scm_role_assignments / audit_logs) end-to-end.
 *
 * Note on tRPC vs SQL: ideally Phase 1.7 would test the tRPC procedures via
 * `appRouter.createCaller(ctx)`. That requires standing up a fake auth context
 * + the tRPC type machinery. For first cut we exercise the SQL layer directly,
 * which is what the procedures emit anyway. Phase 2 wraps these in tRPC-caller
 * tests for full-stack coverage.
 *
 * Convention: every test cleans up after itself via per-test setup that creates
 * a test scope identifier and tags every row it inserts; teardown deletes by
 * that scope.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { getTestSql, resetTestSqlCache } from '../test-utils/test-db';

const RUN = process.env.VITEST_INTEGRATION === '1';

// Per-test-run scope so concurrent runs don't collide
const SCOPE = `scm-1.7-${Date.now()}-${Math.floor(Math.random() * 10_000)}`;

describe.runIf(RUN)('SCM end-to-end procurement flow', () => {
  let sql: ReturnType<typeof getTestSql>;
  let hospitalId: string;
  let actorUserId: string;

  beforeAll(async () => {
    resetTestSqlCache();
    sql = getTestSql();

    // Find a hospital + a super_admin user to act as the actor for all writes.
    // These already exist in the seeded test DB (per Phase 0.2).
    const hospitals = await sql(`SELECT hospital_id FROM hospitals LIMIT 1`);
    if (!hospitals.length) {
      throw new Error('Test DB has no hospitals; seed first');
    }
    hospitalId = hospitals[0].hospital_id;

    const users = await sql(
      `SELECT id FROM users WHERE hospital_id = $1 AND role IN ('super_admin','hospital_admin') LIMIT 1`,
      [hospitalId]
    );
    if (!users.length) {
      throw new Error('Test DB has no super_admin/hospital_admin user; seed first');
    }
    actorUserId = users[0].id;
  });

  afterAll(async () => {
    // Best-effort cleanup; specific tables tagged with our scope via notes columns
    if (!sql) return;
    await sql(`DELETE FROM stock_movements WHERE notes LIKE $1 OR reason LIKE $1`, [`%${SCOPE}%`]);
    await sql(`DELETE FROM auto_reorder_drafts WHERE review_notes LIKE $1`, [`%${SCOPE}%`]);
    await sql(`DELETE FROM purchase_order_items WHERE notes LIKE $1`, [`%${SCOPE}%`]);
    await sql(`DELETE FROM purchase_orders WHERE notes LIKE $1`, [`%${SCOPE}%`]);
    await sql(`DELETE FROM inventory WHERE batch_number LIKE $1`, [`${SCOPE}-%`]);
    await sql(`DELETE FROM items WHERE code LIKE $1`, [`${SCOPE}-%`]);
    await sql(`DELETE FROM vendors WHERE vendor_code LIKE $1`, [`${SCOPE}-%`]);
    await sql(`DELETE FROM scm_role_assignments WHERE notes LIKE $1`, [`%${SCOPE}%`]);
    await sql(`DELETE FROM audit_logs WHERE new_values::text LIKE $1`, [`%${SCOPE}%`]);
  });

  it('schema: scm_role_assignments table exists and CHECK rejects invalid role', async () => {
    // Schema sanity — phase 1.6 migration applied
    const cols = await sql(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'scm_role_assignments' ORDER BY ordinal_position`
    );
    const colNames = cols.map((c: any) => c.column_name);
    expect(colNames).toContain('hospital_id');
    expect(colNames).toContain('user_id');
    expect(colNames).toContain('scm_role');
    expect(colNames).toContain('granted_by');
    expect(colNames).toContain('revoked_at');

    // CHECK constraint blocks invalid scm_role
    await expect(
      sql(
        `INSERT INTO scm_role_assignments (hospital_id, user_id, scm_role, granted_by, notes)
         VALUES ($1, $2, 'totally_made_up_role', $3, $4)`,
        [hospitalId, actorUserId, actorUserId, `${SCOPE}-bad-role`]
      )
    ).rejects.toThrow();
  });

  it('schema: partial UNIQUE INDEX prevents duplicate active assignments', async () => {
    // Pick a real-ish UUID for the target user (use actor for simplicity)
    const role = 'inventory_manager';

    // First insert succeeds
    const r1 = await sql(
      `INSERT INTO scm_role_assignments (hospital_id, user_id, scm_role, granted_by, notes)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [hospitalId, actorUserId, role, actorUserId, `${SCOPE}-dup-1`]
    );
    expect(r1.length).toBe(1);

    // Second active insert with same (hospital, user, role) should violate uq_scm_role_assignments_active
    await expect(
      sql(
        `INSERT INTO scm_role_assignments (hospital_id, user_id, scm_role, granted_by, notes)
         VALUES ($1, $2, $3, $4, $5)`,
        [hospitalId, actorUserId, role, actorUserId, `${SCOPE}-dup-2`]
      )
    ).rejects.toThrow();

    // After soft-revoke, the same role can be re-granted (creates a new active row)
    await sql(
      `UPDATE scm_role_assignments SET revoked_at = NOW(), revoked_by = $1, revoke_reason = $2 WHERE id = $3`,
      [actorUserId, 'test re-grant cycle', r1[0].id]
    );

    const r2 = await sql(
      `INSERT INTO scm_role_assignments (hospital_id, user_id, scm_role, granted_by, notes)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [hospitalId, actorUserId, role, actorUserId, `${SCOPE}-dup-3`]
    );
    expect(r2.length).toBe(1);
  });

  it('procurement flow: vendor → item → inventory → PO → receive → ledger updated', async () => {
    // 1. Create a vendor
    const vendorRows = await sql(
      `INSERT INTO vendors
       (hospital_id, vendor_code, vendor_name, contact_person, vendor_phone, vendor_email,
        vendor_address, payment_terms_days, vendor_is_active, vendor_created_at)
       VALUES ($1, $2, 'Test Vendor', 'Test Contact', '+91 9000000000', 'test@vendor.local',
               'Test address', 30, TRUE, NOW())
       RETURNING id`,
      [hospitalId, `${SCOPE}-V1`]
    );
    const vendorId = vendorRows[0].id;

    // 2. Create an item (active)
    const itemRows = await sql(
      `INSERT INTO items
       (hospital_id, code, display_name, kind, unit_of_measure, status, created_by, manufacturer)
       VALUES ($1, $2, 'Test Drug 500mg', 'drug', 'tab', 'active', $3, 'Test Mfr')
       RETURNING id`,
      [hospitalId, `${SCOPE}-I1`, actorUserId]
    );
    const itemId = itemRows[0].id;

    // 3. Add inventory (location warehouse, batch SCOPE-B1)
    const invRows = await sql(
      `INSERT INTO inventory
       (hospital_id, item_id, location, batch_number, manufacturer, expiry_date,
        quantity_on_hand, unit_cost, mrp, is_active)
       VALUES ($1, $2, 'warehouse', $3, 'Test Mfr', '2027-12-31', 100, 10, 15, TRUE)
       RETURNING id`,
      [hospitalId, itemId, `${SCOPE}-B1`]
    );
    const invId = invRows[0].id;

    // Opening receipt ledger entry (mirrors what scm.inventory.add procedure writes)
    await sql(
      `INSERT INTO stock_movements
       (hospital_id, inventory_id, item_id, item_name, movement_type, quantity,
        previous_balance, new_balance, batch_number, location, source_module,
        unit_cost, total_value, created_by, notes)
       VALUES ($1, $2, $3, 'Test Drug 500mg', 'grn_receive', 100, 0, 100,
               $4, 'warehouse', 'scm', 10, 1000, $5, $6)`,
      [hospitalId, invId, itemId, `${SCOPE}-B1`, actorUserId, `${SCOPE}-opening`]
    );

    // 4. Create PO
    const poNumber = `PO-2026-${SCOPE}`.slice(0, 30); // truncate to fit varchar
    const poRows = await sql(
      `INSERT INTO purchase_orders
       (hospital_id, po_number, vendor_id, status, total_items, total_amount,
        expected_delivery, created_by, notes)
       VALUES ($1, $2, $3, 'draft', 0, 0, '2026-06-01', $4, $5)
       RETURNING id`,
      [hospitalId, poNumber, vendorId, actorUserId, `${SCOPE}-po`]
    );
    const poId = poRows[0].id;

    // 5. Add a line item: 50 more tabs @ ₹10
    const poiRows = await sql(
      `INSERT INTO purchase_order_items
       (hospital_id, po_id, item_id, item_name, quantity_ordered, unit_cost, total_cost, notes)
       VALUES ($1, $2, $3, 'Test Drug 500mg', 50, 10, 500, $4)
       RETURNING id`,
      [hospitalId, poId, itemId, `${SCOPE}-poi`]
    );
    const poiId = poiRows[0].id;

    await sql(
      `UPDATE purchase_orders SET total_items = 1, total_amount = 500 WHERE id = $1`,
      [poId]
    );

    // 6. Approve → sent_to_vendor → receive
    await sql(
      `UPDATE purchase_orders SET status = 'approved', approved_by = $1, approved_at = NOW(),
       approver_role = 'hod' WHERE id = $2`,
      [actorUserId, poId]
    );
    await sql(
      `UPDATE purchase_orders SET status = 'sent_to_vendor', sent_to_vendor_at = NOW() WHERE id = $1`,
      [poId]
    );

    // 7. Receive 50 tabs against the line item — bumps inventory, writes ledger entry,
    //    closes PO (since cumulative_received == ordered)
    await sql(
      `UPDATE purchase_order_items SET quantity_received = 50 WHERE id = $1`,
      [poiId]
    );
    await sql(
      `UPDATE inventory SET quantity_on_hand = quantity_on_hand + 50,
       last_movement_at = NOW(), last_restocked_at = NOW() WHERE id = $1`,
      [invId]
    );
    await sql(
      `INSERT INTO stock_movements
       (hospital_id, inventory_id, item_id, item_name, movement_type, quantity,
        previous_balance, new_balance, batch_number, location, source_module,
        source_ref_id, unit_cost, total_value, vendor_id, created_by, notes)
       VALUES ($1, $2, $3, 'Test Drug 500mg', 'grn_receive', 50, 100, 150,
               $4, 'warehouse', 'scm', $5, 10, 500, $6, $7, $8)`,
      [hospitalId, invId, itemId, `${SCOPE}-B1`, poId, vendorId, actorUserId, `${SCOPE}-receive`]
    );
    await sql(
      `UPDATE purchase_orders SET status = 'received',
       first_received_at = NOW(), fully_received_at = NOW() WHERE id = $1`,
      [poId]
    );

    // 8. Assertions
    const inv = await sql(`SELECT quantity_on_hand FROM inventory WHERE id = $1`, [invId]);
    expect(Number(inv[0].quantity_on_hand)).toBe(150);

    const po = await sql(`SELECT status, total_amount FROM purchase_orders WHERE id = $1`, [poId]);
    expect(po[0].status).toBe('received');
    expect(Number(po[0].total_amount)).toBe(500);

    const movements = await sql(
      `SELECT movement_type, quantity, previous_balance, new_balance, source_module
       FROM stock_movements WHERE inventory_id = $1 ORDER BY created_at ASC`,
      [invId]
    );
    expect(movements.length).toBe(2);
    expect(movements[0].movement_type).toBe('grn_receive');
    expect(Number(movements[0].quantity)).toBe(100);
    expect(movements[1].movement_type).toBe('grn_receive');
    expect(Number(movements[1].quantity)).toBe(50);
    expect(Number(movements[1].new_balance)).toBe(150);
  });

  it('low-stock scan: inventory below reorder generates auto_reorder_draft', async () => {
    // Insert an item with default_reorder_level = 100, then inventory at 30 → should generate draft
    const itemRows = await sql(
      `INSERT INTO items
       (hospital_id, code, display_name, kind, unit_of_measure, status, created_by,
        default_reorder_level, default_reorder_quantity)
       VALUES ($1, $2, 'Test Low-Stock Item', 'consumable', 'box', 'active', $3, 100, 200)
       RETURNING id`,
      [hospitalId, `${SCOPE}-LOW`, actorUserId]
    );
    const itemId = itemRows[0].id;

    const invRows = await sql(
      `INSERT INTO inventory
       (hospital_id, item_id, location, batch_number, quantity_on_hand, unit_cost, mrp, is_active)
       VALUES ($1, $2, 'warehouse', $3, 30, 5, 8, TRUE)
       RETURNING id`,
      [hospitalId, itemId, `${SCOPE}-B-LOW`]
    );
    const invId = invRows[0].id;

    // Mirror scm.alerts.checkLowStock — find low stock + insert draft if none exists
    const lowStock = await sql(
      `SELECT inv.id AS inventory_id, inv.item_id, inv.quantity_on_hand,
              COALESCE(inv.reorder_level, it.default_reorder_level, 0) AS effective_reorder_level
       FROM inventory inv
       LEFT JOIN items it ON inv.item_id = it.id
       WHERE inv.id = $1
         AND inv.quantity_on_hand <= COALESCE(inv.reorder_level, it.default_reorder_level, 0)`,
      [invId]
    );
    expect(lowStock.length).toBe(1);

    await sql(
      `INSERT INTO auto_reorder_drafts
       (hospital_id, item_id, inventory_id, current_quantity, reorder_level,
        suggested_quantity, status, expires_at, review_notes)
       VALUES ($1, $2, $3, 30, 100, 200, 'pending_review', NOW() + INTERVAL '14 days', $4)`,
      [hospitalId, itemId, invId, `${SCOPE}-low-stock-draft`]
    );

    const drafts = await sql(
      `SELECT status FROM auto_reorder_drafts WHERE inventory_id = $1`,
      [invId]
    );
    expect(drafts.length).toBe(1);
    expect(drafts[0].status).toBe('pending_review');
  });

  it('CHECK constraint: items.status rejects invalid lifecycle state', async () => {
    await expect(
      sql(
        `INSERT INTO items
         (hospital_id, code, display_name, kind, unit_of_measure, status, created_by)
         VALUES ($1, $2, 'Bad Status', 'drug', 'tab', 'totally_made_up', $3)`,
        [hospitalId, `${SCOPE}-BAD`, actorUserId]
      )
    ).rejects.toThrow();
  });
});

// Reminder when integration tests are skipped
describe.skipIf(RUN)('SCM procurement flow (skipped — set VITEST_INTEGRATION=1)', () => {
  it('runs only with VITEST_INTEGRATION=1', () => {
    expect(RUN).toBe(false);
  });
});
