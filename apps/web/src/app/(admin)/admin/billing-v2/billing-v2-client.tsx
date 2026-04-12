'use client';

import { useState, useEffect, useCallback } from 'react';

interface User {
  sub: string;
  hospital_id: string;
  role: string;
  email: string;
  name: string;
}

interface Patient {
  id: string;
  name: string;
  uhid: string;
  dob: string;
}

interface BillingAccount {
  id: string;
  patient_id: string;
  account_type: 'self_pay' | 'insurance' | 'corporate' | 'ngo';
  insurer_name?: string;
  tpa_name?: string;
  policy_number?: string;
  member_id?: string;
  sum_insured?: number;
  room_rent_eligibility?: number;
  co_pay_percent?: number;
  estimated_total: number;
  created_at: string;
  is_over_eligible: boolean;
}

interface RunningBillItem {
  id: string;
  category: 'room' | 'procedure' | 'lab' | 'pharmacy' | 'consultation' | 'nursing' | 'other';
  description: string;
  amount: number;
  date: string;
}

interface Deposit {
  id: string;
  account_id: string;
  amount: number;
  payment_method: 'cash' | 'card' | 'upi' | 'neft' | 'cheque';
  reference_number: string;
  receipt_number: string;
  status: 'collected' | 'applied' | 'refunded';
  collected_by: string;
  collected_at: string;
  notes?: string;
}

interface BillingPackage {
  id: string;
  account_id: string;
  package_name: string;
  package_code: string;
  package_price: number;
  includes_room: boolean;
  includes_pharmacy: boolean;
  includes_investigations: boolean;
  max_los_days: number;
  actual_cost: number;
  status: 'active' | 'completed' | 'cancelled';
  created_at: string;
  components: PackageComponent[];
}

interface PackageComponent {
  id: string;
  component_name: string;
  category: string;
  budgeted_amount: number;
  actual_amount: number;
  max_quantity: number;
  used_quantity: number;
}

interface RoomCharge {
  id: string;
  account_id: string;
  charge_date: string;
  charge_type: string;
  ward_name: string;
  room_category: 'General' | 'Semi-Private' | 'Private' | 'Deluxe' | 'ICU' | 'NICU';
  base_rate: number;
  nursing_charge: number;
  room_rent_eligible: boolean;
  created_at: string;
}

interface TabState {
  activeTab: 'accounts' | 'deposits' | 'packages' | 'rooms';
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
  const [runningBill, setRunningBill] = useState<RunningBillItem[]>([]);
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [packages, setPackages] = useState<BillingPackage[]>([]);
  const [roomCharges, setRoomCharges] = useState<RoomCharge[]>([]);

  const [showAccountForm, setShowAccountForm] = useState(false);
  const [showDepositForm, setShowDepositForm] = useState(false);
  const [showPackageForm, setShowPackageForm] = useState(false);
  const [showRoomChargeForm, setShowRoomChargeForm] = useState(false);
  const [expandedPackageId, setExpandedPackageId] = useState<string | null>(null);

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

