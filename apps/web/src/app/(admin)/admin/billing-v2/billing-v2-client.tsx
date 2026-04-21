'use client';

import { useState, useEffect, useCallback } from 'react';

interface User {
  sub: string;
  hospital_id: string;
  role: string;
  email: string;
  name: string;
}

// Shape returned by patient.list (items array)
interface Patient {
  id: string;
  name_full: string;
  uhid: string;
  phone?: string | null;
  dob?: string | null;
}

// Shape returned by billingAccounts.getAccount / listAccounts
// (field names here match the router's SQL aliases — see routers/billing-accounts.ts)
interface BillingAccount {
  id: string;
  patient_id: string;
  encounter_id: string | null;
  account_type: 'self_pay' | 'insurance' | 'corporate' | 'government';
  insurer_name?: string | null;
  tpa_name?: string | null;
  policy_number?: string | null;
  member_id?: string | null;
  sum_insured?: string | number | null;
  room_rent_eligibility?: string | number | null;
  co_pay_percent?: string | number | null;
  total_charges?: string | number | null;
  total_deposits?: string | number | null;
  total_payments?: string | number | null;
  total_approved?: string | number | null;
  balance_due?: string | number | null;
  estimated_total?: string | number | null;
  patient_liability_estimate?: string | number | null;
  is_active: boolean;
  created_at: string;
  updated_at?: string;
  name_full?: string | null;
  encounter_type?: string | null;
  admission_date?: string | null;
  discharge_date?: string | null;
  // UI-derived flag — NOT returned by router; used for the banner
  is_over_eligible?: boolean;
}

// Shape returned by billingAccounts.getRunningBill (aggregate, not per-item)
interface RunningBillSummary {
  charges_by_category: Array<{ category: string; count: number; total: number }>;
  subtotal: string;
  gst_total: string;
  grand_total: string;
  deposits: string;
  payments: string;
  approved: string;
  balance_due: string;
  room_charges: { total: string; days: number };
  package_info: unknown;
}

// Shape returned by billingAccounts.listDeposits
interface Deposit {
  id: string;
  amount: string | number;
  payment_method: 'cash' | 'card' | 'upi' | 'neft' | 'cheque';
  reference_number: string | null;
  status: 'collected' | 'applied' | 'refunded' | 'partial_refund';
  collector_name: string | null;
  collected_at: string;
  notes?: string | null;
}

// Census row returned by billingAccounts.ipdCensus
interface CensusRow {
  encounter_id: string;
  admission_at: string;
  encounter_class: string | null;
  pre_auth_status: string | null;
  patient_id: string;
  patient_name: string;
  uhid: string;
  phone: string | null;
  patient_category: string | null;
  bed_code: string | null;
  bed_name: string | null;
  ward_code: string | null;
  ward_name: string | null;
  account_id: string | null;
  account_type: string | null;
  insurer_name: string | null;
  account_active: boolean | null;
  deposits_collected: string | number;
  running_total: string | number;
}

// Shape returned by billingAccounts.listPackages (summary row — no components)
// Full detail w/ components comes from getPackageDetail if we ever need it.
interface BillingPackage {
  id: string;
  package_name: string;
  package_code: string | null;
  status: 'active' | 'completed' | 'cancelled' | 'exceeded';
  package_price: string | number;
  actual_cost: string | number | null;
  variance_amount: string | number | null;
  applied_at: string;
  name_full?: string | null;
}

// Shape returned by billingAccounts.listRoomCharges
interface RoomCharge {
  id: string;
  charge_date: string;
  room_charge_type: string | null;
  ward_name: string | null;
  room_category: string | null;
  base_rate: string | number;
  nursing_charge: string | number | null;
  total_charge: string | number | null;
  room_rent_eligible: string | number | null;
  is_over_eligible: boolean | null;
}

interface TabState {
  activeTab: 'accounts' | 'deposits' | 'packages' | 'rooms' | 'ai-cost';
  selectedPatientId: string | null;
  selectedAccountId: string | null;
  loading: boolean;
  error: string | null;
}

