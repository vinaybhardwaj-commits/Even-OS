'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

type Allergy = {
  id: string;
  patient_id: string;
  substance: string;
  reaction: string | null;
  severity: 'mild' | 'moderate' | 'severe' | 'life_threatening';
  category: 'medication' | 'food' | 'environment' | 'biologic';
  criticality: 'low' | 'high' | 'unable_to_assess';
  onset_date: string | null;
  allergy_verification_status: 'unconfirmed' | 'confirmed' | 'refuted' | 'entered_in_error';
  notes: string | null;
  created_at: string;
  updated_at: string;
};

type Patient = {
  id: string;
  uhid: string;
  name_full: string;
  phone: string | null;
};

type AllergyStats = {
  life_threatening: number;
  severe: number;
  moderate: number;
  mild: number;
};

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

const SEVERITY_COLORS = {
  life_threatening: { bg: 'bg-red-100', text: 'text-red-800', label: 'Life-threatening' },
  severe: { bg: 'bg-orange-100', text: 'text-orange-800', label: 'Severe' },
  moderate: { bg: 'bg-yellow-100', text: 'text-yellow-800', label: 'Moderate' },
  mild: { bg: 'bg-green-100', text: 'text-green-800', label: 'Mild' },
};

const CATEGORY_COLORS: Record<string, string> = {
  medication: 'bg-blue-100 text-blue-800',
  food: 'bg-purple-100 text-purple-800',
  environment: 'bg-cyan-100 text-cyan-800',
  biologic: 'bg-indigo-100 text-indigo-800',
};

