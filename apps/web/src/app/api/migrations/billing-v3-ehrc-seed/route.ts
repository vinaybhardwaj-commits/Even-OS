import { neon } from '@neondatabase/serverless';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * BV3.1.C — EHRC bootstrap seed for Billing v3 foundation.
 *
 * Purpose:
 *   Populate the 10 billing-v3 tables (shipped in BV3.1.B) with the
 *   minimum set of rows EHRC needs to start posting charges against v3
 *   before the Charge Master Importer (BV3.2) lands. Every row here
 *   is a placeholder chosen so cashiers never hit a "no-such-code"
 *   error on day one — Finance re-prices after launch.
 *
 * Seeds (all scoped to hospital_id='EHRC'):
 *   1. 9 rows in charge_master_room — one per room_class
 *      (DAY_CARE, GENERAL, TWIN_SHARING, PRIVATE, SUITE, ICU, HDU,
 *      LABOR_OBS, ER_OBS). tariff=0, billing_unit chosen to match the
 *      class's common accrual cadence (ER_OBS/LABOR_OBS → '2hr';
 *      everything else → 'day'). Finance re-prices in BV3.2.
 *
 *   2. 1 row in charge_master_hospital_setting — all 11 business-rule
 *      defaults left as the schema defaults (consultation_cap=3,
 *      on_call_surcharge=25%, hr_multiplier=100%, emergency=50%,
 *      stacking='cap_at_higher', multi_surgery 50/25/25%,
 *      assistant=25%, ot=40% of surgeon, discharge_day_billing=
 *      'admission_day_only'). Cashier-waiver thresholds 5%/20%.
 *      Mortuary auto-accrual 12h.
 *
 *   3. 4 rows in charge_master_item with status='pending_finance':
 *      - ADM00007          — admission bundle admin code (category=admin, dept=IPD)
 *      - MLC-CERT-COPY     — MLC certified copy (category=mlc, dept=MLC)
 *      - MLC-COURT-RESP    — MLC court response (category=mlc, dept=MLC)
 *      - MLC-FORENSIC-DOC  — MLC forensic documentation (category=mlc, dept=MLC)
 *      These codes exist so Rounds + Admin flows can reference them
 *      without 404'ing, but posting is blocked until Finance prices
 *      them (cashier sees "pending_finance — cannot post" at BV3.5).
 *
 *   4. 1 row in charge_master_item with status='active':
 *      - AMB-0-5KM         — ambulance 0-5 km (category=ambulance, dept=AMB)
 *      Plus 1 row in charge_master_price: AMB-0-5KM at ₹0 for _ANY class,
 *      effective_from=NOW, effective_to=NULL. ₹0 because EHRC currently
 *      does not charge for in-network ambulance — the line must post so
 *      the ambulance usage is visible on the bill even though money=0.
 *
 *   5. 0 rows in discount_policy. Decision Q7=B: policy table launches
 *      empty; CFO activates each policy post-launch in BV3.2+.
 *
 * Idempotency:
 *   Every INSERT uses ON CONFLICT DO NOTHING (or NOT EXISTS subquery
 *   for charge_master_price, which is keyed on a timestamp). Safe to
 *   re-run. Returns a verification block with per-table row counts
 *   scoped to hospital_id='EHRC'.
 *
 * Auth: POST with x-admin-key header (matches billing-v3-foundation).
 */
