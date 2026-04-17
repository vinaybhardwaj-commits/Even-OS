'use client';

import React, { useState, useEffect, useCallback } from 'react';

// ─── tRPC helpers ───────────────────────────
async function trpcQuery(path: string, input?: any) {
  const params = input ? `?input=${encodeURIComponent(JSON.stringify({ json: input }))}` : '';
  const res = await fetch(`/api/trpc/${path}${params}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || 'Request failed');
  return json.result?.data?.json ?? json.result?.data ?? json;
}

async function trpcMutate(path: string, input: any) {
  const res = await fetch(`/api/trpc/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ json: input }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || 'Request failed');
  return json.result?.data?.json ?? json.result?.data ?? json;
}

// ─── Types ───────────────────────────
interface Account {
  id: string;
  account_code: string;
  account_name: string;
  account_type: string;
  account_sub_type: string | null;
  parent_account_id: string | null;
  level: number;
  is_group: boolean;
  normal_balance: string;
  gst_applicable: boolean;
  hsn_sac_code: string | null;
  description: string | null;
  is_active: boolean;
  is_system_account: boolean;
  opening_balance: string;
  opening_balance_date: string | null;
  children?: TreeNode[];
}

interface TreeNode extends Account {
  children: TreeNode[];
}

interface Props {
  userId: string;
  userRole: string;
  userName: string;
  breadcrumbs: { label: string; href?: string }[];
}

const ACCOUNT_TYPES = ['asset', 'liability', 'equity', 'revenue', 'expense'] as const;
const ACCOUNT_SUB_TYPES = [
  'current_asset', 'fixed_asset', 'current_liability', 'long_term_liability',
  'operating_revenue', 'other_income', 'operating_expense', 'cogs',
  'depreciation', 'tax', 'equity_capital', 'equity_reserves',
] as const;
const NORMAL_BALANCES = ['debit', 'credit'] as const;

const TYPE_COLORS: Record<string, string> = {
  asset: '#2563eb',
  liability: '#dc2626',
  equity: '#7c3aed',
  revenue: '#059669',
  expense: '#ea580c',
};

const TYPE_BG: Record<string, string> = {
  asset: '#eff6ff',
  liability: '#fef2f2',
  equity: '#f5f3ff',
  revenue: '#ecfdf5',
  expense: '#fff7ed',
};

