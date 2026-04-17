const { neon } = require('@neondatabase/serverless');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('ERROR: DATABASE_URL not set');
  process.exit(1);
}

const sql = neon(DATABASE_URL);

// Sample implants with realistic Indian hospital pricing (INR)
const SAMPLE_IMPLANTS = [
  {
    hospital_id: 'EHRC',
    implant_name: 'Knee Prosthesis (Total Knee Replacement)',
    implant_code: 'KP-001',
    category: 'orthopedic',
    sub_category: 'knee_prosthesis',
    manufacturer: 'Zimmer Biomet',
    brand: 'Persona',
    model_number: 'PFJ-300',
    hsn_code: '9021',
    gst_rate: 5.00,
    procurement_cost: 95000,
    billing_price: 185000,
    mrp: 200000,
    requires_serial_tracking: true,
    shelf_life_months: 60,
    storage_instructions: 'Room temperature, sterile packaging',
    regulatory_approval: 'CDSCO approved',
    is_active: true,
  },
  {
    hospital_id: 'EHRC',
    implant_name: 'Hip Prosthesis (Total Hip Replacement)',
    implant_code: 'HP-001',
    category: 'orthopedic',
    sub_category: 'hip_prosthesis',
    manufacturer: 'Stryker',
    brand: 'Accolade',
    model_number: 'ACC-500',
    hsn_code: '9021',
    gst_rate: 5.00,
    procurement_cost: 120000,
    billing_price: 240000,
    mrp: 260000,
    requires_serial_tracking: true,
    shelf_life_months: 60,
    storage_instructions: 'Room temperature, sterile packaging',
    regulatory_approval: 'CDSCO approved',
    is_active: true,
  },
  {
    hospital_id: 'EHRC',
    implant_name: 'Cardiac Stent (Drug-Eluting)',
    implant_code: 'CS-001',
    category: 'cardiac',
    sub_category: 'stent',
    manufacturer: 'Abbott',
    brand: 'Xience',
    model_number: 'XCS-28',
    hsn_code: '9021',
    gst_rate: 5.00,
    procurement_cost: 45000,
    billing_price: 95000,
    mrp: 105000,
    requires_serial_tracking: true,
    shelf_life_months: 36,
    storage_instructions: 'Controlled room temperature',
    regulatory_approval: 'CDSCO approved',
    is_active: true,
  },
  {
    hospital_id: 'EHRC',
    implant_name: 'Pacemaker (Dual Chamber)',
    implant_code: 'PM-001',
    category: 'cardiac',
    sub_category: 'pacemaker',
    manufacturer: 'Medtronic',
    brand: 'Revo',
    model_number: 'REV-DCP-800',
    hsn_code: '9021',
    gst_rate: 5.00,
    procurement_cost: 200000,
    billing_price: 450000,
    mrp: 500000,
    requires_serial_tracking: true,
    shelf_life_months: 120,
    storage_instructions: 'Room temperature, keep dry',
    regulatory_approval: 'CDSCO approved',
    is_active: true,
  },
  {
    hospital_id: 'EHRC',
    implant_name: 'Intraocular Lens (IOL)',
    implant_code: 'IOL-001',
    category: 'ophthalmic',
    sub_category: 'iol',
    manufacturer: 'Alcon',
    brand: 'AcrySof',
    model_number: 'ACR-MA60BM',
    hsn_code: '9021',
    gst_rate: 5.00,
    procurement_cost: 12000,
    billing_price: 28000,
    mrp: 32000,
    requires_serial_tracking: true,
    shelf_life_months: 48,
    storage_instructions: '2-8°C, sterile vial',
    regulatory_approval: 'CDSCO approved',
    is_active: true,
  },
  {
    hospital_id: 'EHRC',
    implant_name: 'Dental Implant (Titanium)',
    implant_code: 'DI-001',
    category: 'dental',
    sub_category: 'implant',
    manufacturer: 'Nobel Biocare',
    brand: 'Replace',
    model_number: 'RP-411',
    hsn_code: '9021',
    gst_rate: 5.00,
    procurement_cost: 8000,
    billing_price: 18000,
    mrp: 22000,
    requires_serial_tracking: true,
    shelf_life_months: 120,
    storage_instructions: 'Room temperature, sterile',
    regulatory_approval: 'CDSCO approved',
    is_active: true,
  },
  {
    hospital_id: 'EHRC',
    implant_name: 'Spinal Cage (PEEK)',
    implant_code: 'SC-001',
    category: 'spinal',
    sub_category: 'cage',
    manufacturer: 'DePuy Synthes',
    brand: 'CLYDESDALE',
    model_number: 'CDS-M',
    hsn_code: '9021',
    gst_rate: 5.00,
    procurement_cost: 55000,
    billing_price: 125000,
    mrp: 140000,
    requires_serial_tracking: true,
    shelf_life_months: 60,
    storage_instructions: 'Room temperature, sterile packaging',
    regulatory_approval: 'CDSCO approved',
    is_active: true,
  },
  {
    hospital_id: 'EHRC',
    implant_name: 'Vascular Graft (Synthetic)',
    implant_code: 'VG-001',
    category: 'vascular',
    sub_category: 'graft',
    manufacturer: 'Vascutek',
    brand: 'GELWEAVE',
    model_number: 'GW-8-MM',
    hsn_code: '9021',
    gst_rate: 5.00,
    procurement_cost: 35000,
    billing_price: 85000,
    mrp: 95000,
    requires_serial_tracking: true,
    shelf_life_months: 24,
    storage_instructions: '4°C, keep sterile',
    regulatory_approval: 'CDSCO approved',
    is_active: true,
  },
  {
    hospital_id: 'EHRC',
    implant_name: 'Cochlear Implant System',
    implant_code: 'CI-001',
    category: 'neurological',
    sub_category: 'cochlear',
    manufacturer: 'Cochlear',
    brand: 'Nucleus',
    model_number: 'NUC-7-PRO',
    hsn_code: '9021',
    gst_rate: 5.00,
    procurement_cost: 300000,
    billing_price: 700000,
    mrp: 800000,
    requires_serial_tracking: true,
    shelf_life_months: 120,
    storage_instructions: 'Room temperature, sterile',
    regulatory_approval: 'CDSCO approved',
    is_active: true,
  },
  {
    hospital_id: 'EHRC',
    implant_name: 'Bone Plate (Titanium, 10 holes)',
    implant_code: 'BP-001',
    category: 'orthopedic',
    sub_category: 'bone_plate',
    manufacturer: 'Synthes',
    brand: 'LC-DCP',
    model_number: 'LCP-4.5-10',
    hsn_code: '9021',
    gst_rate: 5.00,
    procurement_cost: 8000,
    billing_price: 18000,
    mrp: 22000,
    requires_serial_tracking: true,
    shelf_life_months: 120,
    storage_instructions: 'Room temperature, sterile packaging',
    regulatory_approval: 'CDSCO approved',
    is_active: true,
  },
];

