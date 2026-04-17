/**
 * C.1 Chart of Accounts Migration — Finance Module Foundation
 *
 * Creates:
 * 1. chart_of_accounts — Hierarchical GL account structure
 *
 * Seeds ~80 Ind AS compliant hospital accounts across:
 * - Revenue (12+ accounts)
 * - Expense (20+ accounts)
 * - Asset (10+ accounts)
 * - Liability (8+ accounts)
 * - Equity (3 accounts)
 *
 * 4-level hierarchy: Group → Sub-Group → Ledger → Sub-Ledger
 * Auto-generates account codes based on type prefix.
 */

const { neon } = require('@neondatabase/serverless');

const sql = neon(process.env.DATABASE_URL);

const HOSPITAL_ID = 'EHRC';
const ADMIN_USER_ID = 'a348b32e-d932-4451-ba8f-ef608f3d40be';

async function migrate() {
  console.log('[C.1 Chart of Accounts] Starting migration...\n');

  try {
    // ================================================================
    // CREATE ENUMS (if not exist)
    // ================================================================
    console.log('Creating enums...');

    await sql`DO $$ BEGIN CREATE TYPE coa_account_type AS ENUM ('asset','liability','equity','revenue','expense'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`;
    await sql`DO $$ BEGIN CREATE TYPE coa_account_sub_type AS ENUM ('current_asset','fixed_asset','current_liability','long_term_liability','operating_revenue','other_income','operating_expense','cogs','depreciation','tax','equity_capital','equity_reserves'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`;
    await sql`DO $$ BEGIN CREATE TYPE coa_normal_balance AS ENUM ('debit','credit'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`;

    console.log('  Enums created\n');

    // ================================================================
    // CREATE TABLE
    // ================================================================
    console.log('Creating chart_of_accounts table...');

    await sql`
      CREATE TABLE IF NOT EXISTS chart_of_accounts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        hospital_id text NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,

        account_code varchar(20) NOT NULL,
        account_name text NOT NULL,
        account_type text NOT NULL,
        account_sub_type text,

        parent_account_id uuid REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
        level integer NOT NULL DEFAULT 1,

        is_group boolean NOT NULL DEFAULT false,
        normal_balance text NOT NULL,

        gst_applicable boolean DEFAULT false,
        hsn_sac_code varchar(20),

        description text,

        is_active boolean NOT NULL DEFAULT true,
        is_system_account boolean NOT NULL DEFAULT false,

        opening_balance numeric(15,2) DEFAULT 0,
        opening_balance_date date,

        created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        created_at timestamp NOT NULL DEFAULT now(),
        updated_at timestamp NOT NULL DEFAULT now()
      )
    `;

    await sql`CREATE INDEX IF NOT EXISTS idx_coa_hospital ON chart_of_accounts(hospital_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_coa_parent ON chart_of_accounts(parent_account_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_coa_type ON chart_of_accounts(account_type)`;
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_coa_code_unique ON chart_of_accounts(hospital_id, account_code)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_coa_level ON chart_of_accounts(level)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_coa_system ON chart_of_accounts(is_system_account)`;

    console.log('  chart_of_accounts created\n');

    // ================================================================
    // SEED CHART OF ACCOUNTS
    // ================================================================
    console.log('Seeding Ind AS compliant hospital chart of accounts...\n');

    // Helper to insert an account and return its ID
    async function insertAccount(account) {
      const result = await sql`
        INSERT INTO chart_of_accounts
        (hospital_id, account_code, account_name, account_type, account_sub_type,
         parent_account_id, level, is_group, normal_balance, gst_applicable,
         hsn_sac_code, description, is_system_account, created_by)
        VALUES
        (${HOSPITAL_ID}, ${account.code}, ${account.name}, ${account.type}, ${account.sub_type || null},
         ${account.parent_id || null}, ${account.level}, ${account.is_group || false}, ${account.normal_balance},
         ${account.gst_applicable || false}, ${account.hsn_sac || null}, ${account.description || null},
         ${account.is_system || false}, ${ADMIN_USER_ID})
        ON CONFLICT (hospital_id, account_code) DO UPDATE SET
          account_name = EXCLUDED.account_name,
          account_type = EXCLUDED.account_type,
          updated_at = now()
        RETURNING id
      `;
      return result[0].id;
    }

    let count = 0;

    // ============================================================
    // 1. ASSETS (Code prefix: 1xxx)
    // ============================================================
    console.log('  [ASSETS]');

    const assetGroupId = await insertAccount({
      code: '1000', name: 'Assets', type: 'asset', level: 1,
      is_group: true, normal_balance: 'debit', is_system: true,
      description: 'All hospital assets',
    });
    count++;

    // -- Current Assets
    const currentAssetId = await insertAccount({
      code: '1100', name: 'Current Assets', type: 'asset', sub_type: 'current_asset',
      parent_id: assetGroupId, level: 2, is_group: true, normal_balance: 'debit', is_system: true,
    });
    count++;

    const cashId = await insertAccount({
      code: '1110', name: 'Cash on Hand', type: 'asset', sub_type: 'current_asset',
      parent_id: currentAssetId, level: 3, normal_balance: 'debit', is_system: true,
      description: 'Physical cash at hospital counters',
    });
    count++;

    const bankId = await insertAccount({
      code: '1120', name: 'Bank Accounts', type: 'asset', sub_type: 'current_asset',
      parent_id: currentAssetId, level: 3, is_group: true, normal_balance: 'debit', is_system: true,
    });
    count++;

    await insertAccount({
      code: '1121', name: 'Bank — Primary Operating', type: 'asset', sub_type: 'current_asset',
      parent_id: bankId, level: 4, normal_balance: 'debit', is_system: true,
      description: 'Main operating bank account',
    });
    count++;

    await insertAccount({
      code: '1122', name: 'Bank — Collections', type: 'asset', sub_type: 'current_asset',
      parent_id: bankId, level: 4, normal_balance: 'debit',
      description: 'Insurance and TPA collection account',
    });
    count++;

    await insertAccount({
      code: '1123', name: 'Bank — Salary Account', type: 'asset', sub_type: 'current_asset',
      parent_id: bankId, level: 4, normal_balance: 'debit',
    });
    count++;

    const arId = await insertAccount({
      code: '1130', name: 'Accounts Receivable', type: 'asset', sub_type: 'current_asset',
      parent_id: currentAssetId, level: 3, is_group: true, normal_balance: 'debit', is_system: true,
    });
    count++;

    await insertAccount({
      code: '1131', name: 'AR — Patient (Self-Pay)', type: 'asset', sub_type: 'current_asset',
      parent_id: arId, level: 4, normal_balance: 'debit', is_system: true,
    });
    count++;

    await insertAccount({
      code: '1132', name: 'AR — Insurance / TPA', type: 'asset', sub_type: 'current_asset',
      parent_id: arId, level: 4, normal_balance: 'debit', is_system: true,
    });
    count++;

    await insertAccount({
      code: '1133', name: 'AR — Corporate', type: 'asset', sub_type: 'current_asset',
      parent_id: arId, level: 4, normal_balance: 'debit',
    });
    count++;

    const inventoryId = await insertAccount({
      code: '1140', name: 'Inventory', type: 'asset', sub_type: 'current_asset',
      parent_id: currentAssetId, level: 3, is_group: true, normal_balance: 'debit',
    });
    count++;

    await insertAccount({
      code: '1141', name: 'Inventory — Pharmacy', type: 'asset', sub_type: 'current_asset',
      parent_id: inventoryId, level: 4, normal_balance: 'debit',
    });
    count++;

    await insertAccount({
      code: '1142', name: 'Inventory — Consumables', type: 'asset', sub_type: 'current_asset',
      parent_id: inventoryId, level: 4, normal_balance: 'debit',
    });
    count++;

    await insertAccount({
      code: '1143', name: 'Inventory — Implants', type: 'asset', sub_type: 'current_asset',
      parent_id: inventoryId, level: 4, normal_balance: 'debit',
    });
    count++;

    await insertAccount({
      code: '1150', name: 'Prepaid Expenses', type: 'asset', sub_type: 'current_asset',
      parent_id: currentAssetId, level: 3, normal_balance: 'debit',
      description: 'Insurance premiums, AMC prepayments, rent advances',
    });
    count++;

    await insertAccount({
      code: '1160', name: 'Security Deposits', type: 'asset', sub_type: 'current_asset',
      parent_id: currentAssetId, level: 3, normal_balance: 'debit',
      description: 'Utility deposits, lease deposits',
    });
    count++;

    // -- Fixed Assets
    const fixedAssetId = await insertAccount({
      code: '1200', name: 'Fixed Assets', type: 'asset', sub_type: 'fixed_asset',
      parent_id: assetGroupId, level: 2, is_group: true, normal_balance: 'debit', is_system: true,
    });
    count++;

    await insertAccount({
      code: '1210', name: 'Medical Equipment', type: 'asset', sub_type: 'fixed_asset',
      parent_id: fixedAssetId, level: 3, normal_balance: 'debit',
    });
    count++;

    await insertAccount({
      code: '1220', name: 'Furniture & Fixtures', type: 'asset', sub_type: 'fixed_asset',
      parent_id: fixedAssetId, level: 3, normal_balance: 'debit',
    });
    count++;

    await insertAccount({
      code: '1230', name: 'IT Equipment & Software', type: 'asset', sub_type: 'fixed_asset',
      parent_id: fixedAssetId, level: 3, normal_balance: 'debit',
    });
    count++;

    await insertAccount({
      code: '1240', name: 'Building & Leasehold Improvements', type: 'asset', sub_type: 'fixed_asset',
      parent_id: fixedAssetId, level: 3, normal_balance: 'debit',
    });
    count++;

    await insertAccount({
      code: '1250', name: 'Vehicles', type: 'asset', sub_type: 'fixed_asset',
      parent_id: fixedAssetId, level: 3, normal_balance: 'debit',
    });
    count++;

    await insertAccount({
      code: '1290', name: 'Accumulated Depreciation', type: 'asset', sub_type: 'fixed_asset',
      parent_id: fixedAssetId, level: 3, normal_balance: 'credit', is_system: true,
      description: 'Contra-asset account for accumulated depreciation',
    });
    count++;

    console.log(`    ${count} asset accounts seeded`);

    // ============================================================
    // 2. LIABILITIES (Code prefix: 2xxx)
    // ============================================================
    console.log('  [LIABILITIES]');
    const liabStart = count;

    const liabGroupId = await insertAccount({
      code: '2000', name: 'Liabilities', type: 'liability', level: 1,
      is_group: true, normal_balance: 'credit', is_system: true,
    });
    count++;

    const currentLiabId = await insertAccount({
      code: '2100', name: 'Current Liabilities', type: 'liability', sub_type: 'current_liability',
      parent_id: liabGroupId, level: 2, is_group: true, normal_balance: 'credit', is_system: true,
    });
    count++;

    const apId = await insertAccount({
      code: '2110', name: 'Accounts Payable — Vendors', type: 'liability', sub_type: 'current_liability',
      parent_id: currentLiabId, level: 3, normal_balance: 'credit', is_system: true,
    });
    count++;

    await insertAccount({
      code: '2120', name: 'Salaries Payable', type: 'liability', sub_type: 'current_liability',
      parent_id: currentLiabId, level: 3, normal_balance: 'credit',
    });
    count++;

    await insertAccount({
      code: '2130', name: 'Patient Deposits (Advance)', type: 'liability', sub_type: 'current_liability',
      parent_id: currentLiabId, level: 3, normal_balance: 'credit', is_system: true,
      description: 'Patient advance deposits — liability until applied to bills',
    });
    count++;

    const tdsPayableId = await insertAccount({
      code: '2140', name: 'TDS Payable', type: 'liability', sub_type: 'current_liability',
      parent_id: currentLiabId, level: 3, normal_balance: 'credit', is_system: true,
      description: 'Tax deducted at source, pending remittance',
    });
    count++;

    const gstPayableId = await insertAccount({
      code: '2150', name: 'GST Payable', type: 'liability', sub_type: 'current_liability',
      parent_id: currentLiabId, level: 3, is_group: true, normal_balance: 'credit', is_system: true,
    });
    count++;

    await insertAccount({
      code: '2151', name: 'CGST Payable', type: 'liability', sub_type: 'current_liability',
      parent_id: gstPayableId, level: 4, normal_balance: 'credit', is_system: true,
    });
    count++;

    await insertAccount({
      code: '2152', name: 'SGST Payable', type: 'liability', sub_type: 'current_liability',
      parent_id: gstPayableId, level: 4, normal_balance: 'credit', is_system: true,
    });
    count++;

    await insertAccount({
      code: '2153', name: 'IGST Payable', type: 'liability', sub_type: 'current_liability',
      parent_id: gstPayableId, level: 4, normal_balance: 'credit', is_system: true,
    });
    count++;

    await insertAccount({
      code: '2160', name: 'Provision for Bad Debts', type: 'liability', sub_type: 'current_liability',
      parent_id: currentLiabId, level: 3, normal_balance: 'credit',
    });
    count++;

    await insertAccount({
      code: '2170', name: 'Employee Benefits Payable', type: 'liability', sub_type: 'current_liability',
      parent_id: currentLiabId, level: 3, normal_balance: 'credit',
      description: 'PF, ESI, gratuity, leave encashment',
    });
    count++;

    await insertAccount({
      code: '2180', name: 'Other Current Payables', type: 'liability', sub_type: 'current_liability',
      parent_id: currentLiabId, level: 3, normal_balance: 'credit',
    });
    count++;

    // Long-term liabilities
    const ltLiabId = await insertAccount({
      code: '2200', name: 'Long-Term Liabilities', type: 'liability', sub_type: 'long_term_liability',
      parent_id: liabGroupId, level: 2, is_group: true, normal_balance: 'credit',
    });
    count++;

    await insertAccount({
      code: '2210', name: 'Long-Term Loans', type: 'liability', sub_type: 'long_term_liability',
      parent_id: ltLiabId, level: 3, normal_balance: 'credit',
    });
    count++;

    await insertAccount({
      code: '2220', name: 'Lease Liabilities', type: 'liability', sub_type: 'long_term_liability',
      parent_id: ltLiabId, level: 3, normal_balance: 'credit',
    });
    count++;

    console.log(`    ${count - liabStart} liability accounts seeded`);

    // ============================================================
    // 3. EQUITY (Code prefix: 3xxx)
    // ============================================================
    console.log('  [EQUITY]');
    const eqStart = count;

    const equityGroupId = await insertAccount({
      code: '3000', name: 'Equity', type: 'equity', level: 1,
      is_group: true, normal_balance: 'credit', is_system: true,
    });
    count++;

    await insertAccount({
      code: '3100', name: 'Capital', type: 'equity', sub_type: 'equity_capital',
      parent_id: equityGroupId, level: 2, normal_balance: 'credit', is_system: true,
      description: 'Owner/promoter capital contribution',
    });
    count++;

    await insertAccount({
      code: '3200', name: 'Retained Earnings', type: 'equity', sub_type: 'equity_reserves',
      parent_id: equityGroupId, level: 2, normal_balance: 'credit', is_system: true,
      description: 'Accumulated profits/losses carried forward',
    });
    count++;

    await insertAccount({
      code: '3300', name: 'Reserves & Surplus', type: 'equity', sub_type: 'equity_reserves',
      parent_id: equityGroupId, level: 2, normal_balance: 'credit',
    });
    count++;

    console.log(`    ${count - eqStart} equity accounts seeded`);

    // ============================================================
    // 4. REVENUE (Code prefix: 4xxx)
    // ============================================================
    console.log('  [REVENUE]');
    const revStart = count;

    const revenueGroupId = await insertAccount({
      code: '4000', name: 'Revenue', type: 'revenue', level: 1,
      is_group: true, normal_balance: 'credit', is_system: true,
    });
    count++;

    const opRevId = await insertAccount({
      code: '4100', name: 'Operating Revenue', type: 'revenue', sub_type: 'operating_revenue',
      parent_id: revenueGroupId, level: 2, is_group: true, normal_balance: 'credit', is_system: true,
    });
    count++;

    await insertAccount({
      code: '4110', name: 'IPD Revenue', type: 'revenue', sub_type: 'operating_revenue',
      parent_id: opRevId, level: 3, normal_balance: 'credit', is_system: true,
      gst_applicable: true, hsn_sac: '999312',
      description: 'Inpatient bed charges, nursing, general ward',
    });
    count++;

    await insertAccount({
      code: '4120', name: 'OPD Revenue', type: 'revenue', sub_type: 'operating_revenue',
      parent_id: opRevId, level: 3, normal_balance: 'credit', is_system: true,
      gst_applicable: true, hsn_sac: '999312',
    });
    count++;

    await insertAccount({
      code: '4130', name: 'Pharmacy Revenue', type: 'revenue', sub_type: 'operating_revenue',
      parent_id: opRevId, level: 3, normal_balance: 'credit', is_system: true,
      gst_applicable: true, hsn_sac: '3004',
    });
    count++;

    await insertAccount({
      code: '4140', name: 'Lab Revenue', type: 'revenue', sub_type: 'operating_revenue',
      parent_id: opRevId, level: 3, normal_balance: 'credit', is_system: true,
      gst_applicable: true, hsn_sac: '999312',
    });
    count++;

    await insertAccount({
      code: '4150', name: 'Radiology Revenue', type: 'revenue', sub_type: 'operating_revenue',
      parent_id: opRevId, level: 3, normal_balance: 'credit', is_system: true,
      gst_applicable: true, hsn_sac: '999312',
    });
    count++;

    await insertAccount({
      code: '4160', name: 'OT Revenue', type: 'revenue', sub_type: 'operating_revenue',
      parent_id: opRevId, level: 3, normal_balance: 'credit', is_system: true,
      gst_applicable: true, hsn_sac: '999312',
      description: 'Operation theatre charges, surgeon fees, anesthesia',
    });
    count++;

    await insertAccount({
      code: '4170', name: 'Room Rent Revenue', type: 'revenue', sub_type: 'operating_revenue',
      parent_id: opRevId, level: 3, normal_balance: 'credit', is_system: true,
      gst_applicable: true, hsn_sac: '999312',
    });
    count++;

    await insertAccount({
      code: '4180', name: 'Consultation Fees', type: 'revenue', sub_type: 'operating_revenue',
      parent_id: opRevId, level: 3, normal_balance: 'credit', is_system: true,
      gst_applicable: true, hsn_sac: '999312',
    });
    count++;

    await insertAccount({
      code: '4190', name: 'Procedure Charges', type: 'revenue', sub_type: 'operating_revenue',
      parent_id: opRevId, level: 3, normal_balance: 'credit',
      gst_applicable: true, hsn_sac: '999312',
    });
    count++;

    await insertAccount({
      code: '4195', name: 'Package Revenue', type: 'revenue', sub_type: 'operating_revenue',
      parent_id: opRevId, level: 3, normal_balance: 'credit',
      gst_applicable: true, hsn_sac: '999312',
    });
    count++;

    // Other income
    const otherIncomeId = await insertAccount({
      code: '4200', name: 'Other Income', type: 'revenue', sub_type: 'other_income',
      parent_id: revenueGroupId, level: 2, is_group: true, normal_balance: 'credit',
    });
    count++;

    await insertAccount({
      code: '4210', name: 'Interest Income', type: 'revenue', sub_type: 'other_income',
      parent_id: otherIncomeId, level: 3, normal_balance: 'credit',
    });
    count++;

    await insertAccount({
      code: '4220', name: 'Miscellaneous Income', type: 'revenue', sub_type: 'other_income',
      parent_id: otherIncomeId, level: 3, normal_balance: 'credit',
    });
    count++;

    console.log(`    ${count - revStart} revenue accounts seeded`);

    // ============================================================
    // 5. EXPENSES (Code prefix: 5xxx)
    // ============================================================
    console.log('  [EXPENSES]');
    const expStart = count;

    const expenseGroupId = await insertAccount({
      code: '5000', name: 'Expenses', type: 'expense', level: 1,
      is_group: true, normal_balance: 'debit', is_system: true,
    });
    count++;

    // -- Operating Expenses
    const opExpId = await insertAccount({
      code: '5100', name: 'Operating Expenses', type: 'expense', sub_type: 'operating_expense',
      parent_id: expenseGroupId, level: 2, is_group: true, normal_balance: 'debit', is_system: true,
    });
    count++;

    await insertAccount({
      code: '5110', name: 'Salaries & Wages', type: 'expense', sub_type: 'operating_expense',
      parent_id: opExpId, level: 3, normal_balance: 'debit', is_system: true,
    });
    count++;

    await insertAccount({
      code: '5120', name: 'Consultant Fees & Honoraria', type: 'expense', sub_type: 'operating_expense',
      parent_id: opExpId, level: 3, normal_balance: 'debit',
    });
    count++;

    await insertAccount({
      code: '5130', name: 'Employee Benefits (PF/ESI/Gratuity)', type: 'expense', sub_type: 'operating_expense',
      parent_id: opExpId, level: 3, normal_balance: 'debit',
    });
    count++;

    // -- Cost of Goods Sold
    const cogsId = await insertAccount({
      code: '5200', name: 'Cost of Goods Sold', type: 'expense', sub_type: 'cogs',
      parent_id: expenseGroupId, level: 2, is_group: true, normal_balance: 'debit', is_system: true,
    });
    count++;

    await insertAccount({
      code: '5210', name: 'Pharmacy Purchases', type: 'expense', sub_type: 'cogs',
      parent_id: cogsId, level: 3, normal_balance: 'debit',
      gst_applicable: true,
    });
    count++;

    await insertAccount({
      code: '5220', name: 'Lab Consumables', type: 'expense', sub_type: 'cogs',
      parent_id: cogsId, level: 3, normal_balance: 'debit',
      gst_applicable: true,
    });
    count++;

    await insertAccount({
      code: '5230', name: 'Surgical Consumables', type: 'expense', sub_type: 'cogs',
      parent_id: cogsId, level: 3, normal_balance: 'debit',
      gst_applicable: true,
    });
    count++;

    await insertAccount({
      code: '5240', name: 'Implant Costs', type: 'expense', sub_type: 'cogs',
      parent_id: cogsId, level: 3, normal_balance: 'debit',
      gst_applicable: true,
    });
    count++;

    await insertAccount({
      code: '5250', name: 'Outsourced Lab Costs', type: 'expense', sub_type: 'cogs',
      parent_id: cogsId, level: 3, normal_balance: 'debit',
      description: 'Payments to external labs (SRL, etc.)',
      gst_applicable: true,
    });
    count++;

    // -- Facility Expenses
    const facilityExpId = await insertAccount({
      code: '5300', name: 'Facility Expenses', type: 'expense', sub_type: 'operating_expense',
      parent_id: expenseGroupId, level: 2, is_group: true, normal_balance: 'debit',
    });
    count++;

    await insertAccount({
      code: '5310', name: 'Housekeeping', type: 'expense', sub_type: 'operating_expense',
      parent_id: facilityExpId, level: 3, normal_balance: 'debit',
    });
    count++;

    await insertAccount({
      code: '5320', name: 'Laundry', type: 'expense', sub_type: 'operating_expense',
      parent_id: facilityExpId, level: 3, normal_balance: 'debit',
    });
    count++;

    await insertAccount({
      code: '5330', name: 'Dietary & Catering', type: 'expense', sub_type: 'operating_expense',
      parent_id: facilityExpId, level: 3, normal_balance: 'debit',
    });
    count++;

    await insertAccount({
      code: '5340', name: 'Maintenance & Repairs', type: 'expense', sub_type: 'operating_expense',
      parent_id: facilityExpId, level: 3, normal_balance: 'debit',
    });
    count++;

    await insertAccount({
      code: '5350', name: 'Equipment AMC', type: 'expense', sub_type: 'operating_expense',
      parent_id: facilityExpId, level: 3, normal_balance: 'debit',
    });
    count++;

    // -- Admin & Overheads
    const adminExpId = await insertAccount({
      code: '5400', name: 'Administrative Expenses', type: 'expense', sub_type: 'operating_expense',
      parent_id: expenseGroupId, level: 2, is_group: true, normal_balance: 'debit',
    });
    count++;

    await insertAccount({
      code: '5410', name: 'Rent', type: 'expense', sub_type: 'operating_expense',
      parent_id: adminExpId, level: 3, normal_balance: 'debit',
    });
    count++;

    await insertAccount({
      code: '5420', name: 'Utilities (Electricity, Water, Gas)', type: 'expense', sub_type: 'operating_expense',
      parent_id: adminExpId, level: 3, normal_balance: 'debit',
    });
    count++;

    await insertAccount({
      code: '5430', name: 'Insurance Premiums', type: 'expense', sub_type: 'operating_expense',
      parent_id: adminExpId, level: 3, normal_balance: 'debit',
    });
    count++;

    await insertAccount({
      code: '5440', name: 'Marketing & Advertising', type: 'expense', sub_type: 'operating_expense',
      parent_id: adminExpId, level: 3, normal_balance: 'debit',
    });
    count++;

    await insertAccount({
      code: '5450', name: 'Legal & Professional Fees', type: 'expense', sub_type: 'operating_expense',
      parent_id: adminExpId, level: 3, normal_balance: 'debit',
    });
    count++;

    await insertAccount({
      code: '5460', name: 'Printing & Stationery', type: 'expense', sub_type: 'operating_expense',
      parent_id: adminExpId, level: 3, normal_balance: 'debit',
    });
    count++;

    await insertAccount({
      code: '5470', name: 'Communication (Phone/Internet)', type: 'expense', sub_type: 'operating_expense',
      parent_id: adminExpId, level: 3, normal_balance: 'debit',
    });
    count++;

    await insertAccount({
      code: '5480', name: 'Travel & Conveyance', type: 'expense', sub_type: 'operating_expense',
      parent_id: adminExpId, level: 3, normal_balance: 'debit',
    });
    count++;

    // -- Depreciation
    await insertAccount({
      code: '5500', name: 'Depreciation', type: 'expense', sub_type: 'depreciation',
      parent_id: expenseGroupId, level: 2, normal_balance: 'debit', is_system: true,
    });
    count++;

    // -- Financial Charges
    const finExpId = await insertAccount({
      code: '5600', name: 'Financial Charges', type: 'expense', sub_type: 'operating_expense',
      parent_id: expenseGroupId, level: 2, is_group: true, normal_balance: 'debit',
    });
    count++;

    await insertAccount({
      code: '5610', name: 'Bank Charges', type: 'expense', sub_type: 'operating_expense',
      parent_id: finExpId, level: 3, normal_balance: 'debit',
    });
    count++;

    await insertAccount({
      code: '5620', name: 'Interest on Loans', type: 'expense', sub_type: 'operating_expense',
      parent_id: finExpId, level: 3, normal_balance: 'debit',
    });
    count++;

    // -- Discount / Waiver Expense
    await insertAccount({
      code: '5700', name: 'Discount / Waiver Expense', type: 'expense', sub_type: 'operating_expense',
      parent_id: expenseGroupId, level: 2, normal_balance: 'debit', is_system: true,
      description: 'Patient discounts, hardship waivers, TPA negotiated deductions',
    });
    count++;

    // -- TPA Deductions
    await insertAccount({
      code: '5800', name: 'TPA Deductions & Disallowances', type: 'expense', sub_type: 'operating_expense',
      parent_id: expenseGroupId, level: 2, normal_balance: 'debit', is_system: true,
      description: 'Amounts deducted by TPAs during claim settlement',
    });
    count++;

    // -- Bad Debts
    await insertAccount({
      code: '5900', name: 'Bad Debts Written Off', type: 'expense', sub_type: 'operating_expense',
      parent_id: expenseGroupId, level: 2, normal_balance: 'debit',
    });
    count++;

    console.log(`    ${count - expStart} expense accounts seeded`);

    // ================================================================
    // VERIFY
    // ================================================================
    console.log('\nVerifying...\n');

    const totalCount = await sql`
      SELECT COUNT(*) as cnt FROM chart_of_accounts WHERE hospital_id = ${HOSPITAL_ID}
    `;
    const byType = await sql`
      SELECT account_type, COUNT(*) as cnt
      FROM chart_of_accounts
      WHERE hospital_id = ${HOSPITAL_ID}
      GROUP BY account_type
      ORDER BY account_type
    `;
    const systemCount = await sql`
      SELECT COUNT(*) as cnt FROM chart_of_accounts
      WHERE hospital_id = ${HOSPITAL_ID} AND is_system_account = true
    `;

    console.log(`  Total accounts: ${totalCount[0].cnt}`);
    for (const row of byType) {
      console.log(`    ${row.account_type}: ${row.cnt}`);
    }
    console.log(`  System accounts (locked): ${systemCount[0].cnt}`);

    // ================================================================
    // SUMMARY
    // ================================================================
    console.log('\n' + '='.length > 0 ? '=' : '');
    console.log('='.repeat(59));
    console.log('  C.1 Chart of Accounts Migration Complete');
    console.log('='.repeat(59));
    console.log('\nSummary:');
    console.log(`  * 1 table created (chart_of_accounts)`);
    console.log(`  * 3 enums created`);
    console.log(`  * ${count} accounts seeded for EHRC`);
    console.log('  * 4-level hierarchy: Group > Sub-Group > Ledger > Sub-Ledger');
    console.log('  * Ind AS compliant structure');
    console.log(`  * Hospital ID: ${HOSPITAL_ID}`);
    console.log('\nReady for C.1 API development.\n');

    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err.message);
    console.error('\nFull error:', err);
    process.exit(1);
  }
}

migrate();
