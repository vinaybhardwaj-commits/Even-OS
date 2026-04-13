'use client';

import { useState, useEffect, useCallback } from 'react';
import { formatINR } from '@/lib/utils/currency';

// ─── Types ───────────────────────────────────────────────
interface User {
  sub: string;
  hospital_id: string;
  role: string;
  email: string;
  name: string;
  department?: string;
}

interface InventoryItem {
  id: string;
  drug_name: string;
  location: string;
  batch_number: string;
  quantity_on_hand: number;
  quantity_reserved: number;
  quantity_available: number;
  mrp: number;
  expiry_date: string;
  status: 'in-stock' | 'low-stock' | 'expired' | 'out-of-stock';
  reorder_level: number;
}

interface VendorRecord {
  id: string;
  vendor_code: string;
  vendor_name: string;
  phone: string;
  gst_number: string;
  drug_license: string;
  license_expiry: string;
  status: 'active' | 'inactive' | 'suspended';
}

interface PurchaseOrder {
  id: string;
  po_number: string;
  vendor_id: string;
  vendor_name: string;
  status: 'draft' | 'submitted' | 'approved' | 'received';
  items_count: number;
  total_amount: number;
  expected_delivery: string;
}

interface DispensingRecord {
  id: string;
  record_number: string;
  patient_id: string;
  patient_name: string;
  drug_name: string;
  quantity: number;
  dosage: string;
  status: 'pending' | 'dispensed' | 'returned';
  dispensed_by: string;
  dispensed_date: string;
}

interface AlertItem {
  id: string;
  drug_name: string;
  location: string;
  type: 'low-stock' | 'expiry' | 'out-of-stock';
  severity: 'critical' | 'warning' | 'info';
  message: string;
  created_date: string;
}

interface NarcoticMovement {
  id: string;
  drug_name: string;
  movement_type: 'receipt' | 'issue' | 'return';
  quantity: number;
  running_balance: number;
  performed_by: string;
  witness: string;
  verified: boolean;
  date: string;
}

// ─── tRPC helpers ────────────────────────────────────────
async function trpcQuery(path: string, input?: any) {
  const wrapped = input !== undefined ? { json: input } : { json: {} };
  const params = `?input=${encodeURIComponent(JSON.stringify(wrapped))}`;
  const res = await fetch(`/api/trpc/${path}${params}`);
  const json = await res.json();
  if (json.error) {
    const msg = json.error?.json?.message || json.error?.message || json.error?.data?.code || 'Request failed';
    throw new Error(msg);
  }
  return json.result?.data?.json;
}

