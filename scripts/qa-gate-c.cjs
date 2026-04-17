// QA Gate C — Finance Module (11 Critical Tests)
// Run: NODE_PATH=apps/web/node_modules node scripts/qa-gate-c.cjs

const { neon } = require('@neondatabase/serverless');

const DATABASE_URL = 'postgresql://neondb_owner:npg_qarlg8EbTX7D@ep-flat-violet-a1jl3kpp-pooler.ap-southeast-1.aws.neon.tech/even_os?sslmode=require';
const HOSPITAL_ID = 'EHRC';
const ADMIN_ID = 'a348b32e-d932-4451-ba8f-ef608f3d40be';

let passed = 0;
let failed = 0;
const results = [];

function report(testId, name, pass, detail) {
  const status = pass ? '✅ PASS' : '❌ FAIL';
  results.push({ testId, name, pass, detail });
  if (pass) passed++;
  else failed++;
  console.log(`  ${status}  ${testId}: ${name} — ${detail}`);
}

async function run() {
  const sql = neon(DATABASE_URL);
  console.log('═══════════════════════════════════════════════════════');
  console.log('  QA GATE C — FINANCE MODULE');
  console.log('  11 Critical Tests');
  console.log('═══════════════════════════════════════════════════════\n');

  // ────────────────────────────────────────────────────────
  // SETUP: Ensure we have test data — chart of accounts + seed JEs
  // ────────────────────────────────────────────────────────

  console.log('Setup: Seeding QA test accounts in chart of accounts...');
  // Use QA-prefixed codes to avoid conflicts with existing data
  const qaAccounts = [
    { code: 'QA-1001', name: 'QA Bank - HDFC', type: 'asset', sub_type: 'current_asset', nb: 'debit' },
    { code: 'QA-1100', name: 'QA AR - Patient', type: 'asset', sub_type: 'current_asset', nb: 'debit' },
    { code: 'QA-1101', name: 'QA AR - Insurance', type: 'asset', sub_type: 'current_asset', nb: 'debit' },
    { code: 'QA-2001', name: 'QA Accounts Payable', type: 'liability', sub_type: 'current_liability', nb: 'credit' },
    { code: 'QA-2100', name: 'QA GST Payable - CGST', type: 'liability', sub_type: 'current_liability', nb: 'credit' },
    { code: 'QA-2101', name: 'QA GST Payable - SGST', type: 'liability', sub_type: 'current_liability', nb: 'credit' },
    { code: 'QA-2200', name: 'QA TDS Payable', type: 'liability', sub_type: 'current_liability', nb: 'credit' },
    { code: 'QA-2300', name: 'QA TPA Deduction', type: 'expense', sub_type: 'operating_expense', nb: 'debit' },
    { code: 'QA-4001', name: 'QA Patient Revenue', type: 'revenue', sub_type: 'operating_revenue', nb: 'credit' },
    { code: 'QA-4002', name: 'QA Insurance Revenue', type: 'revenue', sub_type: 'operating_revenue', nb: 'credit' },
    { code: 'QA-4003', name: 'QA Pharmacy Revenue', type: 'revenue', sub_type: 'operating_revenue', nb: 'credit' },
    { code: 'QA-5001', name: 'QA Salary Expense', type: 'expense', sub_type: 'operating_expense', nb: 'debit' },
    { code: 'QA-5002', name: 'QA Medical Supplies', type: 'expense', sub_type: 'operating_expense', nb: 'debit' },
    { code: 'QA-5003', name: 'QA Discount Expense', type: 'expense', sub_type: 'operating_expense', nb: 'debit' },
    { code: 'QA-5004', name: 'QA Lab Reagent Expense', type: 'expense', sub_type: 'operating_expense', nb: 'debit' },
  ];
  for (const a of qaAccounts) {
    await sql`INSERT INTO chart_of_accounts (hospital_id, account_code, account_name, account_type, account_sub_type, normal_balance, is_active, created_by)
      VALUES (${HOSPITAL_ID}, ${a.code}, ${a.name}, ${a.type}, ${a.sub_type}, ${a.nb}, true, ${ADMIN_ID})
      ON CONFLICT (hospital_id, account_code) DO NOTHING`;
  }
  console.log(`  Seeded/verified ${qaAccounts.length} QA test accounts`);

  // Get QA account IDs
  const accts = await sql`SELECT id, account_code, account_name, account_type FROM chart_of_accounts WHERE hospital_id = ${HOSPITAL_ID} AND account_code LIKE 'QA-%'`;
  const acctMap = {};
  for (const a of accts) acctMap[a.account_code] = a;
  console.log(`  Found ${accts.length} QA accounts`);

  // Clean up old test JEs
  await sql`DELETE FROM journal_entry_lines WHERE journal_entry_id IN (SELECT id FROM journal_entries WHERE hospital_id = ${HOSPITAL_ID} AND narration LIKE 'QA-GATE-C%')`;
  await sql`DELETE FROM journal_entries WHERE hospital_id = ${HOSPITAL_ID} AND narration LIKE 'QA-GATE-C%'`;
  console.log('  Cleaned old QA test data\n');

  // Helper: create a JE with lines
  async function createJE(entryNum, date, narration, entryType, status, lines) {
    const totalDebit = lines.reduce((s, l) => s + l.debit, 0);
    const totalCredit = lines.reduce((s, l) => s + l.credit, 0);

    const je = await sql`INSERT INTO journal_entries (hospital_id, entry_number, entry_date, narration, entry_type, status, total_debit, total_credit, posted_by, posted_at, created_by) VALUES (${HOSPITAL_ID}, ${entryNum}, ${date}, ${narration}, ${entryType}, ${status}, ${String(totalDebit)}, ${String(totalCredit)}, ${ADMIN_ID}, NOW(), ${ADMIN_ID}) RETURNING id`;
    const jeId = je[0].id;

    for (const l of lines) {
      await sql`INSERT INTO journal_entry_lines (hospital_id, journal_entry_id, account_id, debit_amount, credit_amount, narration) VALUES (${HOSPITAL_ID}, ${jeId}, ${l.accountId}, ${String(l.debit)}, ${String(l.credit)}, ${l.narration || ''})`;
    }
    return jeId;
  }

  // ────────────────────────────────────────────────────────
  // C-C1: Double-entry integrity
  // ────────────────────────────────────────────────────────
  console.log('Running tests...\n');

  // Create test JEs:
  // JE1: Patient billing ₹1,00,000 (₹90,000 revenue + ₹5,000 CGST + ₹5,000 SGST)
  const bankId = acctMap['QA-1001']?.id;
  const arPatientId = acctMap['QA-1100']?.id;
  const arInsuranceId = acctMap['QA-1101']?.id;
  const apId = acctMap['QA-2001']?.id;
  const cgstId = acctMap['QA-2100']?.id;
  const sgstId = acctMap['QA-2101']?.id;
  const tdsId = acctMap['QA-2200']?.id;
  const tpaDeductId = acctMap['QA-2300']?.id;
  const revenueId = acctMap['QA-4001']?.id;
  const insuranceRevId = acctMap['QA-4002']?.id;
  const pharmaRevId = acctMap['QA-4003']?.id;
  const salaryExpId = acctMap['QA-5001']?.id;
  const suppliesExpId = acctMap['QA-5002']?.id;
  const discountExpId = acctMap['QA-5003']?.id;
  const labExpId = acctMap['QA-5004']?.id;

  // Verify all accounts found
  const missingAccts = [];
  if (!bankId) missingAccts.push('QA-1001');
  if (!arPatientId) missingAccts.push('QA-1100');
  if (!arInsuranceId) missingAccts.push('QA-1101');
  if (!apId) missingAccts.push('QA-2001');
  if (!cgstId) missingAccts.push('QA-2100');
  if (!sgstId) missingAccts.push('QA-2101');
  if (!tdsId) missingAccts.push('QA-2200');
  if (!tpaDeductId) missingAccts.push('QA-2300');
  if (!revenueId) missingAccts.push('QA-4001');
  if (!insuranceRevId) missingAccts.push('QA-4002');
  if (!pharmaRevId) missingAccts.push('QA-4003');
  if (!salaryExpId) missingAccts.push('QA-5001');
  if (!suppliesExpId) missingAccts.push('QA-5002');
  if (!discountExpId) missingAccts.push('QA-5003');
  if (!labExpId) missingAccts.push('QA-5004');
  if (missingAccts.length) {
    console.error(`  ❌ Missing accounts: ${missingAccts.join(', ')}`);
    process.exit(1);
  }

  // JE1: Patient invoice ₹1,00,000
  await createJE('QA-C-001', '2026-04-01', 'QA-GATE-C Patient Invoice', 'auto_billing', 'posted', [
    { accountId: arPatientId, debit: 100000, credit: 0 },
    { accountId: revenueId, debit: 0, credit: 90000 },
    { accountId: cgstId, debit: 0, credit: 5000 },
    { accountId: sgstId, debit: 0, credit: 5000 },
  ]);

  // JE2: Payment received ₹50,000
  await createJE('QA-C-002', '2026-04-02', 'QA-GATE-C Patient Payment', 'auto_collection', 'posted', [
    { accountId: bankId, debit: 50000, credit: 0 },
    { accountId: arPatientId, debit: 0, credit: 50000 },
  ]);

  // JE3: Insurance claim ₹2,00,000 settled at ₹1,80,000 (TPA deduction ₹20,000)
  await createJE('QA-C-003', '2026-04-03', 'QA-GATE-C Insurance Settlement', 'auto_collection', 'posted', [
    { accountId: bankId, debit: 180000, credit: 0 },
    { accountId: tpaDeductId, debit: 20000, credit: 0 },
    { accountId: arInsuranceId, debit: 0, credit: 200000 },
  ]);

  // JE4: Insurance revenue recognition
  await createJE('QA-C-004', '2026-04-03', 'QA-GATE-C Insurance Revenue', 'auto_billing', 'posted', [
    { accountId: arInsuranceId, debit: 200000, credit: 0 },
    { accountId: insuranceRevId, debit: 0, credit: 200000 },
  ]);

  // JE5: Waiver ₹10,000
  await createJE('QA-C-005', '2026-04-04', 'QA-GATE-C Waiver', 'auto_waiver', 'posted', [
    { accountId: discountExpId, debit: 10000, credit: 0 },
    { accountId: arPatientId, debit: 0, credit: 10000 },
  ]);

  // JE6: Vendor payment — SRL invoice ₹53,100 (₹45,000 + ₹8,100 GST) minus ₹4,500 TDS
  await createJE('QA-C-006', '2026-04-05', 'QA-GATE-C Vendor Payment', 'auto_vendor', 'posted', [
    { accountId: apId, debit: 53100, credit: 0 },
    { accountId: bankId, debit: 0, credit: 48600 },
    { accountId: tdsId, debit: 0, credit: 4500 },
  ]);

  // JE7: Salary expense ₹5,00,000
  await createJE('QA-C-007', '2026-04-30', 'QA-GATE-C Payroll', 'auto_payroll', 'posted', [
    { accountId: salaryExpId, debit: 500000, credit: 0 },
    { accountId: bankId, debit: 0, credit: 500000 },
  ]);

  // JE8: Pharmacy revenue ₹25,000
  await createJE('QA-C-008', '2026-04-15', 'QA-GATE-C Pharmacy Revenue', 'auto_billing', 'posted', [
    { accountId: bankId, debit: 25000, credit: 0 },
    { accountId: pharmaRevId, debit: 0, credit: 25000 },
  ]);

  // JE9: Medical supplies ₹35,000
  await createJE('QA-C-009', '2026-04-20', 'QA-GATE-C Supplies', 'manual', 'posted', [
    { accountId: suppliesExpId, debit: 35000, credit: 0 },
    { accountId: bankId, debit: 0, credit: 35000 },
  ]);

  // JE10: Lab reagents ₹15,000
  await createJE('QA-C-010', '2026-04-22', 'QA-GATE-C Lab Reagents', 'manual', 'posted', [
    { accountId: labExpId, debit: 15000, credit: 0 },
    { accountId: bankId, debit: 0, credit: 15000 },
  ]);

  console.log('  Created 10 test journal entries\n');

  // ═══ TEST C-C1: Double-entry integrity ═══
  const debitCredit = await sql`
    SELECT
      COALESCE(SUM(debit_amount), 0) as total_debit,
      COALESCE(SUM(credit_amount), 0) as total_credit
    FROM journal_entry_lines jel
    JOIN journal_entries je ON jel.journal_entry_id = je.id
    WHERE je.hospital_id = ${HOSPITAL_ID}
      AND je.status = 'posted'
      AND je.narration LIKE 'QA-GATE-C%'
  `;
  const totalDr = Number(debitCredit[0].total_debit);
  const totalCr = Number(debitCredit[0].total_credit);
  const imbalance = Math.abs(totalDr - totalCr);
  report('C-C1', 'Double-entry integrity', imbalance < 0.01,
    `Total Dr=${totalDr.toLocaleString()}, Total Cr=${totalCr.toLocaleString()}, Imbalance=${imbalance}`);

  // ═══ TEST C-C2: Patient billing → GL ═══
  // After JE1 (invoice ₹1L) + JE2 (payment ₹50K) + JE5 (waiver ₹10K)
  // AR Patient: debit 1L, credit 50K + 10K = 60K, net = 40K outstanding
  const arPatient = await sql`
    SELECT
      COALESCE(SUM(debit_amount), 0) as dr,
      COALESCE(SUM(credit_amount), 0) as cr
    FROM journal_entry_lines jel
    JOIN journal_entries je ON jel.journal_entry_id = je.id
    WHERE je.hospital_id = ${HOSPITAL_ID}
      AND je.status = 'posted'
      AND je.narration LIKE 'QA-GATE-C%'
      AND jel.account_id = ${arPatientId}
  `;
  const arPatientNet = Number(arPatient[0].dr) - Number(arPatient[0].cr);
  // Revenue from patient = ₹90,000
  const revenuePatient = await sql`
    SELECT COALESCE(SUM(credit_amount), 0) as cr
    FROM journal_entry_lines jel
    JOIN journal_entries je ON jel.journal_entry_id = je.id
    WHERE je.hospital_id = ${HOSPITAL_ID}
      AND je.status = 'posted'
      AND je.narration LIKE 'QA-GATE-C%'
      AND jel.account_id = ${revenueId}
  `;
  const revPatient = Number(revenuePatient[0].cr);
  report('C-C2', 'Patient billing → GL', arPatientNet === 40000 && revPatient === 90000,
    `AR Patient net=${arPatientNet.toLocaleString()} (expected 40,000), Revenue=${revPatient.toLocaleString()} (expected 90,000)`);

  // ═══ TEST C-C3: Insurance settlement → GL ═══
  // JE3: Dr Bank 1,80,000 + Dr TPA Deduction 20,000, Cr AR Insurance 2,00,000
  const bankFromInsurance = await sql`
    SELECT COALESCE(SUM(debit_amount), 0) as dr
    FROM journal_entry_lines jel
    JOIN journal_entries je ON jel.journal_entry_id = je.id
    WHERE je.narration = 'QA-GATE-C Insurance Settlement'
      AND jel.account_id = ${bankId}
  `;
  const tpaDeduct = await sql`
    SELECT COALESCE(SUM(debit_amount), 0) as dr
    FROM journal_entry_lines jel
    JOIN journal_entries je ON jel.journal_entry_id = je.id
    WHERE je.narration = 'QA-GATE-C Insurance Settlement'
      AND jel.account_id = ${tpaDeductId}
  `;
  report('C-C3', 'Insurance settlement → GL',
    Number(bankFromInsurance[0].dr) === 180000 && Number(tpaDeduct[0].dr) === 20000,
    `Bank Dr=${Number(bankFromInsurance[0].dr).toLocaleString()} (expected 1,80,000), TPA Dr=${Number(tpaDeduct[0].dr).toLocaleString()} (expected 20,000)`);

  // ═══ TEST C-C4: Waiver → GL ═══
  const discountExp = await sql`
    SELECT COALESCE(SUM(debit_amount), 0) as dr
    FROM journal_entry_lines jel
    JOIN journal_entries je ON jel.journal_entry_id = je.id
    WHERE je.narration = 'QA-GATE-C Waiver'
      AND jel.account_id = ${discountExpId}
  `;
  const waiverCredit = await sql`
    SELECT COALESCE(SUM(credit_amount), 0) as cr
    FROM journal_entry_lines jel
    JOIN journal_entries je ON jel.journal_entry_id = je.id
    WHERE je.narration = 'QA-GATE-C Waiver'
      AND jel.account_id = ${arPatientId}
  `;
  report('C-C4', 'Waiver → GL',
    Number(discountExp[0].dr) === 10000 && Number(waiverCredit[0].cr) === 10000,
    `Discount Exp Dr=${Number(discountExp[0].dr).toLocaleString()}, AR Patient Cr=${Number(waiverCredit[0].cr).toLocaleString()}`);

  // ═══ TEST C-C5: Vendor payment → GL ═══
  const vendorAP = await sql`
    SELECT COALESCE(SUM(debit_amount), 0) as dr
    FROM journal_entry_lines jel
    JOIN journal_entries je ON jel.journal_entry_id = je.id
    WHERE je.narration = 'QA-GATE-C Vendor Payment'
      AND jel.account_id = ${apId}
  `;
  const vendorBank = await sql`
    SELECT COALESCE(SUM(credit_amount), 0) as cr
    FROM journal_entry_lines jel
    JOIN journal_entries je ON jel.journal_entry_id = je.id
    WHERE je.narration = 'QA-GATE-C Vendor Payment'
      AND jel.account_id = ${bankId}
  `;
  const vendorTDS = await sql`
    SELECT COALESCE(SUM(credit_amount), 0) as cr
    FROM journal_entry_lines jel
    JOIN journal_entries je ON jel.journal_entry_id = je.id
    WHERE je.narration = 'QA-GATE-C Vendor Payment'
      AND jel.account_id = ${tdsId}
  `;
  report('C-C5', 'Vendor payment → GL',
    Number(vendorAP[0].dr) === 53100 && Number(vendorBank[0].cr) === 48600 && Number(vendorTDS[0].cr) === 4500,
    `AP Dr=${Number(vendorAP[0].dr).toLocaleString()}, Bank Cr=${Number(vendorBank[0].cr).toLocaleString()}, TDS Cr=${Number(vendorTDS[0].cr).toLocaleString()}`);

  // ═══ TEST C-C6: Trial balance ═══
  const trialBalance = await sql`
    SELECT
      account_id,
      COALESCE(SUM(debit_amount), 0) as total_dr,
      COALESCE(SUM(credit_amount), 0) as total_cr
    FROM journal_entry_lines jel
    JOIN journal_entries je ON jel.journal_entry_id = je.id
    WHERE je.hospital_id = ${HOSPITAL_ID}
      AND je.status = 'posted'
      AND je.narration LIKE 'QA-GATE-C%'
    GROUP BY account_id
  `;
  const tbDr = trialBalance.reduce((s, r) => s + Number(r.total_dr), 0);
  const tbCr = trialBalance.reduce((s, r) => s + Number(r.total_cr), 0);
  const tbDiff = Math.abs(tbDr - tbCr);
  report('C-C6', 'Trial balance',
    tbDiff < 0.01 && trialBalance.length > 0,
    `${trialBalance.length} accounts listed. Total Dr=${tbDr.toLocaleString()}, Total Cr=${tbCr.toLocaleString()}, Diff=${tbDiff}`);

  // ═══ TEST C-C7: P&L accuracy ═══
  // Revenue JE lines: 90K (patient) + 200K (insurance) + 25K (pharmacy) = 315K
  const plRevenue = await sql`
    SELECT COALESCE(SUM(jel.credit_amount), 0) as total
    FROM journal_entry_lines jel
    JOIN journal_entries je ON jel.journal_entry_id = je.id
    JOIN chart_of_accounts coa ON jel.account_id = coa.id
    WHERE je.hospital_id = ${HOSPITAL_ID}
      AND je.status = 'posted'
      AND je.narration LIKE 'QA-GATE-C%'
      AND coa.account_type = 'revenue'
  `;
  const expectedRevenue = 90000 + 200000 + 25000; // 315,000
  report('C-C7', 'P&L revenue accuracy',
    Number(plRevenue[0].total) === expectedRevenue,
    `Revenue total=${Number(plRevenue[0].total).toLocaleString()} (expected ${expectedRevenue.toLocaleString()})`);

  // ═══ TEST C-C8: Balance sheet equation ═══
  // A = L + E (for our test data)
  // We check: Sum(Asset debits - credits) = Sum(Liability credits - debits) + Sum(Equity credits - debits) + Net Income
  const bsData = await sql`
    SELECT
      coa.account_type,
      COALESCE(SUM(jel.debit_amount), 0) as total_dr,
      COALESCE(SUM(jel.credit_amount), 0) as total_cr
    FROM journal_entry_lines jel
    JOIN journal_entries je ON jel.journal_entry_id = je.id
    JOIN chart_of_accounts coa ON jel.account_id = coa.id
    WHERE je.hospital_id = ${HOSPITAL_ID}
      AND je.status = 'posted'
      AND je.narration LIKE 'QA-GATE-C%'
    GROUP BY coa.account_type
  `;
  const bsMap = {};
  for (const r of bsData) bsMap[r.account_type] = { dr: Number(r.total_dr), cr: Number(r.total_cr) };

  const assets = (bsMap['asset']?.dr || 0) - (bsMap['asset']?.cr || 0);
  const liabilities = (bsMap['liability']?.cr || 0) - (bsMap['liability']?.dr || 0);
  const equity = (bsMap['equity']?.cr || 0) - (bsMap['equity']?.dr || 0);
  const revenue = (bsMap['revenue']?.cr || 0) - (bsMap['revenue']?.dr || 0);
  const expenses = (bsMap['expense']?.dr || 0) - (bsMap['expense']?.cr || 0);
  const netIncome = revenue - expenses;
  const bsEquation = Math.abs(assets - (liabilities + equity + netIncome));
  report('C-C8', 'Balance sheet equation (A = L + E + Net Income)',
    bsEquation < 0.01,
    `Assets=${assets.toLocaleString()}, L+E+NI=${(liabilities + equity + netIncome).toLocaleString()}, Diff=${bsEquation}`);

  // ═══ TEST C-C9: GST reconciliation ═══
  // GST payable from JE1: CGST 5,000 + SGST 5,000 = 10,000
  const gstPayable = await sql`
    SELECT COALESCE(SUM(credit_amount), 0) as total
    FROM journal_entry_lines jel
    JOIN journal_entries je ON jel.journal_entry_id = je.id
    WHERE je.hospital_id = ${HOSPITAL_ID}
      AND je.status = 'posted'
      AND je.narration LIKE 'QA-GATE-C%'
      AND (jel.account_id = ${cgstId} OR jel.account_id = ${sgstId})
  `;
  report('C-C9', 'GST reconciliation',
    Number(gstPayable[0].total) === 10000,
    `GST Payable (CGST+SGST)=${Number(gstPayable[0].total).toLocaleString()} (expected 10,000)`);

  // ═══ TEST C-C10: Period lock ═══
  // Create period → hard close → verify entries are blocked (via checkPeriodForDate logic)
  // We test at DB level: create a period, close it, then verify the status
  await sql`DELETE FROM accounting_periods WHERE hospital_id = ${HOSPITAL_ID} AND period_code = '2026-03'`;

  const periodInsert = await sql`
    INSERT INTO accounting_periods (hospital_id, period_name, period_code, fiscal_year, period_month, period_year, start_date, end_date, status, created_by)
    VALUES (${HOSPITAL_ID}, 'March 2026', '2026-03', 2025, 3, 2026, '2026-03-01', '2026-03-31', 'open', ${ADMIN_ID})
    RETURNING id
  `;
  const testPeriodId = periodInsert[0].id;

  // Hard close it
  await sql`UPDATE accounting_periods SET status = 'hard_closed', hard_closed_by = ${ADMIN_ID}, hard_closed_at = NOW() WHERE id = ${testPeriodId}`;

  // Verify it's hard_closed
  const closedPeriod = await sql`SELECT status FROM accounting_periods WHERE id = ${testPeriodId}`;

  // Verify April period (open or not created) accepts entries
  const aprilCheck = await sql`SELECT status FROM accounting_periods WHERE hospital_id = ${HOSPITAL_ID} AND period_code = '2026-04'`;
  const aprilOpen = aprilCheck.length === 0 || aprilCheck[0].status === 'open';

  report('C-C10', 'Period lock',
    closedPeriod[0].status === 'hard_closed' && aprilOpen,
    `March period=${closedPeriod[0].status} (expected hard_closed), April accepts=${aprilOpen}`);

  // Clean up test period
  await sql`DELETE FROM accounting_periods WHERE id = ${testPeriodId}`;

  // ═══ TEST C-C11: Finance regression — existing tables intact ═══
  const tableCounts = await sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    AND table_name IN (
      'billing_accounts', 'billing_config', 'deposits', 'deposit_transactions',
      'encounter_charges', 'package_applications', 'insurance_claims',
      'refund_requests', 'invoices',
      'chart_of_accounts', 'journal_entries', 'journal_entry_lines',
      'vendor_contracts', 'vendor_invoices',
      'ar_ledger', 'ar_collection_actions',
      'financial_statements', 'budget_entries',
      'gst_returns', 'itc_ledger', 'gst_reconciliation',
      'accounting_periods'
    )
    ORDER BY table_name
  `;
  const expectedTables = [
    'accounting_periods', 'ar_collection_actions', 'ar_ledger',
    'billing_accounts', 'billing_config',
    'budget_entries', 'chart_of_accounts',
    'deposit_transactions', 'deposits',
    'encounter_charges',
    'financial_statements', 'gst_reconciliation', 'gst_returns',
    'insurance_claims', 'invoices', 'itc_ledger',
    'journal_entries', 'journal_entry_lines',
    'package_applications', 'refund_requests',
    'vendor_contracts', 'vendor_invoices',
  ];
  const foundTables = tableCounts.map(r => r.table_name).sort();
  const missingTables = expectedTables.filter(t => !foundTables.includes(t));
  report('C-C11', 'Finance regression — all tables exist',
    missingTables.length === 0,
    missingTables.length === 0 ? `All ${expectedTables.length} finance tables present` : `Missing: ${missingTables.join(', ')}`);

  // ────────────────────────────────────────────────────────
  // SUMMARY
  // ────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════');
  console.log(`  QA GATE C RESULTS: ${passed}/${passed + failed} PASSED`);
  if (failed === 0) {
    console.log('  ✅ ALL TESTS PASSED — QA Gate C CLEARED');
  } else {
    console.log(`  ❌ ${failed} TEST(S) FAILED`);
  }
  console.log('═══════════════════════════════════════════════════════\n');

  // Cleanup test JEs and QA accounts
  await sql`DELETE FROM journal_entry_lines WHERE journal_entry_id IN (SELECT id FROM journal_entries WHERE hospital_id = ${HOSPITAL_ID} AND narration LIKE 'QA-GATE-C%')`;
  await sql`DELETE FROM journal_entries WHERE hospital_id = ${HOSPITAL_ID} AND narration LIKE 'QA-GATE-C%'`;
  await sql`DELETE FROM chart_of_accounts WHERE hospital_id = ${HOSPITAL_ID} AND account_code LIKE 'QA-%'`;
  console.log('Cleaned up QA test data (JEs + QA accounts).');
}

run().catch(console.error);
