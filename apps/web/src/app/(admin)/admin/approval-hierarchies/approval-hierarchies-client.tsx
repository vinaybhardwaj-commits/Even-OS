'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

type ApprovalType = 'discount' | 'write_off' | 'override' | 'refund' | 'credit_note' | 'other';

interface ApprovalLevel {
  threshold_min: number;
  threshold_max: number;
  approver_role: string;
  description?: string;
}

interface ApprovalHierarchy {
  id: string;
  hospital_id: string;
  approval_type: ApprovalType;
  levels: ApprovalLevel[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

const APPROVAL_TYPE_LABELS: Record<ApprovalType, string> = {
  discount: 'Discount',
  write_off: 'Write Off',
  override: 'Override',
  refund: 'Refund',
  credit_note: 'Credit Note',
  other: 'Other',
};

// tRPC helper functions
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

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function ApprovalHierarchiesClient() {
  const [hierarchies, setHierarchies] = useState<ApprovalHierarchy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<{
    approval_type: ApprovalType;
    levels: ApprovalLevel[];
  }>({
    approval_type: 'discount',
    levels: [{ threshold_min: 0, threshold_max: 10000, approver_role: '', description: '' }],
  });

  // Load hierarchies
  useEffect(() => {
    loadHierarchies();
  }, []);

  async function loadHierarchies() {
    try {
      setLoading(true);
      setError(null);
      const data = await trpcQuery('approvalHierarchies.list');
      setHierarchies(data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load approval hierarchies');
    } finally {
      setLoading(false);
    }
  }

  function openCreateModal() {
    setEditingId(null);
    setFormData({
      approval_type: 'discount',
      levels: [{ threshold_min: 0, threshold_max: 10000, approver_role: '', description: '' }],
    });
    setShowModal(true);
  }

  async function openEditModal(hierarchy: ApprovalHierarchy) {
    setEditingId(hierarchy.id);
    setFormData({
      approval_type: hierarchy.approval_type,
      levels: hierarchy.levels,
    });
    setShowModal(true);
  }

  async function handleSubmit() {
    try {
      setError(null);

      // Validation
      if (formData.levels.length === 0) {
        setError('At least one approval level is required');
        return;
      }

      for (const level of formData.levels) {
        if (!level.approver_role.trim()) {
          setError('All levels must have an approver role');
          return;
        }
        if (level.threshold_min < 0 || level.threshold_max < 0) {
          setError('Thresholds cannot be negative');
          return;
        }
        if (level.threshold_min > level.threshold_max) {
          setError('Minimum threshold cannot exceed maximum threshold');
          return;
        }
      }

      if (editingId) {
        await trpcMutate('approvalHierarchies.update', {
          id: editingId,
          levels: formData.levels,
        });
      } else {
        await trpcMutate('approvalHierarchies.create', {
          approval_type: formData.approval_type,
          levels: formData.levels,
        });
      }

      setShowModal(false);
      await loadHierarchies();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save approval hierarchy');
    }
  }

  async function handleToggleActive(hierarchy: ApprovalHierarchy) {
    try {
      setError(null);
      await trpcMutate('approvalHierarchies.deactivate', { id: hierarchy.id });
      await loadHierarchies();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to toggle approval hierarchy status');
    }
  }

  function addLevel() {
    setFormData({
      ...formData,
      levels: [
        ...formData.levels,
        { threshold_min: 0, threshold_max: 10000, approver_role: '', description: '' },
      ],
    });
  }

  function removeLevel(index: number) {
    if (formData.levels.length > 1) {
      setFormData({
        ...formData,
        levels: formData.levels.filter((_, i) => i !== index),
      });
    }
  }

  function updateLevel(index: number, field: keyof ApprovalLevel, value: any) {
    const newLevels = [...formData.levels];
    newLevels[index] = { ...newLevels[index], [field]: value };
    setFormData({ ...formData, levels: newLevels });
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-blue-900 text-white px-6 py-6">
        <div className="flex items-center gap-4 mb-2">
          <Link href="/dashboard" className="text-xl cursor-pointer hover:opacity-80">
            ←
          </Link>
          <h1 className="text-3xl font-bold">Approval Hierarchies</h1>
        </div>
      </div>

      {/* Main Content */}
      <div className="p-6">
        {/* Action Bar */}
        <div className="flex justify-end mb-6">
          <button
            onClick={openCreateModal}
            className="bg-blue-900 text-white px-4 py-2 rounded-lg hover:bg-blue-800 flex items-center gap-2 transition"
          >
            + New Hierarchy
          </button>
        </div>

        {/* Error Message */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6 text-red-700">
            {error}
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="text-center text-gray-600 py-12">
            Loading approval hierarchies...
          </div>
        )}

        {/* Cards Grid */}
        {!loading && hierarchies.length === 0 && (
          <div className="text-center text-gray-600 py-12">
            No approval hierarchies configured yet. Click "New Hierarchy" to create one.
          </div>
        )}

        {!loading && hierarchies.length > 0 && (
          <div className="grid gap-6">
            {hierarchies.map((hierarchy) => (
              <div
                key={hierarchy.id}
                className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden"
              >
                {/* Card Header */}
                <div className="bg-gray-50 px-6 py-4 flex items-center justify-between border-b border-gray-200">
                  <div className="flex items-center gap-4">
                    <h2 className="text-lg font-semibold text-gray-900">
                      {APPROVAL_TYPE_LABELS[hierarchy.approval_type]}
                    </h2>
                    <span
                      className={`px-3 py-1 rounded-full text-sm font-medium ${
                        hierarchy.is_active
                          ? 'bg-green-100 text-green-800'
                          : 'bg-gray-200 text-gray-700'
                      }`}
                    >
                      {hierarchy.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => openEditModal(hierarchy)}
                      className="bg-gray-200 hover:bg-gray-300 text-gray-700 p-2 rounded transition"
                      title="Edit"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleToggleActive(hierarchy)}
                      className="bg-gray-200 hover:bg-gray-300 text-gray-700 p-2 rounded transition"
                      title={hierarchy.is_active ? 'Deactivate' : 'Activate'}
                    >
                      {hierarchy.is_active ? 'Disable' : 'Enable'}
                    </button>
                  </div>
                </div>

                {/* Card Content - Table of Levels */}
                <div className="px-6 py-4 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200">
                        <th className="text-left py-2 font-semibold text-gray-700">
                          Min Amount
                        </th>
                        <th className="text-left py-2 font-semibold text-gray-700">
                          Max Amount
                        </th>
                        <th className="text-left py-2 font-semibold text-gray-700">
                          Approver Role
                        </th>
                        <th className="text-left py-2 font-semibold text-gray-700">
                          Description
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {hierarchy.levels.map((level, idx) => (
                        <tr key={idx} className="border-b border-gray-100 last:border-b-0">
                          <td className="py-3 text-gray-900">
                            {formatCurrency(level.threshold_min)}
                          </td>
                          <td className="py-3 text-gray-900">
                            {formatCurrency(level.threshold_max)}
                          </td>
                          <td className="py-3 text-gray-900">{level.approver_role}</td>
                          <td className="py-3 text-gray-600">
                            {level.description || '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            {/* Modal Header */}
            <div className="sticky top-0 bg-gray-50 px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h2 className="text-xl font-semibold text-gray-900">
                {editingId ? 'Edit' : 'Create'} Approval Hierarchy
              </h2>
              <button
                onClick={() => setShowModal(false)}
                className="text-gray-500 hover:text-gray-700 text-xl"
              >
                ×
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-6">
              {/* Approval Type */}
              {!editingId && (
                <div>
                  <label className="block text-sm font-semibold text-gray-900 mb-2">
                    Approval Type
                  </label>
                  <select
                    value={formData.approval_type}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        approval_type: e.target.value as ApprovalType,
                      })
                    }
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {Object.entries(APPROVAL_TYPE_LABELS).map(([type, label]) => (
                      <option key={type} value={type}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Levels */}
              <div>
                <label className="block text-sm font-semibold text-gray-900 mb-4">
                  Approval Levels
                </label>
                <div className="space-y-4">
                  {formData.levels.map((level, idx) => (
                    <div key={idx} className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                      <div className="flex justify-between items-start mb-4">
                        <h3 className="font-medium text-gray-900">Level {idx + 1}</h3>
                        {formData.levels.length > 1 && (
                          <button
                            onClick={() => removeLevel(idx)}
                            className="text-red-600 hover:text-red-700 text-lg"
                            title="Remove level"
                          >
                            ×
                          </button>
                        )}
                      </div>

                      <div className="grid grid-cols-2 gap-4 mb-4">
                        <div>
                          <label className="block text-xs font-semibold text-gray-700 mb-1">
                            Min Amount (₹)
                          </label>
                          <input
                            type="number"
                            value={level.threshold_min}
                            onChange={(e) =>
                              updateLevel(idx, 'threshold_min', parseFloat(e.target.value) || 0)
                            }
                            className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-gray-700 mb-1">
                            Max Amount (₹)
                          </label>
                          <input
                            type="number"
                            value={level.threshold_max}
                            onChange={(e) =>
                              updateLevel(idx, 'threshold_max', parseFloat(e.target.value) || 0)
                            }
                            className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                      </div>

                      <div className="mb-4">
                        <label className="block text-xs font-semibold text-gray-700 mb-1">
                          Approver Role
                        </label>
                        <input
                          type="text"
                          value={level.approver_role}
                          onChange={(e) =>
                            updateLevel(idx, 'approver_role', e.target.value)
                          }
                          placeholder="e.g., Manager, Director, CFO"
                          className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-gray-700 mb-1">
                          Description (optional)
                        </label>
                        <input
                          type="text"
                          value={level.description || ''}
                          onChange={(e) =>
                            updateLevel(idx, 'description', e.target.value)
                          }
                          placeholder="e.g., Head approval required for mid-range discounts"
                          className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                    </div>
                  ))}
                </div>

                <button
                  onClick={addLevel}
                  className="mt-4 w-full border-2 border-dashed border-gray-300 rounded-lg py-2 text-gray-700 hover:border-gray-400 hover:bg-gray-50 transition"
                >
                  + Add Level
                </button>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="sticky bottom-0 bg-gray-50 px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2 border border-gray-300 rounded-lg text-gray-900 hover:bg-gray-50 transition"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                className="px-4 py-2 bg-blue-900 text-white rounded-lg hover:bg-blue-800 transition"
              >
                {editingId ? 'Update' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
