'use client';

import { useState, useEffect } from 'react';

type RetentionRule = {
  id: string;
  document_type: string;
  retention_days: string | null;
  rationale: string | null;
  auto_delete: boolean;
  archive_before_delete: boolean;
  notification_days_before_deletion: string | null;
  updated_by: string | null;
  updated_at: string;
};

async function trpcQuery(path: string, input?: any) {
  const params = input ? `?input=${encodeURIComponent(JSON.stringify(input))}` : '';
  const res = await fetch(`/api/trpc/${path}${params}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || 'Request failed');
  return json.result?.data;
}

async function trpcMutate(path: string, input: any) {
  const res = await fetch(`/api/trpc/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || 'Request failed');
  return json.result?.data;
}

export function RetentionRulesClient() {
  const [rules, setRules] = useState<RetentionRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingData, setEditingData] = useState<Record<string, any>>({});

  const fetchRules = async () => {
    setLoading(true);
    try {
      const data = await trpcQuery('mrdDocuments.listRetentionRules', {});
      setRules(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRules();
  }, []);

  const handleEdit = (rule: RetentionRule) => {
    setEditingId(rule.id);
    setEditingData({
      retention_days: rule.retention_days || '',
      rationale: rule.rationale || '',
      auto_delete: rule.auto_delete,
      archive_before_delete: rule.archive_before_delete,
      notification_days_before_deletion: rule.notification_days_before_deletion || '30',
    });
  };

  const handleSave = async (ruleId: string) => {
    setError('');
    setSuccess('');
    try {
      await trpcMutate('mrdDocuments.updateRetentionRule', {
        id: ruleId,
        ...editingData,
      });
      setSuccess('Retention rule updated');
      setEditingId(null);
      fetchRules();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleCancel = () => {
    setEditingId(null);
    setEditingData({});
  };

  return (
    <div className="bg-white rounded-lg shadow p-6 space-y-6">
      <div>
        <h2 className="text-xl font-bold">Document Retention Rules</h2>
        <p className="text-sm text-gray-600">Configure how long each document type is retained before deletion</p>
      </div>

      {/* ALERTS */}
      {error && <div className="bg-red-50 border border-red-200 rounded p-3 text-red-700 text-sm">{error}</div>}
      {success && <div className="bg-green-50 border border-green-200 rounded p-3 text-green-700 text-sm">{success}</div>}

      {/* TABLE */}
      {loading ? (
        <div className="text-center py-8 text-gray-500">Loading...</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-4 py-2 text-left">Document Type</th>
                <th className="px-4 py-2 text-left">Retention (Days)</th>
                <th className="px-4 py-2 text-left">Rationale</th>
                <th className="px-4 py-2 text-left">Auto Delete</th>
                <th className="px-4 py-2 text-left">Archive First</th>
                <th className="px-4 py-2 text-left">Notify (Days)</th>
                <th className="px-4 py-2 text-left">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rules.map((rule) => (
                <tr key={rule.id} className={editingId === rule.id ? 'bg-blue-50' : 'hover:bg-gray-50'}>
                  <td className="px-4 py-3 font-medium">{rule.document_type}</td>
                  <td className="px-4 py-3">
                    {editingId === rule.id ? (
                      <input
                        type="text"
                        value={editingData.retention_days}
                        onChange={(e) => setEditingData({ ...editingData, retention_days: e.target.value })}
                        className="px-2 py-1 border rounded text-sm w-20"
                      />
                    ) : (
                      rule.retention_days
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600">
                    {editingId === rule.id ? (
                      <input
                        type="text"
                        value={editingData.rationale}
                        onChange={(e) => setEditingData({ ...editingData, rationale: e.target.value })}
                        className="px-2 py-1 border rounded text-sm w-40"
                      />
                    ) : (
                      rule.rationale
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {editingId === rule.id ? (
                      <input
                        type="checkbox"
                        checked={editingData.auto_delete}
                        onChange={(e) => setEditingData({ ...editingData, auto_delete: e.target.checked })}
                        className="rounded"
                      />
                    ) : (
                      rule.auto_delete ? '✓' : '—'
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {editingId === rule.id ? (
                      <input
                        type="checkbox"
                        checked={editingData.archive_before_delete}
                        onChange={(e) => setEditingData({ ...editingData, archive_before_delete: e.target.checked })}
                        className="rounded"
                      />
                    ) : (
                      rule.archive_before_delete ? '✓' : '—'
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {editingId === rule.id ? (
                      <input
                        type="text"
                        value={editingData.notification_days_before_deletion}
                        onChange={(e) => setEditingData({ ...editingData, notification_days_before_deletion: e.target.value })}
                        className="px-2 py-1 border rounded text-sm w-20"
                      />
                    ) : (
                      rule.notification_days_before_deletion
                    )}
                  </td>
                  <td className="px-4 py-3 space-x-2">
                    {editingId === rule.id ? (
                      <>
                        <button
                          onClick={() => handleSave(rule.id)}
                          className="text-green-600 hover:text-green-700 font-medium text-sm"
                        >
                          Save
                        </button>
                        <button
                          onClick={handleCancel}
                          className="text-gray-600 hover:text-gray-700 text-sm"
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => handleEdit(rule)}
                        className="text-blue-600 hover:text-blue-700 text-sm"
                      >
                        Edit
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="text-xs text-gray-500 pt-4 border-t">
        <p>Retention days: How long documents are kept before deletion</p>
        <p>Auto delete: Automatically delete when retention period expires</p>
        <p>Archive first: Move to archive storage before deletion</p>
        <p>Notify: Days before deletion to send reminder notifications</p>
      </div>
    </div>
  );
}
