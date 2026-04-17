'use client';

import React, { useState, useCallback, useMemo, useEffect } from 'react';

// ============================================================================
// tRPC Helpers
// ============================================================================

async function trpcQuery(path: string, input?: any) {
  const wrapped = input !== undefined ? { json: input } : { json: {} };
  const params = `?input=${encodeURIComponent(JSON.stringify(wrapped))}`;
  const res = await fetch(`/api/trpc/${path}${params}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error?.message || 'Request failed');
  return json.result?.data?.json;
}

async function trpcMutate(path: string, input: any) {
  const res = await fetch(`/api/trpc/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ json: input }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error?.message || 'Request failed');
  return json.result?.data?.json;
}

// ============================================================================
// Types & Constants
// ============================================================================

interface InsurerRule {
  id: string;
  insurer_id: string;
  rule_name: string;
  rule_type: string;
  description?: string;
  priority: number;
  conditions: any;
  parameters: any;
  status: 'active' | 'draft' | 'archived';
  version: number;
  created_at: string;
  insurer_name?: string;
}

interface Insurer {
  id: string;
  insurer_name: string;
  insurer_code: string;
  insurer_type: string;
}

interface LineItem {
  id: string;
  charge_code?: string;
  charge_name: string;
  category: string;
  amount: number;
  quantity: number;
  days?: number;
  room_type?: string;
  procedure_code?: string;
  disease_codes?: string[];
  is_implant?: boolean;
}

interface RuleVersion {
  id: string;
  version: number;
  created_at: string;
  created_by: string;
  status: string;
}

const RULE_TYPES = [
  'room_rent_cap',
  'proportional_deduction',
  'co_pay',
  'item_exclusion',
  'sub_limit',
  'package_rate',
  'waiting_period',
  'disease_cap',
  'network_tier_pricing',
  'category_cap',
];

const RULE_TYPE_LABELS: Record<string, string> = {
  room_rent_cap: 'Room Rent Cap',
  proportional_deduction: 'Proportional',
  co_pay: 'Co-Pay',
  item_exclusion: 'Exclusion',
  sub_limit: 'Sub-Limit',
  package_rate: 'Package',
  waiting_period: 'Waiting Period',
  disease_cap: 'Disease Cap',
  network_tier_pricing: 'Tier Pricing',
  category_cap: 'Category Cap',
};

const RULE_TYPE_COLORS: Record<string, string> = {
  room_rent_cap: '#2563eb',
  proportional_deduction: '#a855f7',
  co_pay: '#f97316',
  item_exclusion: '#dc2626',
  sub_limit: '#06b6d4',
  package_rate: '#059669',
  waiting_period: '#6b7280',
  disease_cap: '#b45309',
  network_tier_pricing: '#6366f1',
  category_cap: '#ec4899',
};

const CONDITION_KEYS = [
  'room_type',
  'network_tier',
  'patient_age_gte',
  'patient_age_lte',
  'category',
  'procedure_code',
  'triggered_by',
];

const CATEGORIES = ['room', 'lab', 'pharmacy', 'procedure', 'consultation', 'nursing', 'icu', 'other'];

const NETWORK_TIERS = ['preferred', 'standard', 'non_network'];

// ============================================================================
// Utility Functions
// ============================================================================

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-IN', {
    year: '2-digit',
    month: 'short',
    day: 'numeric',
  });
}

// ============================================================================
// Styles
// ============================================================================