async function trpcMutate(path: string, input?: any) {
  const res = await fetch(`/api/trpc/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ json: input !== undefined ? input : {} }),
  });
  const json = await res.json();
  if (json.error) {
    const msg = json.error?.json?.message || json.error?.message || json.error?.data?.code || 'Mutation failed';
    throw new Error(msg);
  }
  return json.result?.data?.json;
}

// ─── Format helpers ──────────────────────────────────────
function formatDate(d: string | null | undefined): string {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString('en-IN');
  } catch {
    return d;
  }
}

function formatDateTime(d: string | null | undefined): string {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleString('en-IN');
  } catch {
    return d;
  }
}

function formatCurrency(n: number | null | undefined): string {
  if (n === null || n === undefined || isNaN(n)) return formatINR(0);
  return formatINR(Math.round(n));
}

function getStatusBadgeColor(status: string): string {
  const colors: Record<string, string> = {
    'in-stock': '#10b981', // green
    'low-stock': '#f59e0b', // yellow
    'expired': '#ef4444', // red
    'out-of-stock': '#ef4444', // red
    'pending': '#f59e0b', // yellow
    'dispensed': '#10b981', // green
    'returned': '#6b7280', // gray
    'draft': '#6b7280', // gray
    'submitted': '#3b82f6', // blue
    'approved': '#10b981', // green
    'received': '#10b981', // green
    'active': '#10b981', // green
    'inactive': '#6b7280', // gray
    'suspended': '#ef4444', // red
    'critical': '#ef4444', // red
    'warning': '#f59e0b', // yellow
    'info': '#3b82f6', // blue
  };
  return colors[status] || '#6b7280';
}

// ─── Main component ──────────────────────────────────────
export default function PharmacyClient({ user }: { user: User }) {
  const [activeTab, setActiveTab] = useState(0);
  const [loading, setLoading] = useState(true);

  // ─── AI Pharmacy Intelligence ────────────────────────
  const [aiPharmacyAlerts, setAiPharmacyAlerts] = useState<any>(null);
  const [aiPharmacyLoading, setAiPharmacyLoading] = useState(false);
  const [aiPharmacyError, setAiPharmacyError] = useState('');

  // ─── Tab 1: Inventory ─────────────────────────────────
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [locationFilter, setLocationFilter] = useState('');
  const [searchDrug, setSearchDrug] = useState('');
  const [inventoryStats, setInventoryStats] = useState({
    totalItems: 0,
    lowStockAlerts: 0,
    expiringItems: 0,
    totalStockValue: 0,
  });

  // ─── Tab 2: Dispensing ──────────────────────────────
  const [dispensingRecords, setDispensingRecords] = useState<DispensingRecord[]>([]);
  const [pendingDispensing, setPendingDispensing] = useState<DispensingRecord[]>([]);
  const [dispensingLoading, setDispensingLoading] = useState(false);

  // ─── Tab 3: Narcotics ──────────────────────────────
  const [narcoticsLoading, setNarcoticsLoading] = useState(false);
  const [narcoticsMovements, setNarcoticsMovements] = useState<NarcoticMovement[]>([]);
  const [selectedNarcotic, setSelectedNarcotic] = useState('');
  const [narcoticsStats, setNarcoticsStats] = useState({
    totalTracked: 0,
    unverifiedEntries: 0,
    todaysMovements: 0,
  });
  const [showNarcoticForm, setShowNarcoticForm] = useState(false);
  const [narcoticFormData, setNarcoticFormData] = useState({
    drug: '',
    type: 'receipt' as 'receipt' | 'issue' | 'return',
    quantity: 0,
    witness: '',
    source: '',
  });

  // ─── Tab 4: Purchase Orders ────────────────────────
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [poLoading, setPoLoading] = useState(false);
  const [showNewPO, setShowNewPO] = useState(false);
  const [poFormData, setPoFormData] = useState({
    vendor: '',
    items: [] as Array<{ drug: string; qty: number; unitCost: number }>,
  });

  // ─── Tab 5: Vendors ───────────────────────────────
  const [vendors, setVendors] = useState<VendorRecord[]>([]);
  const [vendorLoading, setVendorLoading] = useState(false);
  const [showNewVendor, setShowNewVendor] = useState(false);
  const [vendorFormData, setVendorFormData] = useState({
    code: '',
    name: '',
    phone: '',
    gst: '',
    license: '',
    licenseExpiry: '',
  });

  // ─── Tab 6: Alerts ────────────────────────────────
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [alertsLoading, setAlertsLoading] = useState(false);
  const [alertStats, setAlertStats] = useState({
    dispensingVolume: 0,
    topDrugs: [] as Array<{ name: string; count: number }>,
    stockValue: 0,
  });

  // ─── Inventory fetches ─────────────────────────────
  const fetchInventory = useCallback(async () => {
    setInventoryLoading(true);
    try {
      const data = await trpcQuery('pharmacy.listInventory', {
        location: locationFilter || undefined,
        search: searchDrug || undefined,
      });
      setInventory(data.items || []);
      setInventoryStats(data.stats || {});
    } catch (err) {
      console.error('Failed to fetch inventory:', err);
    } finally {
      setInventoryLoading(false);
    }
  }, [locationFilter, searchDrug]);

  useEffect(() => {
    if (activeTab === 0) {
      fetchInventory();
    }
  }, [activeTab, fetchInventory]);

  // ─── Dispensing fetches ────────────────────────────
  const fetchDispensing = useCallback(async () => {
    setDispensingLoading(true);
    try {
      const [pending, records] = await Promise.all([
        trpcQuery('pharmacy.pendingDispensing'),
        trpcQuery('pharmacy.listDispensingRecords', { pageSize: 50 }),
      ]);
      setPendingDispensing(pending || []);
      setDispensingRecords(records?.items || []);
    } catch (err) {
      console.error('Failed to fetch dispensing:', err);
    } finally {
      setDispensingLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 1) {
      fetchDispensing();
    }
  }, [activeTab, fetchDispensing]);

  // ─── Narcotics fetches ────────────────────────────
  const fetchNarcotics = useCallback(async () => {
    setNarcoticsLoading(true);
    try {
      if (selectedNarcotic) {
        const data = await trpcQuery('pharmacy.narcoticsAudit', {
          drug_id: selectedNarcotic,
        });
        setNarcoticsMovements(data.movements || []);
      }
      const stats = await trpcQuery('pharmacy.narcoticsReport');
      setNarcoticsStats(stats || {});
    } catch (err) {
      console.error('Failed to fetch narcotics:', err);
    } finally {
      setNarcoticsLoading(false);
    }
  }, [selectedNarcotic]);

  useEffect(() => {
    if (activeTab === 2) {
      fetchNarcotics();
    }
  }, [activeTab, fetchNarcotics]);

  // ─── Purchase Orders fetches ──────────────────────
  const fetchPOs = useCallback(async () => {
    setPoLoading(true);
    try {
      const data = await trpcQuery('pharmacy.listPurchaseOrders', { pageSize: 50 });
      setPurchaseOrders(data?.items || []);
    } catch (err) {
      console.error('Failed to fetch POs:', err);
    } finally {
      setPoLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 3) {
      fetchPOs();
    }
  }, [activeTab, fetchPOs]);

  // ─── Vendors fetches ──────────────────────────────
  const fetchVendors = useCallback(async () => {
    setVendorLoading(true);
    try {
      const data = await trpcQuery('pharmacy.listVendors', { pageSize: 100 });
      setVendors(data?.items || []);
    } catch (err) {
      console.error('Failed to fetch vendors:', err);
    } finally {
      setVendorLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 4) {
      fetchVendors();
    }
  }, [activeTab, fetchVendors]);

  // ─── Alerts fetches ──────────────────────────────
  const fetchAlerts = useCallback(async () => {
    setAlertsLoading(true);
    try {
      const [alertData, statsData] = await Promise.all([
        trpcQuery('pharmacy.listAlerts', { pageSize: 100 }),
        trpcQuery('pharmacy.pharmacyStats'),
      ]);
      setAlerts(alertData?.items || []);
      setAlertStats(statsData || {});
    } catch (err) {
      console.error('Failed to fetch alerts:', err);
    } finally {
      setAlertsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 5) {
      fetchAlerts();
    }
  }, [activeTab, fetchAlerts]);

  // ─── Handlers ────────────────────────────────────
  const handleDispense = async (recordId: string) => {
    try {
      await trpcMutate('pharmacy.dispenseMedication', { order_id: recordId });
      fetchDispensing();
    } catch (err) {
      console.error('Dispense failed:', err);
    }
  };

  const handleResolveAlert = async (alertId: string) => {
    try {
      await trpcMutate('pharmacy.resolveAlert', { alert_id: alertId });
      fetchAlerts();
    } catch (err) {
      console.error('Resolve alert failed:', err);
    }
  };

  const handleAddVendor = async () => {
    if (!vendorFormData.name || !vendorFormData.code) return;
    try {
      await trpcMutate('pharmacy.createVendor', {
        code: vendorFormData.code,
        name: vendorFormData.name,
        phone: vendorFormData.phone || null,
        gst_number: vendorFormData.gst || null,
        drug_license: vendorFormData.license || null,
        license_expiry: vendorFormData.licenseExpiry || null,
      });
      setVendorFormData({ code: '', name: '', phone: '', gst: '', license: '', licenseExpiry: '' });
      setShowNewVendor(false);
      fetchVendors();
    } catch (err) {
      console.error('Add vendor failed:', err);
    }
  };

  const handleRecordNarcotic = async () => {
    if (!narcoticFormData.drug || !narcoticFormData.witness) return;
    try {
      await trpcMutate('pharmacy.recordNarcoticMovement', {
        drug_id: narcoticFormData.drug,
        movement_type: narcoticFormData.type,
        quantity: narcoticFormData.quantity,
        witness_name: narcoticFormData.witness,
        source_or_destination: narcoticFormData.source || null,
      });
      setNarcoticFormData({
        drug: '',
        type: 'receipt',
        quantity: 0,
        witness: '',
        source: '',
      });
      setShowNarcoticForm(false);
      fetchNarcotics();
    } catch (err) {
      console.error('Record narcotic failed:', err);
    }
  };

  // ─── Render ──────────────────────────────────────
  return (
    <div style={{ padding: '20px', fontFamily: 'system-ui, sans-serif', backgroundColor: '#f9fafb' }}>
      <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
        {/* Header */}
        <div style={{ marginBottom: '30px' }}>
          <h1 style={{ fontSize: '28px', fontWeight: '700', margin: '0 0 8px 0' }}>
            Pharmacy Management
          </h1>
          <p style={{ margin: '0', color: '#6b7280', fontSize: '14px' }}>
            Inventory, dispensing, narcotics, purchase orders, vendors &amp; alerts
          </p>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '24px', borderBottom: '1px solid #e5e7eb' }}>
          {[
            'Inventory',
            'Dispensing',
            'Narcotics',
            'Purchase Orders',
            'Vendors',
            'Alerts &amp; Analytics',
            '🤖 AI Pharmacy',
          ].map((tab, i) => (
            <button
              key={i}
              onClick={() => setActiveTab(i)}
              style={{
                padding: '12px 16px',
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: activeTab === i ? '600' : '500',
                borderBottom: activeTab === i ? '2px solid #3b82f6' : 'transparent',
                color: activeTab === i ? '#1f2937' : '#6b7280',
                marginBottom: '-1px',
              }}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Tab 0: Inventory */}
        {activeTab === 0 && (
          <div>
            {/* Stat cards */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: '16px',
                marginBottom: '24px',
              }}
            >
              <div
                style={{
                  padding: '16px',
                  background: '#fff',
                  border: '1px solid #e5e7eb',
                  borderRadius: '8px',
                }}
              >
                <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '8px' }}>
                  Total Items
                </div>
                <div style={{ fontSize: '24px', fontWeight: '700' }}>
                  {inventoryStats.totalItems || 0}
                </div>
              </div>
              <div
                style={{
                  padding: '16px',
                  background: '#fff',
                  border: '1px solid #e5e7eb',
                  borderRadius: '8px',
                }}
              >
                <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '8px' }}>
                  Low Stock Alerts
                </div>
                <div style={{ fontSize: '24px', fontWeight: '700', color: '#f59e0b' }}>
                  {inventoryStats.lowStockAlerts || 0}
                </div>
              </div>
              <div
                style={{
                  padding: '16px',
                  background: '#fff',
                  border: '1px solid #e5e7eb',
                  borderRadius: '8px',
                }}
              >
                <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '8px' }}>
                  Expiring Soon
                </div>
                <div style={{ fontSize: '24px', fontWeight: '700', color: '#ef4444' }}>
                  {inventoryStats.expiringItems || 0}
                </div>
              </div>
              <div
                style={{
                  padding: '16px',
                  background: '#fff',
                  border: '1px solid #e5e7eb',
                  borderRadius: '8px',
                }}
              >
                <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '8px' }}>
                  Total Stock Value
                </div>
                <div style={{ fontSize: '20px', fontWeight: '700' }}>
                  {formatCurrency(inventoryStats.totalStockValue)}
                </div>
              </div>
            </div>

            {/* Filters */}
            <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
              <input
                type="text"
                placeholder="Search drug name..."
                value={searchDrug}
                onChange={(e) => setSearchDrug(e.target.value)}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  border: '1px solid #d1d5db',
                  borderRadius: '6px',
                  fontSize: '14px',
                }}
              />
              <select
                value={locationFilter}
                onChange={(e) => setLocationFilter(e.target.value)}
                style={{
                  padding: '8px 12px',
                  border: '1px solid #d1d5db',
                  borderRadius: '6px',
                  fontSize: '14px',
                }}
              >
                <option value="">All Locations</option>
                <option value="main-store">Main Store</option>
                <option value="ward-a">Ward A</option>
                <option value="ward-b">Ward B</option>
                <option value="icu">ICU</option>
                <option value="od">OD</option>
              </select>
            </div>

            {/* Inventory table */}
            <div
              style={{
                background: '#fff',
                border: '1px solid #e5e7eb',
                borderRadius: '8px',
                overflow: 'hidden',
              }}
            >
              {inventoryLoading ? (
                <div style={{ padding: '24px', textAlign: 'center', color: '#6b7280' }}>
                  Loading inventory...
                </div>
              ) : inventory.length === 0 ? (
                <div style={{ padding: '24px', textAlign: 'center', color: '#6b7280' }}>
                  No inventory items found
                </div>
              ) : (
                <table
                  style={{
                    width: '100%',
                    borderCollapse: 'collapse',
                    fontSize: '14px',
                  }}
                >
                  <thead>
                    <tr style={{ backgroundColor: '#f3f4f6', borderBottom: '1px solid #e5e7eb' }}>
                      <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600' }}>
                        Drug Name
                      </th>
                      <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600' }}>
                        Location
                      </th>
                      <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600' }}>
                        Batch
                      </th>
                      <th style={{ padding: '12px', textAlign: 'center', fontWeight: '600' }}>
                        On Hand
                      </th>
                      <th style={{ padding: '12px', textAlign: 'center', fontWeight: '600' }}>
                        Reserved
                      </th>
                      <th style={{ padding: '12px', textAlign: 'center', fontWeight: '600' }}>
                        Available
                      </th>
                      <th style={{ padding: '12px', textAlign: 'right', fontWeight: '600' }}>MRP</th>
                      <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600' }}>
                        Expiry
                      </th>
                      <th style={{ padding: '12px', textAlign: 'center', fontWeight: '600' }}>
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {inventory.map((item) => (
                      <tr
                        key={item.id}
                        style={{ borderBottom: '1px solid #e5e7eb' }}
                      >
                        <td style={{ padding: '12px' }}>{item.drug_name}</td>
                        <td style={{ padding: '12px' }}>{item.location}</td>
                        <td style={{ padding: '12px', fontSize: '12px', color: '#6b7280' }}>
                          {item.batch_number}
                        </td>
                        <td style={{ padding: '12px', textAlign: 'center' }}>
                          {item.quantity_on_hand}
                        </td>
                        <td style={{ padding: '12px', textAlign: 'center' }}>
                          {item.quantity_reserved}
                        </td>
                        <td
                          style={{
                            padding: '12px',
                            textAlign: 'center',
                            fontWeight: '600',
                            color:
                              item.quantity_available < item.reorder_level
                                ? '#ef4444'
                                : '#10b981',
                          }}
                        >
                          {item.quantity_available}
                        </td>
                        <td style={{ padding: '12px', textAlign: 'right' }}>
                          {formatCurrency(item.mrp)}
                        </td>
                        <td
                          style={{
                            padding: '12px',
                            color:
                              new Date(item.expiry_date) < new Date()
                                ? '#ef4444'
                                : new Date(item.expiry_date) <
                                    new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
                                  ? '#f59e0b'
                                  : '#6b7280',
                          }}
                        >
                          {formatDate(item.expiry_date)}
                        </td>
                        <td style={{ padding: '12px', textAlign: 'center' }}>
                          <div
                            style={{
                              display: 'inline-block',
                              padding: '4px 8px',
                              backgroundColor: getStatusBadgeColor(item.status),
                              color: '#fff',
                              borderRadius: '4px',
                              fontSize: '12px',
                              fontWeight: '600',
                            }}
                          >
                            {item.status.replace('-', ' ')}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {/* Tab 1: Dispensing */}
        {activeTab === 1 && (
          <div>
            <div style={{ marginBottom: '24px' }}>
              <h2 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '16px' }}>
                Pending Dispensing
              </h2>
              {dispensingLoading ? (
                <div style={{ color: '#6b7280' }}>Loading...</div>
              ) : pendingDispensing.length === 0 ? (
                <div style={{ color: '#6b7280' }}>No pending orders</div>
              ) : (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                    gap: '16px',
                  }}
                >
                  {pendingDispensing.map((order) => (
                    <div
                      key={order.id}
                      style={{
                        padding: '16px',
                        background: '#fff',
                        border: '1px solid #e5e7eb',
                        borderRadius: '8px',
                      }}
                    >
                      <div style={{ marginBottom: '12px' }}>
                        <div style={{ fontSize: '12px', color: '#6b7280' }}>Patient</div>
                        <div style={{ fontSize: '14px', fontWeight: '600' }}>
                          {order.patient_name}
                        </div>
                      </div>
                      <div style={{ marginBottom: '12px' }}>
                        <div style={{ fontSize: '12px', color: '#6b7280' }}>Drug</div>
                        <div style={{ fontSize: '14px', fontWeight: '600' }}>
                          {order.drug_name}
                        </div>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                        <div>
                          <div style={{ fontSize: '12px', color: '#6b7280' }}>Qty</div>
                          <div style={{ fontSize: '14px', fontWeight: '600' }}>
                            {order.quantity}
                          </div>
                        </div>
                        <div>
                          <div style={{ fontSize: '12px', color: '#6b7280' }}>Dosage</div>
                          <div style={{ fontSize: '14px', fontWeight: '600' }}>
                            {order.dosage}
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={() => handleDispense(order.id)}
                        style={{
                          width: '100%',
                          padding: '8px',
                          background: '#10b981',
                          color: '#fff',
                          border: 'none',
                          borderRadius: '6px',
                          cursor: 'pointer',
                          fontSize: '14px',
                          fontWeight: '600',
                        }}
                      >
                        Dispense
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <h2 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '16px' }}>
              Recent Dispensing
            </h2>
            <div
              style={{
                background: '#fff',
                border: '1px solid #e5e7eb',
                borderRadius: '8px',
                overflow: 'hidden',
              }}
            >
              {dispensingLoading ? (
                <div style={{ padding: '24px', color: '#6b7280' }}>Loading...</div>
              ) : dispensingRecords.length === 0 ? (
                <div style={{ padding: '24px', color: '#6b7280' }}>No records</div>
              ) : (
                <table
                  style={{
                    width: '100%',
                    borderCollapse: 'collapse',
                    fontSize: '14px',
                  }}
                >
                  <thead>
                    <tr style={{ backgroundColor: '#f3f4f6', borderBottom: '1px solid #e5e7eb' }}>
                      <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600' }}>
                        Record #
                      </th>
                      <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600' }}>
                        Patient
                      </th>
                      <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600' }}>
                        Drug
                      </th>
                      <th style={{ padding: '12px', textAlign: 'center', fontWeight: '600' }}>
                        Qty
                      </th>
                      <th style={{ padding: '12px', textAlign: 'center', fontWeight: '600' }}>
                        Status
                      </th>
                      <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600' }}>
                        Dispensed By
                      </th>
                      <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600' }}>
                        Date
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {dispensingRecords.map((rec) => (
                      <tr
                        key={rec.id}
                        style={{ borderBottom: '1px solid #e5e7eb' }}
                      >
                        <td style={{ padding: '12px', fontSize: '12px', color: '#6b7280' }}>
                          {rec.record_number}
                        </td>
                        <td style={{ padding: '12px' }}>{rec.patient_name}</td>
                        <td style={{ padding: '12px' }}>{rec.drug_name}</td>
                        <td style={{ padding: '12px', textAlign: 'center' }}>
                          {rec.quantity}
                        </td>
                        <td style={{ padding: '12px', textAlign: 'center' }}>
                          <div
                            style={{
                              display: 'inline-block',
                              padding: '4px 8px',
                              backgroundColor: getStatusBadgeColor(rec.status),
                              color: '#fff',
                              borderRadius: '4px',
                              fontSize: '12px',
                              fontWeight: '600',
                            }}
                          >
                            {rec.status}
                          </div>
                        </td>
                        <td style={{ padding: '12px' }}>{rec.dispensed_by}</td>
                        <td style={{ padding: '12px', color: '#6b7280' }}>
                          {formatDate(rec.dispensed_date)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {/* Tab 2: Narcotics */}
        {activeTab === 2 && (
          <div>
            {/* Stat cards */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: '16px',
                marginBottom: '24px',
              }}
            >
              <div
                style={{
                  padding: '16px',
                  background: '#fff',
                  border: '1px solid #e5e7eb',
                  borderRadius: '8px',
                }}
              >
                <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '8px' }}>
                  Total Narcotics Tracked
                </div>
                <div style={{ fontSize: '24px', fontWeight: '700' }}>
                  {narcoticsStats.totalTracked || 0}
                </div>
              </div>
              <div
                style={{
                  padding: '16px',
                  background: '#fff',
                  border: '1px solid #e5e7eb',
                  borderRadius: '8px',
                }}
              >
                <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '8px' }}>
                  Unverified Entries
                </div>
                <div style={{ fontSize: '24px', fontWeight: '700', color: '#ef4444' }}>
                  {narcoticsStats.unverifiedEntries || 0}
                </div>
              </div>
              <div
                style={{
                  padding: '16px',
                  background: '#fff',
                  border: '1px solid #e5e7eb',
                  borderRadius: '8px',
                }}
              >
                <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '8px' }}>
                  Today&apos;s Movements
                </div>
                <div style={{ fontSize: '24px', fontWeight: '700', color: '#3b82f6' }}>
                  {narcoticsStats.todaysMovements || 0}
                </div>
              </div>
            </div>

            {/* Drug selector */}
            <div style={{ marginBottom: '24px', display: 'flex', gap: '12px' }}>
              <select
                value={selectedNarcotic}
                onChange={(e) => setSelectedNarcotic(e.target.value)}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  border: '1px solid #d1d5db',
                  borderRadius: '6px',
                  fontSize: '14px',
                }}
              >
                <option value="">Select Narcotic Drug...</option>
                <option value="morphine">Morphine</option>
                <option value="pethidine">Pethidine</option>
                <option value="tramadol">Tramadol</option>
              </select>
              <button
                onClick={() => setShowNarcoticForm(!showNarcoticForm)}
                style={{
                  padding: '8px 16px',
                  background: '#3b82f6',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '14px',
                  fontWeight: '600',
                }}
              >
                Record Movement
              </button>
            </div>

            {/* Record movement form */}
            {showNarcoticForm && (
              <div
                style={{
                  padding: '16px',
                  background: '#eff6ff',
                  border: '1px solid #bfdbfe',
                  borderRadius: '8px',
                  marginBottom: '24px',
                }}
              >
                <h3 style={{ margin: '0 0 12px 0', fontSize: '14px', fontWeight: '600' }}>
                  Record Narcotic Movement
                </h3>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                    gap: '12px',
                  }}
                >
                  <div>
                    <label style={{ display: 'block', fontSize: '12px', marginBottom: '4px' }}>
                      Drug
                    </label>
                    <select
                      value={narcoticFormData.drug}
                      onChange={(e) =>
                        setNarcoticFormData({ ...narcoticFormData, drug: e.target.value })
                      }
                      style={{
                        width: '100%',
                        padding: '6px',
                        border: '1px solid #d1d5db',
                        borderRadius: '4px',
                        fontSize: '13px',
                      }}
                    >
                      <option value="">Select</option>
                      <option value="morphine">Morphine</option>
                      <option value="pethidine">Pethidine</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '12px', marginBottom: '4px' }}>
                      Type
                    </label>
                    <select
                      value={narcoticFormData.type}
                      onChange={(e) =>
                        setNarcoticFormData({
                          ...narcoticFormData,
                          type: e.target.value as 'receipt' | 'issue' | 'return',
                        })
                      }
                      style={{
                        width: '100%',
                        padding: '6px',
                        border: '1px solid #d1d5db',
                        borderRadius: '4px',
                        fontSize: '13px',
                      }}
                    >
                      <option value="receipt">Receipt</option>
                      <option value="issue">Issue</option>
                      <option value="return">Return</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '12px', marginBottom: '4px' }}>
                      Quantity
                    </label>
                    <input
                      type="number"
                      value={narcoticFormData.quantity}
                      onChange={(e) =>
                        setNarcoticFormData({
                          ...narcoticFormData,
                          quantity: parseInt(e.target.value) || 0,
                        })
                      }
                      style={{
                        width: '100%',
                        padding: '6px',
                        border: '1px solid #d1d5db',
                        borderRadius: '4px',
                        fontSize: '13px',
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '12px', marginBottom: '4px' }}>
                      Witness
                    </label>
                    <input
                      type="text"
                      value={narcoticFormData.witness}
                      onChange={(e) =>
                        setNarcoticFormData({ ...narcoticFormData, witness: e.target.value })
                      }
                      style={{
                        width: '100%',
                        padding: '6px',
                        border: '1px solid #d1d5db',
                        borderRadius: '4px',
                        fontSize: '13px',
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '12px', marginBottom: '4px' }}>
                      Source/Destination
                    </label>
                    <input
                      type="text"
                      value={narcoticFormData.source}
                      onChange={(e) =>
                        setNarcoticFormData({ ...narcoticFormData, source: e.target.value })
                      }
                      style={{
                        width: '100%',
                        padding: '6px',
                        border: '1px solid #d1d5db',
                        borderRadius: '4px',
                        fontSize: '13px',
                      }}
                    />
                  </div>
                </div>
                <div style={{ marginTop: '12px', display: 'flex', gap: '8px' }}>
                  <button
                    onClick={handleRecordNarcotic}
                    style={{
                      padding: '6px 12px',
                      background: '#10b981',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '13px',
                    }}
                  >
                    Save
                  </button>
                  <button
                    onClick={() => setShowNarcoticForm(false)}
                    style={{
                      padding: '6px 12px',
                      background: '#d1d5db',
                      color: '#374151',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '13px',
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Movements table */}
            <h3 style={{ fontSize: '14px', fontWeight: '600', marginBottom: '12px' }}>
              {selectedNarcotic ? `${selectedNarcotic} Movement History` : 'Select a drug to view history'}
            </h3>
            <div
              style={{
                background: '#fff',
                border: '1px solid #e5e7eb',
                borderRadius: '8px',
                overflow: 'hidden',
              }}
            >
              {narcoticsLoading ? (
                <div style={{ padding: '24px', color: '#6b7280' }}>Loading...</div>
              ) : narcoticsMovements.length === 0 ? (
                <div style={{ padding: '24px', color: '#6b7280' }}>No movements recorded</div>
              ) : (
                <table
                  style={{
                    width: '100%',
                    borderCollapse: 'collapse',
                    fontSize: '14px',
                  }}
                >
                  <thead>
                    <tr style={{ backgroundColor: '#f3f4f6', borderBottom: '1px solid #e5e7eb' }}>
                      <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600' }}>
                        Date
                      </th>
                      <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600' }}>
                        Type
                      </th>
                      <th style={{ padding: '12px', textAlign: 'center', fontWeight: '600' }}>
                        Qty
                      </th>
                      <th style={{ padding: '12px', textAlign: 'center', fontWeight: '600' }}>
                        Balance
                      </th>
                      <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600' }}>
                        Performed By
                      </th>
                      <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600' }}>
                        Witness
                      </th>
                      <th style={{ padding: '12px', textAlign: 'center', fontWeight: '600' }}>
                        Verified
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {narcoticsMovements.map((mov) => (
                      <tr
                        key={mov.id}
                        style={{ borderBottom: '1px solid #e5e7eb' }}
                      >
                        <td style={{ padding: '12px' }}>{formatDate(mov.date)}</td>
                        <td
                          style={{
                            padding: '12px',
                            color: getStatusBadgeColor(mov.movement_type),
                            fontWeight: '600',
                          }}
                        >
                          {mov.movement_type}
                        </td>
                        <td style={{ padding: '12px', textAlign: 'center' }}>
                          {mov.quantity}
                        </td>
                        <td
                          style={{ padding: '12px', textAlign: 'center', fontWeight: '600' }}
                        >
                          {mov.running_balance}
                        </td>
                        <td style={{ padding: '12px' }}>{mov.performed_by}</td>
                        <td style={{ padding: '12px' }}>{mov.witness}</td>
                        <td style={{ padding: '12px', textAlign: 'center' }}>
                          {mov.verified ? (
                            <span style={{ color: '#10b981', fontWeight: '600' }}>✓</span>
                          ) : (
                            <span style={{ color: '#ef4444', fontWeight: '600' }}>✗</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {/* Tab 3: Purchase Orders */}
        {activeTab === 3 && (
          <div>
            <div style={{ marginBottom: '16px' }}>
              <button
                onClick={() => setShowNewPO(!showNewPO)}
                style={{
                  padding: '8px 16px',
                  background: '#3b82f6',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '14px',
                  fontWeight: '600',
                }}
              >
                New Purchase Order
              </button>
            </div>

            {showNewPO && (
              <div
                style={{
                  padding: '16px',
                  background: '#eff6ff',
                  border: '1px solid #bfdbfe',
                  borderRadius: '8px',
                  marginBottom: '24px',
                }}
              >
                <h3 style={{ margin: '0 0 12px 0', fontSize: '14px', fontWeight: '600' }}>
                  Create New PO
                </h3>
                <div style={{ marginBottom: '12px' }}>
                  <label style={{ display: 'block', fontSize: '12px', marginBottom: '4px' }}>
                    Vendor
                  </label>
                  <select
                    value={poFormData.vendor}
                    onChange={(e) =>
                      setPoFormData({ ...poFormData, vendor: e.target.value })
                    }
                    style={{
                      width: '100%',
                      padding: '8px',
                      border: '1px solid #d1d5db',
                      borderRadius: '4px',
                    }}
                  >
                    <option value="">Select Vendor</option>
                    {vendors.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.vendor_name}
                      </option>
                    ))}
                  </select>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    onClick={() => setShowNewPO(false)}
                    style={{
                      padding: '6px 12px',
                      background: '#d1d5db',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    style={{
                      padding: '6px 12px',
                      background: '#10b981',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                    }}
                  >
                    Create
                  </button>
                </div>
              </div>
            )}

            {/* PO list */}
            <div
              style={{
                background: '#fff',
                border: '1px solid #e5e7eb',
                borderRadius: '8px',
                overflow: 'hidden',
              }}
            >
              {poLoading ? (
                <div style={{ padding: '24px', color: '#6b7280' }}>Loading...</div>
              ) : purchaseOrders.length === 0 ? (
                <div style={{ padding: '24px', color: '#6b7280' }}>No purchase orders</div>
              ) : (
                <table
                  style={{
                    width: '100%',
                    borderCollapse: 'collapse',
                    fontSize: '14px',
                  }}
                >
                  <thead>
                    <tr style={{ backgroundColor: '#f3f4f6', borderBottom: '1px solid #e5e7eb' }}>
                      <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600' }}>
                        PO #
                      </th>
                      <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600' }}>
                        Vendor
                      </th>
                      <th style={{ padding: '12px', textAlign: 'center', fontWeight: '600' }}>
                        Status
                      </th>
                      <th style={{ padding: '12px', textAlign: 'center', fontWeight: '600' }}>
                        Items
                      </th>
                      <th style={{ padding: '12px', textAlign: 'right', fontWeight: '600' }}>
                        Total
                      </th>
                      <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600' }}>
                        Expected Delivery
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {purchaseOrders.map((po) => (
                      <tr
                        key={po.id}
                        style={{ borderBottom: '1px solid #e5e7eb' }}
                      >
                        <td style={{ padding: '12px', fontSize: '12px', color: '#6b7280' }}>
                          {po.po_number}
                        </td>
                        <td style={{ padding: '12px' }}>{po.vendor_name}</td>
                        <td style={{ padding: '12px', textAlign: 'center' }}>
                          <div
                            style={{
                              display: 'inline-block',
                              padding: '4px 8px',
                              backgroundColor: getStatusBadgeColor(po.status),
                              color: '#fff',
                              borderRadius: '4px',
                              fontSize: '12px',
                              fontWeight: '600',
                            }}
                          >
                            {po.status}
                          </div>
                        </td>
                        <td style={{ padding: '12px', textAlign: 'center' }}>
                          {po.items_count}
                        </td>
                        <td style={{ padding: '12px', textAlign: 'right' }}>
                          {formatCurrency(po.total_amount)}
                        </td>
                        <td style={{ padding: '12px', color: '#6b7280' }}>
                          {formatDate(po.expected_delivery)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {/* Tab 4: Vendors */}
        {activeTab === 4 && (
          <div>
            <div style={{ marginBottom: '16px' }}>
              <button
                onClick={() => setShowNewVendor(!showNewVendor)}
                style={{
                  padding: '8px 16px',
                  background: '#3b82f6',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '14px',
                  fontWeight: '600',
                }}
              >
                Add Vendor
              </button>
            </div>

            {showNewVendor && (
              <div
                style={{
                  padding: '16px',
                  background: '#eff6ff',
                  border: '1px solid #bfdbfe',
                  borderRadius: '8px',
                  marginBottom: '24px',
                }}
              >
                <h3 style={{ margin: '0 0 12px 0', fontSize: '14px', fontWeight: '600' }}>
                  Add New Vendor
                </h3>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                    gap: '12px',
                    marginBottom: '12px',
                  }}
                >
                  <input
                    type="text"
                    placeholder="Vendor Code"
                    value={vendorFormData.code}
                    onChange={(e) =>
                      setVendorFormData({ ...vendorFormData, code: e.target.value })
                    }
                    style={{
                      padding: '8px',
                      border: '1px solid #d1d5db',
                      borderRadius: '4px',
                    }}
                  />
                  <input
                    type="text"
                    placeholder="Vendor Name"
                    value={vendorFormData.name}
                    onChange={(e) =>
                      setVendorFormData({ ...vendorFormData, name: e.target.value })
                    }
                    style={{
                      padding: '8px',
                      border: '1px solid #d1d5db',
                      borderRadius: '4px',
                    }}
                  />
                  <input
                    type="text"
                    placeholder="Phone"
                    value={vendorFormData.phone}
                    onChange={(e) =>
                      setVendorFormData({ ...vendorFormData, phone: e.target.value })
                    }
                    style={{
                      padding: '8px',
                      border: '1px solid #d1d5db',
                      borderRadius: '4px',
                    }}
                  />
                  <input
                    type="text"
                    placeholder="GST Number"
                    value={vendorFormData.gst}
                    onChange={(e) =>
                      setVendorFormData({ ...vendorFormData, gst: e.target.value })
                    }
                    style={{
                      padding: '8px',
                      border: '1px solid #d1d5db',
                      borderRadius: '4px',
                    }}
                  />
                  <input
                    type="text"
                    placeholder="Drug License"
                    value={vendorFormData.license}
                    onChange={(e) =>
                      setVendorFormData({ ...vendorFormData, license: e.target.value })
                    }
                    style={{
                      padding: '8px',
                      border: '1px solid #d1d5db',
                      borderRadius: '4px',
                    }}
                  />
                  <input
                    type="date"
                    placeholder="License Expiry"
                    value={vendorFormData.licenseExpiry}
                    onChange={(e) =>
                      setVendorFormData({ ...vendorFormData, licenseExpiry: e.target.value })
                    }
                    style={{
                      padding: '8px',
                      border: '1px solid #d1d5db',
                      borderRadius: '4px',
                    }}
                  />
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    onClick={handleAddVendor}
                    style={{
                      padding: '6px 12px',
                      background: '#10b981',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '13px',
                    }}
                  >
                    Save
                  </button>
                  <button
                    onClick={() => setShowNewVendor(false)}
                    style={{
                      padding: '6px 12px',
                      background: '#d1d5db',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '13px',
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Vendor table */}
            <div
              style={{
                background: '#fff',
                border: '1px solid #e5e7eb',
                borderRadius: '8px',
                overflow: 'hidden',
              }}
            >
              {vendorLoading ? (
                <div style={{ padding: '24px', color: '#6b7280' }}>Loading...</div>
              ) : vendors.length === 0 ? (
                <div style={{ padding: '24px', color: '#6b7280' }}>No vendors</div>
              ) : (
                <table
                  style={{
                    width: '100%',
                    borderCollapse: 'collapse',
                    fontSize: '14px',
                  }}
                >
                  <thead>
                    <tr style={{ backgroundColor: '#f3f4f6', borderBottom: '1px solid #e5e7eb' }}>
                      <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600' }}>
                        Code
                      </th>
                      <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600' }}>
                        Name
                      </th>
                      <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600' }}>
                        Phone
                      </th>
                      <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600' }}>
                        GST
                      </th>
                      <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600' }}>
                        License
                      </th>
                      <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600' }}>
                        License Expiry
                      </th>
                      <th style={{ padding: '12px', textAlign: 'center', fontWeight: '600' }}>
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {vendors.map((vendor) => (
                      <tr
                        key={vendor.id}
                        style={{ borderBottom: '1px solid #e5e7eb' }}
                      >
                        <td style={{ padding: '12px', fontSize: '12px', color: '#6b7280' }}>
                          {vendor.vendor_code}
                        </td>
                        <td style={{ padding: '12px' }}>{vendor.vendor_name}</td>
                        <td style={{ padding: '12px' }}>{vendor.phone}</td>
                        <td style={{ padding: '12px', fontSize: '12px', color: '#6b7280' }}>
                          {vendor.gst_number}
                        </td>
                        <td style={{ padding: '12px', fontSize: '12px', color: '#6b7280' }}>
                          {vendor.drug_license}
                        </td>
                        <td
                          style={{
                            padding: '12px',
                            color:
                              new Date(vendor.license_expiry) < new Date()
                                ? '#ef4444'
                                : new Date(vendor.license_expiry) <
                                    new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
                                  ? '#f59e0b'
                                  : '#6b7280',
                          }}
                        >
                          {formatDate(vendor.license_expiry)}
                        </td>
                        <td style={{ padding: '12px', textAlign: 'center' }}>
                          <div
                            style={{
                              display: 'inline-block',
                              padding: '4px 8px',
                              backgroundColor: getStatusBadgeColor(vendor.status),
                              color: '#fff',
                              borderRadius: '4px',
                              fontSize: '12px',
                              fontWeight: '600',
                            }}
                          >
                            {vendor.status}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {/* Tab 5: Alerts & Analytics */}
        {activeTab === 5 && (
          <div>
            {/* Stats */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: '16px',
                marginBottom: '24px',
              }}
            >
              <div
                style={{
                  padding: '16px',
                  background: '#fff',
                  border: '1px solid #e5e7eb',
                  borderRadius: '8px',
                }}
              >
                <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '8px' }}>
                  Total Dispensing Volume
                </div>
                <div style={{ fontSize: '24px', fontWeight: '700' }}>
                  {alertStats.dispensingVolume || 0}
                </div>
              </div>
              <div
                style={{
                  padding: '16px',
                  background: '#fff',
                  border: '1px solid #e5e7eb',
                  borderRadius: '8px',
                }}
              >
                <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '8px' }}>
                  Total Stock Value
                </div>
                <div style={{ fontSize: '20px', fontWeight: '700' }}>
                  {formatCurrency(alertStats.stockValue)}
                </div>
              </div>
            </div>

            {/* Alerts table */}
            <h3 style={{ fontSize: '14px', fontWeight: '600', marginBottom: '12px' }}>
              Active Alerts
            </h3>
            <div
              style={{
                background: '#fff',
                border: '1px solid #e5e7eb',
                borderRadius: '8px',
                overflow: 'hidden',
                marginBottom: '24px',
              }}
            >
              {alertsLoading ? (
                <div style={{ padding: '24px', color: '#6b7280' }}>Loading...</div>
              ) : alerts.length === 0 ? (
                <div style={{ padding: '24px', color: '#6b7280' }}>No active alerts</div>
              ) : (
                <table
                  style={{
                    width: '100%',
                    borderCollapse: 'collapse',
                    fontSize: '14px',
                  }}
                >
                  <thead>
                    <tr style={{ backgroundColor: '#f3f4f6', borderBottom: '1px solid #e5e7eb' }}>
                      <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600' }}>
                        Drug
                      </th>
                      <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600' }}>
                        Location
                      </th>
                      <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600' }}>
                        Type
                      </th>
                      <th style={{ padding: '12px', textAlign: 'center', fontWeight: '600' }}>
                        Severity
                      </th>
                      <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600' }}>
                        Message
                      </th>
                      <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600' }}>
                        Created
                      </th>
                      <th style={{ padding: '12px', textAlign: 'center', fontWeight: '600' }}>
                        Action
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {alerts.map((alert) => (
                      <tr
                        key={alert.id}
                        style={{ borderBottom: '1px solid #e5e7eb' }}
                      >
                        <td style={{ padding: '12px' }}>{alert.drug_name}</td>
                        <td style={{ padding: '12px' }}>{alert.location}</td>
                        <td style={{ padding: '12px', fontSize: '12px', color: '#6b7280' }}>
                          {alert.type.replace('-', ' ')}
                        </td>
                        <td style={{ padding: '12px', textAlign: 'center' }}>
                          <div
                            style={{
                              display: 'inline-block',
                              padding: '4px 8px',
                              backgroundColor: getStatusBadgeColor(alert.severity),
                              color: '#fff',
                              borderRadius: '4px',
                              fontSize: '12px',
                              fontWeight: '600',
                            }}
                          >
                            {alert.severity}
                          </div>
                        </td>
                        <td style={{ padding: '12px', fontSize: '13px' }}>
                          {alert.message}
                        </td>
                        <td style={{ padding: '12px', color: '#6b7280' }}>
                          {formatDate(alert.created_date)}
                        </td>
                        <td style={{ padding: '12px', textAlign: 'center' }}>
                          <button
                            onClick={() => handleResolveAlert(alert.id)}
                            style={{
                              padding: '4px 8px',
                              background: '#6b7280',
                              color: '#fff',
                              border: 'none',
                              borderRadius: '4px',
                              cursor: 'pointer',
                              fontSize: '12px',
                            }}
                          >
                            Resolve
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Top drugs */}
            <h3 style={{ fontSize: '14px', fontWeight: '600', marginBottom: '12px' }}>
              Top 10 Dispensed Drugs
            </h3>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: '12px',
              }}
            >
              {alertStats.topDrugs && alertStats.topDrugs.length > 0 ? (
                alertStats.topDrugs.map((drug, i) => (
                  <div
                    key={i}
                    style={{
                      padding: '12px',
                      background: '#fff',
                      border: '1px solid #e5e7eb',
                      borderRadius: '6px',
                    }}
                  >
                    <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>
                      {i + 1}. {drug.name}
                    </div>
                    <div style={{ fontSize: '18px', fontWeight: '700', color: '#1f2937' }}>
                      {drug.count} times
                    </div>
                  </div>
                ))
              ) : (
                <div style={{ color: '#6b7280' }}>No data available</div>
              )}
            </div>
          </div>
        )}
        {/* Tab 6: AI Pharmacy Intelligence */}
        {activeTab === 6 && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
              <h2 style={{ margin: 0, fontSize: '18px', fontWeight: '700', color: '#7C3AED' }}>🤖 AI Pharmacy Intelligence</h2>
              <button
                onClick={async () => {
                  setAiPharmacyLoading(true); setAiPharmacyError('');
                  try {
                    const res = await fetch('/api/trpc/evenAI.runPharmacyAlerts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ json: {} }) });
                    const json = await res.json();
                    if (json.error) throw new Error(json.error?.json?.message || json.error?.message || 'Request failed');
                    setAiPharmacyAlerts(json.result?.data?.json);
                  } catch (e: any) { setAiPharmacyError(e.message); }
                  finally { setAiPharmacyLoading(false); }
                }}
                disabled={aiPharmacyLoading}
                style={{ padding: '8px 16px', backgroundColor: '#7C3AED', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: '600', cursor: 'pointer', opacity: aiPharmacyLoading ? 0.5 : 1 }}
              >
                {aiPharmacyLoading ? 'Running Checks...' : 'Run AI Checks'}
              </button>
            </div>

            {aiPharmacyError && (
              <div style={{ padding: '12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', color: '#dc2626', fontSize: '13px', marginBottom: '16px' }}>{aiPharmacyError}</div>
            )}

            {aiPharmacyLoading && <p style={{ color: '#7C3AED', fontSize: '13px' }}>Running pharmacy AI checks...</p>}

            {aiPharmacyAlerts && (
              <div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px', marginBottom: '20px' }}>
                  <div style={{ padding: '16px', background: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: '8px', textAlign: 'center' }}>
                    <div style={{ fontSize: '11px', color: '#6b7280', marginBottom: '4px' }}>Checks Run</div>
                    <div style={{ fontSize: '24px', fontWeight: '700', color: '#7C3AED' }}>{aiPharmacyAlerts.checks_run || 0}</div>
                  </div>
                  <div style={{ padding: '16px', background: aiPharmacyAlerts.total_alerts > 0 ? '#fef2f2' : '#f0fdf4', border: `1px solid ${aiPharmacyAlerts.total_alerts > 0 ? '#fecaca' : '#bbf7d0'}`, borderRadius: '8px', textAlign: 'center' }}>
                    <div style={{ fontSize: '11px', color: '#6b7280', marginBottom: '4px' }}>Total Alerts</div>
                    <div style={{ fontSize: '24px', fontWeight: '700', color: aiPharmacyAlerts.total_alerts > 0 ? '#dc2626' : '#16a34a' }}>{aiPharmacyAlerts.total_alerts || 0}</div>
                  </div>
                  <div style={{ padding: '16px', background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', textAlign: 'center' }}>
                    <div style={{ fontSize: '11px', color: '#6b7280', marginBottom: '4px' }}>Errors</div>
                    <div style={{ fontSize: '24px', fontWeight: '700', color: '#6b7280' }}>{aiPharmacyAlerts.errors?.length || 0}</div>
                  </div>
                </div>

                {aiPharmacyAlerts.alerts && aiPharmacyAlerts.alerts.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {aiPharmacyAlerts.alerts.map((alert: any, idx: number) => (
                      <div key={idx} style={{
                        padding: '12px 16px',
                        background: '#fff',
                        border: `1px solid ${alert.severity === 'critical' ? '#fecaca' : alert.severity === 'high' ? '#fed7aa' : alert.severity === 'medium' ? '#fde68a' : '#e5e7eb'}`,
                        borderRadius: '8px',
                        borderLeft: `4px solid ${alert.severity === 'critical' ? '#dc2626' : alert.severity === 'high' ? '#ea580c' : alert.severity === 'medium' ? '#d97706' : '#6b7280'}`,
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                          <span style={{
                            fontSize: '10px', fontWeight: '700', textTransform: 'uppercase' as const,
                            padding: '2px 6px', borderRadius: '4px',
                            backgroundColor: alert.severity === 'critical' ? '#dc2626' : alert.severity === 'high' ? '#ea580c' : alert.severity === 'medium' ? '#d97706' : '#6b7280',
                            color: '#fff',
                          }}>{alert.severity}</span>
                          <span style={{ fontSize: '13px', fontWeight: '600', color: '#1f2937' }}>{alert.title}</span>
                        </div>
                        <div style={{ fontSize: '12px', color: '#6b7280' }}>{alert.body}</div>
                      </div>
                    ))}
                  </div>
                )}

                {aiPharmacyAlerts.alerts && aiPharmacyAlerts.alerts.length === 0 && (
                  <div style={{ padding: '20px', textAlign: 'center', background: '#f0fdf4', borderRadius: '8px', color: '#16a34a', fontSize: '14px' }}>
                    ✅ All clear — no pharmacy alerts detected
                  </div>
                )}
              </div>
            )}

            {!aiPharmacyLoading && !aiPharmacyAlerts && !aiPharmacyError && (
              <p style={{ color: '#6b7280', fontSize: '13px' }}>Click &quot;Run AI Checks&quot; to detect stock-out risks, expiry alerts, consumption anomalies, and narcotic discrepancies.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