async function runMigration() {
  console.log('Starting implant billing migration...\n');

  try {
    // Step 1: Create implant_master table
    console.log('Step 1: Creating implant_master table...');
    await sql`
      CREATE TABLE IF NOT EXISTS implant_master (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        hospital_id TEXT NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,
        implant_name TEXT NOT NULL,
        implant_code TEXT,
        category TEXT NOT NULL,
        sub_category TEXT,
        manufacturer TEXT,
        brand TEXT,
        model_number TEXT,
        hsn_code TEXT,
        gst_rate NUMERIC(5, 2),
        procurement_cost NUMERIC(14, 2) NOT NULL,
        billing_price NUMERIC(14, 2) NOT NULL,
        mrp NUMERIC(14, 2),
        requires_serial_tracking BOOLEAN DEFAULT true,
        shelf_life_months INTEGER,
        storage_instructions TEXT,
        regulatory_approval TEXT,
        is_active BOOLEAN DEFAULT true,
        notes TEXT,
        created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
    `;
    console.log('✓ implant_master table created\n');

    // Step 2: Create implant_usage table
    console.log('Step 2: Creating implant_usage table...');
    await sql`
      CREATE TABLE IF NOT EXISTS implant_usage (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        hospital_id TEXT NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,
        implant_id UUID NOT NULL REFERENCES implant_master(id) ON DELETE RESTRICT,
        encounter_id UUID,
        patient_id UUID,
        surgery_id UUID,
        bill_id UUID,
        serial_number TEXT,
        batch_number TEXT,
        lot_number TEXT,
        expiry_date DATE,
        quantity INTEGER DEFAULT 1 NOT NULL,
        unit_cost NUMERIC(14, 2) NOT NULL,
        billing_amount NUMERIC(14, 2) NOT NULL,
        surgeon_id UUID REFERENCES users(id) ON DELETE SET NULL,
        surgeon_name TEXT,
        implant_site TEXT,
        implant_date TIMESTAMP NOT NULL,
        removal_date TIMESTAMP,
        removal_reason TEXT,
        notes TEXT,
        recorded_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
    `;
    console.log('✓ implant_usage table created\n');

    // Step 3: Create indexes
    console.log('Step 3: Creating indexes...');
    await sql`CREATE INDEX IF NOT EXISTS idx_im_hospital ON implant_master(hospital_id);`;
    await sql`CREATE INDEX IF NOT EXISTS idx_im_category ON implant_master(category);`;
    await sql`CREATE INDEX IF NOT EXISTS idx_im_code ON implant_master(implant_code);`;
    await sql`CREATE INDEX IF NOT EXISTS idx_im_active ON implant_master(is_active);`;
    await sql`CREATE INDEX IF NOT EXISTS idx_iu_hospital ON implant_usage(hospital_id);`;
    await sql`CREATE INDEX IF NOT EXISTS idx_iu_implant_id ON implant_usage(implant_id);`;
    await sql`CREATE INDEX IF NOT EXISTS idx_iu_encounter ON implant_usage(encounter_id);`;
    await sql`CREATE INDEX IF NOT EXISTS idx_iu_patient ON implant_usage(patient_id);`;
    await sql`CREATE INDEX IF NOT EXISTS idx_iu_surgery ON implant_usage(surgery_id);`;
    await sql`CREATE INDEX IF NOT EXISTS idx_iu_serial ON implant_usage(serial_number);`;
    console.log('✓ All indexes created\n');

    // Step 4: Seed sample implants
    console.log('Step 4: Seeding sample implants for EHRC...');
    const adminUserId = 'a348b32e-d932-4451-ba8f-ef608f3d40be';

    for (const implant of SAMPLE_IMPLANTS) {
      await sql`
        INSERT INTO implant_master (
          hospital_id, implant_name, implant_code, category, sub_category,
          manufacturer, brand, model_number, hsn_code, gst_rate,
          procurement_cost, billing_price, mrp, requires_serial_tracking,
          shelf_life_months, storage_instructions, regulatory_approval,
          is_active, created_by
        ) VALUES (
          ${implant.hospital_id}, ${implant.implant_name}, ${implant.implant_code},
          ${implant.category}, ${implant.sub_category},
          ${implant.manufacturer}, ${implant.brand}, ${implant.model_number},
          ${implant.hsn_code}, ${implant.gst_rate},
          ${implant.procurement_cost}, ${implant.billing_price}, ${implant.mrp},
          ${implant.requires_serial_tracking},
          ${implant.shelf_life_months}, ${implant.storage_instructions},
          ${implant.regulatory_approval}, ${implant.is_active}, ${adminUserId}
        )
      `;
    }
    console.log(`✓ Seeded ${SAMPLE_IMPLANTS.length} sample implants\n`);

    // Step 5: Verify
    console.log('Step 5: Verifying migration...');
    const masterCount = await sql`SELECT COUNT(*) as count FROM implant_master;`;
    const usageCount = await sql`SELECT COUNT(*) as count FROM implant_usage;`;

    console.log(`✓ implant_master: ${masterCount[0].count} rows`);
    console.log(`✓ implant_usage: ${usageCount[0].count} rows\n`);

    console.log('Migration completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error.message);
    console.error(error);
    process.exit(1);
  }
}

runMigration();