const formatCurrency = (amount: number): string => {
  return `₹${amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const formatDate = (dateStr: string): string => {
  return new Date(dateStr).toLocaleDateString('en-IN');
};

export function BillingV2Client({ user }: { user: User }) {
  const [tabState, setTabState] = useState<TabState>({
    activeTab: 'accounts',
    selectedPatientId: null,
    selectedAccountId: null,
    loading: false,
    error: null,
  });

  const [patients, setPatients] = useState<Patient[]>([]);
  const [patientSearch, setPatientSearch] = useState('');
  const [showPatientSearch, setShowPatientSearch] = useState(false);

  const [account, setAccount] = useState<BillingAccount | null>(null);
  const [runningBill, setRunningBill] = useState<RunningBillSummary | null>(null);
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [packages, setPackages] = useState<BillingPackage[]>([]);
  const [roomCharges, setRoomCharges] = useState<RoomCharge[]>([]);

  // Current encounter for the selected account — needed for collectDeposit,
  // applyPackage, addRoomCharge, listRoomCharges, listPackages (all filter by encounter_id).
  const [encounterId, setEncounterId] = useState<string | null>(null);

  // IPD census — default landing view. One row per currently-admitted encounter.
  const [census, setCensus] = useState<CensusRow[]>([]);
  const [censusLoading, setCensusLoading] = useState(false);
  const [censusSearch, setCensusSearch] = useState('');

  const [showAccountForm, setShowAccountForm] = useState(false);
  const [showDepositForm, setShowDepositForm] = useState(false);
  const [showPackageForm, setShowPackageForm] = useState(false);
  const [showRoomChargeForm, setShowRoomChargeForm] = useState(false);
  const [expandedPackageId, setExpandedPackageId] = useState<string | null>(null);

  // AI Cost Intelligence state
  const [aiCostEstimate, setAiCostEstimate] = useState<any>(null);
  const [aiCostLoading, setAiCostLoading] = useState(false);
  const [aiCostError, setAiCostError] = useState<string | null>(null);

  const [accountFormData, setAccountFormData] = useState({
    account_type: 'self_pay' as 'self_pay' | 'insurance' | 'corporate' | 'government',
    insurer_name: '',
    tpa_name: '',
    policy_number: '',
    member_id: '',
    sum_insured: 0,
    room_rent_eligibility: 0,
    co_pay_percent: 0,
    estimated_total: 0,
  });

  const [depositFormData, setDepositFormData] = useState({
    amount: 0,
    payment_method: 'cash' as 'cash' | 'card' | 'upi' | 'neft' | 'cheque',
    reference_number: '',
    receipt_number: '',
    notes: '',
  });

  const [packageFormData, setPackageFormData] = useState({
    package_name: '',
    package_code: '',
    package_price: 0,
    includes_room: false,
    includes_pharmacy: false,
    includes_investigations: false,
    max_los_days: 0,
    components: [] as Array<{ component_name: string; category: string; budgeted_amount: number; max_quantity: number }>,
  });

  const [roomChargeFormData, setRoomChargeFormData] = useState({
    charge_date: new Date().toISOString().split('T')[0],
    charge_type: 'daily',
    ward_name: '',
    room_category: 'General' as const,
    base_rate: 0,
    nursing_charge: 0,
    room_rent_eligible: true,
  });

  // Fetch patients list — patient.list returns { items, total, page, pageSize, totalPages }
  // (NOT `patients`). tRPC's query-procedure call style uses GET w/ ?input=… but the
  // whole module was written to POST against mutations, which works for queries too in
  // the tRPC HTTP adapter, so we keep the pattern here.
  const fetchPatients = useCallback(async (query: string) => {
    try {
      const response = await fetch('/api/trpc/patient.list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ json: { search: query, pageSize: 20 } }),
      });
      const data = await response.json();
      const items = data.result?.data?.json?.items;
      if (Array.isArray(items)) {
        setPatients(items);
      }
    } catch (err) {
      console.error('Error fetching patients:', err);
    }
  }, []);

  // IPD census loader — single tRPC call, returns denormalized row per active encounter.
  const fetchIpdCensus = useCallback(async () => {
    setCensusLoading(true);
    try {
      const response = await fetch('/api/trpc/billingAccounts.ipdCensus', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ json: {} }),
      });
      const data = await response.json();
      const rows = data.result?.data?.json;
      if (Array.isArray(rows)) {
        setCensus(rows as CensusRow[]);
      }
    } catch (err) {
      console.error('Error fetching IPD census:', err);
    } finally {
      setCensusLoading(false);
    }
  }, []);

  // Fetch the running bill aggregate for an account — router returns the summary
  // shape directly (charges_by_category + totals), not a list of line items.
  const fetchRunningBill = useCallback(async (accountId: string) => {
    try {
      const response = await fetch('/api/trpc/billingAccounts.getRunningBill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ json: { account_id: accountId } }),
      });
      const data = await response.json();
      const summary = data.result?.data?.json;
      if (summary && typeof summary === 'object' && Array.isArray(summary.charges_by_category)) {
        setRunningBill(summary as RunningBillSummary);
      }
    } catch (err) {
      console.error('Error fetching running bill:', err);
    }
  }, []);

  // listDeposits returns a bare array (no envelope `.deposits`).
  // Filter by account_id (falls back to encounter_id if account missing).
  const fetchDeposits = useCallback(async (accountId: string) => {
    try {
      const response = await fetch('/api/trpc/billingAccounts.listDeposits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ json: { account_id: accountId } }),
      });
      const data = await response.json();
      const rows = data.result?.data?.json;
      if (Array.isArray(rows)) {
        setDeposits(rows as Deposit[]);
      }
    } catch (err) {
      console.error('Error fetching deposits:', err);
    }
  }, []);

  // listPackages takes encounter_id (NOT account_id) and returns a bare array.
  const fetchPackages = useCallback(async (encId: string | null) => {
    if (!encId) {
      setPackages([]);
      return;
    }
    try {
      const response = await fetch('/api/trpc/billingAccounts.listPackages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ json: { encounter_id: encId } }),
      });
      const data = await response.json();
      const rows = data.result?.data?.json;
      if (Array.isArray(rows)) {
        setPackages(rows as BillingPackage[]);
      }
    } catch (err) {
      console.error('Error fetching packages:', err);
    }
  }, []);

  // listRoomCharges takes encounter_id (NOT account_id) and returns a bare array.
  const fetchRoomCharges = useCallback(async (encId: string | null) => {
    if (!encId) {
      setRoomCharges([]);
      return;
    }
    try {
      const response = await fetch('/api/trpc/billingAccounts.listRoomCharges', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ json: { encounter_id: encId } }),
      });
      const data = await response.json();
      const rows = data.result?.data?.json;
      if (Array.isArray(rows)) {
        setRoomCharges(rows as RoomCharge[]);
      }
    } catch (err) {
      console.error('Error fetching room charges:', err);
    }
  }, []);

  // fetchAccountForPatient: uses listAccounts (active only) + getAccount for full detail.
  // getByPatient does not exist on the router — that was the primary bug. We pick the
  // first active account for the patient; if none exists the UI falls through to the
  // "create billing account" CTA.
  const fetchAccountForPatient = useCallback(async (patientId: string) => {
    setTabState(prev => ({ ...prev, loading: true, error: null }));
    try {
      const listRes = await fetch('/api/trpc/billingAccounts.listAccounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ json: { patient_id: patientId, is_active: true } }),
      });
      const listData = await listRes.json();
      const listed = listData.result?.data?.json;
      const firstAccount = Array.isArray(listed) && listed.length > 0 ? listed[0] : null;

      if (!firstAccount) {
        // No active account — clear state; "Create Billing Account" CTA shows.
        setAccount(null);
        setEncounterId(null);
        setRunningBill(null);
        setDeposits([]);
        setPackages([]);
        setRoomCharges([]);
        setTabState(prev => ({ ...prev, selectedAccountId: null }));
        return;
      }

      // Full detail via getAccount — gives us encounter_id + all derived fields.
      const detailRes = await fetch('/api/trpc/billingAccounts.getAccount', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ json: { account_id: firstAccount.id } }),
      });
      const detailData = await detailRes.json();
      const full = detailData.result?.data?.json as BillingAccount | undefined;
      if (!full) {
        throw new Error('getAccount returned no row');
      }

      setAccount(full);
      setEncounterId(full.encounter_id);
      setTabState(prev => ({ ...prev, selectedAccountId: full.id }));

      // Fetch all related data in parallel — each has its own no-throw try/catch.
      await Promise.all([
        fetchRunningBill(full.id),
        fetchDeposits(full.id),
        fetchPackages(full.encounter_id),
        fetchRoomCharges(full.encounter_id),
      ]);
    } catch (err) {
      setTabState(prev => ({ ...prev, error: 'Failed to load billing account' }));
    } finally {
      setTabState(prev => ({ ...prev, loading: false }));
    }
  }, [fetchRunningBill, fetchDeposits, fetchPackages, fetchRoomCharges]);

  // Handle patient selection — defined AFTER fetchAccountForPatient so the closure is valid.
  const handleSelectPatient = useCallback((patientId: string) => {
    setTabState(prev => ({ ...prev, selectedPatientId: patientId }));
    setShowPatientSearch(false);
    void fetchAccountForPatient(patientId);
  }, [fetchAccountForPatient]);

  // Load IPD census on mount so the landing page is never empty.
  useEffect(() => {
    void fetchIpdCensus();
  }, [fetchIpdCensus]);

  // Format a number into Zod's regex shape (/^\d+(\.\d{1,2})?$/).
  // Router rejects "1e3", "1.234", "-5" etc., so we normalize + clamp here.
  const toMoneyString = (n: number): string => {
    if (!Number.isFinite(n) || n < 0) return '0';
    return n.toFixed(2);
  };

  const handleCreateAccount = async () => {
    if (!tabState.selectedPatientId) return;
    setTabState(prev => ({ ...prev, loading: true, error: null }));
    try {
      // Router is `createAccount` (NOT `create`). Monetary fields are strings matching
      // Zod's /^\d+(\.\d{1,2})?$/ regex, so we stringify here. Also `room_rent_eligibility`
      // is the server-side key name — client form already uses that name.
      const payload: Record<string, unknown> = {
        patient_id: tabState.selectedPatientId,
        account_type: accountFormData.account_type,
        estimated_total: toMoneyString(accountFormData.estimated_total),
      };
      if (accountFormData.account_type === 'insurance') {
        if (accountFormData.insurer_name) payload.insurer_name = accountFormData.insurer_name;
        if (accountFormData.tpa_name) payload.tpa_name = accountFormData.tpa_name;
        if (accountFormData.policy_number) payload.policy_number = accountFormData.policy_number;
        if (accountFormData.member_id) payload.member_id = accountFormData.member_id;
        payload.sum_insured = toMoneyString(accountFormData.sum_insured);
        payload.room_rent_eligibility = toMoneyString(accountFormData.room_rent_eligibility);
        payload.co_pay_percent = toMoneyString(accountFormData.co_pay_percent);
      }
      if (encounterId) payload.encounter_id = encounterId;

      const response = await fetch('/api/trpc/billingAccounts.createAccount', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ json: payload }),
      });
      const data = await response.json();
      const created = data.result?.data?.json as { account_id?: string } | undefined;
      if (!created?.account_id) {
        throw new Error(data.error?.json?.message || 'createAccount returned no id');
      }

      // createAccount returns a thin {account_id, account_type, created_at} envelope —
      // fetch the full detail via getAccount so the UI has encounter_id + eligibility.
      const detailRes = await fetch('/api/trpc/billingAccounts.getAccount', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ json: { account_id: created.account_id } }),
      });
      const detailData = await detailRes.json();
      const full = detailData.result?.data?.json as BillingAccount | undefined;
      if (full) {
        setAccount(full);
        setEncounterId(full.encounter_id);
        setTabState(prev => ({ ...prev, selectedAccountId: full.id }));
        // Refresh derived data for the newly created account.
        await Promise.all([
          fetchRunningBill(full.id),
          fetchDeposits(full.id),
          fetchPackages(full.encounter_id),
          fetchRoomCharges(full.encounter_id),
        ]);
      }

      setShowAccountForm(false);
      setAccountFormData({
        account_type: 'self_pay',
        insurer_name: '',
        tpa_name: '',
        policy_number: '',
        member_id: '',
        sum_insured: 0,
        room_rent_eligibility: 0,
        co_pay_percent: 0,
        estimated_total: 0,
      });
    } catch (err) {
      setTabState(prev => ({ ...prev, error: 'Failed to create account' }));
    } finally {
      setTabState(prev => ({ ...prev, loading: false }));
    }
  };

  const handleCollectDeposit = async () => {
    if (!tabState.selectedAccountId || !tabState.selectedPatientId) return;
    setTabState(prev => ({ ...prev, loading: true, error: null }));
    try {
      // Router is `collectDeposit` (NOT `addDeposit`). Requires patient_id + amount
      // as a string in Zod regex shape. collected_by / collected_at are set server-side
      // (from ctx.user.sub + NOW()), so we must NOT send them.
      const response = await fetch('/api/trpc/billingAccounts.collectDeposit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          json: {
            patient_id: tabState.selectedPatientId,
            encounter_id: encounterId ?? undefined,
            account_id: tabState.selectedAccountId,
            amount: toMoneyString(depositFormData.amount),
            payment_method: depositFormData.payment_method,
            reference_number: depositFormData.reference_number || undefined,
            receipt_number: depositFormData.receipt_number || undefined,
            notes: depositFormData.notes || undefined,
          },
        }),
      });
      const data = await response.json();
      if (data.error) {
        throw new Error(data.error?.json?.message || 'Deposit failed');
      }
      await fetchDeposits(tabState.selectedAccountId);
      setShowDepositForm(false);
      setDepositFormData({
        amount: 0,
        payment_method: 'cash',
        reference_number: '',
        receipt_number: '',
        notes: '',
      });
    } catch (err) {
      setTabState(prev => ({ ...prev, error: 'Failed to collect deposit' }));
    } finally {
      setTabState(prev => ({ ...prev, loading: false }));
    }
  };

  const handleApplyPackage = async () => {
    if (!tabState.selectedAccountId || !tabState.selectedPatientId || !encounterId) {
      setTabState(prev => ({ ...prev, error: 'Select a patient with an active encounter first' }));
      return;
    }
    setTabState(prev => ({ ...prev, loading: true, error: null }));
    try {
      // Router is `applyPackage`. Requires patient_id + encounter_id; package_price
      // and component budgeted_amount must be regex-matching strings.
      const response = await fetch('/api/trpc/billingAccounts.applyPackage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          json: {
            patient_id: tabState.selectedPatientId,
            encounter_id: encounterId,
            account_id: tabState.selectedAccountId,
            package_name: packageFormData.package_name,
            package_code: packageFormData.package_code || undefined,
            package_price: toMoneyString(packageFormData.package_price),
            includes_room: packageFormData.includes_room,
            includes_pharmacy: packageFormData.includes_pharmacy,
            includes_investigations: packageFormData.includes_investigations,
            max_los_days: packageFormData.max_los_days || undefined,
            components: packageFormData.components.length > 0
              ? packageFormData.components.map(c => ({
                  component_name: c.component_name,
                  category: c.category,
                  budgeted_amount: toMoneyString(c.budgeted_amount),
                  max_quantity: c.max_quantity || undefined,
                }))
              : undefined,
          },
        }),
      });
      const data = await response.json();
      if (data.error) {
        throw new Error(data.error?.json?.message || 'Package apply failed');
      }
      await fetchPackages(encounterId);
      setShowPackageForm(false);
      setPackageFormData({
        package_name: '',
        package_code: '',
        package_price: 0,
        includes_room: false,
        includes_pharmacy: false,
        includes_investigations: false,
        max_los_days: 0,
        components: [],
      });
    } catch (err) {
      setTabState(prev => ({ ...prev, error: 'Failed to apply package' }));
    } finally {
      setTabState(prev => ({ ...prev, loading: false }));
    }
  };

  const handleAddRoomCharge = async () => {
    if (!tabState.selectedAccountId || !tabState.selectedPatientId || !encounterId) {
      setTabState(prev => ({ ...prev, error: 'Select a patient with an active encounter first' }));
      return;
    }
    setTabState(prev => ({ ...prev, loading: true, error: null }));
    try {
      // Router is `addRoomCharge`. Amount fields are regex-matching strings.
      // `is_over_eligible` is a boolean — mapped as the inverse of the UI's
      // "Room Rent Eligible" checkbox (checked = within eligibility = NOT over).
      const response = await fetch('/api/trpc/billingAccounts.addRoomCharge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          json: {
            patient_id: tabState.selectedPatientId,
            encounter_id: encounterId,
            charge_date: roomChargeFormData.charge_date,
            charge_type: roomChargeFormData.charge_type,
            ward_name: roomChargeFormData.ward_name || undefined,
            room_category: roomChargeFormData.room_category,
            base_rate: toMoneyString(roomChargeFormData.base_rate),
            nursing_charge: toMoneyString(roomChargeFormData.nursing_charge),
            is_over_eligible: !roomChargeFormData.room_rent_eligible,
          },
        }),
      });
      const data = await response.json();
      if (data.error) {
        throw new Error(data.error?.json?.message || 'Add room charge failed');
      }
      await fetchRoomCharges(encounterId);
      setShowRoomChargeForm(false);
      setRoomChargeFormData({
        charge_date: new Date().toISOString().split('T')[0],
        charge_type: 'daily',
        ward_name: '',
        room_category: 'General',
        base_rate: 0,
        nursing_charge: 0,
        room_rent_eligible: true,
      });
    } catch (err) {
      setTabState(prev => ({ ...prev, error: 'Failed to add room charge' }));
    } finally {
      setTabState(prev => ({ ...prev, loading: false }));
    }
  };

  const handleRunCostEstimate = async () => {
    if (!account) return;
    setAiCostLoading(true);
    setAiCostError(null);
    try {
      // We need encounter_id — fetch it from the billing account
      const acctRes = await fetch('/api/trpc/billingAccounts.getAccount?input=' + encodeURIComponent(JSON.stringify({ json: { account_id: account.id } })));
      const acctData = await acctRes.json();
      const encounterId = acctData.result?.data?.json?.encounter_id;

      if (!encounterId) {
        setAiCostError('No encounter linked to this billing account');
        return;
      }

      const res = await fetch('/api/trpc/evenAI.runCostEstimation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ json: { encounter_id: encounterId } }),
      });
      const data = await res.json();
      if (data.result?.data?.json) {
        setAiCostEstimate(data.result.data.json);
      } else {
        setAiCostError(data.error?.json?.message || 'Cost estimation failed');
      }
    } catch (e: any) {
      setAiCostError(e.message || 'Network error');
    } finally {
      setAiCostLoading(false);
    }
  };

  // Server returns strings for numeric columns (Drizzle numeric type) — always coerce.
  const toNum = (v: string | number | null | undefined): number => {
    if (v === null || v === undefined) return 0;
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  // Running bill is an aggregate object (not an array). Categories come pre-bucketed
  // from getRunningBill. Subtotal/GST/Grand-total are authoritative from the router.
  const runningCategories = runningBill?.charges_by_category ?? [];
  const runningItemCount = runningCategories.reduce((sum, c) => sum + (c.count || 0), 0);
  const billTotal = toNum(runningBill?.subtotal);
  const gst = toNum(runningBill?.gst_total);
  const grandTotal = toNum(runningBill?.grand_total);

  const depositSummary = {
    collected: deposits
      .filter(d => d.status === 'collected' || d.status === 'applied')
      .reduce((sum, d) => sum + toNum(d.amount), 0),
    applied: deposits.filter(d => d.status === 'applied').reduce((sum, d) => sum + toNum(d.amount), 0),
    refunded: deposits
      .filter(d => d.status === 'refunded' || d.status === 'partial_refund')
      .reduce((sum, d) => sum + toNum(d.amount), 0),
  };

  const roomChargeTotal = roomCharges.reduce(
    (sum, rc) => sum + toNum(rc.total_charge ?? toNum(rc.base_rate) + toNum(rc.nursing_charge)),
    0,
  );
  const eligibleDays = roomCharges.filter(rc => !rc.is_over_eligible).length;
  const overEligibleDays = roomCharges.filter(rc => rc.is_over_eligible).length;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <h1 className="text-3xl font-bold text-gray-900">Enhanced Billing</h1>
          <p className="text-gray-600 mt-1">Manage patient accounts, deposits, packages, and room charges</p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Patient Selector */}
        <div className="bg-white rounded-lg shadow mb-6 p-6">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700 mb-2">Select Patient</label>
              <div className="relative">
                <input
                  type="text"
                  placeholder="Search by name or UHID..."
                  value={patientSearch}
                  onChange={(e) => {
                    setPatientSearch(e.target.value);
                    if (e.target.value.length > 0) {
                      fetchPatients(e.target.value);
                      setShowPatientSearch(true);
                    }
                  }}
                  onFocus={() => setShowPatientSearch(true)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                {showPatientSearch && patients.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-300 rounded-lg shadow-lg z-50 max-h-64 overflow-y-auto">
                    {patients.map(p => (
                      <button
                        key={p.id}
                        onClick={() => {
                          handleSelectPatient(p.id);
                          setPatientSearch(p.name_full);
                        }}
                        className="w-full text-left px-4 py-3 hover:bg-gray-100 border-b border-gray-200 last:border-b-0"
                      >
                        <div className="font-medium text-gray-900">{p.name_full}</div>
                        <div className="text-sm text-gray-600">UHID: {p.uhid}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            {tabState.selectedPatientId && (
              <div className="ml-4">
                <span className="text-sm font-medium text-green-700 bg-green-50 px-3 py-1 rounded-full">
                  Patient Selected
                </span>
              </div>
            )}
          </div>
        </div>

        {tabState.error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6">
            {tabState.error}
          </div>
        )}

        {account && (
          <>
            {/* Account Summary Card */}
            <div className="bg-white rounded-lg shadow mb-6 p-6">
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
                <div>
                  <span className="text-xs font-semibold text-gray-600 uppercase">Type</span>
                  <div className="mt-1">
                    <span className="inline-block px-3 py-1 rounded-full text-sm font-medium bg-blue-100 text-blue-800">
                      {account.account_type.replace('_', ' ')}
                    </span>
                  </div>
                </div>
                {account.insurer_name && (
                  <div>
                    <span className="text-xs font-semibold text-gray-600 uppercase">Insurer</span>
                    <p className="text-sm font-medium text-gray-900 mt-1">{account.insurer_name}</p>
                  </div>
                )}
                <div>
                  <span className="text-xs font-semibold text-gray-600 uppercase">Running Bill</span>
                  <p className="text-lg font-bold text-gray-900 mt-1">{formatCurrency(billTotal)}</p>
                </div>
                <div>
                  <span className="text-xs font-semibold text-gray-600 uppercase">Deposits</span>
                  <p className="text-lg font-bold text-green-600 mt-1">{formatCurrency(depositSummary.collected)}</p>
                </div>
                <div>
                  <span className="text-xs font-semibold text-gray-600 uppercase">Balance</span>
                  <p className={`text-lg font-bold mt-1 ${grandTotal > depositSummary.collected ? 'text-red-600' : 'text-green-600'}`}>
                    {formatCurrency(Math.max(0, grandTotal - depositSummary.collected))}
                  </p>
                </div>
              </div>
              {account.is_over_eligible && (
                <div className="mt-4 bg-red-50 border-l-4 border-red-500 p-4">
                  <p className="text-sm font-medium text-red-800">
                    ⚠️ Patient exceeds room rent eligibility. Proportional deduction risk: ₹{toNum(account.sum_insured).toLocaleString('en-IN')}
                  </p>
                </div>
              )}
            </div>

            {/* Tabs */}
            <div className="bg-white rounded-lg shadow overflow-hidden">
              <div className="border-b border-gray-200">
                <div className="flex">
                  {(['accounts', 'deposits', 'packages', 'rooms', 'ai-cost'] as const).map(tab => (
                    <button
                      key={tab}
                      onClick={() => setTabState(prev => ({ ...prev, activeTab: tab }))}
                      className={`flex-1 px-6 py-4 font-medium text-sm border-b-2 transition-colors ${
                        tabState.activeTab === tab
                          ? 'border-blue-600 text-blue-600'
                          : 'border-transparent text-gray-600 hover:text-gray-900'
                      }`}
                    >
                      {tab === 'accounts' && '💰 Accounts & Bill'}
                      {tab === 'deposits' && '🏦 Deposits'}
                      {tab === 'packages' && '📦 Packages'}
                      {tab === 'rooms' && '🛏️ Room Charges'}
                      {tab === 'ai-cost' && '🤖 AI Cost'}
                    </button>
                  ))}
                </div>
              </div>

              <div className="p-6">
                {/* Tab: Accounts & Running Bill */}
                {tabState.activeTab === 'accounts' && (
                  <div>
                    <div className="flex justify-end mb-6">
                      <button
                        onClick={() => setShowAccountForm(!showAccountForm)}
                        className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg transition-colors"
                      >
                        {showAccountForm ? 'Cancel' : '+ Create New Account'}
                      </button>
                    </div>

                    {showAccountForm && (
                      <div className="bg-gray-50 rounded-lg p-6 mb-6 border border-gray-200">
                        <h3 className="font-semibold text-gray-900 mb-4">Create Billing Account</h3>
                        <div className="grid md:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Account Type</label>
                            <select
                              value={accountFormData.account_type}
                              onChange={(e) =>
                                setAccountFormData({
                                  ...accountFormData,
                                  account_type: e.target.value as any,
                                })
                              }
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                            >
                              <option value="self_pay">Self Pay</option>
                              <option value="insurance">Insurance</option>
                              <option value="corporate">Corporate</option>
                              <option value="government">Government</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Estimated Total</label>
                            <input
                              type="number"
                              value={accountFormData.estimated_total}
                              onChange={(e) =>
                                setAccountFormData({
                                  ...accountFormData,
                                  estimated_total: parseFloat(e.target.value) || 0,
                                })
                              }
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                            />
                          </div>

                          {accountFormData.account_type === 'insurance' && (
                            <>
                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Insurer Name</label>
                                <input
                                  type="text"
                                  value={accountFormData.insurer_name}
                                  onChange={(e) =>
                                    setAccountFormData({
                                      ...accountFormData,
                                      insurer_name: e.target.value,
                                    })
                                  }
                                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                />
                              </div>
                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">TPA Name</label>
                                <input
                                  type="text"
                                  value={accountFormData.tpa_name}
                                  onChange={(e) =>
                                    setAccountFormData({
                                      ...accountFormData,
                                      tpa_name: e.target.value,
                                    })
                                  }
                                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                />
                              </div>
                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Policy Number</label>
                                <input
                                  type="text"
                                  value={accountFormData.policy_number}
                                  onChange={(e) =>
                                    setAccountFormData({
                                      ...accountFormData,
                                      policy_number: e.target.value,
                                    })
                                  }
                                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                />
                              </div>
                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Member ID</label>
                                <input
                                  type="text"
                                  value={accountFormData.member_id}
                                  onChange={(e) =>
                                    setAccountFormData({
                                      ...accountFormData,
                                      member_id: e.target.value,
                                    })
                                  }
                                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                />
                              </div>
                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Sum Insured</label>
                                <input
                                  type="number"
                                  value={accountFormData.sum_insured}
                                  onChange={(e) =>
                                    setAccountFormData({
                                      ...accountFormData,
                                      sum_insured: parseFloat(e.target.value) || 0,
                                    })
                                  }
                                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                />
                              </div>
                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Room Rent Eligibility</label>
                                <input
                                  type="number"
                                  value={accountFormData.room_rent_eligibility}
                                  onChange={(e) =>
                                    setAccountFormData({
                                      ...accountFormData,
                                      room_rent_eligibility: parseFloat(e.target.value) || 0,
                                    })
                                  }
                                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                />
                              </div>
                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Co-pay %</label>
                                <input
                                  type="number"
                                  value={accountFormData.co_pay_percent}
                                  onChange={(e) =>
                                    setAccountFormData({
                                      ...accountFormData,
                                      co_pay_percent: parseFloat(e.target.value) || 0,
                                    })
                                  }
                                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                />
                              </div>
                            </>
                          )}
                        </div>
                        <button
                          onClick={handleCreateAccount}
                          disabled={tabState.loading}
                          className="mt-6 w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-medium py-2 px-4 rounded-lg transition-colors"
                        >
                          {tabState.loading ? 'Creating...' : 'Create Account'}
                        </button>
                      </div>
                    )}

                    {/* Running Bill Table */}
                    <div className="space-y-4">
                      <h3 className="font-semibold text-gray-900">Running Bill Breakdown</h3>
                      <div className="overflow-x-auto">
                        <table className="min-w-full border-collapse">
                          <thead>
                            <tr className="bg-gray-100">
                              <th className="border border-gray-300 px-4 py-2 text-left text-sm font-semibold text-gray-900">Category</th>
                              <th className="border border-gray-300 px-4 py-2 text-right text-sm font-semibold text-gray-900">Items</th>
                              <th className="border border-gray-300 px-4 py-2 text-right text-sm font-semibold text-gray-900">Amount</th>
                            </tr>
                          </thead>
                          <tbody>
                            {runningCategories.length > 0 ? (
                              runningCategories.map(cat => (
                                <tr key={cat.category} className="border-b border-gray-200 hover:bg-gray-50">
                                  <td className="border border-gray-300 px-4 py-3 text-sm font-medium text-gray-900">
                                    {cat.category.replace(/_/g, ' ')}
                                  </td>
                                  <td className="border border-gray-300 px-4 py-3 text-right text-sm text-gray-600">
                                    {cat.count}
                                  </td>
                                  <td className="border border-gray-300 px-4 py-3 text-right text-sm font-medium text-gray-900">
                                    {formatCurrency(toNum(cat.total))}
                                  </td>
                                </tr>
                              ))
                            ) : (
                              <tr>
                                <td colSpan={3} className="border border-gray-300 px-4 py-6 text-center text-sm text-gray-500">
                                  No charges posted yet for this encounter.
                                </td>
                              </tr>
                            )}
                            <tr className="bg-gray-100 font-semibold">
                              <td className="border border-gray-300 px-4 py-3 text-sm text-gray-900">Subtotal</td>
                              <td className="border border-gray-300 px-4 py-3 text-right text-sm text-gray-900">{runningItemCount}</td>
                              <td className="border border-gray-300 px-4 py-3 text-right text-sm text-gray-900">{formatCurrency(billTotal)}</td>
                            </tr>
                            <tr className="bg-gray-100">
                              <td className="border border-gray-300 px-4 py-3 text-sm font-semibold text-gray-900">GST</td>
                              <td className="border border-gray-300 px-4 py-3"></td>
                              <td className="border border-gray-300 px-4 py-3 text-right text-sm font-medium text-gray-900">
                                {formatCurrency(gst)}
                              </td>
                            </tr>
                            <tr className="bg-blue-50">
                              <td className="border border-gray-300 px-4 py-3 text-sm font-bold text-blue-900">Grand Total</td>
                              <td className="border border-gray-300 px-4 py-3"></td>
                              <td className="border border-gray-300 px-4 py-3 text-right text-sm font-bold text-blue-900">
                                {formatCurrency(grandTotal)}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                )}

                {/* Tab: Deposits */}
                {tabState.activeTab === 'deposits' && (
                  <div>
                    <div className="grid md:grid-cols-4 gap-4 mb-6">
                      <div className="bg-green-50 rounded-lg p-4 border border-green-200">
                        <span className="text-xs font-semibold text-green-700 uppercase">Collected</span>
                        <p className="text-2xl font-bold text-green-600 mt-2">{formatCurrency(depositSummary.collected)}</p>
                      </div>
                      <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
                        <span className="text-xs font-semibold text-blue-700 uppercase">Applied</span>
                        <p className="text-2xl font-bold text-blue-600 mt-2">{formatCurrency(depositSummary.applied)}</p>
                      </div>
                      <div className="bg-orange-50 rounded-lg p-4 border border-orange-200">
                        <span className="text-xs font-semibold text-orange-700 uppercase">Refunded</span>
                        <p className="text-2xl font-bold text-orange-600 mt-2">{formatCurrency(depositSummary.refunded)}</p>
                      </div>
                      <div className="bg-gray-900 rounded-lg p-4 border border-gray-700">
                        <span className="text-xs font-semibold text-white uppercase">Net Available</span>
                        <p className="text-2xl font-bold text-white mt-2">
                          {formatCurrency(depositSummary.collected - depositSummary.applied)}
                        </p>
                      </div>
                    </div>

                    <div className="flex justify-end mb-6">
                      <button
                        onClick={() => setShowDepositForm(!showDepositForm)}
                        className="bg-green-600 hover:bg-green-700 text-white font-medium py-2 px-4 rounded-lg transition-colors"
                      >
                        {showDepositForm ? 'Cancel' : '+ Collect Deposit'}
                      </button>
                    </div>

                    {showDepositForm && (
                      <div className="bg-gray-50 rounded-lg p-6 mb-6 border border-gray-200">
                        <h3 className="font-semibold text-gray-900 mb-4">Collect Deposit</h3>
                        <div className="grid md:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Amount</label>
                            <input
                              type="number"
                              value={depositFormData.amount}
                              onChange={(e) =>
                                setDepositFormData({
                                  ...depositFormData,
                                  amount: parseFloat(e.target.value) || 0,
                                })
                              }
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Payment Method</label>
                            <select
                              value={depositFormData.payment_method}
                              onChange={(e) =>
                                setDepositFormData({
                                  ...depositFormData,
                                  payment_method: e.target.value as any,
                                })
                              }
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                            >
                              <option value="cash">Cash</option>
                              <option value="card">Card</option>
                              <option value="upi">UPI</option>
                              <option value="neft">NEFT</option>
                              <option value="cheque">Cheque</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Reference Number</label>
                            <input
                              type="text"
                              value={depositFormData.reference_number}
                              onChange={(e) =>
                                setDepositFormData({
                                  ...depositFormData,
                                  reference_number: e.target.value,
                                })
                              }
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Receipt Number</label>
                            <input
                              type="text"
                              value={depositFormData.receipt_number}
                              onChange={(e) =>
                                setDepositFormData({
                                  ...depositFormData,
                                  receipt_number: e.target.value,
                                })
                              }
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                            />
                          </div>
                          <div className="md:col-span-2">
                            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                            <textarea
                              value={depositFormData.notes}
                              onChange={(e) =>
                                setDepositFormData({
                                  ...depositFormData,
                                  notes: e.target.value,
                                })
                              }
                              rows={2}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                            />
                          </div>
                        </div>
                        <button
                          onClick={handleCollectDeposit}
                          disabled={tabState.loading}
                          className="mt-6 w-full bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white font-medium py-2 px-4 rounded-lg transition-colors"
                        >
                          {tabState.loading ? 'Collecting...' : 'Collect Deposit'}
                        </button>
                      </div>
                    )}

                    {/* Deposits List */}
                    <div className="overflow-x-auto">
                      <table className="min-w-full border-collapse">
                        <thead>
                          <tr className="bg-gray-100">
                            <th className="border border-gray-300 px-4 py-2 text-left text-sm font-semibold text-gray-900">Date</th>
                            <th className="border border-gray-300 px-4 py-2 text-left text-sm font-semibold text-gray-900">Amount</th>
                            <th className="border border-gray-300 px-4 py-2 text-left text-sm font-semibold text-gray-900">Method</th>
                            <th className="border border-gray-300 px-4 py-2 text-left text-sm font-semibold text-gray-900">Reference #</th>
                            <th className="border border-gray-300 px-4 py-2 text-left text-sm font-semibold text-gray-900">Status</th>
                            <th className="border border-gray-300 px-4 py-2 text-left text-sm font-semibold text-gray-900">Collected By</th>
                          </tr>
                        </thead>
                        <tbody>
                          {deposits.length > 0 ? (
                            deposits.map(deposit => (
                              <tr key={deposit.id} className="border-b border-gray-200 hover:bg-gray-50">
                                <td className="border border-gray-300 px-4 py-3 text-sm text-gray-600">{formatDate(deposit.collected_at)}</td>
                                <td className="border border-gray-300 px-4 py-3 text-sm font-medium text-gray-900">{formatCurrency(toNum(deposit.amount))}</td>
                                <td className="border border-gray-300 px-4 py-3 text-sm text-gray-600">{deposit.payment_method}</td>
                                <td className="border border-gray-300 px-4 py-3 text-sm text-gray-600">{deposit.reference_number ?? '—'}</td>
                                <td className="border border-gray-300 px-4 py-3 text-sm">
                                  <span
                                    className={`inline-block px-2 py-1 rounded text-xs font-medium ${
                                      deposit.status === 'collected'
                                        ? 'bg-green-100 text-green-800'
                                        : deposit.status === 'applied'
                                        ? 'bg-blue-100 text-blue-800'
                                        : 'bg-orange-100 text-orange-800'
                                    }`}
                                  >
                                    {deposit.status}
                                  </span>
                                </td>
                                <td className="border border-gray-300 px-4 py-3 text-sm text-gray-600">{deposit.collector_name ?? '—'}</td>
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td colSpan={6} className="border border-gray-300 px-4 py-3 text-center text-sm text-gray-600">
                                No deposits recorded
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Tab: Packages */}
                {tabState.activeTab === 'packages' && (
                  <div>
                    <div className="flex justify-end mb-6">
                      <button
                        onClick={() => setShowPackageForm(!showPackageForm)}
                        className="bg-purple-600 hover:bg-purple-700 text-white font-medium py-2 px-4 rounded-lg transition-colors"
                      >
                        {showPackageForm ? 'Cancel' : '+ Apply Package'}
                      </button>
                    </div>

                    {showPackageForm && (
                      <div className="bg-gray-50 rounded-lg p-6 mb-6 border border-gray-200">
                        <h3 className="font-semibold text-gray-900 mb-4">Apply Package</h3>
                        <div className="grid md:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Package Name</label>
                            <input
                              type="text"
                              value={packageFormData.package_name}
                              onChange={(e) =>
                                setPackageFormData({
                                  ...packageFormData,
                                  package_name: e.target.value,
                                })
                              }
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Package Code</label>
                            <input
                              type="text"
                              value={packageFormData.package_code}
                              onChange={(e) =>
                                setPackageFormData({
                                  ...packageFormData,
                                  package_code: e.target.value,
                                })
                              }
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Package Price</label>
                            <input
                              type="number"
                              value={packageFormData.package_price}
                              onChange={(e) =>
                                setPackageFormData({
                                  ...packageFormData,
                                  package_price: parseFloat(e.target.value) || 0,
                                })
                              }
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Max LOS (Days)</label>
                            <input
                              type="number"
                              value={packageFormData.max_los_days}
                              onChange={(e) =>
                                setPackageFormData({
                                  ...packageFormData,
                                  max_los_days: parseInt(e.target.value) || 0,
                                })
                              }
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                            />
                          </div>
                          <div className="md:col-span-2">
                            <div className="flex items-center space-x-6">
                              <label className="flex items-center">
                                <input
                                  type="checkbox"
                                  checked={packageFormData.includes_room}
                                  onChange={(e) =>
                                    setPackageFormData({
                                      ...packageFormData,
                                      includes_room: e.target.checked,
                                    })
                                  }
                                  className="w-4 h-4 text-purple-600 border-gray-300 rounded focus:ring-purple-500"
                                />
                                <span className="ml-2 text-sm font-medium text-gray-700">Includes Room</span>
                              </label>
                              <label className="flex items-center">
                                <input
                                  type="checkbox"
                                  checked={packageFormData.includes_pharmacy}
                                  onChange={(e) =>
                                    setPackageFormData({
                                      ...packageFormData,
                                      includes_pharmacy: e.target.checked,
                                    })
                                  }
                                  className="w-4 h-4 text-purple-600 border-gray-300 rounded focus:ring-purple-500"
                                />
                                <span className="ml-2 text-sm font-medium text-gray-700">Includes Pharmacy</span>
                              </label>
                              <label className="flex items-center">
                                <input
                                  type="checkbox"
                                  checked={packageFormData.includes_investigations}
                                  onChange={(e) =>
                                    setPackageFormData({
                                      ...packageFormData,
                                      includes_investigations: e.target.checked,
                                    })
                                  }
                                  className="w-4 h-4 text-purple-600 border-gray-300 rounded focus:ring-purple-500"
                                />
                                <span className="ml-2 text-sm font-medium text-gray-700">Includes Investigations</span>
                              </label>
                            </div>
                          </div>
                        </div>
                        <button
                          onClick={handleApplyPackage}
                          disabled={tabState.loading}
                          className="mt-6 w-full bg-purple-600 hover:bg-purple-700 disabled:bg-gray-400 text-white font-medium py-2 px-4 rounded-lg transition-colors"
                        >
                          {tabState.loading ? 'Applying...' : 'Apply Package'}
                        </button>
                      </div>
                    )}

                    {/* Packages List */}
                    <div className="space-y-4">
                      {packages.length > 0 ? (
                        packages.map(pkg => {
                          const packagePrice = toNum(pkg.package_price);
                          const actualCost = toNum(pkg.actual_cost);
                          // Router returns variance_amount = package_price - actual_cost
                          // (positive = under-budget, negative = over-budget).
                          const variance = pkg.variance_amount !== null && pkg.variance_amount !== undefined
                            ? toNum(pkg.variance_amount)
                            : packagePrice - actualCost;
                          return (
                            <div key={pkg.id} className="border border-gray-200 rounded-lg overflow-hidden hover:shadow-lg transition-shadow">
                              <div
                                className="bg-gray-50 p-4 cursor-pointer flex items-center justify-between"
                                onClick={() =>
                                  setExpandedPackageId(expandedPackageId === pkg.id ? null : pkg.id)
                                }
                              >
                                <div className="flex-1">
                                  <div className="flex items-center gap-3">
                                    <h4 className="font-semibold text-gray-900">{pkg.package_name}</h4>
                                    <span className="text-xs bg-purple-100 text-purple-800 px-2 py-1 rounded">
                                      {pkg.status}
                                    </span>
                                  </div>
                                  <p className="text-sm text-gray-600 mt-1">Code: {pkg.package_code ?? '—'}</p>
                                </div>
                                <div className="text-right">
                                  <div className="text-lg font-bold text-gray-900">{formatCurrency(packagePrice)}</div>
                                  <div className={`text-sm font-medium ${variance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                    {variance >= 0 ? '+' : ''}{formatCurrency(variance)}
                                  </div>
                                </div>
                                <div className="ml-4 text-gray-400">{expandedPackageId === pkg.id ? '▼' : '▶'}</div>
                              </div>

                              {expandedPackageId === pkg.id && (
                                <div className="p-4 border-t border-gray-200 bg-white">
                                  <div className="grid md:grid-cols-3 gap-4 mb-4">
                                    <div>
                                      <span className="text-xs font-semibold text-gray-600 uppercase">Budgeted</span>
                                      <p className="text-lg font-bold text-gray-900 mt-1">{formatCurrency(packagePrice)}</p>
                                    </div>
                                    <div>
                                      <span className="text-xs font-semibold text-gray-600 uppercase">Actual Cost</span>
                                      <p className="text-lg font-bold text-gray-900 mt-1">{formatCurrency(actualCost)}</p>
                                    </div>
                                    <div>
                                      <span className="text-xs font-semibold text-gray-600 uppercase">Variance</span>
                                      <p className={`text-lg font-bold mt-1 ${variance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                        {variance >= 0 ? '+' : ''}{formatCurrency(variance)}
                                      </p>
                                    </div>
                                  </div>
                                  <p className="text-xs text-gray-500 italic">
                                    Applied {formatDate(pkg.applied_at)}
                                    {pkg.name_full ? ` • Patient: ${pkg.name_full}` : ''}
                                  </p>
                                </div>
                              )}
                            </div>
                          );
                        })
                      ) : (
                        <div className="text-center py-8 text-gray-600">No packages applied</div>
                      )}
                    </div>
                  </div>
                )}

                {/* Tab: Room Charges */}
                {tabState.activeTab === 'rooms' && (
                  <div>
                    <div className="grid md:grid-cols-4 gap-4 mb-6">
                      <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
                        <span className="text-xs font-semibold text-blue-700 uppercase">Total Days</span>
                        <p className="text-2xl font-bold text-blue-600 mt-2">{roomCharges.length}</p>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                        <span className="text-xs font-semibold text-gray-700 uppercase">Total Charges</span>
                        <p className="text-2xl font-bold text-gray-900 mt-2">{formatCurrency(roomChargeTotal)}</p>
                      </div>
                      <div className="bg-green-50 rounded-lg p-4 border border-green-200">
                        <span className="text-xs font-semibold text-green-700 uppercase">Eligible Days</span>
                        <p className="text-2xl font-bold text-green-600 mt-2">{eligibleDays}</p>
                      </div>
                      <div className="bg-red-50 rounded-lg p-4 border border-red-200">
                        <span className="text-xs font-semibold text-red-700 uppercase">Over Eligible</span>
                        <p className="text-2xl font-bold text-red-600 mt-2">{overEligibleDays}</p>
                      </div>
                    </div>

                    <div className="flex justify-end mb-6">
                      <button
                        onClick={() => setShowRoomChargeForm(!showRoomChargeForm)}
                        className="bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2 px-4 rounded-lg transition-colors"
                      >
                        {showRoomChargeForm ? 'Cancel' : '+ Add Room Charge'}
                      </button>
                    </div>

                    {showRoomChargeForm && (
                      <div className="bg-gray-50 rounded-lg p-6 mb-6 border border-gray-200">
                        <h3 className="font-semibold text-gray-900 mb-4">Add Room Charge</h3>
                        <div className="grid md:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Charge Date</label>
                            <input
                              type="date"
                              value={roomChargeFormData.charge_date}
                              onChange={(e) =>
                                setRoomChargeFormData({
                                  ...roomChargeFormData,
                                  charge_date: e.target.value,
                                })
                              }
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Charge Type</label>
                            <select
                              value={roomChargeFormData.charge_type}
                              onChange={(e) =>
                                setRoomChargeFormData({
                                  ...roomChargeFormData,
                                  charge_type: e.target.value,
                                })
                              }
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                            >
                              <option value="daily">Daily</option>
                              <option value="hourly">Hourly</option>
                              <option value="one-time">One-time</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Ward Name</label>
                            <input
                              type="text"
                              value={roomChargeFormData.ward_name}
                              onChange={(e) =>
                                setRoomChargeFormData({
                                  ...roomChargeFormData,
                                  ward_name: e.target.value,
                                })
                              }
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Room Category</label>
                            <select
                              value={roomChargeFormData.room_category}
                              onChange={(e) =>
                                setRoomChargeFormData({
                                  ...roomChargeFormData,
                                  room_category: e.target.value as any,
                                })
                              }
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                            >
                              <option value="General">General</option>
                              <option value="Semi-Private">Semi-Private</option>
                              <option value="Private">Private</option>
                              <option value="Deluxe">Deluxe</option>
                              <option value="ICU">ICU</option>
                              <option value="NICU">NICU</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Base Rate</label>
                            <input
                              type="number"
                              value={roomChargeFormData.base_rate}
                              onChange={(e) =>
                                setRoomChargeFormData({
                                  ...roomChargeFormData,
                                  base_rate: parseFloat(e.target.value) || 0,
                                })
                              }
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Nursing Charge</label>
                            <input
                              type="number"
                              value={roomChargeFormData.nursing_charge}
                              onChange={(e) =>
                                setRoomChargeFormData({
                                  ...roomChargeFormData,
                                  nursing_charge: parseFloat(e.target.value) || 0,
                                })
                              }
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                            />
                          </div>
                          <div className="md:col-span-2">
                            <label className="flex items-center">
                              <input
                                type="checkbox"
                                checked={roomChargeFormData.room_rent_eligible}
                                onChange={(e) =>
                                  setRoomChargeFormData({
                                    ...roomChargeFormData,
                                    room_rent_eligible: e.target.checked,
                                  })
                                }
                                className="w-4 h-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500"
                              />
                              <span className="ml-2 text-sm font-medium text-gray-700">Room Rent Eligible</span>
                            </label>
                          </div>
                        </div>
                        <button
                          onClick={handleAddRoomCharge}
                          disabled={tabState.loading}
                          className="mt-6 w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-400 text-white font-medium py-2 px-4 rounded-lg transition-colors"
                        >
                          {tabState.loading ? 'Adding...' : 'Add Room Charge'}
                        </button>
                      </div>
                    )}

                    {/* Room Charges Table */}
                    <div className="overflow-x-auto">
                      <table className="min-w-full border-collapse">
                        <thead>
                          <tr className="bg-gray-100">
                            <th className="border border-gray-300 px-4 py-2 text-left text-sm font-semibold text-gray-900">Date</th>
                            <th className="border border-gray-300 px-4 py-2 text-left text-sm font-semibold text-gray-900">Room</th>
                            <th className="border border-gray-300 px-4 py-2 text-left text-sm font-semibold text-gray-900">Category</th>
                            <th className="border border-gray-300 px-4 py-2 text-right text-sm font-semibold text-gray-900">Base Rate</th>
                            <th className="border border-gray-300 px-4 py-2 text-right text-sm font-semibold text-gray-900">Nursing</th>
                            <th className="border border-gray-300 px-4 py-2 text-right text-sm font-semibold text-gray-900">Total</th>
                            <th className="border border-gray-300 px-4 py-2 text-center text-sm font-semibold text-gray-900">Eligible</th>
                          </tr>
                        </thead>
                        <tbody>
                          {roomCharges.length > 0 ? (
                            roomCharges.map(charge => {
                              const baseRate = toNum(charge.base_rate);
                              const nursing = toNum(charge.nursing_charge);
                              const total = charge.total_charge !== null && charge.total_charge !== undefined
                                ? toNum(charge.total_charge)
                                : baseRate + nursing;
                              const eligible = !charge.is_over_eligible;
                              return (
                                <tr
                                  key={charge.id}
                                  className={`border-b border-gray-200 ${
                                    !eligible ? 'bg-red-50' : 'hover:bg-gray-50'
                                  }`}
                                >
                                  <td className="border border-gray-300 px-4 py-3 text-sm text-gray-600">{formatDate(charge.charge_date)}</td>
                                  <td className="border border-gray-300 px-4 py-3 text-sm text-gray-900">{charge.ward_name ?? '—'}</td>
                                  <td className="border border-gray-300 px-4 py-3 text-sm text-gray-600">{charge.room_category ?? '—'}</td>
                                  <td className="border border-gray-300 px-4 py-3 text-sm font-medium text-right text-gray-900">
                                    {formatCurrency(baseRate)}
                                  </td>
                                  <td className="border border-gray-300 px-4 py-3 text-sm font-medium text-right text-gray-900">
                                    {formatCurrency(nursing)}
                                  </td>
                                  <td className="border border-gray-300 px-4 py-3 text-sm font-bold text-right text-gray-900">
                                    {formatCurrency(total)}
                                  </td>
                                  <td className="border border-gray-300 px-4 py-3 text-center text-sm">
                                    <span
                                      className={`inline-block px-2 py-1 rounded text-xs font-medium ${
                                        eligible
                                          ? 'bg-green-100 text-green-800'
                                          : 'bg-red-100 text-red-800'
                                      }`}
                                    >
                                      {eligible ? '✓' : '✗'}
                                    </span>
                                  </td>
                                </tr>
                              );
                            })
                          ) : (
                            <tr>
                              <td colSpan={7} className="border border-gray-300 px-4 py-3 text-center text-sm text-gray-600">
                                No room charges recorded
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {tabState.activeTab === 'ai-cost' && (
                  <div style={{ padding: '20px', maxWidth: '1400px' }}>
                    <h2 style={{ margin: '0 0 8px 0', fontSize: '20px', fontWeight: '600' }}>🤖 AI Cost Intelligence</h2>
                    <p style={{ margin: '0 0 20px 0', fontSize: '14px', color: '#6b7280' }}>
                      Real-time cost forecasting, margin analysis, and deposit adequacy assessment.
                    </p>

                    {aiCostError && (
                      <div style={{ padding: '12px 16px', backgroundColor: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', marginBottom: '16px', color: '#991b1b', fontSize: '14px' }}>
                        {aiCostError}
                      </div>
                    )}

                    {account ? (
                      <div>
                        <button
                          onClick={handleRunCostEstimate}
                          disabled={aiCostLoading}
                          style={{
                            padding: '10px 20px',
                            backgroundColor: aiCostLoading ? '#c4b5fd' : '#7c3aed',
                            color: '#fff',
                            border: 'none',
                            borderRadius: '8px',
                            cursor: aiCostLoading ? 'not-allowed' : 'pointer',
                            fontSize: '14px',
                            fontWeight: '600',
                            marginBottom: '20px',
                          }}
                        >
                          {aiCostLoading ? 'Analyzing...' : `Run Cost Analysis — ${account.insurer_name || 'Self Pay'}`}
                        </button>

                        {aiCostEstimate && (
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                            {/* Cost Estimate */}
                            <div style={{ backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: '12px', padding: '20px' }}>
                              <h3 style={{ margin: '0 0 16px 0', fontSize: '16px', fontWeight: '600', color: '#7c3aed' }}>Cost Estimate</h3>
                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', fontSize: '14px' }}>
                                <div>
                                  <div style={{ fontSize: '12px', color: '#6b7280' }}>Charges Accrued</div>
                                  <div style={{ fontWeight: '700', fontSize: '18px' }}>₹{Number(aiCostEstimate.estimate?.charges_accrued || 0).toLocaleString('en-IN')}</div>
                                </div>
                                <div>
                                  <div style={{ fontSize: '12px', color: '#6b7280' }}>Estimated Remaining</div>
                                  <div style={{ fontWeight: '700', fontSize: '18px' }}>₹{Number(aiCostEstimate.estimate?.estimated_remaining || 0).toLocaleString('en-IN')}</div>
                                </div>
                                <div>
                                  <div style={{ fontSize: '12px', color: '#6b7280' }}>Estimated Total</div>
                                  <div style={{ fontWeight: '700', fontSize: '20px', color: '#7c3aed' }}>₹{Number(aiCostEstimate.estimate?.estimated_total || 0).toLocaleString('en-IN')}</div>
                                </div>
                                <div>
                                  <div style={{ fontSize: '12px', color: '#6b7280' }}>Daily Burn Rate</div>
                                  <div style={{ fontWeight: '700', fontSize: '18px' }}>₹{Number(aiCostEstimate.estimate?.daily_burn_rate || 0).toLocaleString('en-IN')}/day</div>
                                </div>
                                <div>
                                  <div style={{ fontSize: '12px', color: '#6b7280' }}>LOS</div>
                                  <div style={{ fontWeight: '600' }}>{aiCostEstimate.estimate?.los_current_days || 0} / {aiCostEstimate.estimate?.los_expected_days || '?'} days</div>
                                </div>
                                <div>
                                  <div style={{ fontSize: '12px', color: '#6b7280' }}>Confidence</div>
                                  <div style={{ fontWeight: '600', color: '#059669' }}>{((aiCostEstimate.estimate?.confidence || 0) * 100).toFixed(0)}%</div>
                                </div>
                              </div>

                              {/* Deposit Status */}
                              {aiCostEstimate.estimate?.deposit_status && (
                                <div style={{ marginTop: '16px', padding: '12px', backgroundColor: aiCostEstimate.estimate.deposit_status.shortfall > 0 ? '#fef2f2' : '#f0fdf4', borderRadius: '8px' }}>
                                  <div style={{ fontSize: '13px', fontWeight: '600', marginBottom: '4px', color: aiCostEstimate.estimate.deposit_status.shortfall > 0 ? '#991b1b' : '#166534' }}>
                                    {aiCostEstimate.estimate.deposit_status.shortfall > 0 ? '⚠ Deposit Shortfall' : '✓ Deposit Adequate'}
                                  </div>
                                  <div style={{ fontSize: '12px', color: '#4b5563' }}>
                                    Collected: ₹{Number(aiCostEstimate.estimate.deposit_status.collected).toLocaleString('en-IN')} / Required: ₹{Number(aiCostEstimate.estimate.deposit_status.required).toLocaleString('en-IN')}
                                  </div>
                                </div>
                              )}

                              {/* Package Comparison */}
                              {aiCostEstimate.estimate?.package_comparison && (
                                <div style={{ marginTop: '12px', padding: '12px', backgroundColor: '#eff6ff', borderRadius: '8px', fontSize: '13px' }}>
                                  <div style={{ fontWeight: '600', color: '#1e40af', marginBottom: '4px' }}>Package vs Itemized</div>
                                  <div>Package: ₹{Number(aiCostEstimate.estimate.package_comparison.package_total).toLocaleString('en-IN')}</div>
                                  <div>Itemized: ₹{Number(aiCostEstimate.estimate.package_comparison.itemized_total).toLocaleString('en-IN')}</div>
                                  <div style={{ marginTop: '4px', fontWeight: '600', color: '#047857' }}>
                                    Recommended: {aiCostEstimate.estimate.package_comparison.recommended} (saves ₹{Number(aiCostEstimate.estimate.package_comparison.savings).toLocaleString('en-IN')})
                                  </div>
                                </div>
                              )}
                            </div>

                            {/* Margin Analysis */}
                            <div style={{ backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: '12px', padding: '20px' }}>
                              <h3 style={{ margin: '0 0 16px 0', fontSize: '16px', fontWeight: '600', color: '#7c3aed' }}>Margin Analysis</h3>
                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', fontSize: '14px', marginBottom: '16px' }}>
                                <div>
                                  <div style={{ fontSize: '12px', color: '#6b7280' }}>Revenue</div>
                                  <div style={{ fontWeight: '700', fontSize: '18px' }}>₹{Number(aiCostEstimate.margin?.revenue || 0).toLocaleString('en-IN')}</div>
                                </div>
                                <div>
                                  <div style={{ fontSize: '12px', color: '#6b7280' }}>Cost</div>
                                  <div style={{ fontWeight: '700', fontSize: '18px' }}>₹{Number(aiCostEstimate.margin?.cost || 0).toLocaleString('en-IN')}</div>
                                </div>
                                <div>
                                  <div style={{ fontSize: '12px', color: '#6b7280' }}>Margin</div>
                                  <div style={{ fontWeight: '700', fontSize: '18px', color: (aiCostEstimate.margin?.margin_pct || 0) < 15 ? '#dc2626' : '#059669' }}>
                                    {(aiCostEstimate.margin?.margin_pct || 0).toFixed(1)}%
                                  </div>
                                </div>
                                <div>
                                  <div style={{ fontSize: '12px', color: '#6b7280' }}>Deposit Adequacy</div>
                                  <div style={{ fontWeight: '700', fontSize: '18px' }}>{(aiCostEstimate.margin?.deposit_adequacy_pct || 0).toFixed(0)}%</div>
                                </div>
                              </div>

                              {/* Low margin items */}
                              {aiCostEstimate.margin?.low_margin_items?.length > 0 && (
                                <div>
                                  <div style={{ fontWeight: '600', color: '#991b1b', marginBottom: '8px', fontSize: '13px' }}>Low-Margin Items</div>
                                  {aiCostEstimate.margin.low_margin_items.map((item: any, i: number) => (
                                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #f3f4f6', fontSize: '12px' }}>
                                      <span style={{ color: '#4b5563' }}>{item.description}</span>
                                      <span style={{ fontWeight: '600', color: item.margin_pct < 0 ? '#dc2626' : '#d97706' }}>{item.margin_pct.toFixed(1)}%</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div style={{ padding: '40px', textAlign: 'center', color: '#9ca3af', backgroundColor: '#fff', borderRadius: '12px', border: '1px solid #e5e7eb' }}>
                        <p style={{ fontSize: '16px', marginBottom: '8px' }}>Select a patient and billing account first</p>
                        <p style={{ fontSize: '13px' }}>Go to the Accounts tab, search for a patient, and select their billing account.</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        {!account && tabState.selectedPatientId && !tabState.loading && (
          <div className="bg-white rounded-lg shadow p-8 text-center">
            <p className="text-gray-600 mb-4">No billing account exists for this patient</p>
            <button
              onClick={() => {
                setTabState(prev => ({ ...prev, activeTab: 'accounts' }));
                setShowAccountForm(true);
              }}
              className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-6 rounded-lg transition-colors"
            >
              Create Billing Account
            </button>
          </div>
        )}

        {/* Default landing: IPD census table. Shown whenever no patient is selected
            (and we're not mid-load). Every row is clickable — click loads the billing
            account for that patient into the detail view above. Search filters locally
            on name / UHID / ward — no extra round-trip. */}
        {!tabState.selectedPatientId && !tabState.loading && (
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Currently Admitted (IPD)</h2>
                <p className="text-sm text-gray-600">
                  {censusLoading
                    ? 'Loading census…'
                    : `${census.length} active ${census.length === 1 ? 'encounter' : 'encounters'}`}
                </p>
              </div>
              <input
                type="text"
                placeholder="Filter by name, UHID, or ward"
                value={censusSearch}
                onChange={(e) => setCensusSearch(e.target.value)}
                className="w-72 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
              />
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full border-collapse">
                <thead>
                  <tr className="bg-gray-100">
                    <th className="border border-gray-300 px-4 py-2 text-left text-sm font-semibold text-gray-900">Patient</th>
                    <th className="border border-gray-300 px-4 py-2 text-left text-sm font-semibold text-gray-900">UHID</th>
                    <th className="border border-gray-300 px-4 py-2 text-left text-sm font-semibold text-gray-900">Ward / Bed</th>
                    <th className="border border-gray-300 px-4 py-2 text-right text-sm font-semibold text-gray-900">Days</th>
                    <th className="border border-gray-300 px-4 py-2 text-left text-sm font-semibold text-gray-900">Account</th>
                    <th className="border border-gray-300 px-4 py-2 text-right text-sm font-semibold text-gray-900">Deposits</th>
                    <th className="border border-gray-300 px-4 py-2 text-right text-sm font-semibold text-gray-900">Running Bill</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const q = censusSearch.trim().toLowerCase();
                    const filtered = q
                      ? census.filter(
                          r =>
                            (r.patient_name || '').toLowerCase().includes(q) ||
                            (r.uhid || '').toLowerCase().includes(q) ||
                            (r.ward_name || '').toLowerCase().includes(q) ||
                            (r.bed_code || '').toLowerCase().includes(q),
                        )
                      : census;

                    if (censusLoading && census.length === 0) {
                      return (
                        <tr>
                          <td colSpan={7} className="border border-gray-300 px-4 py-8 text-center text-sm text-gray-600">
                            Loading currently-admitted patients…
                          </td>
                        </tr>
                      );
                    }
                    if (filtered.length === 0) {
                      return (
                        <tr>
                          <td colSpan={7} className="border border-gray-300 px-4 py-8 text-center text-sm text-gray-600">
                            {census.length === 0
                              ? 'No patients currently admitted.'
                              : 'No matches for that filter.'}
                          </td>
                        </tr>
                      );
                    }

                    const now = Date.now();
                    return filtered.map(row => {
                      const admittedMs = new Date(row.admission_at).getTime();
                      const days = Number.isFinite(admittedMs)
                        ? Math.max(1, Math.floor((now - admittedMs) / 86400000) + 1)
                        : '—';
                      const deposit = toNum(row.deposits_collected);
                      const running = toNum(row.running_total);
                      const accountLabel = row.account_id
                        ? (row.account_type ?? 'account').replace(/_/g, ' ')
                        : 'none';
                      return (
                        <tr
                          key={row.encounter_id}
                          onClick={() => handleSelectPatient(row.patient_id)}
                          className="border-b border-gray-200 hover:bg-blue-50 cursor-pointer transition-colors"
                        >
                          <td className="border border-gray-300 px-4 py-3 text-sm font-medium text-gray-900">
                            {row.patient_name}
                          </td>
                          <td className="border border-gray-300 px-4 py-3 text-sm text-gray-700">{row.uhid}</td>
                          <td className="border border-gray-300 px-4 py-3 text-sm text-gray-700">
                            {row.ward_name ?? '—'}
                            {row.bed_code ? (
                              <span className="text-xs text-gray-500 ml-2">#{row.bed_code}</span>
                            ) : null}
                          </td>
                          <td className="border border-gray-300 px-4 py-3 text-sm text-right text-gray-900">{days}</td>
                          <td className="border border-gray-300 px-4 py-3 text-sm">
                            <span
                              className={`inline-block px-2 py-1 rounded text-xs font-medium ${
                                row.account_id
                                  ? 'bg-blue-100 text-blue-800'
                                  : 'bg-amber-100 text-amber-800'
                              }`}
                            >
                              {accountLabel}
                            </span>
                            {row.insurer_name ? (
                              <span className="text-xs text-gray-600 ml-2">{row.insurer_name}</span>
                            ) : null}
                          </td>
                          <td className="border border-gray-300 px-4 py-3 text-sm text-right text-gray-900">
                            {formatCurrency(deposit)}
                          </td>
                          <td className="border border-gray-300 px-4 py-3 text-sm text-right font-medium text-gray-900">
                            {formatCurrency(running)}
                          </td>
                        </tr>
                      );
                    });
                  })()}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