export default function ChartOfAccountsAdminClient({ userId, userRole, userName, breadcrumbs }: Props) {
  const [tab, setTab] = useState<'tree' | 'list' | 'stats'>('tree');
  const [treeData, setTreeData] = useState<TreeNode[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [filterType, setFilterType] = useState<string>('');
  const [search, setSearch] = useState('');
  const [listData, setListData] = useState<Account[]>([]);
  const [listTotal, setListTotal] = useState(0);
  const [listPage, setListPage] = useState(1);

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [editAccount, setEditAccount] = useState<Account | null>(null);
  const [parentForNew, setParentForNew] = useState<Account | null>(null);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const loadTree = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = {};
      if (filterType) params.account_type = filterType;
      const data = await trpcQuery('financeChart.tree', params);
      setTreeData(data.tree || []);
    } catch (err: any) {
      console.error('Load tree error:', err);
    }
    setLoading(false);
  }, [filterType]);

  const loadStats = useCallback(async () => {
    try {
      const data = await trpcQuery('financeChart.stats');
      setStats(data);
    } catch (err: any) {
      console.error('Stats error:', err);
    }
  }, []);

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = { page: listPage, pageSize: 50 };
      if (search) params.search = search;
      if (filterType) params.account_type = filterType;
      const data = await trpcQuery('financeChart.list', params);
      setListData(data.items || []);
      setListTotal(data.total || 0);
    } catch (err: any) {
      console.error('List error:', err);
    }
    setLoading(false);
  }, [search, filterType, listPage]);

  useEffect(() => {
    if (tab === 'tree') loadTree();
    else if (tab === 'list') loadList();
    else if (tab === 'stats') loadStats();
  }, [tab, loadTree, loadList, loadStats]);

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const expandAll = () => {
    const allIds = new Set<string>();
    const collect = (nodes: TreeNode[]) => {
      for (const n of nodes) {
        if (n.children?.length) {
          allIds.add(n.id);
          collect(n.children);
        }
      }
    };
    collect(treeData);
    setExpanded(allIds);
  };

  const collapseAll = () => setExpanded(new Set());

  // ─── Add / Edit form ───────────────────────────
  const openAddUnder = (parent: Account | null) => {
    setEditAccount(null);
    setParentForNew(parent);
    setShowModal(true);
    setFormError('');
  };

  const openEdit = (acct: Account) => {
    setEditAccount(acct);
    setParentForNew(null);
    setShowModal(true);
    setFormError('');
  };

  const handleSave = async (formData: any) => {
    setSaving(true);
    setFormError('');
    try {
      if (editAccount) {
        await trpcMutate('financeChart.update', { id: editAccount.id, ...formData });
      } else {
        await trpcMutate('financeChart.create', formData);
      }
      setShowModal(false);
      if (tab === 'tree') loadTree();
      else loadList();
      loadStats();
    } catch (err: any) {
      setFormError(err.message || 'Save failed');
    }
    setSaving(false);
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Deactivate account "${name}"? This will hide it from active lists.`)) return;
    try {
      await trpcMutate('financeChart.delete', { id });
      if (tab === 'tree') loadTree();
      else loadList();
      loadStats();
    } catch (err: any) {
      alert(err.message || 'Delete failed');
    }
  };

  // ─── Tree Node Renderer ───────────────────────────
  const renderTreeNode = (node: TreeNode, depth: number = 0): React.ReactNode => {
    const hasChildren = node.children && node.children.length > 0;
    const isExpanded = expanded.has(node.id);

    return (
      <div key={node.id}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: '6px 12px',
            paddingLeft: `${12 + depth * 24}px`,
            borderBottom: '1px solid #f3f4f6',
            background: !node.is_active ? '#f9fafb' : 'white',
            opacity: node.is_active ? 1 : 0.6,
            gap: '8px',
            minHeight: '40px',
          }}
        >
          {/* Expand/collapse */}
          <span
            onClick={() => hasChildren && toggleExpand(node.id)}
            style={{
              width: '20px',
              cursor: hasChildren ? 'pointer' : 'default',
              fontSize: '14px',
              color: '#6b7280',
              userSelect: 'none' as const,
              textAlign: 'center' as const,
            }}
          >
            {hasChildren ? (isExpanded ? '▼' : '▶') : '·'}
          </span>

          {/* Code badge */}
          <span style={{
            background: TYPE_BG[node.account_type] || '#f3f4f6',
            color: TYPE_COLORS[node.account_type] || '#374151',
            padding: '2px 8px',
            borderRadius: '4px',
            fontSize: '12px',
            fontFamily: 'monospace',
            fontWeight: 600,
            minWidth: '52px',
            textAlign: 'center' as const,
          }}>
            {node.account_code}
          </span>

          {/* Name */}
          <span style={{
            flex: 1,
            fontWeight: node.is_group ? 600 : 400,
            fontSize: '14px',
            color: '#111827',
          }}>
            {node.account_name}
            {node.is_system_account && (
              <span style={{ marginLeft: '6px', fontSize: '10px', color: '#9ca3af', fontWeight: 400 }}>SYSTEM</span>
            )}
          </span>

          {/* Type & Balance */}
          <span style={{ fontSize: '11px', color: '#6b7280', width: '70px', textAlign: 'center' as const }}>
            {node.normal_balance === 'debit' ? 'Dr' : 'Cr'}
          </span>

          {/* Actions */}
          <div style={{ display: 'flex', gap: '4px' }}>
            {node.is_group && (
              <button
                onClick={() => openAddUnder(node as Account)}
                style={{
                  padding: '2px 8px',
                  fontSize: '11px',
                  background: '#eff6ff',
                  color: '#2563eb',
                  border: '1px solid #bfdbfe',
                  borderRadius: '4px',
                  cursor: 'pointer',
                }}
              >
                + Add
              </button>
            )}
            <button
              onClick={() => openEdit(node as Account)}
              style={{
                padding: '2px 8px',
                fontSize: '11px',
                background: '#f3f4f6',
                border: '1px solid #d1d5db',
                borderRadius: '4px',
                cursor: 'pointer',
              }}
            >
              Edit
            </button>
            {!node.is_system_account && (
              <button
                onClick={() => handleDelete(node.id, node.account_name)}
                style={{
                  padding: '2px 8px',
                  fontSize: '11px',
                  background: '#fef2f2',
                  color: '#dc2626',
                  border: '1px solid #fecaca',
                  borderRadius: '4px',
                  cursor: 'pointer',
                }}
              >
                Del
              </button>
            )}
          </div>
        </div>
        {isExpanded && hasChildren && node.children.map(child => renderTreeNode(child, depth + 1))}
      </div>
    );
  };

  // ─── RENDER ───────────────────────────
  return (
    <div style={{ padding: '24px', maxWidth: '1400px', margin: '0 auto' }}>
      {/* Breadcrumbs */}
      <div style={{ fontSize: '13px', color: '#6b7280', marginBottom: '8px' }}>
        {breadcrumbs.map((b, i) => (
          <span key={i}>
            {b.href ? <a href={b.href} style={{ color: '#2563eb', textDecoration: 'none' }}>{b.label}</a> : <span style={{ color: '#111827' }}>{b.label}</span>}
            {i < breadcrumbs.length - 1 && ' / '}
          </span>
        ))}
      </div>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 700, color: '#111827', margin: 0 }}>Chart of Accounts</h1>
          <p style={{ fontSize: '13px', color: '#6b7280', marginTop: '4px' }}>Ind AS compliant GL structure for EHRC</p>
        </div>
        <button
          onClick={() => openAddUnder(null)}
          style={{
            padding: '8px 16px',
            background: '#2563eb',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            fontSize: '14px',
            cursor: 'pointer',
            fontWeight: 500,
          }}
        >
          + New Account
        </button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '2px', marginBottom: '16px', borderBottom: '2px solid #e5e7eb' }}>
        {(['tree', 'list', 'stats'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: '8px 20px',
              background: tab === t ? '#2563eb' : 'transparent',
              color: tab === t ? 'white' : '#6b7280',
              border: 'none',
              borderRadius: '6px 6px 0 0',
              fontSize: '14px',
              fontWeight: tab === t ? 600 : 400,
              cursor: 'pointer',
              textTransform: 'capitalize' as const,
            }}
          >
            {t === 'tree' ? 'Tree View' : t === 'list' ? 'Flat List' : 'Statistics'}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' as const }}>
        <select
          value={filterType}
          onChange={e => { setFilterType(e.target.value); setListPage(1); }}
          style={{ padding: '6px 12px', borderRadius: '6px', border: '1px solid #d1d5db', fontSize: '13px' }}
        >
          <option value="">All Types</option>
          {ACCOUNT_TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
        </select>

        {tab === 'list' && (
          <input
            type="text"
            placeholder="Search by name or code..."
            value={search}
            onChange={e => { setSearch(e.target.value); setListPage(1); }}
            style={{ padding: '6px 12px', borderRadius: '6px', border: '1px solid #d1d5db', fontSize: '13px', width: '250px' }}
          />
        )}

        {tab === 'tree' && (
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={expandAll} style={{ padding: '6px 12px', fontSize: '12px', background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: '6px', cursor: 'pointer' }}>
              Expand All
            </button>
            <button onClick={collapseAll} style={{ padding: '6px 12px', fontSize: '12px', background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: '6px', cursor: 'pointer' }}>
              Collapse All
            </button>
          </div>
        )}
      </div>

      {/* Content */}
      {loading ? (
        <div style={{ padding: '40px', textAlign: 'center' as const, color: '#6b7280' }}>Loading...</div>
      ) : tab === 'tree' ? (
        <div style={{ border: '1px solid #e5e7eb', borderRadius: '8px', overflow: 'hidden' }}>
          {/* Tree header */}
          <div style={{ display: 'flex', padding: '8px 12px', background: '#f9fafb', borderBottom: '2px solid #e5e7eb', fontSize: '12px', fontWeight: 600, color: '#6b7280', gap: '8px' }}>
            <span style={{ width: '20px' }}></span>
            <span style={{ minWidth: '52px', textAlign: 'center' as const }}>Code</span>
            <span style={{ flex: 1 }}>Account Name</span>
            <span style={{ width: '70px', textAlign: 'center' as const }}>Balance</span>
            <span style={{ width: '140px', textAlign: 'center' as const }}>Actions</span>
          </div>
          {treeData.length === 0 ? (
            <div style={{ padding: '24px', textAlign: 'center' as const, color: '#9ca3af' }}>No accounts found</div>
          ) : (
            treeData.map(node => renderTreeNode(node, 0))
          )}
        </div>
      ) : tab === 'list' ? (
        <div>
          <div style={{ border: '1px solid #e5e7eb', borderRadius: '8px', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' as const, fontSize: '13px' }}>
              <thead>
                <tr style={{ background: '#f9fafb', borderBottom: '2px solid #e5e7eb' }}>
                  <th style={{ padding: '8px 12px', textAlign: 'left' as const, fontWeight: 600, color: '#6b7280' }}>Code</th>
                  <th style={{ padding: '8px 12px', textAlign: 'left' as const, fontWeight: 600, color: '#6b7280' }}>Name</th>
                  <th style={{ padding: '8px 12px', textAlign: 'center' as const, fontWeight: 600, color: '#6b7280' }}>Type</th>
                  <th style={{ padding: '8px 12px', textAlign: 'center' as const, fontWeight: 600, color: '#6b7280' }}>Level</th>
                  <th style={{ padding: '8px 12px', textAlign: 'center' as const, fontWeight: 600, color: '#6b7280' }}>Balance</th>
                  <th style={{ padding: '8px 12px', textAlign: 'center' as const, fontWeight: 600, color: '#6b7280' }}>Status</th>
                  <th style={{ padding: '8px 12px', textAlign: 'center' as const, fontWeight: 600, color: '#6b7280' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {listData.map(acct => (
                  <tr key={acct.id} style={{ borderBottom: '1px solid #f3f4f6', opacity: acct.is_active ? 1 : 0.6 }}>
                    <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontWeight: 600 }}>
                      <span style={{ background: TYPE_BG[acct.account_type] || '#f3f4f6', color: TYPE_COLORS[acct.account_type] || '#374151', padding: '2px 6px', borderRadius: '4px', fontSize: '12px' }}>
                        {acct.account_code}
                      </span>
                    </td>
                    <td style={{ padding: '8px 12px', fontWeight: acct.is_group ? 600 : 400 }}>
                      {acct.account_name}
                      {acct.is_system_account && <span style={{ marginLeft: '6px', fontSize: '10px', color: '#9ca3af' }}>SYSTEM</span>}
                    </td>
                    <td style={{ padding: '8px 12px', textAlign: 'center' as const, textTransform: 'capitalize' as const }}>{acct.account_type}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'center' as const }}>L{acct.level}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'center' as const }}>{acct.normal_balance === 'debit' ? 'Dr' : 'Cr'}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'center' as const }}>
                      <span style={{ padding: '2px 8px', borderRadius: '10px', fontSize: '11px', background: acct.is_active ? '#ecfdf5' : '#fef2f2', color: acct.is_active ? '#059669' : '#dc2626' }}>
                        {acct.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td style={{ padding: '8px 12px', textAlign: 'center' as const }}>
                      <button onClick={() => openEdit(acct)} style={{ padding: '2px 8px', fontSize: '11px', background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: '4px', cursor: 'pointer', marginRight: '4px' }}>Edit</button>
                      {!acct.is_system_account && (
                        <button onClick={() => handleDelete(acct.id, acct.account_name)} style={{ padding: '2px 8px', fontSize: '11px', background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', borderRadius: '4px', cursor: 'pointer' }}>Del</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Pagination */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px', fontSize: '13px', color: '#6b7280' }}>
            <span>Showing {listData.length} of {listTotal} accounts</span>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={() => setListPage(p => Math.max(1, p - 1))} disabled={listPage === 1} style={{ padding: '4px 12px', background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: '4px', cursor: listPage === 1 ? 'not-allowed' : 'pointer', opacity: listPage === 1 ? 0.5 : 1 }}>Prev</button>
              <span style={{ padding: '4px 8px' }}>Page {listPage}</span>
              <button onClick={() => setListPage(p => p + 1)} disabled={listData.length < 50} style={{ padding: '4px 12px', background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: '4px', cursor: listData.length < 50 ? 'not-allowed' : 'pointer', opacity: listData.length < 50 ? 0.5 : 1 }}>Next</button>
            </div>
          </div>
        </div>
      ) : (
        /* Stats tab */
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
          {stats?.by_type?.map((t: any) => (
            <div key={t.account_type} style={{ padding: '20px', border: '1px solid #e5e7eb', borderRadius: '8px', background: TYPE_BG[t.account_type] || '#f9fafb' }}>
              <div style={{ fontSize: '14px', fontWeight: 600, color: TYPE_COLORS[t.account_type] || '#374151', textTransform: 'capitalize' as const, marginBottom: '12px' }}>
                {t.account_type}
              </div>
              <div style={{ fontSize: '28px', fontWeight: 700, color: '#111827' }}>{t.total}</div>
              <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>
                {t.active} active · {t.groups} groups · {t.system} system
              </div>
            </div>
          ))}
          {stats && (
            <div style={{ padding: '20px', border: '2px solid #2563eb', borderRadius: '8px', background: '#eff6ff' }}>
              <div style={{ fontSize: '14px', fontWeight: 600, color: '#2563eb', marginBottom: '12px' }}>Total</div>
              <div style={{ fontSize: '28px', fontWeight: 700, color: '#111827' }}>{stats.total_accounts}</div>
              <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>
                {stats.total_active} active · {stats.total_system} system-locked
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── Create/Edit Modal ─────────────── */}
      {showModal && (
        <AccountModal
          account={editAccount}
          parentAccount={parentForNew}
          onSave={handleSave}
          onClose={() => setShowModal(false)}
          error={formError}
          saving={saving}
        />
      )}
    </div>
  );
}

// ─── Account Modal Component ───────────────────────────
function AccountModal({
  account, parentAccount, onSave, onClose, error, saving,
}: {
  account: Account | null;
  parentAccount: Account | null;
  onSave: (data: any) => void;
  onClose: () => void;
  error: string;
  saving: boolean;
}) {
  const isEdit = !!account;

  const [code, setCode] = useState(account?.account_code || '');
  const [name, setName] = useState(account?.account_name || '');
  const [type, setType] = useState(account?.account_type || parentAccount?.account_type || 'asset');
  const [subType, setSubType] = useState(account?.account_sub_type || '');
  const [level, setLevel] = useState(account?.level || (parentAccount ? parentAccount.level + 1 : 1));
  const [isGroup, setIsGroup] = useState(account?.is_group || false);
  const [normalBalance, setNormalBalance] = useState(account?.normal_balance || (['asset', 'expense'].includes(type) ? 'debit' : 'credit'));
  const [gstApplicable, setGstApplicable] = useState(account?.gst_applicable || false);
  const [hsnSac, setHsnSac] = useState(account?.hsn_sac_code || '');
  const [description, setDescription] = useState(account?.description || '');

  // Auto-set normal balance when type changes (for new accounts)
  useEffect(() => {
    if (!isEdit) {
      setNormalBalance(['asset', 'expense'].includes(type) ? 'debit' : 'credit');
    }
  }, [type, isEdit]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const data: any = {};

    if (isEdit) {
      if (name !== account!.account_name) data.account_name = name;
      if (subType !== (account!.account_sub_type || '')) data.account_sub_type = subType || null;
      if (level !== account!.level) data.level = level;
      if (isGroup !== account!.is_group) data.is_group = isGroup;
      if (gstApplicable !== account!.gst_applicable) data.gst_applicable = gstApplicable;
      if (hsnSac !== (account!.hsn_sac_code || '')) data.hsn_sac_code = hsnSac || null;
      if (description !== (account!.description || '')) data.description = description || null;
    } else {
      data.account_code = code;
      data.account_name = name;
      data.account_type = type;
      if (subType) data.account_sub_type = subType;
      if (parentAccount) data.parent_account_id = parentAccount.id;
      data.level = level;
      data.is_group = isGroup;
      data.normal_balance = normalBalance;
      data.gst_applicable = gstApplicable;
      if (hsnSac) data.hsn_sac_code = hsnSac;
      if (description) data.description = description;
    }

    onSave(data);
  };

  const inputStyle = {
    width: '100%',
    padding: '8px 12px',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    fontSize: '14px',
    boxSizing: 'border-box' as const,
  };

  const labelStyle = {
    display: 'block' as const,
    fontSize: '13px',
    fontWeight: 500 as const,
    color: '#374151',
    marginBottom: '4px',
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: 'white', borderRadius: '12px', padding: '24px', width: '500px', maxHeight: '80vh', overflowY: 'auto' as const }}>
        <h2 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '16px', color: '#111827' }}>
          {isEdit ? `Edit: ${account!.account_name}` : parentAccount ? `Add under: ${parentAccount.account_name}` : 'New Account'}
        </h2>

        <form onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gap: '12px' }}>
            {/* Code (only for new) */}
            {!isEdit && (
              <div>
                <label style={labelStyle}>Account Code *</label>
                <input type="text" value={code} onChange={e => setCode(e.target.value)} required maxLength={20} style={inputStyle} placeholder="e.g., 4195" />
              </div>
            )}

            {/* Name */}
            <div>
              <label style={labelStyle}>Account Name *</label>
              <input type="text" value={name} onChange={e => setName(e.target.value)} required maxLength={200} style={inputStyle} />
            </div>

            {/* Type (only for new) */}
            {!isEdit && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={labelStyle}>Account Type *</label>
                  <select value={type} onChange={e => setType(e.target.value)} style={inputStyle}>
                    {ACCOUNT_TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Normal Balance *</label>
                  <select value={normalBalance} onChange={e => setNormalBalance(e.target.value)} style={inputStyle}>
                    {NORMAL_BALANCES.map(b => <option key={b} value={b}>{b === 'debit' ? 'Debit (Dr)' : 'Credit (Cr)'}</option>)}
                  </select>
                </div>
              </div>
            )}

            {/* Sub-type */}
            <div>
              <label style={labelStyle}>Sub-Type</label>
              <select value={subType} onChange={e => setSubType(e.target.value)} style={inputStyle}>
                <option value="">— None —</option>
                {ACCOUNT_SUB_TYPES.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
              </select>
            </div>

            {/* Level & Group */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div>
                <label style={labelStyle}>Level</label>
                <select value={level} onChange={e => setLevel(Number(e.target.value))} style={inputStyle}>
                  <option value={1}>1 — Group</option>
                  <option value={2}>2 — Sub-Group</option>
                  <option value={3}>3 — Ledger</option>
                  <option value={4}>4 — Sub-Ledger</option>
                </select>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: '8px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', cursor: 'pointer' }}>
                  <input type="checkbox" checked={isGroup} onChange={e => setIsGroup(e.target.checked)} />
                  Is Group (can have children)
                </label>
              </div>
            </div>

            {/* GST */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', cursor: 'pointer' }}>
                  <input type="checkbox" checked={gstApplicable} onChange={e => setGstApplicable(e.target.checked)} />
                  GST Applicable
                </label>
              </div>
              {gstApplicable && (
                <div>
                  <label style={labelStyle}>HSN/SAC Code</label>
                  <input type="text" value={hsnSac} onChange={e => setHsnSac(e.target.value)} style={inputStyle} placeholder="e.g., 999312" />
                </div>
              )}
            </div>

            {/* Description */}
            <div>
              <label style={labelStyle}>Description</label>
              <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} style={{ ...inputStyle, resize: 'vertical' as const }} />
            </div>
          </div>

          {error && (
            <div style={{ padding: '8px 12px', background: '#fef2f2', color: '#dc2626', borderRadius: '6px', fontSize: '13px', marginTop: '12px' }}>
              {error}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
            <button type="button" onClick={onClose} style={{ padding: '8px 16px', background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px', cursor: 'pointer' }}>
              Cancel
            </button>
            <button type="submit" disabled={saving} style={{ padding: '8px 16px', background: '#2563eb', color: 'white', border: 'none', borderRadius: '6px', fontSize: '14px', cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1 }}>
              {saving ? 'Saving...' : isEdit ? 'Update' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
