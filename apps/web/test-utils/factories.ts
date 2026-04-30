/**
 * Test data factories — Phase 0 starter set.
 *
 * Factories produce deterministic-ish test fixtures with sensible defaults.
 * Override any field by passing an `override` object.
 *
 *   const vendor = makeVendor({ vendor_name: 'Specific Pharma Co' });
 *
 * CONVENTIONS:
 *   - All factories return PLAIN OBJECTS (no DB writes here).
 *   - `id` defaults to a deterministic UUID-shaped string per call.
 *   - `hospital_id` defaults to 'EHRC' unless overridden.
 *   - Timestamps default to `now` (or the mock-clock instant if active).
 *
 * Per-PRD factories should be added under test-utils/factories/<prd>.ts as
 * the modules ship. Phase 0 ships only what's needed to verify infra.
 */
import { randomUUID } from 'node:crypto';

let _counter = 0;
function nextId(): string {
  return randomUUID();
}
function nextInt(): number {
  return ++_counter;
}

export function resetFactoryCounters(): void {
  _counter = 0;
}

// ---------- Hospital ----------
export interface HospitalFixture {
  hospital_id: string;
  display_name: string;
  is_active: boolean;
  created_at: Date;
}
export function makeHospital(override: Partial<HospitalFixture> = {}): HospitalFixture {
  return {
    hospital_id: 'EHRC',
    display_name: 'Even Hospital Race Course Road',
    is_active: true,
    created_at: new Date(),
    ...override,
  };
}

// 4-hospital launch network helper (V locked Dec 2026 big bang)
export function makeAllFourHospitals(): HospitalFixture[] {
  return [
    makeHospital({ hospital_id: 'EHRC', display_name: 'Even Hospital Race Course Road' }),
    makeHospital({ hospital_id: 'EHBR', display_name: 'Even Hospital Brookfield' }),
    makeHospital({ hospital_id: 'EHIN', display_name: 'Even Hospital Indiranagar' }),
    makeHospital({ hospital_id: 'EHBF', display_name: 'Even Hospital Brookfield' }),
    // Note: EHBR vs EHBF — V to disambiguate the two Brookfield codes when
    // confirming hospital_ids. Placeholder; correct in factories.ts once
    // hospital codes are finalized.
  ];
}

// ---------- User ----------
export interface UserFixture {
  id: string;
  email: string;
  full_name: string;
  role: string;
  hospital_id: string;
  is_active: boolean;
}
export function makeUser(override: Partial<UserFixture> = {}): UserFixture {
  const n = nextInt();
  return {
    id: nextId(),
    email: `test_user_${n}@even.in`,
    full_name: `Test User ${n}`,
    role: 'super_admin',
    hospital_id: 'EHRC',
    is_active: true,
    ...override,
  };
}

// ---------- SCM Vendor ----------
export interface VendorFixture {
  id: string;
  hospital_id: string;
  vendor_code: string;
  vendor_name: string;
  contact_person: string;
  phone: string;
  email: string;
  address: string;
  gst_number: string;
  drug_license_number: string;
  license_expiry: string;       // ISO date
  payment_terms_days: number;
  is_active: boolean;
}
export function makeVendor(override: Partial<VendorFixture> = {}): VendorFixture {
  const n = nextInt();
  return {
    id: nextId(),
    hospital_id: 'EHRC',
    vendor_code: `V${String(n).padStart(4, '0')}`,
    vendor_name: `Test Vendor ${n}`,
    contact_person: `Contact Person ${n}`,
    phone: `+91-9${String(n).padStart(9, '0')}`,
    email: `vendor${n}@example.com`,
    address: `Vendor Address ${n}, Bangalore`,
    gst_number: `29ABCDE${String(n).padStart(4, '0')}F1Z5`,
    drug_license_number: `DL-${String(n).padStart(6, '0')}`,
    license_expiry: '2027-12-31',
    payment_terms_days: 30,
    is_active: true,
    ...override,
  };
}

// ---------- SCM Item (universal — Codes Layer 1 stub) ----------
// Phase 1 will replace this with the Codes Layer 1 polymorphic shape.
export interface ItemFixture {
  id: string;
  hospital_id: string | null;     // null = network-shared (Codes Q8 multi-tenancy)
  code: string;                   // e.g., M-N-PH-00001 per SOP
  display_name: string;
  kind: 'drug' | 'consumable' | 'implant' | 'reagent' | 'linen' | 'cssd_pack' | 'equipment_spare';
  unit_of_measure: string;
  is_active: boolean;
}
export function makeItem(override: Partial<ItemFixture> = {}): ItemFixture {
  const n = nextInt();
  return {
    id: nextId(),
    hospital_id: null,
    code: `M-N-PH-${String(n).padStart(5, '0')}`,
    display_name: `Test Item ${n}`,
    kind: 'drug',
    unit_of_measure: 'tab',
    is_active: true,
    ...override,
  };
}

// ---------- Indent (Phase 2 placeholder) ----------
export interface IndentFixture {
  id: string;
  hospital_id: string;
  raised_by: string;              // user_id
  source_location: string;
  destination_location: string;
  state: 'pending' | 'approved' | 'issued' | 'in_transit' | 'received' | 'closed' | 'rejected' | 'cancelled';
  priority: 'routine' | 'urgent' | 'stat';
  created_at: Date;
}
export function makeIndent(override: Partial<IndentFixture> = {}): IndentFixture {
  return {
    id: nextId(),
    hospital_id: 'EHRC',
    raised_by: nextId(),
    source_location: 'main_pharmacy',
    destination_location: 'icu_stock',
    state: 'pending',
    priority: 'routine',
    created_at: new Date(),
    ...override,
  };
}

// ---------- Purchase Order (Phase 3 placeholder) ----------
export interface PurchaseOrderFixture {
  id: string;
  hospital_id: string;
  po_number: string;
  vendor_id: string;
  status: 'draft' | 'approved' | 'partially_received' | 'received' | 'closed';
  total_amount: number;
  created_by: string;
  created_at: Date;
}
export function makePurchaseOrder(override: Partial<PurchaseOrderFixture> = {}): PurchaseOrderFixture {
  const n = nextInt();
  return {
    id: nextId(),
    hospital_id: 'EHRC',
    po_number: `PO-2026-${String(n).padStart(5, '0')}`,
    vendor_id: nextId(),
    status: 'draft',
    total_amount: 10000,
    created_by: nextId(),
    created_at: new Date(),
    ...override,
  };
}

// Add additional factories per PRD as those modules build:
//   - apps/web/test-utils/factories/billing.ts (Phase 4 charge_items)
//   - apps/web/test-utils/factories/codes.ts (Codes Layer 1 + standards)
//   - apps/web/test-utils/factories/chart.ts (Patient Chart Q3 notes)
//   - etc.
