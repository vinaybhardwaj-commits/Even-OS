import { neon, type NeonQueryFunction } from '@neondatabase/serverless';

// ============================================================
// SCM transactional helper — Phase 1.6
//
// Wraps Neon's batch-mode transaction support so receive/transfer flows
// that write multiple rows can do so atomically.
//
// Neon HTTP driver (`@neondatabase/serverless`) exposes `sql.transaction([])`
// which batches a sequence of pre-built SQL queries into a single round-trip
// PostgreSQL transaction (BEGIN/COMMIT/ROLLBACK). All queries succeed or
// all rollback.
//
// Limitation: this is BATCH mode — you cannot have conditional logic
// between statements (no "read row, branch, then write"). For procedures
// that need that pattern (e.g. inventory.adjust which pre-checks balance,
// then UPDATEs + INSERTs), the existing sequential best-effort approach
// continues. Phase 2 may switch those paths to pgBouncer + node-postgres
// for full session-mode transactions.
//
// Use when:
//   ✓ scm.inventory.transfer  — pair of stock_movements + 1 inventory UPDATE + 1 inventory UPSERT
//   ✓ scm.purchaseOrders.receive — N pairs of stock_movements + inventory UPSERTS, + PO update
//
// Don't use when:
//   ✗ Logic between statements depends on the result of an earlier read
//   ✗ The sequence already short-circuits on intermediate validation
//
// Convention: `runInTransaction(builders)` accepts a synchronous list-builder
// that returns Neon SQL queries. The helper passes them to sql.transaction().
// ============================================================

let _sqlClient: NeonQueryFunction<false, false> | null = null;
function getSql() {
  if (!_sqlClient) _sqlClient = neon(process.env.DATABASE_URL!);
  return _sqlClient;
}

/**
 * Run a sequence of pre-built SQL queries inside a single Neon transaction.
 * Returns the array of query results in submission order.
 *
 * IMPORTANT: queries cannot use prior-result values. Build the entire list
 * up-front. For conditional flows, fall through to sequential calls.
 *
 * @param queries Array of pre-built Neon query Promise-like objects
 *                (i.e. the raw output of `sql\`SELECT ...\`` template literal
 *                or `sql(text, params)` parametric call WITHOUT awaiting).
 *
 * Example:
 *   const sql = getSql();
 *   await runInTransaction([
 *     sql(`UPDATE inventory SET quantity_on_hand = $1 WHERE id = $2`, [next, invId]),
 *     sql(`INSERT INTO stock_movements (...) VALUES (...)`, [...]),
 *   ]);
 */
export async function runInTransaction<T = any>(queries: any[]): Promise<T[]> {
  const sql = getSql();
  // The Neon HTTP driver's transaction() method takes an array of pre-built
  // queries. Pass through directly.
  return (sql as any).transaction(queries);
}

/** Re-export the lazy Neon client for callers that need raw access. */
export { getSql };