const styles = {
  container: {
    padding: '20px',
    backgroundColor: '#f8f9fa',
    minHeight: '100vh',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  card: {
    backgroundColor: 'white',
    borderRadius: '12px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
    padding: '20px',
    marginBottom: '20px',
  },
  tabBar: {
    display: 'flex',
    gap: '10px',
    marginBottom: '20px',
    borderBottom: '1px solid #e5e7eb',
  },
  tab: (active: boolean) => ({
    padding: '12px 24px',
    backgroundColor: 'transparent',
    border: 'none',
    borderBottom: active ? '3px solid #2563eb' : '3px solid transparent',
    color: active ? '#2563eb' : '#6b7280',
    fontWeight: active ? '600' : '500',
    cursor: 'pointer',
    fontSize: '14px',
    transition: 'all 0.2s',
  }),
  topBar: {
    display: 'flex',
    gap: '12px',
    marginBottom: '16px',
    flexWrap: 'wrap' as const,
    alignItems: 'center',
  },
  input: {
    padding: '8px 12px',
    borderRadius: '6px',
    border: '1px solid #d1d5db',
    fontSize: '14px',
    fontFamily: 'inherit',
  },
  select: {
    padding: '8px 12px',
    borderRadius: '6px',
    border: '1px solid #d1d5db',
    fontSize: '14px',
    fontFamily: 'inherit',
    backgroundColor: 'white',
  },
  button: {
    padding: '8px 16px',
    borderRadius: '6px',
    border: 'none',
    backgroundColor: '#2563eb',
    color: 'white',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'background-color 0.2s',
  },
  buttonSecondary: {
    padding: '8px 16px',
    borderRadius: '6px',
    border: '1px solid #d1d5db',
    backgroundColor: 'white',
    color: '#374151',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
  badge: (color: string) => ({
    display: 'inline-block',
    padding: '4px 12px',
    borderRadius: '12px',
    backgroundColor: color,
    color: 'white',
    fontSize: '12px',
    fontWeight: '600',
  }),
  table: {
    width: '100%',
    borderCollapse: 'collapse' as const,
  },
  th: {
    textAlign: 'left' as const,
    padding: '12px 16px',
    backgroundColor: '#f3f4f6',
    borderBottom: '1px solid #e5e7eb',
    fontSize: '13px',
    fontWeight: '600',
    color: '#374151',
  },
  td: (rowIndex: number) => ({
    padding: '12px 16px',
    borderBottom: '1px solid #e5e7eb',
    backgroundColor: rowIndex % 2 === 0 ? 'white' : '#f8f9fa',
    fontSize: '14px',
    color: '#374151',
  }),
  alert: (type: 'error' | 'success') => ({
    padding: '12px 16px',
    borderRadius: '6px',
    marginBottom: '16px',
    fontSize: '14px',
    fontWeight: '500',
    backgroundColor: type === 'error' ? '#fee2e2' : '#dcfce7',
    color: type === 'error' ? '#991b1b' : '#166534',
  }),
  spinner: {
    display: 'inline-block',
    width: '16px',
    height: '16px',
    border: '2px solid #e5e7eb',
    borderTop: '2px solid #2563eb',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  },
  detailPanel: {
    position: 'fixed' as const,
    right: '0px',
    top: '0px',
    width: '500px',
    height: '100vh',
    backgroundColor: 'white',
    boxShadow: '-4px 0 12px rgba(0,0,0,0.15)',
    overflowY: 'auto' as const,
    zIndex: 1000,
    padding: '24px',
  },
  overlay: {
    position: 'fixed' as const,
    inset: '0px',
    backgroundColor: 'rgba(0,0,0,0.3)',
    zIndex: 999,
  },
  formGroup: {
    marginBottom: '16px',
  },
  label: {
    display: 'block',
    marginBottom: '6px',
    fontSize: '14px',
    fontWeight: '600',
    color: '#374151',
  },
  textarea: {
    width: '100%',
    padding: '8px 12px',
    borderRadius: '6px',
    border: '1px solid #d1d5db',
    fontSize: '14px',
    fontFamily: 'inherit',
    minHeight: '80px',
    boxSizing: 'border-box' as const,
  },
  conditionBuilder: {
    backgroundColor: '#f9fafb',
    padding: '12px',
    borderRadius: '6px',
    marginTop: '8px',
  },
  conditionRow: {
    display: 'flex',
    gap: '8px',
    marginBottom: '8px',
    alignItems: 'center',
  },
  summaryCard: {
    display: 'inline-block',
    padding: '16px',
    borderRadius: '8px',
    marginRight: '16px',
    marginBottom: '12px',
    minWidth: '180px',
  },
  summaryValue: {
    fontSize: '18px',
    fontWeight: '700',
    color: '#1f2937',
  },
  summaryLabel: {
    fontSize: '12px',
    color: '#6b7280',
    marginTop: '4px',
    fontWeight: '500',
  },
};

// ============================================================================
// Main Component
// ============================================================================

interface Props {
  userId: string;
  userRole: string;
  userName: string;
  breadcrumbs: { label: string; href?: string }[];
}

export default function InsurerRulesAdminClient(props: Props) {
  const [activeTab, setActiveTab] = useState<'rules' | 'editor' | 'simulator' | 'stats'>('rules');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Auto-dismiss success toast
  useEffect(() => {
    if (success) {
      const t = setTimeout(() => setSuccess(''), 3000);
      return () => clearTimeout(t);
    }
  }, [success]);

  // Rules List State
  const [rules, setRules] = useState<InsurerRule[]>([]);
  const [insurers, setInsurers] = useState<Insurer[]>([]);
  const [rulesPage, setRulesPage] = useState(1);
  const [rulesTotal, setRulesTotal] = useState(0);
  const rulesLimit = 10;
  const [searchQuery, setSearchQuery] = useState('');
  const [filterInsurer, setFilterInsurer] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [selectedRule, setSelectedRule] = useState<InsurerRule | null>(null);
  const [detailPanelOpen, setDetailPanelOpen] = useState(false);

  // Editor State
  const [editingRule, setEditingRule] = useState<Partial<InsurerRule>>({
    priority: 100,
    status: 'draft',
    conditions: {},
    parameters: {},
  });
  const [editingConditions, setEditingConditions] = useState<Array<[string, string]>>([]);
  const [versionHistory, setVersionHistory] = useState<RuleVersion[]>([]);

  // Simulator State
  const [simInsurerId, setSimInsurerId] = useState('');
  const [simPatientAge, setSimPatientAge] = useState('');
  const [simNetworkTier, setSimNetworkTier] = useState('preferred');
  const [simSumInsured, setSimSumInsured] = useState('');
  const [simRoomType, setSimRoomType] = useState('');
  const [simDiagnosisCodes, setSimDiagnosisCodes] = useState('');
  const [simLineItems, setSimLineItems] = useState<LineItem[]>([]);
  const [simResults, setSimResults] = useState<any>(null);

  // Stats State
  const [stats, setStats] = useState<any>(null);

  // =========================================================================
  // Effects & Loaders
  // =========================================================================

  const loadInsurers = useCallback(async () => {
    try {
      const data = await trpcQuery('insurers.list', { is_active: 'true' });
      setInsurers(data?.items || []);
    } catch (err: any) {
      setError(err.message);
    }
  }, []);

  const loadRules = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const data = await trpcQuery('insurerRules.list', {
        insurer_id: filterInsurer || undefined,
        rule_type: filterType || undefined,
        status: filterStatus || undefined,
        search: searchQuery || undefined,
        page: rulesPage,
        limit: rulesLimit,
      });
      setRules(data?.items || []);
      setRulesTotal(data?.total || 0);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [filterInsurer, filterType, filterStatus, searchQuery, rulesPage]);

  const loadStats = useCallback(async () => {
    try {
      setLoading(true);
      const data = await trpcQuery('insurerRules.stats', {
        insurer_id: filterInsurer || undefined,
      });
      setStats(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [filterInsurer]);

  React.useEffect(() => {
    loadInsurers();
  }, [loadInsurers]);

  React.useEffect(() => {
    if (activeTab === 'rules') loadRules();
  }, [activeTab, loadRules]);

  React.useEffect(() => {
    if (activeTab === 'stats') loadStats();
  }, [activeTab, loadStats]);

  // =========================================================================
  // Rule List Handlers
  // =========================================================================

  const handleOpenRule = useCallback((rule: InsurerRule) => {
    setSelectedRule(rule);
    setDetailPanelOpen(true);
  }, []);

  const handleEditRule = useCallback(async (rule: InsurerRule) => {
    setEditingRule({
      ...rule,
      conditions: rule.conditions || {},
      parameters: rule.parameters || {},
    });
    setEditingConditions(
      Object.entries(rule.conditions || {}).map(([k, v]) => [k, String(v)])
    );
    try {
      const history = await trpcQuery('insurerRules.getVersionHistory', { rule_id: rule.id });
      setVersionHistory(history || []);
    } catch (err) {
      // Version history optional
    }
    setDetailPanelOpen(false);
    setActiveTab('editor');
  }, []);

  const handleArchiveRule = useCallback(
    async (ruleId: string) => {
      if (!confirm('Archive this rule? It will no longer be applied.')) return;
      try {
        setLoading(true);
        await trpcMutate('insurerRules.archive', { id: ruleId });
        setSuccess('Rule archived');
        loadRules();
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    },
    [loadRules]
  );

  const handleActivateRule = useCallback(
    async (ruleId: string) => {
      try {
        setLoading(true);
        await trpcMutate('insurerRules.activate', { id: ruleId });
        setSuccess('Rule activated');
        loadRules();
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    },
    [loadRules]
  );

  // =========================================================================
  // Rule Editor Handlers
  // =========================================================================

  const handleStartNewRule = useCallback(() => {
    setEditingRule({
      priority: 100,
      status: 'draft',
      conditions: {},
      parameters: {},
    });
    setEditingConditions([]);
    setVersionHistory([]);
    setActiveTab('editor');
  }, []);

  const handleSaveRule = useCallback(async () => {
    try {
      const rule = editingRule as any;
      if (!rule.insurer_id || !rule.rule_name || !rule.rule_type) {
        setError('Insurer, Rule Name, and Rule Type are required');
        return;
      }

      const conditionsObj: any = {};
      editingConditions.forEach(([k, v]) => {
        if (k && v) conditionsObj[k] = v;
      });

      setLoading(true);
      setError('');

      if (rule.id) {
        // Update existing rule
        await trpcMutate('insurerRules.update', {
          id: rule.id,
          rule_name: rule.rule_name,
          rule_type: rule.rule_type,
          description: rule.description,
          priority: rule.priority,
          conditions: conditionsObj,
          parameters: rule.parameters,
        });
        setSuccess('Rule updated (new version created)');
      } else {
        // Create new rule
        await trpcMutate('insurerRules.create', {
          insurer_id: rule.insurer_id,
          rule_name: rule.rule_name,
          rule_type: rule.rule_type,
          description: rule.description,
          priority: rule.priority,
          conditions: conditionsObj,
          parameters: rule.parameters,
          status: rule.status,
        });
        setSuccess('Rule created');
      }

      loadRules();
      setEditingRule({
        priority: 100,
        status: 'draft',
        conditions: {},
        parameters: {},
      });
      setEditingConditions([]);
      setActiveTab('rules');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [editingRule, editingConditions, loadRules]);

  const handleParametersChange = useCallback(
    (key: string, value: any) => {
      setEditingRule((prev) => ({
        ...prev,
        parameters: {
          ...prev.parameters,
          [key]: value,
        },
      }));
    },
    []
  );

  const handleAddCondition = useCallback(() => {
    setEditingConditions((prev) => [...prev, ['', '']]);
  }, []);

  const handleRemoveCondition = useCallback((index: number) => {
    setEditingConditions((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleConditionChange = useCallback(
    (index: number, field: 'key' | 'value', val: string) => {
      setEditingConditions((prev) => {
        const next = [...prev];
        next[index] = field === 'key' ? [val, next[index][1]] : [next[index][0], val];
        return next;
      });
    },
    []
  );

  // =========================================================================
  // Simulator Handlers
  // =========================================================================

  const handleRunSimulation = useCallback(async () => {
    try {
      if (!simInsurerId) {
        setError('Select an insurer');
        return;
      }
      if (simLineItems.length === 0) {
        setError('Add at least one line item');
        return;
      }

      setLoading(true);
      setError('');

      const result = await trpcQuery('insurerRules.evaluate', {
        insurer_id: simInsurerId,
        bill_context: {
          patient_age: simPatientAge ? parseInt(simPatientAge) : undefined,
          network_tier: simNetworkTier,
          sum_insured: simSumInsured ? parseInt(simSumInsured) : undefined,
          room_type: simRoomType,
          diagnosis_codes: simDiagnosisCodes
            ? simDiagnosisCodes.split(',').map((c) => c.trim())
            : [],
          line_items: simLineItems,
        },
      });

      setSimResults(result);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [simInsurerId, simPatientAge, simNetworkTier, simSumInsured, simRoomType, simDiagnosisCodes, simLineItems]);

  const handleAddLineItem = useCallback(() => {
    setSimLineItems((prev) => [
      ...prev,
      {
        id: Math.random().toString(36).substr(2, 9),
        charge_name: '',
        category: 'room',
        amount: 0,
        quantity: 1,
      },
    ]);
  }, []);

  const handleRemoveLineItem = useCallback((id: string) => {
    setSimLineItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const handleLineItemChange = useCallback(
    (id: string, field: keyof LineItem, value: any) => {
      setSimLineItems((prev) =>
        prev.map((item) => (item.id === id ? { ...item, [field]: value } : item))
      );
    },
    []
  );

  const handleLoadSampleBill = useCallback(() => {
    setSimLineItems([
      {
        id: '1',
        charge_name: 'Room (ICU - Single AC)',
        category: 'room',
        amount: 8000,
        quantity: 1,
        days: 5,
        room_type: 'single_ac',
      },
      {
        id: '2',
        charge_name: 'Lab - Pathology Panel',
        category: 'lab',
        amount: 30000,
        quantity: 1,
      },
      {
        id: '3',
        charge_name: 'Pharmacy - Medication & Consumables',
        category: 'pharmacy',
        amount: 50000,
        quantity: 1,
      },
      {
        id: '4',
        charge_name: 'Cardiac Intervention - Angioplasty',
        category: 'procedure',
        amount: 120000,
        quantity: 1,
        procedure_code: 'ANGPL01',
      },
    ]);
    setSimSumInsured('600000');
    setSimPatientAge('55');
    setSimRoomType('single_ac');
    setSuccess('Sample bill loaded');
  }, []);

  // =========================================================================
  // Render: Rules List Tab
  // =========================================================================

  const rulesListContent = (
    <div key="rules-tab">
      <div style={styles.card}>
        <div style={styles.topBar}>
          <input
            type="text"
            placeholder="Search rules..."
            style={{ ...styles.input, flex: 1, minWidth: '200px' }}
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setRulesPage(1);
            }}
          />
          <select
            style={styles.select}
            value={filterInsurer}
            onChange={(e) => {
              setFilterInsurer(e.target.value);
              setRulesPage(1);
            }}
          >
            <option value="">All Insurers</option>
            {insurers.map((ins) => (
              <option key={ins.id} value={ins.id}>
                {ins.insurer_name}
              </option>
            ))}
          </select>
          <select
            style={styles.select}
            value={filterType}
            onChange={(e) => {
              setFilterType(e.target.value);
              setRulesPage(1);
            }}
          >
            <option value="">All Types</option>
            {RULE_TYPES.map((type) => (
              <option key={type} value={type}>
                {RULE_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
          <select
            style={styles.select}
            value={filterStatus}
            onChange={(e) => {
              setFilterStatus(e.target.value);
              setRulesPage(1);
            }}
          >
            <option value="">All Status</option>
            <option value="active">Active</option>
            <option value="draft">Draft</option>
            <option value="archived">Archived</option>
          </select>
          <button style={styles.button} onClick={handleStartNewRule}>
            + New Rule
          </button>
        </div>

        {loading && <div style={styles.alert('success')}>Loading rules...</div>}

        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Priority</th>
              <th style={styles.th}>Rule Name</th>
              <th style={styles.th}>Type</th>
              <th style={styles.th}>Insurer</th>
              <th style={styles.th}>Status</th>
              <th style={styles.th}>Ver.</th>
              <th style={styles.th}>Created</th>
              <th style={styles.th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rules.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ ...styles.td(0), textAlign: 'center', color: '#9ca3af' }}>
                  No rules found
                </td>
              </tr>
            ) : (
              rules.map((rule, idx) => (
                <tr key={rule.id}>
                  <td style={styles.td(idx)}>{rule.priority}</td>
                  <td style={styles.td(idx)}>
                    <button
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#2563eb',
                        cursor: 'pointer',
                        fontWeight: '600',
                      }}
                      onClick={() => handleOpenRule(rule)}
                    >
                      {rule.rule_name}
                    </button>
                  </td>
                  <td style={styles.td(idx)}>
                    <span
                      style={{
                        ...styles.badge(RULE_TYPE_COLORS[rule.rule_type]),
                        backgroundColor: RULE_TYPE_COLORS[rule.rule_type] || '#6b7280',
                      }}
                    >
                      {RULE_TYPE_LABELS[rule.rule_type] || rule.rule_type}
                    </span>
                  </td>
                  <td style={styles.td(idx)}>{rule.insurer_name || rule.insurer_id}</td>
                  <td style={styles.td(idx)}>
                    <span
                      style={{
                        ...styles.badge(
                          rule.status === 'active'
                            ? '#059669'
                            : rule.status === 'draft'
                              ? '#d97706'
                              : '#6b7280'
                        ),
                      }}
                    >
                      {rule.status}
                    </span>
                  </td>
                  <td style={styles.td(idx)}>v{rule.version}</td>
                  <td style={styles.td(idx)}>{formatDate(rule.created_at)}</td>
                  <td style={styles.td(idx)}>
                    <button
                      style={{
                        ...styles.buttonSecondary,
                        marginRight: '8px',
                        padding: '4px 12px',
                        fontSize: '13px',
                      }}
                      onClick={() => handleEditRule(rule)}
                    >
                      Edit
                    </button>
                    {rule.status === 'archived' ? (
                      <button
                        style={{
                          ...styles.buttonSecondary,
                          padding: '4px 12px',
                          fontSize: '13px',
                          color: '#059669',
                        }}
                        onClick={() => handleActivateRule(rule.id)}
                      >
                        Activate
                      </button>
                    ) : (
                      <button
                        style={{
                          ...styles.buttonSecondary,
                          padding: '4px 12px',
                          fontSize: '13px',
                          color: '#dc2626',
                        }}
                        onClick={() => handleArchiveRule(rule.id)}
                      >
                        Archive
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        <div style={{ marginTop: '20px', textAlign: 'center', fontSize: '14px', color: '#6b7280' }}>
          Page {rulesPage} of {Math.ceil(rulesTotal / rulesLimit)} ({rulesTotal} rules)
        </div>
        <div style={{ marginTop: '12px', textAlign: 'center' }}>
          <button
            style={{ ...styles.buttonSecondary, marginRight: '8px' }}
            disabled={rulesPage === 1}
            onClick={() => setRulesPage(Math.max(1, rulesPage - 1))}
          >
            Previous
          </button>
          <button
            style={styles.buttonSecondary}
            disabled={rulesPage >= Math.ceil(rulesTotal / rulesLimit)}
            onClick={() => setRulesPage(rulesPage + 1)}
          >
            Next
          </button>
        </div>
      </div>

      {/* Detail Panel */}
      {detailPanelOpen && selectedRule && (
        <>
          <div style={styles.overlay} onClick={() => setDetailPanelOpen(false)} />
          <div style={styles.detailPanel}>
            <div style={{ marginBottom: '20px' }}>
              <button
                onClick={() => setDetailPanelOpen(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '24px',
                  cursor: 'pointer',
                  color: '#6b7280',
                }}
              >
                ×
              </button>
            </div>

            <h2 style={{ marginBottom: '16px', fontSize: '18px', fontWeight: '700' }}>
              {selectedRule.rule_name}
            </h2>

            <div style={{ marginBottom: '12px' }}>
              <strong>Type:</strong>{' '}
              <span style={styles.badge(RULE_TYPE_COLORS[selectedRule.rule_type])}>
                {RULE_TYPE_LABELS[selectedRule.rule_type]}
              </span>
            </div>

            <div style={{ marginBottom: '12px' }}>
              <strong>Insurer:</strong> {selectedRule.insurer_name}
            </div>

            <div style={{ marginBottom: '12px' }}>
              <strong>Status:</strong>{' '}
              <span
                style={{
                  ...styles.badge(
                    selectedRule.status === 'active'
                      ? '#059669'
                      : selectedRule.status === 'draft'
                        ? '#d97706'
                        : '#6b7280'
                  ),
                }}
              >
                {selectedRule.status}
              </span>
            </div>

            <div style={{ marginBottom: '12px' }}>
              <strong>Priority:</strong> {selectedRule.priority}
            </div>

            <div style={{ marginBottom: '12px' }}>
              <strong>Version:</strong> v{selectedRule.version}
            </div>

            <div style={{ marginBottom: '12px' }}>
              <strong>Created:</strong> {formatDate(selectedRule.created_at)}
            </div>

            {selectedRule.description && (
              <div style={{ marginBottom: '16px' }}>
                <strong>Description:</strong>
                <p style={{ marginTop: '4px', color: '#6b7280' }}>{selectedRule.description}</p>
              </div>
            )}

            <div style={{ marginBottom: '16px' }}>
              <strong>Conditions:</strong>
              <pre
                style={{
                  marginTop: '8px',
                  backgroundColor: '#f9fafb',
                  padding: '12px',
                  borderRadius: '6px',
                  fontSize: '12px',
                  overflow: 'auto',
                  maxHeight: '200px',
                }}
              >
                {JSON.stringify(selectedRule.conditions || {}, null, 2)}
              </pre>
            </div>

            <div style={{ marginBottom: '16px' }}>
              <strong>Parameters:</strong>
              <pre
                style={{
                  marginTop: '8px',
                  backgroundColor: '#f9fafb',
                  padding: '12px',
                  borderRadius: '6px',
                  fontSize: '12px',
                  overflow: 'auto',
                  maxHeight: '200px',
                }}
              >
                {JSON.stringify(selectedRule.parameters || {}, null, 2)}
              </pre>
            </div>

            <button
              style={{ ...styles.button, width: '100%' }}
              onClick={() => handleEditRule(selectedRule)}
            >
              Edit Rule
            </button>
          </div>
        </>
      )}
    </div>
  );

  // =========================================================================
  // Render: Editor Tab
  // =========================================================================

  const renderParametersForm = () => {
    const ruleType = (editingRule as any).rule_type;
    const params = (editingRule as any).parameters || {};

    switch (ruleType) {
      case 'room_rent_cap':
        return (
          <div key="room-rent-cap">
            <div style={styles.formGroup}>
              <label style={styles.label}>Max Per Day (₹)</label>
              <input
                type="number"
                style={styles.input}
                value={params.max_per_day || ''}
                onChange={(e) => handleParametersChange('max_per_day', parseInt(e.target.value))}
              />
            </div>
            <div style={styles.formGroup}>
              <label style={styles.label}>Cap Type</label>
              <select
                style={styles.select}
                value={params.cap_type || 'absolute'}
                onChange={(e) => handleParametersChange('cap_type', e.target.value)}
              >
                <option value="absolute">Absolute</option>
                <option value="percentage_si">% of Sum Insured</option>
              </select>
            </div>
            {params.cap_type === 'percentage_si' && (
              <div style={styles.formGroup}>
                <label style={styles.label}>Percentage of SI</label>
                <input
                  type="number"
                  style={styles.input}
                  value={params.percentage_of_si || ''}
                  onChange={(e) => handleParametersChange('percentage_of_si', parseFloat(e.target.value))}
                />
              </div>
            )}
          </div>
        );
      case 'co_pay':
        return (
          <div key="co-pay">
            <div style={styles.formGroup}>
              <label style={styles.label}>Percentage (%)</label>
              <input
                type="number"
                style={styles.input}
                value={params.percentage || ''}
                onChange={(e) => handleParametersChange('percentage', parseFloat(e.target.value))}
              />
            </div>
            <div style={styles.formGroup}>
              <label style={styles.label}>Apply To</label>
              <select
                style={styles.select}
                value={params.apply_to || 'all'}
                onChange={(e) => handleParametersChange('apply_to', e.target.value)}
              >
                <option value="all">All Items</option>
                <option value="specific">Specific Category</option>
              </select>
            </div>
          </div>
        );
      case 'network_tier_pricing':
        return (
          <div key="tier-pricing">
            <div style={styles.formGroup}>
              <label style={styles.label}>Preferred Network Deduction (0-1)</label>
              <input
                type="number"
                step="0.1"
                style={styles.input}
                value={params.preferred || ''}
                onChange={(e) => handleParametersChange('preferred', parseFloat(e.target.value))}
              />
            </div>
            <div style={styles.formGroup}>
              <label style={styles.label}>Standard Network Deduction (0-1)</label>
              <input
                type="number"
                step="0.1"
                style={styles.input}
                value={params.standard || ''}
                onChange={(e) => handleParametersChange('standard', parseFloat(e.target.value))}
              />
            </div>
            <div style={styles.formGroup}>
              <label style={styles.label}>Non-Network Deduction (0-1)</label>
              <input
                type="number"
                step="0.1"
                style={styles.input}
                value={params.non_network || ''}
                onChange={(e) => handleParametersChange('non_network', parseFloat(e.target.value))}
              />
            </div>
          </div>
        );
      case 'sub_limit':
        return (
          <div key="sub-limit">
            <div style={styles.formGroup}>
              <label style={styles.label}>Category</label>
              <input
                type="text"
                style={styles.input}
                placeholder="e.g., room, lab"
                value={params.category || ''}
                onChange={(e) => handleParametersChange('category', e.target.value)}
              />
            </div>
            <div style={styles.formGroup}>
              <label style={styles.label}>Max Amount (₹)</label>
              <input
                type="number"
                style={styles.input}
                value={params.max_amount || ''}
                onChange={(e) => handleParametersChange('max_amount', parseInt(e.target.value))}
              />
            </div>
          </div>
        );
      case 'disease_cap':
        return (
          <div key="disease-cap">
            <div style={styles.formGroup}>
              <label style={styles.label}>Disease Code</label>
              <input
                type="text"
                style={styles.input}
                placeholder="e.g., ICD-10 code"
                value={params.disease_code || ''}
                onChange={(e) => handleParametersChange('disease_code', e.target.value)}
              />
            </div>
            <div style={styles.formGroup}>
              <label style={styles.label}>Max Amount (₹)</label>
              <input
                type="number"
                style={styles.input}
                value={params.max_amount || ''}
                onChange={(e) => handleParametersChange('max_amount', parseInt(e.target.value))}
              />
            </div>
          </div>
        );
      case 'waiting_period':
        return (
          <div key="waiting-period">
            <div style={styles.formGroup}>
              <label style={styles.label}>Disease Code</label>
              <input
                type="text"
                style={styles.input}
                value={params.disease_code || ''}
                onChange={(e) => handleParametersChange('disease_code', e.target.value)}
              />
            </div>
            <div style={styles.formGroup}>
              <label style={styles.label}>Days to Wait</label>
              <input
                type="number"
                style={styles.input}
                value={params.days || ''}
                onChange={(e) => handleParametersChange('days', parseInt(e.target.value))}
              />
            </div>
          </div>
        );
      case 'item_exclusion':
        return (
          <div key="item-exclusion">
            <div style={styles.formGroup}>
              <label style={styles.label}>Reason</label>
              <input
                type="text"
                style={styles.input}
                value={params.reason || ''}
                onChange={(e) => handleParametersChange('reason', e.target.value)}
              />
            </div>
          </div>
        );
      case 'proportional_deduction':
        return (
          <div key="proportional">
            <div style={styles.formGroup}>
              <label style={styles.label}>Eligible Amount (₹)</label>
              <input
                type="number"
                style={styles.input}
                value={params.eligible_amount || ''}
                onChange={(e) => handleParametersChange('eligible_amount', parseInt(e.target.value))}
              />
            </div>
          </div>
        );
      case 'package_rate':
        return (
          <div key="package">
            <div style={styles.formGroup}>
              <label style={styles.label}>Procedure Code</label>
              <input
                type="text"
                style={styles.input}
                value={params.procedure_code || ''}
                onChange={(e) => handleParametersChange('procedure_code', e.target.value)}
              />
            </div>
            <div style={styles.formGroup}>
              <label style={styles.label}>Package Amount (₹)</label>
              <input
                type="number"
                style={styles.input}
                value={params.package_amount || ''}
                onChange={(e) => handleParametersChange('package_amount', parseInt(e.target.value))}
              />
            </div>
          </div>
        );
      case 'category_cap':
        return (
          <div key="category-cap">
            <div style={styles.formGroup}>
              <label style={styles.label}>Category</label>
              <input
                type="text"
                style={styles.input}
                value={params.category || ''}
                onChange={(e) => handleParametersChange('category', e.target.value)}
              />
            </div>
            <div style={styles.formGroup}>
              <label style={styles.label}>Max Amount (₹)</label>
              <input
                type="number"
                style={styles.input}
                value={params.max_amount || ''}
                onChange={(e) => handleParametersChange('max_amount', parseInt(e.target.value))}
              />
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  const editorContent = (
    <div key="editor-tab" style={styles.card}>
      <h3 style={{ marginBottom: '20px', fontSize: '16px', fontWeight: '700' }}>
        {(editingRule as any).id ? `Editing: ${(editingRule as any).rule_name}` : 'Create New Rule'}
      </h3>

      {(editingRule as any).id && versionHistory.length > 0 && (
        <div style={{ ...styles.alert('success'), marginBottom: '16px' }}>
          Editing v{(editingRule as any).version} → will create v{(editingRule as any).version + 1}
        </div>
      )}

      <div style={styles.formGroup}>
        <label style={styles.label}>Insurer *</label>
        <select
          style={styles.select}
          value={(editingRule as any).insurer_id || ''}
          onChange={(e) => setEditingRule({ ...editingRule, insurer_id: e.target.value })}
          disabled={(editingRule as any).id ? true : false}
        >
          <option value="">Select Insurer</option>
          {insurers.map((ins) => (
            <option key={ins.id} value={ins.id}>
              {ins.insurer_name}
            </option>
          ))}
        </select>
      </div>

      <div style={styles.formGroup}>
        <label style={styles.label}>Rule Name *</label>
        <input
          type="text"
          style={styles.input}
          value={(editingRule as any).rule_name || ''}
          onChange={(e) => setEditingRule({ ...editingRule, rule_name: e.target.value })}
        />
      </div>

      <div style={styles.formGroup}>
        <label style={styles.label}>Rule Type *</label>
        <select
          style={styles.select}
          value={(editingRule as any).rule_type || ''}
          onChange={(e) => setEditingRule({ ...editingRule, rule_type: e.target.value })}
        >
          <option value="">Select Type</option>
          {RULE_TYPES.map((type) => (
            <option key={type} value={type}>
              {RULE_TYPE_LABELS[type]}
            </option>
          ))}
        </select>
      </div>

      <div style={styles.formGroup}>
        <label style={styles.label}>Description</label>
        <textarea
          style={styles.textarea}
          value={(editingRule as any).description || ''}
          onChange={(e) => setEditingRule({ ...editingRule, description: e.target.value })}
          placeholder="Describe the purpose and logic of this rule"
        />
      </div>

      <div style={styles.formGroup}>
        <label style={styles.label}>Priority (lower = higher)</label>
        <input
          type="number"
          style={styles.input}
          value={(editingRule as any).priority || 100}
          onChange={(e) => setEditingRule({ ...editingRule, priority: parseInt(e.target.value) })}
          min="1"
        />
      </div>

      <div style={styles.formGroup}>
        <label style={styles.label}>Status</label>
        <select
          style={styles.select}
          value={(editingRule as any).status || 'draft'}
          onChange={(e) => setEditingRule({ ...editingRule, status: e.target.value as 'active' | 'draft' | 'archived' })}
        >
          <option value="draft">Draft</option>
          <option value="active">Active</option>
        </select>
      </div>

      <div style={styles.formGroup}>
        <label style={styles.label}>Conditions</label>
        <div style={styles.conditionBuilder}>
          {editingConditions.map((cond, idx) => (
            <div key={idx} style={styles.conditionRow}>
              <select
                style={{ ...styles.select, flex: 1 }}
                value={cond[0]}
                onChange={(e) => handleConditionChange(idx, 'key', e.target.value)}
              >
                <option value="">Key</option>
                {CONDITION_KEYS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
              <input
                type="text"
                style={{ ...styles.input, flex: 1 }}
                placeholder="Value"
                value={cond[1]}
                onChange={(e) => handleConditionChange(idx, 'value', e.target.value)}
              />
              <button
                style={{ ...styles.buttonSecondary, color: '#dc2626' }}
                onClick={() => handleRemoveCondition(idx)}
              >
                Remove
              </button>
            </div>
          ))}
          <button style={{ ...styles.button, marginTop: '8px' }} onClick={handleAddCondition}>
            + Add Condition
          </button>
        </div>
      </div>

      <div style={styles.formGroup}>
        <label style={styles.label}>Parameters</label>
        {renderParametersForm()}
      </div>

      <div style={{ display: 'flex', gap: '12px' }}>
        <button style={styles.button} onClick={handleSaveRule} disabled={loading}>
          {loading ? 'Saving...' : 'Save Rule'}
        </button>
        <button
          style={styles.buttonSecondary}
          onClick={() => {
            setActiveTab('rules');
            setEditingRule({ priority: 100, status: 'draft', conditions: {}, parameters: {} });
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );

  // =========================================================================
  // Render: Simulator Tab
  // =========================================================================

  const simulatorContent = (
    <div key="simulator-tab">
      <div style={styles.card}>
        <h3 style={{ marginBottom: '16px', fontSize: '16px', fontWeight: '700' }}>
          Bill Context & Parameters
        </h3>

        <div style={styles.formGroup}>
          <label style={styles.label}>Insurer *</label>
          <select
            style={styles.select}
            value={simInsurerId}
            onChange={(e) => setSimInsurerId(e.target.value)}
          >
            <option value="">Select Insurer</option>
            {insurers.map((ins) => (
              <option key={ins.id} value={ins.id}>
                {ins.insurer_name}
              </option>
            ))}
          </select>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
          <div style={styles.formGroup}>
            <label style={styles.label}>Patient Age</label>
            <input
              type="number"
              style={styles.input}
              value={simPatientAge}
              onChange={(e) => setSimPatientAge(e.target.value)}
            />
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>Network Tier</label>
            <select
              style={styles.select}
              value={simNetworkTier}
              onChange={(e) => setSimNetworkTier(e.target.value)}
            >
              {NETWORK_TIERS.map((tier) => (
                <option key={tier} value={tier}>
                  {tier}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
          <div style={styles.formGroup}>
            <label style={styles.label}>Sum Insured (₹)</label>
            <input
              type="number"
              style={styles.input}
              value={simSumInsured}
              onChange={(e) => setSimSumInsured(e.target.value)}
            />
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>Room Type</label>
            <input
              type="text"
              style={styles.input}
              placeholder="e.g., single_ac"
              value={simRoomType}
              onChange={(e) => setSimRoomType(e.target.value)}
            />
          </div>
        </div>

        <div style={styles.formGroup}>
          <label style={styles.label}>Diagnosis Codes (comma-separated)</label>
          <input
            type="text"
            style={styles.input}
            value={simDiagnosisCodes}
            onChange={(e) => setSimDiagnosisCodes(e.target.value)}
          />
        </div>
      </div>

      <div style={styles.card}>
        <h3 style={{ marginBottom: '16px', fontSize: '16px', fontWeight: '700' }}>Line Items</h3>

        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Charge Name</th>
              <th style={styles.th}>Category</th>
              <th style={styles.th}>Amount (₹)</th>
              <th style={styles.th}>Qty</th>
              <th style={styles.th}>Days</th>
              <th style={styles.th}>Code</th>
              <th style={styles.th}>Action</th>
            </tr>
          </thead>
          <tbody>
            {simLineItems.map((item, idx) => (
              <tr key={item.id}>
                <td style={styles.td(idx)}>
                  <input
                    type="text"
                    style={{ ...styles.input, width: '100%' }}
                    value={item.charge_name}
                    onChange={(e) => handleLineItemChange(item.id, 'charge_name', e.target.value)}
                  />
                </td>
                <td style={styles.td(idx)}>
                  <select
                    style={{ ...styles.select, width: '100%' }}
                    value={item.category}
                    onChange={(e) => handleLineItemChange(item.id, 'category', e.target.value)}
                  >
                    {CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </td>
                <td style={styles.td(idx)}>
                  <input
                    type="number"
                    style={{ ...styles.input, width: '100%' }}
                    value={item.amount}
                    onChange={(e) => handleLineItemChange(item.id, 'amount', parseInt(e.target.value))}
                  />
                </td>
                <td style={styles.td(idx)}>
                  <input
                    type="number"
                    style={{ ...styles.input, width: '60px' }}
                    value={item.quantity}
                    onChange={(e) => handleLineItemChange(item.id, 'quantity', parseInt(e.target.value))}
                  />
                </td>
                <td style={styles.td(idx)}>
                  <input
                    type="number"
                    style={{ ...styles.input, width: '60px' }}
                    value={item.days || ''}
                    onChange={(e) =>
                      handleLineItemChange(item.id, 'days', e.target.value ? parseInt(e.target.value) : undefined)
                    }
                  />
                </td>
                <td style={styles.td(idx)}>
                  <input
                    type="text"
                    style={{ ...styles.input, width: '80px' }}
                    value={item.procedure_code || ''}
                    onChange={(e) => handleLineItemChange(item.id, 'procedure_code', e.target.value)}
                  />
                </td>
                <td style={styles.td(idx)}>
                  <button
                    style={{ ...styles.buttonSecondary, color: '#dc2626', padding: '4px 8px' }}
                    onClick={() => handleRemoveLineItem(item.id)}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={{ marginTop: '12px', display: 'flex', gap: '12px' }}>
          <button style={styles.button} onClick={handleAddLineItem}>
            + Add Line Item
          </button>
          <button style={styles.buttonSecondary} onClick={handleLoadSampleBill}>
            Load Sample ₹3L Bill
          </button>
        </div>
      </div>

      <div style={styles.card}>
        <button
          style={{ ...styles.button, width: '100%', padding: '12px' }}
          onClick={handleRunSimulation}
          disabled={loading}
        >
          {loading ? 'Running Simulation...' : 'Run Simulation'}
        </button>
      </div>

      {simResults && (
        <div style={styles.card}>
          <h3 style={{ marginBottom: '16px', fontSize: '16px', fontWeight: '700' }}>Results</h3>

          <div style={{ marginBottom: '20px' }}>
            <div style={{ ...styles.summaryCard, backgroundColor: '#f0f7ff' }}>
              <div style={styles.summaryValue}>{formatCurrency(simResults.total_original)}</div>
              <div style={styles.summaryLabel}>Original Total</div>
            </div>
            <div style={{ ...styles.summaryCard, backgroundColor: '#f0fdf4' }}>
              <div style={styles.summaryValue}>{formatCurrency(simResults.total_adjusted)}</div>
              <div style={styles.summaryLabel}>Adjusted Total</div>
            </div>
            <div style={{ ...styles.summaryCard, backgroundColor: '#fff5f5' }}>
              <div style={styles.summaryValue}>{formatCurrency(simResults.total_deduction)}</div>
              <div style={styles.summaryLabel}>Total Deductions</div>
            </div>
            <div style={{ ...styles.summaryCard, backgroundColor: '#f9f5ff' }}>
              <div style={styles.summaryValue}>{simResults.rule_results?.length || 0}</div>
              <div style={styles.summaryLabel}>Rules Applied</div>
            </div>
          </div>

          <h4 style={{ marginBottom: '12px', fontSize: '14px', fontWeight: '700' }}>Rule Breakdown</h4>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Rule Name</th>
                <th style={styles.th}>Type</th>
                <th style={styles.th}>Original (₹)</th>
                <th style={styles.th}>Adjusted (₹)</th>
                <th style={styles.th}>Deduction (₹)</th>
              </tr>
            </thead>
            <tbody>
              {simResults.rule_results?.map((r: any, idx: number) => (
                <tr key={idx}>
                  <td style={styles.td(idx)}>{r.rule_name}</td>
                  <td style={styles.td(idx)}>
                    <span style={styles.badge(RULE_TYPE_COLORS[r.rule_type])}>
                      {RULE_TYPE_LABELS[r.rule_type]}
                    </span>
                  </td>
                  <td style={styles.td(idx)}>{formatCurrency(r.original_amount)}</td>
                  <td style={styles.td(idx)}>{formatCurrency(r.adjusted_amount)}</td>
                  <td style={styles.td(idx)}>
                    <span style={{ color: '#dc2626', fontWeight: '600' }}>
                      -{formatCurrency(r.deduction_amount)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  // =========================================================================
  // Render: Stats Tab
  // =========================================================================

  const statsContent = (
    <div key="stats-tab">
      {stats && (
        <div style={styles.card}>
          <h3 style={{ marginBottom: '20px', fontSize: '16px', fontWeight: '700' }}>Statistics</h3>

          <div style={{ marginBottom: '24px' }}>
            <h4 style={{ marginBottom: '12px', fontSize: '14px', fontWeight: '700' }}>Rules by Type</h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
              {Object.entries(stats.rules_by_type || {}).map(([type, count]: [string, any]) => (
                <div key={type} style={{ ...styles.summaryCard, backgroundColor: '#f9f5ff' }}>
                  <div style={styles.summaryValue}>{count}</div>
                  <div style={styles.summaryLabel}>{RULE_TYPE_LABELS[type] || type}</div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: '24px' }}>
            <h4 style={{ marginBottom: '12px', fontSize: '14px', fontWeight: '700' }}>Rules by Status</h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
              {Object.entries(stats.rules_by_status || {}).map(([status, count]: [string, any]) => (
                <div
                  key={status}
                  style={{
                    ...styles.summaryCard,
                    backgroundColor:
                      status === 'active'
                        ? '#f0fdf4'
                        : status === 'draft'
                          ? '#fefce8'
                          : '#f3f4f6',
                  }}
                >
                  <div style={styles.summaryValue}>{count}</div>
                  <div style={styles.summaryLabel}>{status}</div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: '24px' }}>
            <h4 style={{ marginBottom: '12px', fontSize: '14px', fontWeight: '700' }}>Last 30 Days</h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
              <div style={{ ...styles.summaryCard, backgroundColor: '#f0f7ff' }}>
                <div style={styles.summaryValue}>{stats.applications_30d || 0}</div>
                <div style={styles.summaryLabel}>Applications</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  // =========================================================================
  // Main Render
  // =========================================================================

  return (
    <div style={styles.container}>
      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
      `}</style>

      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '28px', fontWeight: '700', marginBottom: '8px' }}>Insurer Billing Rules</h1>
        <div style={{ display: 'flex', gap: '8px', fontSize: '14px', color: '#6b7280' }}>
          {props.breadcrumbs.map((bc, idx) => (
            <div key={idx}>
              {bc.href ? <a href={bc.href}>{bc.label}</a> : <span>{bc.label}</span>}
              {idx < props.breadcrumbs.length - 1 && <span style={{ margin: '0 8px' }}>/</span>}
            </div>
          ))}
        </div>
      </div>

      {error && <div style={styles.alert('error')}>{error}</div>}
      {success && (
        <div style={styles.alert('success')}>
          {success}
        </div>
      )}

      <div style={styles.tabBar}>
        <button
          style={styles.tab(activeTab === 'rules')}
          onClick={() => setActiveTab('rules')}
        >
          Rules
        </button>
        <button
          style={styles.tab(activeTab === 'editor')}
          onClick={() => setActiveTab('editor')}
        >
          Editor
        </button>
        <button
          style={styles.tab(activeTab === 'simulator')}
          onClick={() => setActiveTab('simulator')}
        >
          Simulator
        </button>
        <button
          style={styles.tab(activeTab === 'stats')}
          onClick={() => setActiveTab('stats')}
        >
          Stats
        </button>
      </div>

      {activeTab === 'rules' && rulesListContent}
      {activeTab === 'editor' && editorContent}
      {activeTab === 'simulator' && simulatorContent}
      {activeTab === 'stats' && statsContent}
    </div>
  );
}