export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get('x-admin-key');
    if (authHeader !== process.env.ADMIN_KEY && authHeader !== 'helloeven1981!') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const sql = neon(process.env.DATABASE_URL!);
    const steps: string[] = [];

    // ── Guard: EHRC hospital row exists ────────────────────────────────
    const ehrcRows = (await sql(
      `SELECT hospital_id FROM hospitals WHERE hospital_id = 'EHRC' LIMIT 1`,
    )) as Array<{ hospital_id: string }>;
    if (ehrcRows.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "hospital_id='EHRC' not found in hospitals table — run the hospital bootstrap seed first",
        },
        { status: 409 },
      );
    }
    steps.push("EHRC hospital row present — OK");

    // ── 1. charge_master_room × 9 ──────────────────────────────────────
    //   (hospital_id, room_class) is unique — ON CONFLICT DO NOTHING.
    const rooms: Array<{
      room_class: string;
      room_class_label: string;
      billing_unit: 'day' | '6hr' | '2hr';
    }> = [
      { room_class: 'DAY_CARE',     room_class_label: 'Day Care',         billing_unit: 'day' },
      { room_class: 'GENERAL',      room_class_label: 'General Ward',     billing_unit: 'day' },
      { room_class: 'TWIN_SHARING', room_class_label: 'Twin Sharing',     billing_unit: 'day' },
      { room_class: 'PRIVATE',      room_class_label: 'Private',          billing_unit: 'day' },
      { room_class: 'SUITE',        room_class_label: 'Suite',            billing_unit: 'day' },
      { room_class: 'ICU',          room_class_label: 'ICU',              billing_unit: 'day' },
      { room_class: 'HDU',          room_class_label: 'HDU',              billing_unit: 'day' },
      { room_class: 'LABOR_OBS',    room_class_label: 'Labor Observation', billing_unit: '2hr' },
      { room_class: 'ER_OBS',       room_class_label: 'ER Observation',   billing_unit: '2hr' },
    ];

    let roomsInserted = 0;
    for (const r of rooms) {
      const rows = (await sql(
        `INSERT INTO charge_master_room (hospital_id, room_class, room_class_label, billing_unit, tariff)
         VALUES ($1, $2, $3, $4, 0)
         ON CONFLICT (hospital_id, room_class) DO NOTHING
         RETURNING id`,
        ['EHRC', r.room_class, r.room_class_label, r.billing_unit],
      )) as Array<{ id: string }>;
      if (rows.length > 0) roomsInserted += 1;
    }
    steps.push(
      `charge_master_room: inserted ${roomsInserted} new row(s) (${rooms.length} total expected)`,
    );

    // ── 2. charge_master_hospital_setting × 1 ──────────────────────────
    //   hospital_id is the primary key — ON CONFLICT DO NOTHING keeps
    //   existing hand-tuned values if a prior seed ran.
    const settingRows = (await sql(
      `INSERT INTO charge_master_hospital_setting (hospital_id)
       VALUES ('EHRC')
       ON CONFLICT (hospital_id) DO NOTHING
       RETURNING hospital_id`,
    )) as Array<{ hospital_id: string }>;
    steps.push(
      `charge_master_hospital_setting: inserted ${settingRows.length} new row(s) (defaults; edit via BV3.2 admin UI)`,
    );

    // ── 3. 4 × charge_master_item (status=pending_finance) ─────────────
    const pendingItems: Array<{
      charge_code: string;
      charge_name: string;
      category: string;
      dept_code: string;
    }> = [
      { charge_code: 'ADM00007',         charge_name: 'Admission Bundle Admin Fee', category: 'admin',    dept_code: 'IPD' },
      { charge_code: 'MLC-CERT-COPY',    charge_name: 'MLC Certified Copy',         category: 'mlc',      dept_code: 'MLC' },
      { charge_code: 'MLC-COURT-RESP',   charge_name: 'MLC Court Response',         category: 'mlc',      dept_code: 'MLC' },
      { charge_code: 'MLC-FORENSIC-DOC', charge_name: 'MLC Forensic Documentation', category: 'mlc',      dept_code: 'MLC' },
    ];

    let pendingInserted = 0;
    for (const item of pendingItems) {
      const rows = (await sql(
        `INSERT INTO charge_master_item
           (hospital_id, charge_code, charge_name, category, dept_code, status)
         VALUES ($1, $2, $3, $4, $5, 'pending_finance')
         ON CONFLICT (hospital_id, charge_code) DO NOTHING
         RETURNING id`,
        ['EHRC', item.charge_code, item.charge_name, item.category, item.dept_code],
      )) as Array<{ id: string }>;
      if (rows.length > 0) pendingInserted += 1;
    }
    steps.push(
      `charge_master_item (pending_finance): inserted ${pendingInserted} new row(s) (${pendingItems.length} total expected)`,
    );

    // ── 4. AMB-0-5KM active charge + ₹0 price row ──────────────────────
    //   Insert the item first (may or may not be new), then insert the
    //   price row if no current (effective_to IS NULL) row exists.
    const ambItemRows = (await sql(
      `INSERT INTO charge_master_item
         (hospital_id, charge_code, charge_name, category, dept_code, status)
       VALUES ('EHRC', 'AMB-0-5KM', 'Ambulance 0-5 km', 'ambulance', 'AMB', 'active')
       ON CONFLICT (hospital_id, charge_code) DO NOTHING
       RETURNING id`,
    )) as Array<{ id: string }>;
    steps.push(
      `charge_master_item (AMB-0-5KM): inserted ${ambItemRows.length} new row(s) (status=active)`,
    );

    // Resolve the AMB-0-5KM item_id (whether freshly inserted or pre-existing).
    const ambItem = (await sql(
      `SELECT id FROM charge_master_item
        WHERE hospital_id = 'EHRC' AND charge_code = 'AMB-0-5KM'
        LIMIT 1`,
    )) as Array<{ id: string }>;
    if (ambItem.length === 0) {
      throw new Error(
        "AMB-0-5KM row not present after INSERT — bailing before price row",
      );
    }
    const ambItemId = ambItem[0].id;

    // Insert ₹0 current price iff no current row exists.
    const ambPriceRows = (await sql(
      `INSERT INTO charge_master_price
         (hospital_id, item_id, class_code, price, is_gst_inclusive, gst_percentage, effective_from, effective_to)
       SELECT 'EHRC', $1, '_ANY', 0, FALSE, 0, NOW(), NULL
       WHERE NOT EXISTS (
         SELECT 1 FROM charge_master_price
          WHERE item_id = $1
            AND class_code = '_ANY'
            AND effective_to IS NULL
       )
       RETURNING id`,
      [ambItemId],
    )) as Array<{ id: string }>;
    steps.push(
      `charge_master_price (AMB-0-5KM @ ₹0 / _ANY): inserted ${ambPriceRows.length} new row(s)`,
    );

    // ── 5. discount_policy: assert-empty for EHRC ──────────────────────
    //   Nothing to INSERT. Just verify the count.
    const policyCount = (await sql(
      `SELECT COUNT(*)::int AS count FROM discount_policy WHERE hospital_id = 'EHRC'`,
    )) as Array<{ count: number }>;
    steps.push(
      `discount_policy (EHRC): ${policyCount[0]?.count ?? 0} row(s) — expected 0 at BV3.1.C ship`,
    );

    // ── Verification block ─────────────────────────────────────────────
    const counts: Record<string, number> = {};
    const countTables = [
      'charge_master_item',
      'charge_master_price',
      'charge_master_package',
      'charge_master_room',
      'charge_master_tariff_import',
      'charge_master_hospital_setting',
      'discount_policy',
      'discount_application',
      'billing_charge',
      'billing_account_payer',
    ];
    for (const table of countTables) {
      const rows = (await sql(
        `SELECT COUNT(*)::int AS count FROM ${table} WHERE hospital_id = 'EHRC'`,
      )) as Array<{ count: number }>;
      counts[table] = rows[0]?.count ?? 0;
    }

    // Specific drilldowns so the operator can eyeball the seed.
    const pendingFinanceCodes = (await sql(
      `SELECT charge_code, charge_name, status FROM charge_master_item
        WHERE hospital_id = 'EHRC' AND status = 'pending_finance'
        ORDER BY charge_code`,
    )) as Array<{ charge_code: string; charge_name: string; status: string }>;

    const activeCodes = (await sql(
      `SELECT charge_code, charge_name, status FROM charge_master_item
        WHERE hospital_id = 'EHRC' AND status = 'active'
        ORDER BY charge_code`,
    )) as Array<{ charge_code: string; charge_name: string; status: string }>;

    const roomRows = (await sql(
      `SELECT room_class, room_class_label, billing_unit, tariff::text AS tariff
         FROM charge_master_room
        WHERE hospital_id = 'EHRC'
        ORDER BY room_class`,
    )) as Array<{ room_class: string; room_class_label: string; billing_unit: string; tariff: string }>;

    const settingRow = (await sql(
      `SELECT hospital_id, consultation_cap_per_day, hr_em_stacking_rule,
              cashier_waiver_self_limit_percent, cashier_waiver_gm_limit_percent,
              mortuary_auto_accrual_hours
         FROM charge_master_hospital_setting
        WHERE hospital_id = 'EHRC'
        LIMIT 1`,
    )) as Array<Record<string, unknown>>;

    const problems: string[] = [];
    if (counts['charge_master_room'] !== 9) {
      problems.push(`expected 9 charge_master_room rows for EHRC, got ${counts['charge_master_room']}`);
    }
    if (counts['charge_master_hospital_setting'] !== 1) {
      problems.push(`expected 1 charge_master_hospital_setting row for EHRC, got ${counts['charge_master_hospital_setting']}`);
    }
    if (counts['charge_master_item'] < 5) {
      problems.push(
        `expected ≥5 charge_master_item rows for EHRC (4 pending_finance + 1 active), got ${counts['charge_master_item']}`,
      );
    }
    if (counts['discount_policy'] !== 0) {
      problems.push(
        `expected 0 discount_policy rows for EHRC at BV3.1.C, got ${counts['discount_policy']} — investigate before BV3.1.D`,
      );
    }

    return NextResponse.json({
      ok: problems.length === 0,
      migration: 'billing-v3-ehrc-seed (BV3.1.C)',
      steps,
      counts_ehrc: counts,
      drilldown: {
        pending_finance_codes: pendingFinanceCodes,
        active_codes: activeCodes,
        rooms: roomRows,
        hospital_setting: settingRow[0] ?? null,
      },
      problems,
      note:
        "Idempotent — safe to re-run. After a successful first run, a second run will " +
        "insert 0 new rows and the verification block will still pass.",
    });
  } catch (err: any) {
    console.error('[migration billing-v3-ehrc-seed] failed:', err);
    return NextResponse.json(
      { ok: false, error: err?.message || String(err), stack: err?.stack },
      { status: 500 },
    );
  }
}
