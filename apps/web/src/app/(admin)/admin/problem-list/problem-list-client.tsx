'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';

interface Patient {
  id: string;
  uhid: string;
  name_full: string;
  phone: string;
  dob: string;
  gender: string;
}

interface Condition {
  id: string;
  patient_id: string;
  encounter_id: string | null;
  icd10_code: string | null;
  condition_name: string;
  clinical_status: 'active' | 'inactive' | 'resolved' | 'remission';
  verification_status: 'unconfirmed' | 'provisional' | 'differential' | 'confirmed';
  severity: 'mild' | 'moderate' | 'severe' | null;
  onset_date: string | null;
  abatement_date: string | null;
  notes: string | null;
  recorded_by: string;
  version: number;
  created_at: string;
  updated_at: string;
}

interface Stats {
  active: number;
  confirmed: number;
  provisional: number;
  resolved: number;
}

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

async function trpcMutate(path: string, input: any) {
  const res = await fetch(`/api/trpc/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ json: input }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error?.json?.message || json.error?.message || 'Request failed');
  return json.result?.data?.json;
}

function formatIndianDate(dateString: string | null): string {
  if (!dateString) return '—';
  const date = new Date(dateString);
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function getStatusColor(status: string): string {
  switch (status) {
    case 'active':
      return 'bg-green-100 text-green-800 border-green-300';
    case 'recurrence':
    case 'relapse':
      return 'bg-yellow-100 text-yellow-800 border-yellow-300';
    case 'inactive':
    case 'remission':
      return 'bg-gray-100 text-gray-800 border-gray-300';
    case 'resolved':
      return 'bg-blue-100 text-blue-800 border-blue-300';
    default:
      return 'bg-gray-100 text-gray-800 border-gray-300';
  }
}

function getVerificationColor(status: string): string {
  switch (status) {
    case 'confirmed':
      return 'bg-emerald-100 text-emerald-800';
    case 'provisional':
      return 'bg-amber-100 text-amber-800';
    case 'differential':
      return 'bg-orange-100 text-orange-800';
    case 'unconfirmed':
      return 'bg-slate-100 text-slate-800';
    default:
      return 'bg-slate-100 text-slate-800';
  }
}

function getSeverityColor(severity: string | null): string {
  switch (severity) {
    case 'mild':
      return 'bg-blue-50 text-blue-700';
    case 'moderate':
      return 'bg-orange-50 text-orange-700';
    case 'severe':
      return 'bg-red-50 text-red-700';
    default:
      return 'bg-gray-50 text-gray-700';
  }
}

function DebounceInput({
  value,
  onChange,
  placeholder,
  loading,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  loading: boolean;
}) {
  const timeoutRef = useRef<NodeJS.Timeout>();

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      onChange(newValue);
    }, 300);
  };

  return (
    <div className="relative">
      <input
        type="text"
        value={value}
        onChange={handleChange}
        placeholder={placeholder}
        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        disabled={loading}
      />
      {loading && (
        <div className="absolute right-3 top-2.5">
          <div className="w-5 h-5 border-2 border-blue-300 border-t-blue-600 rounded-full animate-spin"></div>
        </div>
      )}
    </div>
  );
}

export default function ProblemListClient() {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [conditions, setConditions] = useState<Condition[]>([]);
  const [stats, setStats] = useState<Stats>({ active: 0, confirmed: 0, provisional: 0, resolved: 0 });
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showPatientDropdown, setShowPatientDropdown] = useState(false);
  const [loading, setLoading] = useState(false);
  const [conditionsLoading, setConditionsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    condition_name: '',
    icd10_code: '',
    clinical_status: 'active' as const,
    verification_status: 'provisional' as const,
    severity: '' as '' | 'mild' | 'moderate' | 'severe',
    onset_date: '',
    notes: '',
  });

  // Load stats on mount
  useEffect(() => {
    loadStats();
  }, []);

  async function loadStats() {
    try {
      const allConditions = await trpcQuery('conditions.list', {
        patient_id: '00000000-0000-0000-0000-000000000000', // Dummy call to get counts
      });
      // This is a simplified approach; ideally we'd have a dedicated stats endpoint
      setStats({ active: 0, confirmed: 0, provisional: 0, resolved: 0 });
    } catch (err) {
      console.error('Failed to load stats:', err);
    }
  }

  async function searchPatients(query: string) {
    if (query.length < 1) {
      setPatients([]);
      setShowPatientDropdown(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const results = await trpcQuery('patient.search', { query, limit: 10 });
      setPatients(results || []);
      setShowPatientDropdown(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to search patients');
      setPatients([]);
    } finally {
      setLoading(false);
    }
  }

  async function selectPatient(patient: Patient) {
    setSelectedPatient(patient);
    setSearchQuery(patient.name_full);
    setShowPatientDropdown(false);
    await loadConditions(patient.id);
  }

  async function loadConditions(patientId: string) {
    try {
      setConditionsLoading(true);
      setError(null);
      const result = await trpcQuery('conditions.list', {
        patient_id: patientId,
        include_resolved: false,
      });
      setConditions(result?.conditions || []);
      updateStats(result?.conditions || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load conditions');
      setConditions([]);
    } finally {
      setConditionsLoading(false);
    }
  }

  function updateStats(conditionsList: Condition[]) {
    const stats = {
      active: conditionsList.filter(c => c.clinical_status === 'active').length,
      confirmed: conditionsList.filter(c => c.verification_status === 'confirmed').length,
      provisional: conditionsList.filter(c => c.verification_status === 'provisional').length,
      resolved: conditionsList.filter(c => c.clinical_status === 'resolved').length,
    };
    setStats(stats);
  }

  async function handleCreateCondition(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedPatient || !formData.condition_name) {
      setError('Please select a patient and enter condition name');
      return;
    }

    try {
      setSubmitting(true);
      setError(null);
      const input: any = {
        patient_id: selectedPatient.id,
        condition_name: formData.condition_name,
        clinical_status: formData.clinical_status,
        verification_status: formData.verification_status,
      };
      if (formData.icd10_code) input.icd10_code = formData.icd10_code;
      if (formData.severity) input.severity = formData.severity;
      if (formData.onset_date) input.onset_date = formData.onset_date;
      if (formData.notes) input.notes = formData.notes;

      await trpcMutate('conditions.create', input);
      setShowModal(false);
      setFormData({
        condition_name: '',
        icd10_code: '',
        clinical_status: 'active',
        verification_status: 'provisional',
        severity: '',
        onset_date: '',
        notes: '',
      });
      await loadConditions(selectedPatient.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create condition');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUpdateStatus(conditionId: string, newStatus: string) {
    if (!selectedPatient) return;

    try {
      setError(null);
      await trpcMutate('conditions.update', {
        condition_id: conditionId,
        clinical_status: newStatus,
      });
      await loadConditions(selectedPatient.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update condition');
    }
  }

  async function handleDeleteCondition(conditionId: string) {
    if (!selectedPatient) return;

    try {
      setError(null);
      await trpcMutate('conditions.delete', { condition_id: conditionId });
      setDeleteConfirm(null);
      await loadConditions(selectedPatient.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete condition');
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Problem List</h1>
            <p className="text-gray-600 mt-1">Manage patient conditions and clinical problems</p>
          </div>
          <Link href="/admin" className="px-4 py-2 text-gray-700 hover:text-gray-900 flex items-center gap-2">
            ✖ Back
          </Link>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="text-sm text-gray-600 font-medium">Total Active</div>
            <div className="text-2xl font-bold text-green-600 mt-2">{stats.active}</div>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="text-sm text-gray-600 font-medium">Confirmed</div>
            <div className="text-2xl font-bold text-emerald-600 mt-2">{stats.confirmed}</div>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="text-sm text-gray-600 font-medium">Provisional</div>
            <div className="text-2xl font-bold text-amber-600 mt-2">{stats.provisional}</div>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="text-sm text-gray-600 font-medium">Resolved</div>
            <div className="text-2xl font-bold text-blue-600 mt-2">{stats.resolved}</div>
          </div>
        </div>

        {/* Patient Search */}
        <div className="bg-white rounded-lg border border-gray-200 p-6 mb-8">
          <label className="block text-sm font-semibold text-gray-900 mb-3">
            Search Patient
          </label>
          <div className="relative">
            <DebounceInput
              value={searchQuery}
              onChange={searchPatients}
              placeholder="Search by name or UHID..."
              loading={loading}
            />
            {showPatientDropdown && patients.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-300 rounded-lg shadow-lg z-10 max-h-64 overflow-y-auto">
                {patients.map(patient => (
                  <button
                    key={patient.id}
                    onClick={() => selectPatient(patient)}
                    className="w-full text-left px-4 py-3 hover:bg-blue-50 border-b border-gray-100 last:border-b-0 transition"
                  >
                    <div className="font-medium text-gray-900">{patient.name_full}</div>
                    <div className="text-sm text-gray-600">{patient.uhid} • {patient.phone}</div>
                  </button>
                ))}
              </div>
            )}
            {showPatientDropdown && loading && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-300 rounded-lg shadow-lg z-10 p-4 text-center text-gray-600">
                Searching...
              </div>
            )}
          </div>
          {selectedPatient && (
            <div className="mt-4 p-4 bg-blue-50 rounded-lg border border-blue-200">
              <div className="flex justify-between items-start">
                <div>
                  <div className="font-semibold text-gray-900">{selectedPatient.name_full}</div>
                  <div className="text-sm text-gray-600">UHID: {selectedPatient.uhid}</div>
                  <div className="text-sm text-gray-600">DOB: {formatIndianDate(selectedPatient.dob)} • {selectedPatient.gender}</div>
                </div>
                <button
                  onClick={() => {
                    setSelectedPatient(null);
                    setSearchQuery('');
                    setConditions([]);
                  }}
                  className="text-sm text-blue-600 hover:text-blue-800 font-medium"
                >
                  ✕ Clear
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Error Message */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg mb-6">
            {error}
          </div>
        )}

        {/* Conditions List */}
        {selectedPatient && (
          <div className="space-y-6">
            <div className="flex justify-between items-center">
              <h2 className="text-xl font-bold text-gray-900">
                Active Conditions ({conditions.length})
              </h2>
              <button
                onClick={() => setShowModal(true)}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition flex items-center gap-2 font-medium"
              >
                + Add Condition
              </button>
            </div>

            {conditionsLoading ? (
              <div className="text-center py-12">
                <div className="w-8 h-8 border-4 border-blue-300 border-t-blue-600 rounded-full animate-spin mx-auto"></div>
              </div>
            ) : conditions.length === 0 ? (
              <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
                <div className="text-gray-600">No active conditions recorded</div>
              </div>
            ) : (
              <div className="space-y-4">
                {conditions.map(condition => (
                  <div
                    key={condition.id}
                    className="bg-white rounded-lg border border-gray-200 p-6 hover:shadow-lg transition"
                  >
                    <div className="flex justify-between items-start gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-3">
                          <h3 className="text-lg font-semibold text-gray-900">
                            {condition.condition_name}
                          </h3>
                          {condition.icd10_code && (
                            <span className="text-xs bg-gray-100 text-gray-700 px-2 py-1 rounded font-mono">
                              {condition.icd10_code}
                            </span>
                          )}
                        </div>

                        <div className="flex flex-wrap gap-2 mb-4">
                          <span className={`text-xs font-semibold px-3 py-1 rounded-full border ${getStatusColor(condition.clinical_status)}`}>
                            {condition.clinical_status.charAt(0).toUpperCase() + condition.clinical_status.slice(1)}
                          </span>
                          <span className={`text-xs font-semibold px-3 py-1 rounded-full ${getVerificationColor(condition.verification_status)}`}>
                            {condition.verification_status.charAt(0).toUpperCase() + condition.verification_status.slice(1)}
                          </span>
                          {condition.severity && (
                            <span className={`text-xs font-semibold px-3 py-1 rounded-full ${getSeverityColor(condition.severity)}`}>
                              {condition.severity.charAt(0).toUpperCase() + condition.severity.slice(1)}
                            </span>
                          )}
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                          <div>
                            <div className="text-gray-600">Onset Date</div>
                            <div className="font-medium text-gray-900">{formatIndianDate(condition.onset_date)}</div>
                          </div>
                          <div>
                            <div className="text-gray-600">Recorded By</div>
                            <div className="font-medium text-gray-900">{condition.recorded_by}</div>
                          </div>
                          <div>
                            <div className="text-gray-600">Version</div>
                            <div className="font-medium text-gray-900">{condition.version}</div>
                          </div>
                          <div>
                            <div className="text-gray-600">Created</div>
                            <div className="font-medium text-gray-900">
                              {formatIndianDate(condition.created_at)}
                            </div>
                          </div>
                        </div>

                        {condition.notes && (
                          <div className="mt-4 p-3 bg-gray-50 rounded border border-gray-200">
                            <div className="text-xs text-gray-600 mb-1">Notes</div>
                            <div className="text-sm text-gray-900">{condition.notes}</div>
                          </div>
                        )}
                      </div>

                      <div className="flex flex-col gap-2">
                        <select
                          value={condition.clinical_status}
                          onChange={e => handleUpdateStatus(condition.id, e.target.value)}
                          className="px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium cursor-pointer hover:border-blue-400 transition"
                        >
                          <option value="active">Active</option>
                          <option value="inactive">Inactive</option>
                          <option value="resolved">Resolved</option>
                          <option value="remission">Remission</option>
                        </select>

                        <button
                          onClick={() => setDeleteConfirm(condition.id)}
                          className="px-3 py-2 text-red-600 hover:bg-red-50 rounded-lg text-sm font-medium transition border border-transparent hover:border-red-200"
                        >
                          🗑 Delete
                        </button>
                      </div>
                    </div>

                    {deleteConfirm === condition.id && (
                      <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg flex justify-between items-center">
                        <div className="text-sm text-red-800 font-medium">
                          Delete this condition? This action cannot be undone.
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => setDeleteConfirm(null)}
                            className="px-3 py-1 text-sm border border-red-200 text-red-600 rounded hover:bg-red-50 transition"
                          >
                            ✖ Cancel
                          </button>
                          <button
                            onClick={() => handleDeleteCondition(condition.id)}
                            className="px-3 py-1 text-sm bg-red-600 text-white rounded hover:bg-red-700 transition"
                          >
                            ✔ Confirm
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Add Condition Modal */}
        {showModal && selectedPatient && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
              <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex justify-between items-center">
                <h2 className="text-xl font-bold text-gray-900">Add Condition</h2>
                <button
                  onClick={() => setShowModal(false)}
                  className="text-gray-600 hover:text-gray-900 text-2xl"
                >
                  ✖
                </button>
              </div>

              <form onSubmit={handleCreateCondition} className="p-6 space-y-6">
                <div>
                  <label className="block text-sm font-semibold text-gray-900 mb-2">
                    Condition Name *
                  </label>
                  <input
                    type="text"
                    value={formData.condition_name}
                    onChange={e => setFormData({ ...formData, condition_name: e.target.value })}
                    placeholder="e.g., Type 2 Diabetes Mellitus"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-900 mb-2">
                    ICD-10 Code (Optional)
                  </label>
                  <input
                    type="text"
                    value={formData.icd10_code}
                    onChange={e => setFormData({ ...formData, icd10_code: e.target.value })}
                    placeholder="e.g., E11.9"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-semibold text-gray-900 mb-2">
                      Clinical Status *
                    </label>
                    <select
                      value={formData.clinical_status}
                      onChange={e => setFormData({ ...formData, clinical_status: e.target.value as any })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                      <option value="resolved">Resolved</option>
                      <option value="remission">Remission</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-gray-900 mb-2">
                      Verification Status *
                    </label>
                    <select
                      value={formData.verification_status}
                      onChange={e => setFormData({ ...formData, verification_status: e.target.value as any })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="unconfirmed">Unconfirmed</option>
                      <option value="provisional">Provisional</option>
                      <option value="differential">Differential</option>
                      <option value="confirmed">Confirmed</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-semibold text-gray-900 mb-2">
                      Severity (Optional)
                    </label>
                    <select
                      value={formData.severity}
                      onChange={e => setFormData({ ...formData, severity: e.target.value as any })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">Not Specified</option>
                      <option value="mild">Mild</option>
                      <option value="moderate">Moderate</option>
                      <option value="severe">Severe</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-gray-900 mb-2">
                      Onset Date (Optional)
                    </label>
                    <input
                      type="date"
                      value={formData.onset_date}
                      onChange={e => setFormData({ ...formData, onset_date: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-900 mb-2">
                    Notes (Optional)
                  </label>
                  <textarea
                    value={formData.notes}
                    onChange={e => setFormData({ ...formData, notes: e.target.value })}
                    placeholder="Clinical notes and observations..."
                    rows={4}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  />
                </div>

                <div className="flex gap-3 pt-4 border-t border-gray-200">
                  <button
                    type="button"
                    onClick={() => setShowModal(false)}
                    className="flex-1 px-4 py-2 border border-gray-300 text-gray-900 rounded-lg hover:bg-gray-50 transition font-medium"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-medium disabled:bg-blue-400"
                  >
                    {submitting ? 'Creating...' : 'Create Condition'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