  // Fetch patients list
  const fetchPatients = useCallback(async (query: string) => {
    try {
      const response = await fetch('/api/trpc/patient.list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ json: { search: query, limit: 20 } }),
      });
      const data = await response.json();
      if (data.result?.data?.json?.patients) {
        setPatients(data.result.data.json.patients);
      }
    } catch (err) {
      console.error('Error fetching patients:', err);
    }
  }, []);

  // Handle patient selection
  const handleSelectPatient = useCallback((patientId: string) => {
    setTabState(prev => ({ ...prev, selectedPatientId: patientId }));
    setShowPatientSearch(false);
    // Auto-fetch account for this patient
    fetchAccountForPatient(patientId);
  }, []);

  const fetchAccountForPatient = useCallback(async (patientId: string) => {
    setTabState(prev => ({ ...prev, loading: true, error: null }));
    try {
      const response = await fetch('/api/trpc/billingAccounts.getByPatient', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ json: { patient_id: patientId } }),
      });
      const data = await response.json();
      if (data.result?.data?.json) {
        setAccount(data.result.data.json);
        setTabState(prev => ({ ...prev, selectedAccountId: data.result.data.json.id }));
        // Fetch related data
        await Promise.all([
          fetchRunningBill(data.result.data.json.id),
          fetchDeposits(data.result.data.json.id),
          fetchPackages(data.result.data.json.id),
          fetchRoomCharges(data.result.data.json.id),
        ]);
      }
    } catch (err) {
      setTabState(prev => ({ ...prev, error: 'Failed to load billing account' }));
    } finally {
      setTabState(prev => ({ ...prev, loading: false }));
    }
  }, []);

  const fetchRunningBill = useCallback(async (accountId: string) => {
    try {
      const response = await fetch('/api/trpc/billingAccounts.getRunningBill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ json: { account_id: accountId } }),
      });
      const data = await response.json();
      if (data.result?.data?.json?.items) {
        setRunningBill(data.result.data.json.items);
      }
    } catch (err) {
      console.error('Error fetching running bill:', err);
    }
  }, []);

  const fetchDeposits = useCallback(async (accountId: string) => {
    try {
      const response = await fetch('/api/trpc/billingAccounts.getDeposits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ json: { account_id: accountId } }),
      });
      const data = await response.json();
      if (data.result?.data?.json?.deposits) {
        setDeposits(data.result.data.json.deposits);
      }
    } catch (err) {
      console.error('Error fetching deposits:', err);
    }
  }, []);

  const fetchPackages = useCallback(async (accountId: string) => {
    try {
      const response = await fetch('/api/trpc/billingAccounts.getPackages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ json: { account_id: accountId } }),
      });
      const data = await response.json();
      if (data.result?.data?.json?.packages) {
        setPackages(data.result.data.json.packages);
      }
    } catch (err) {
      console.error('Error fetching packages:', err);
    }
  }, []);

  const fetchRoomCharges = useCallback(async (accountId: string) => {
    try {
      const response = await fetch('/api/trpc/billingAccounts.getRoomCharges', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ json: { account_id: accountId } }),
      });
      const data = await response.json();
      if (data.result?.data?.json?.charges) {
        setRoomCharges(data.result.data.json.charges);
      }
    } catch (err) {
      console.error('Error fetching room charges:', err);
    }
  }, []);

  const handleCreateAccount = async () => {
    if (!tabState.selectedPatientId) return;
    setTabState(prev => ({ ...prev, loading: true, error: null }));
    try {
      const response = await fetch('/api/trpc/billingAccounts.create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ json: { patient_id: tabState.selectedPatientId, ...accountFormData } }),
      });
      const data = await response.json();
      if (data.result?.data?.json) {
        setAccount(data.result.data.json);
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
      }
    } catch (err) {
      setTabState(prev => ({ ...prev, error: 'Failed to create account' }));
    } finally {
      setTabState(prev => ({ ...prev, loading: false }));
    }
  };

  const handleCollectDeposit = async () => {
    if (!tabState.selectedAccountId) return;
    setTabState(prev => ({ ...prev, loading: true, error: null }));
    try {
      const response = await fetch('/api/trpc/billingAccounts.addDeposit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          json: {
            account_id: tabState.selectedAccountId,
            ...depositFormData,
            collected_by: user.name,
            collected_at: new Date().toISOString(),
          },
        }),
      });
      const data = await response.json();
      if (data.result?.data?.json) {
        await fetchDeposits(tabState.selectedAccountId);
        setShowDepositForm(false);
        setDepositFormData({
          amount: 0,
          payment_method: 'cash',
          reference_number: '',
          receipt_number: '',
          notes: '',
        });
      }
    } catch (err) {
      setTabState(prev => ({ ...prev, error: 'Failed to collect deposit' }));
    } finally {
      setTabState(prev => ({ ...prev, loading: false }));
    }
  };

  const handleApplyPackage = async () => {
    if (!tabState.selectedAccountId) return;
    setTabState(prev => ({ ...prev, loading: true, error: null }));
    try {
      const response = await fetch('/api/trpc/billingAccounts.addPackage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          json: {
            account_id: tabState.selectedAccountId,
            ...packageFormData,
            actual_cost: 0,
            status: 'active',
          },
        }),
      });
      const data = await response.json();
      if (data.result?.data?.json) {
        await fetchPackages(tabState.selectedAccountId);
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
      }
    } catch (err) {
      setTabState(prev => ({ ...prev, error: 'Failed to apply package' }));
    } finally {
      setTabState(prev => ({ ...prev, loading: false }));
    }
  };

  const handleAddRoomCharge = async () => {
    if (!tabState.selectedAccountId) return;
    setTabState(prev => ({ ...prev, loading: true, error: null }));
    try {
      const response = await fetch('/api/trpc/billingAccounts.addRoomCharge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          json: {
            account_id: tabState.selectedAccountId,
            ...roomChargeFormData,
          },
        }),
      });
      const data = await response.json();
      if (data.result?.data?.json) {
        await fetchRoomCharges(tabState.selectedAccountId);
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
      }
    } catch (err) {
      setTabState(prev => ({ ...prev, error: 'Failed to add room charge' }));
    } finally {
      setTabState(prev => ({ ...prev, loading: false }));
    }
  };

  const categoryTotals = runningBill.reduce(
    (acc, item) => {
      acc[item.category] = (acc[item.category] || 0) + item.amount;
      return acc;
    },
    {} as Record<string, number>
  );

  const billTotal = Object.values(categoryTotals).reduce((sum, val) => sum + val, 0);
  const gst = billTotal * 0.05;

  const depositSummary = {
    collected: deposits.filter(d => d.status === 'collected').reduce((sum, d) => sum + d.amount, 0),
    applied: deposits.filter(d => d.status === 'applied').reduce((sum, d) => sum + d.amount, 0),
    refunded: deposits.filter(d => d.status === 'refunded').reduce((sum, d) => sum + d.amount, 0),
  };

  const roomChargeTotal = roomCharges.reduce((sum, rc) => sum + rc.base_rate + rc.nursing_charge, 0);
  const eligibleDays = roomCharges.filter(rc => rc.room_rent_eligible).length;
  const overEligibleDays = roomCharges.filter(rc => !rc.room_rent_eligible).length;

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
                          setPatientSearch(p.name);
                        }}
                        className="w-full text-left px-4 py-3 hover:bg-gray-100 border-b border-gray-200 last:border-b-0"
                      >
                        <div className="font-medium text-gray-900">{p.name}</div>
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
                  <p className={`text-lg font-bold mt-1 ${billTotal + gst > depositSummary.collected ? 'text-red-600' : 'text-green-600'}`}>
                    {formatCurrency(Math.max(0, billTotal + gst - depositSummary.collected))}
                  </p>
                </div>
              </div>
              {account.is_over_eligible && (
                <div className="mt-4 bg-red-50 border-l-4 border-red-500 p-4">
                  <p className="text-sm font-medium text-red-800">
                    ⚠️ Patient exceeds room rent eligibility. Proportional deduction risk: ₹{(account.sum_insured || 0).toLocaleString('en-IN')}
                  </p>
                </div>
              )}
            </div>

            {/* Tabs */}
            <div className="bg-white rounded-lg shadow overflow-hidden">
              <div className="border-b border-gray-200">
                <div className="flex">
                  {(['accounts', 'deposits', 'packages', 'rooms'] as const).map(tab => (
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
                            {Object.entries(categoryTotals).map(([category, total]) => (
                              <tr key={category} className="border-b border-gray-200 hover:bg-gray-50">
                                <td className="border border-gray-300 px-4 py-3 text-sm font-medium text-gray-900">{category.replace('_', ' ')}</td>
                                <td className="border border-gray-300 px-4 py-3 text-right text-sm text-gray-600">
                                  {runningBill.filter(b => b.category === category).length}
                                </td>
                                <td className="border border-gray-300 px-4 py-3 text-right text-sm font-medium text-gray-900">
                                  {formatCurrency(total)}
                                </td>
                              </tr>
                            ))}
                            <tr className="bg-gray-100 font-semibold">
                              <td className="border border-gray-300 px-4 py-3 text-sm text-gray-900">Subtotal</td>
                              <td className="border border-gray-300 px-4 py-3 text-right text-sm text-gray-900">{runningBill.length}</td>
                              <td className="border border-gray-300 px-4 py-3 text-right text-sm text-gray-900">{formatCurrency(billTotal)}</td>
                            </tr>
                            <tr className="bg-gray-100">
                              <td className="border border-gray-300 px-4 py-3 text-sm font-semibold text-gray-900">GST (5%)</td>
                              <td className="border border-gray-300 px-4 py-3"></td>
                              <td className="border border-gray-300 px-4 py-3 text-right text-sm font-medium text-gray-900">
                                {formatCurrency(gst)}
                              </td>
                            </tr>
                            <tr className="bg-blue-50">
                              <td className="border border-gray-300 px-4 py-3 text-sm font-bold text-blue-900">Total Due</td>
                              <td className="border border-gray-300 px-4 py-3"></td>
                              <td className="border border-gray-300 px-4 py-3 text-right text-sm font-bold text-blue-900">
                                {formatCurrency(billTotal + gst)}
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
                            <th className="border border-gray-300 px-4 py-2 text-left text-sm font-semibold text-gray-900">Receipt #</th>
                            <th className="border border-gray-300 px-4 py-2 text-left text-sm font-semibold text-gray-900">Status</th>
                            <th className="border border-gray-300 px-4 py-2 text-left text-sm font-semibold text-gray-900">Collected By</th>
                          </tr>
                        </thead>
                        <tbody>
                          {deposits.length > 0 ? (
                            deposits.map(deposit => (
                              <tr key={deposit.id} className="border-b border-gray-200 hover:bg-gray-50">
                                <td className="border border-gray-300 px-4 py-3 text-sm text-gray-600">{formatDate(deposit.collected_at)}</td>
                                <td className="border border-gray-300 px-4 py-3 text-sm font-medium text-gray-900">{formatCurrency(deposit.amount)}</td>
                                <td className="border border-gray-300 px-4 py-3 text-sm text-gray-600">{deposit.payment_method}</td>
                                <td className="border border-gray-300 px-4 py-3 text-sm text-gray-600">{deposit.receipt_number}</td>
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
                                <td className="border border-gray-300 px-4 py-3 text-sm text-gray-600">{deposit.collected_by}</td>
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
                          const variance = pkg.package_price - pkg.actual_cost;
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
                                  <p className="text-sm text-gray-600 mt-1">Code: {pkg.package_code}</p>
                                </div>
                                <div className="text-right">
                                  <div className="text-lg font-bold text-gray-900">{formatCurrency(pkg.package_price)}</div>
                                  <div className={`text-sm font-medium ${variance > 0 ? 'text-green-600' : 'text-red-600'}`}>
                                    {variance > 0 ? '+' : ''}{formatCurrency(variance)}
                                  </div>
                                </div>
                                <div className="ml-4 text-gray-400">{expandedPackageId === pkg.id ? '▼' : '▶'}</div>
                              </div>

                              {expandedPackageId === pkg.id && (
                                <div className="p-4 border-t border-gray-200 bg-white">
                                  <div className="grid md:grid-cols-3 gap-4 mb-4">
                                    <div>
                                      <span className="text-xs font-semibold text-gray-600 uppercase">Budgeted</span>
                                      <p className="text-lg font-bold text-gray-900 mt-1">{formatCurrency(pkg.package_price)}</p>
                                    </div>
                                    <div>
                                      <span className="text-xs font-semibold text-gray-600 uppercase">Actual Cost</span>
                                      <p className="text-lg font-bold text-gray-900 mt-1">{formatCurrency(pkg.actual_cost)}</p>
                                    </div>
                                    <div>
                                      <span className="text-xs font-semibold text-gray-600 uppercase">Variance</span>
                                      <p className={`text-lg font-bold mt-1 ${variance > 0 ? 'text-green-600' : 'text-red-600'}`}>
                                        {variance > 0 ? '+' : ''}{formatCurrency(variance)}
                                      </p>
                                    </div>
                                  </div>
                                  {pkg.components.length > 0 && (
                                    <div className="space-y-2">
                                      <h5 className="font-medium text-gray-900 text-sm">Components:</h5>
                                      {pkg.components.map(comp => {
                                        const utilization =
                                          comp.max_quantity > 0
                                            ? (comp.used_quantity / comp.max_quantity) * 100
                                            : 0;
                                        return (
                                          <div key={comp.id} className="bg-gray-50 p-3 rounded text-sm">
                                            <div className="flex justify-between mb-1">
                                              <span className="font-medium text-gray-900">{comp.component_name}</span>
                                              <span className="text-gray-600">{comp.used_quantity}/{comp.max_quantity}</span>
                                            </div>
                                            <div className="w-full bg-gray-300 rounded-full h-2">
                                              <div
                                                className={`h-2 rounded-full transition-all ${
                                                  utilization > 100 ? 'bg-red-500' : 'bg-green-500'
                                                }`}
                                                style={{ width: `${Math.min(utilization, 100)}%` }}
                                              ></div>
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}
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
                            roomCharges.map(charge => (
                              <tr
                                key={charge.id}
                                className={`border-b border-gray-200 ${
                                  !charge.room_rent_eligible ? 'bg-red-50' : 'hover:bg-gray-50'
                                }`}
                              >
                                <td className="border border-gray-300 px-4 py-3 text-sm text-gray-600">{formatDate(charge.charge_date)}</td>
                                <td className="border border-gray-300 px-4 py-3 text-sm text-gray-900">{charge.ward_name}</td>
                                <td className="border border-gray-300 px-4 py-3 text-sm text-gray-600">{charge.room_category}</td>
                                <td className="border border-gray-300 px-4 py-3 text-sm font-medium text-right text-gray-900">
                                  {formatCurrency(charge.base_rate)}
                                </td>
                                <td className="border border-gray-300 px-4 py-3 text-sm font-medium text-right text-gray-900">
                                  {formatCurrency(charge.nursing_charge)}
                                </td>
                                <td className="border border-gray-300 px-4 py-3 text-sm font-bold text-right text-gray-900">
                                  {formatCurrency(charge.base_rate + charge.nursing_charge)}
                                </td>
                                <td className="border border-gray-300 px-4 py-3 text-center text-sm">
                                  <span
                                    className={`inline-block px-2 py-1 rounded text-xs font-medium ${
                                      charge.room_rent_eligible
                                        ? 'bg-green-100 text-green-800'
                                        : 'bg-red-100 text-red-800'
                                    }`}
                                  >
                                    {charge.room_rent_eligible ? '✓' : '✗'}
                                  </span>
                                </td>
                              </tr>
                            ))
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

        {!tabState.selectedPatientId && !tabState.loading && (
          <div className="bg-white rounded-lg shadow p-8 text-center">
            <p className="text-lg font-medium text-gray-900 mb-2">Welcome to Enhanced Billing</p>
            <p className="text-gray-600">Select a patient to get started</p>
          </div>
        )}
      </div>
    </div>
  );
}