export default function AllergiesClient() {
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [patientSearch, setPatientSearch] = useState('');
  const [patientSuggestions, setPatientSuggestions] = useState<Patient[]>([]);
  const [showPatientDropdown, setShowPatientDropdown] = useState(false);
  const [allergies, setAllergies] = useState<Allergy[]>([]);
  const [allergyStats, setAllergyStats] = useState<AllergyStats>({
    life_threatening: 0,
    severe: 0,
    moderate: 0,
    mild: 0,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [conflictCheck, setConflictCheck] = useState('');
  const [conflictResult, setConflictResult] = useState<any>(null);
  const [showConflictAlert, setShowConflictAlert] = useState(false);
  const patientSearchTimeout = useRef<NodeJS.Timeout>();

  const emptyForm = {
    substance: '',
    reaction: '',
    severity: 'moderate' as const,
    category: 'medication' as const,
    criticality: 'low' as const,
    onset_date: '',
    notes: '',
  };
  const [form, setForm] = useState(emptyForm);

  // Search patients
  const handlePatientSearch = (val: string) => {
    setPatientSearch(val);
    if (patientSearchTimeout.current) clearTimeout(patientSearchTimeout.current);

    if (!val.trim()) {
      setPatientSuggestions([]);
      setShowPatientDropdown(false);
      return;
    }

    patientSearchTimeout.current = setTimeout(async () => {
      try {
        const result = await trpcQuery('patient.list', {
          page: 1,
          pageSize: 10,
          search: val,
        });
        setPatientSuggestions(result.items || []);
        setShowPatientDropdown(true);
      } catch (err: any) {
        setError(err.message);
      }
    }, 300);
  };

  const selectPatient = async (patient: Patient) => {
    setSelectedPatient(patient);
    setPatientSearch(`${patient.name_full} (${patient.uhid})`);
    setShowPatientDropdown(false);
    await fetchAllergies(patient.id);
  };

  // Fetch allergies for selected patient
  const fetchAllergies = useCallback(async (patientId: string) => {
    setLoading(true);
    setError('');
    try {
      const result = await trpcQuery('allergies.list', { patient_id: patientId });
      setAllergies(result.allergies || []);

      // Calculate stats
      const stats: AllergyStats = {
        life_threatening: 0,
        severe: 0,
        moderate: 0,
        mild: 0,
      };
      (result.allergies || []).forEach((allergy: Allergy) => {
        stats[allergy.severity]++;
      });
      setAllergyStats(stats);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Add allergy
  const handleAddAllergy = async () => {
    setError('');
    setSuccess('');

    if (!selectedPatient) {
      setError('Please select a patient first');
      return;
    }

    if (!form.substance.trim()) {
      setError('Substance name is required');
      return;
    }

    try {
      const payload: any = {
        patient_id: selectedPatient.id,
        substance: form.substance,
        severity: form.severity,
        category: form.category,
        criticality: form.criticality,
      };

      if (form.reaction) payload.reaction = form.reaction;
      if (form.onset_date) payload.onset_date = new Date(form.onset_date).toISOString();
      if (form.notes) payload.notes = form.notes;

      await trpcMutate('allergies.create', payload);
      setSuccess('Allergy added successfully');
      setForm(emptyForm);
      setShowAddForm(false);
      await fetchAllergies(selectedPatient.id);
    } catch (err: any) {
      setError(err.message);
    }
  };

  // Delete allergy
  const handleDeleteAllergy = async (allergyId: string) => {
    if (!confirm('Are you sure you want to delete this allergy?')) return;

    setError('');
    try {
      await trpcMutate('allergies.delete', { allergy_id: allergyId });
      setSuccess('Allergy deleted successfully');
      if (selectedPatient) {
        await fetchAllergies(selectedPatient.id);
      }
    } catch (err: any) {
      setError(err.message);
    }
  };

  // Check conflict
  const handleCheckConflict = async () => {
    if (!selectedPatient || !conflictCheck.trim()) {
      setError('Please select a patient and enter a substance name');
      return;
    }

    setError('');
    try {
      const result = await trpcQuery('allergies.checkConflict', {
        patient_id: selectedPatient.id,
        substance: conflictCheck,
      });

      if (result.has_conflict) {
        setConflictResult(result.conflicts);
        setShowConflictAlert(true);
      } else {
        setSuccess('No conflicts found');
        setConflictResult(null);
        setShowConflictAlert(false);
      }
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900">Allergies Management</h1>
          <p className="text-gray-600 mt-2">Manage patient allergies and intolerances</p>
        </div>

        {/* Error/Success Messages */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-red-800">❌ {error}</p>
          </div>
        )}
        {success && (
          <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg">
            <p className="text-green-800">✔ {success}</p>
          </div>
        )}

        {/* Patient Selector */}
        <div className="mb-8 bg-white p-6 rounded-lg shadow">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Select Patient</h2>
          <div className="relative">
            <input
              type="text"
              placeholder="Search patient by name or UHID..."
              value={patientSearch}
              onChange={(e) => handlePatientSearch(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <span className="absolute right-3 top-2.5 text-gray-400">🔍</span>

            {/* Dropdown */}
            {showPatientDropdown && patientSuggestions.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-300 rounded-lg shadow-lg z-10">
                {patientSuggestions.map((patient) => (
                  <button
                    key={patient.id}
                    onClick={() => selectPatient(patient)}
                    className="w-full text-left px-4 py-3 hover:bg-blue-50 border-b border-gray-100 last:border-b-0"
                  >
                    <div className="font-semibold text-gray-900">{patient.name_full}</div>
                    <div className="text-sm text-gray-500">UHID: {patient.uhid}</div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {selectedPatient && (
            <div className="mt-4 p-4 bg-blue-50 rounded-lg border border-blue-200">
              <p className="text-sm text-gray-600">Selected Patient:</p>
              <p className="font-semibold text-gray-900">{selectedPatient.name_full}</p>
              <p className="text-sm text-gray-600">UHID: {selectedPatient.uhid}</p>
            </div>
          )}
        </div>

        {/* Allergy Stats Cards */}
        {selectedPatient && (
          <div className="mb-8 grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className={`p-4 rounded-lg border-2 ${SEVERITY_COLORS.life_threatening.bg}`}>
              <p className="text-sm font-medium text-gray-700">Life-threatening</p>
              <p className={`text-3xl font-bold ${SEVERITY_COLORS.life_threatening.text}`}>
                {allergyStats.life_threatening}
              </p>
            </div>
            <div className={`p-4 rounded-lg border-2 ${SEVERITY_COLORS.severe.bg}`}>
              <p className="text-sm font-medium text-gray-700">Severe</p>
              <p className={`text-3xl font-bold ${SEVERITY_COLORS.severe.text}`}>
                {allergyStats.severe}
              </p>
            </div>
            <div className={`p-4 rounded-lg border-2 ${SEVERITY_COLORS.moderate.bg}`}>
              <p className="text-sm font-medium text-gray-700">Moderate</p>
              <p className={`text-3xl font-bold ${SEVERITY_COLORS.moderate.text}`}>
                {allergyStats.moderate}
              </p>
            </div>
            <div className={`p-4 rounded-lg border-2 ${SEVERITY_COLORS.mild.bg}`}>
              <p className="text-sm font-medium text-gray-700">Mild</p>
              <p className={`text-3xl font-bold ${SEVERITY_COLORS.mild.text}`}>
                {allergyStats.mild}
              </p>
            </div>
          </div>
        )}

        {/* Conflict Checker */}
        {selectedPatient && (
          <div className="mb-8 bg-white p-6 rounded-lg shadow">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Check Drug Conflict</h2>
            <div className="flex gap-3">
              <input
                type="text"
                placeholder="Enter drug/substance name..."
                value={conflictCheck}
                onChange={(e) => setConflictCheck(e.target.value)}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                onClick={handleCheckConflict}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
              >
                Check
              </button>
            </div>

            {/* Conflict Alert */}
            {showConflictAlert && conflictResult && conflictResult.length > 0 && (
              <div className="mt-4 p-4 bg-red-50 border-2 border-red-300 rounded-lg">
                <p className="font-semibold text-red-900 mb-3">⚠ Allergy Conflict Found!</p>
                {conflictResult.map((conflict: any, idx: number) => (
                  <div key={idx} className="mb-2 pb-2 border-b border-red-200 last:border-b-0">
                    <p className="font-semibold text-red-900">{conflict.substance}</p>
                    <p className="text-sm text-red-800">Reaction: {conflict.reaction || 'Not specified'}</p>
                    <p className="text-sm text-red-800">
                      Severity: <span className="font-medium">{(SEVERITY_COLORS as any)[conflict.severity]?.label || conflict.severity}</span>
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Add Allergy Form Modal */}
        {showAddForm && selectedPatient && (
          <div className="mb-8 bg-white p-6 rounded-lg shadow border-2 border-blue-200">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Add New Allergy</h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Substance <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={form.substance}
                  onChange={(e) => setForm({ ...form, substance: e.target.value })}
                  placeholder="e.g., Penicillin, Peanuts"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Reaction</label>
                <input
                  type="text"
                  value={form.reaction}
                  onChange={(e) => setForm({ ...form, reaction: e.target.value })}
                  placeholder="e.g., Rash, Anaphylaxis"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Severity</label>
                <select
                  value={form.severity}
                  onChange={(e) => setForm({ ...form, severity: e.target.value as any })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="mild">Mild</option>
                  <option value="moderate">Moderate</option>
                  <option value="severe">Severe</option>
                  <option value="life_threatening">Life-threatening</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Category</label>
                <select
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value as any })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="medication">Medication</option>
                  <option value="food">Food</option>
                  <option value="environment">Environment</option>
                  <option value="biologic">Biologic</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Criticality</label>
                <select
                  value={form.criticality}
                  onChange={(e) => setForm({ ...form, criticality: e.target.value as any })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="low">Low</option>
                  <option value="high">High</option>
                  <option value="unable_to_assess">Unable to assess</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Onset Date</label>
                <input
                  type="date"
                  value={form.onset_date}
                  onChange={(e) => setForm({ ...form, onset_date: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">Notes</label>
              <textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Additional notes..."
                rows={3}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleAddAllergy}
                className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium"
              >
                ✔ Save Allergy
              </button>
              <button
                onClick={() => {
                  setShowAddForm(false);
                  setForm(emptyForm);
                }}
                className="px-6 py-2 bg-gray-400 text-white rounded-lg hover:bg-gray-500 font-medium"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Add Allergy Button */}
        {selectedPatient && !showAddForm && (
          <div className="mb-8">
            <button
              onClick={() => setShowAddForm(true)}
              className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-semibold text-lg"
            >
              + Add Allergy
            </button>
          </div>
        )}

        {/* Allergies List */}
        {selectedPatient && (
          <div className="bg-white rounded-lg shadow">
            <div className="p-6 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">
                Allergies ({allergies.length})
              </h2>
            </div>

            {loading ? (
              <div className="p-6 text-center text-gray-600">Loading allergies...</div>
            ) : allergies.length === 0 ? (
              <div className="p-6 text-center text-gray-600">No allergies recorded</div>
            ) : (
              <div className="divide-y divide-gray-200">
                {allergies.map((allergy) => (
                  <div key={allergy.id} className="p-6 hover:bg-gray-50">
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <p className="text-lg font-bold text-gray-900">{allergy.substance}</p>
                        {allergy.reaction && (
                          <p className="text-sm text-gray-600 mt-1">Reaction: {allergy.reaction}</p>
                        )}
                      </div>
                      <button
                        onClick={() => handleDeleteAllergy(allergy.id)}
                        className="p-2 text-red-600 hover:bg-red-50 rounded-lg"
                        title="Delete allergy"
                      >
                        🗑
                      </button>
                    </div>

                    <div className="flex flex-wrap gap-2 mb-3">
                      <span className={`px-3 py-1 rounded-full text-sm font-medium ${SEVERITY_COLORS[allergy.severity].bg} ${SEVERITY_COLORS[allergy.severity].text}`}>
                        {SEVERITY_COLORS[allergy.severity].label}
                      </span>
                      <span className={`px-3 py-1 rounded-full text-sm font-medium ${CATEGORY_COLORS[allergy.category]}`}>
                        {allergy.category.charAt(0).toUpperCase() + allergy.category.slice(1)}
                      </span>
                      <span className="px-3 py-1 rounded-full text-sm font-medium bg-gray-100 text-gray-800">
                        Criticality: {allergy.criticality.replace('_', ' ').charAt(0).toUpperCase() + allergy.criticality.replace('_', ' ').slice(1)}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                      {allergy.onset_date && (
                        <div>
                          <span className="text-gray-600">Onset Date:</span>
                          <p className="text-gray-900 font-medium">{new Date(allergy.onset_date).toLocaleDateString()}</p>
                        </div>
                      )}
                      <div>
                        <span className="text-gray-600">Verification Status:</span>
                        <p className="text-gray-900 font-medium">{allergy.allergy_verification_status.replace('_', ' ').charAt(0).toUpperCase() + allergy.allergy_verification_status.replace('_', ' ').slice(1)}</p>
                      </div>
                      {allergy.notes && (
                        <div className="md:col-span-2">
                          <span className="text-gray-600">Notes:</span>
                          <p className="text-gray-900">{allergy.notes}</p>
                        </div>
                      )}
                    </div>

                    <div className="mt-3 pt-3 border-t border-gray-200 text-xs text-gray-500">
                      Created: {new Date(allergy.created_at).toLocaleDateString()} | Updated: {new Date(allergy.updated_at).toLocaleDateString()}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
