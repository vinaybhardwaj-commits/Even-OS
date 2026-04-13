'use client';

import { useState, useEffect, useCallback } from 'react';

// ─── Types ───────────────────────────────────────────────
interface AdmissionStats {
  active: number;
  emergency: number;
  elective: number;
  pre_auth_overrides: number;
  discharged_today: number;
  admitted_today: number;
}

interface ActiveAdmission {
  encounter_id: string;
  encounter_class: string;
  admission_type: string;
  chief_complaint: string;
  admission_at: string;
  expected_los_days: number | null;
  pre_auth_status: string;
  patient_id: string;
  uhid: string;
  patient_name: string;
  phone: string;
  gender: string;
  patient_category: string;
  bed_code: string;
  bed_name: string;
  ward_code: string;
  ward_name: string;
}

interface AvailableBed {
  id: string;
  code: string;
  name: string;
  bed_status: string;
  ward_code: string;
  ward_name: string;
}

interface PatientSearchResult {
  id: string;
  uhid: string;
  name_full: string;
  phone: string;
  gender: string;
  dob: string | null;
  blood_group: string | null;
  patient_category: string;
}

interface ChecklistItem {
  key: string;
  label: string;
  mandatory: boolean;
  insuredOnly?: boolean;
  checked: boolean;
}

// ─── tRPC helper ─────────────────────────────────────────
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

// ─── Default checklist items ─────────────────────────────
const DEFAULT_CHECKLIST: ChecklistItem[] = [
  { key: 'identity_docs', label: 'Identity documents collected', mandatory: true, checked: false },
  { key: 'insurance_verified', label: 'Insurance status verified', mandatory: true, checked: false },
  { key: 'pre_auth_obtained', label: 'Pre-authorization obtained', mandatory: true, insuredOnly: true, checked: false },
  { key: 'consent_signed', label: 'General consent signed', mandatory: true, checked: false },
  { key: 'emergency_contact', label: 'Emergency contact confirmed', mandatory: true, checked: false },
  { key: 'allergies_reviewed', label: 'Allergies reviewed', mandatory: false, checked: false },
  { key: 'medications_reviewed', label: 'Current medications reviewed', mandatory: false, checked: false },
];

// ─── Main Component ──────────────────────────────────────
export default function AdmissionsClient() {
  // List state
  const [stats, setStats] = useState<AdmissionStats | null>(null);
  const [admissions, setAdmissions] = useState<ActiveAdmission[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [wardFilter, setWardFilter] = useState('');
  const [loading, setLoading] = useState(true);

  // Wizard state
  const [showWizard, setShowWizard] = useState(false);
  const [wizardStep, setWizardStep] = useState(1); // 1=Patient+Checklist, 2=Clinical, 3=Financial, 4=Bed+Confirm
  const [submitting, setSubmitting] = useState(false);
  const [wizardError, setWizardError] = useState('');

  // Patient search
  const [patientSearch, setPatientSearch] = useState('');
  const [patientResults, setPatientResults] = useState<PatientSearchResult[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<PatientSearchResult | null>(null);
  const [searchingPatient, setSearchingPatient] = useState(false);

  // Checklist
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);

  // Clinical (Step 2)
  const [encounterClass, setEncounterClass] = useState<string>('IMP');
  const [admissionType, setAdmissionType] = useState<string>('elective');
  const [chiefComplaint, setChiefComplaint] = useState('');
  const [preliminaryDiagnosis, setPreliminaryDiagnosis] = useState('');
  const [clinicalNotes, setClinicalNotes] = useState('');
  const [dietType, setDietType] = useState('');
  const [expectedLosDays, setExpectedLosDays] = useState('');

  // Financial (Step 3)
  const [preAuthStatus, setPreAuthStatus] = useState<string>('not_required');
  const [preAuthNumber, setPreAuthNumber] = useState('');
  const [preAuthOverrideReason, setPreAuthOverrideReason] = useState('');

  // Bed (Step 4)
  const [availableBeds, setAvailableBeds] = useState<AvailableBed[]>([]);
  const [selectedBedId, setSelectedBedId] = useState('');
  const [bedWardFilter, setBedWardFilter] = useState('');
  const [loadingBeds, setLoadingBeds] = useState(false);

  // ─── Fetch list data ────────────────────────────────────
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [statsData, listData] = await Promise.all([
        trpcQuery('encounter.stats'),
        trpcQuery('encounter.listActive', { page, pageSize: 25, ...(wardFilter ? { ward_code: wardFilter } : {}) }),
      ]);
      setStats(statsData);
      setAdmissions(listData.items);
      setTotal(listData.total);
    } catch {
      // silently handle
    } finally {
      setLoading(false);
    }
  }, [page, wardFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ─── Patient search ─────────────────────────────────────
  const searchPatients = async () => {
    if (patientSearch.length < 2) return;
    setSearchingPatient(true);
    try {
      const data = await trpcQuery('patient.list', { search: patientSearch, page: 1, pageSize: 10 });
      setPatientResults(data.items || []);
    } catch {
      setPatientResults([]);
    } finally {
      setSearchingPatient(false);
    }
  };

  const selectPatient = (p: PatientSearchResult) => {
    setSelectedPatient(p);
    setPatientResults([]);
    setPatientSearch('');
    // Build checklist based on patient category
    const isInsured = p.patient_category === 'insured';
    setChecklist(
      DEFAULT_CHECKLIST
        .filter(item => !item.insuredOnly || isInsured)
        .map(item => ({ ...item, checked: false }))
    );
    // Default pre-auth for insured
    if (isInsured) {
      setPreAuthStatus('obtained');
    } else {
      setPreAuthStatus('not_required');
    }
  };

  // ─── Fetch beds ─────────────────────────────────────────
  const fetchBeds = async () => {
    setLoadingBeds(true);
    try {
      const data = await trpcQuery('encounter.availableBeds', bedWardFilter ? { ward_code: bedWardFilter } : {});
      setAvailableBeds(data || []);
    } catch {
      setAvailableBeds([]);
    } finally {
      setLoadingBeds(false);
    }
  };

  useEffect(() => {
    if (wizardStep === 4) fetchBeds();
  }, [wizardStep, bedWardFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Wizard validation ──────────────────────────────────
  const canProceedStep1 = () => {
    if (!selectedPatient) return false;
    const mandatoryUnchecked = checklist.filter(c => c.mandatory && !c.checked);
    return mandatoryUnchecked.length === 0;
  };

  const canProceedStep2 = () => {
    return chiefComplaint.trim().length > 0;
  };

  const canProceedStep3 = () => {
    if (!selectedPatient) return false;
    if (selectedPatient.patient_category === 'insured') {
      if (preAuthStatus === 'not_required') return false;
      if (preAuthStatus === 'obtained' && !preAuthNumber.trim()) return false;
      if (preAuthStatus === 'override' && !preAuthOverrideReason.trim()) return false;
    }
    return true;
  };

  const canSubmit = () => {
    return selectedBedId !== '';
  };

  // ─── Submit admission ───────────────────────────────────
  const handleSubmit = async () => {
    if (!selectedPatient || !selectedBedId) return;
    setSubmitting(true);
    setWizardError('');
    try {
      await trpcMutate('encounter.admit', {
        patient_id: selectedPatient.id,
        encounter_class: encounterClass,
        admission_type: admissionType,
        chief_complaint: chiefComplaint.trim(),
        preliminary_diagnosis: preliminaryDiagnosis.trim() || undefined,
        clinical_notes: clinicalNotes.trim() || undefined,
        diet_type: dietType.trim() || undefined,
        expected_los_days: expectedLosDays ? parseInt(expectedLosDays) : undefined,
        bed_id: selectedBedId,
        pre_auth_status: preAuthStatus,
        pre_auth_number: preAuthNumber.trim() || undefined,
        pre_auth_override_reason: preAuthOverrideReason.trim() || undefined,
      });
      // Success — close wizard, refresh list
      resetWizard();
      fetchData();
    } catch (err: unknown) {
      setWizardError(err instanceof Error ? err.message : 'Admission failed');
    } finally {
      setSubmitting(false);
    }
  };

  const resetWizard = () => {
    setShowWizard(false);
    setWizardStep(1);
    setSelectedPatient(null);
    setPatientSearch('');
    setPatientResults([]);
    setChecklist([]);
    setEncounterClass('IMP');
    setAdmissionType('elective');
    setChiefComplaint('');
    setPreliminaryDiagnosis('');
    setClinicalNotes('');
    setDietType('');
    setExpectedLosDays('');
    setPreAuthStatus('not_required');
    setPreAuthNumber('');
    setPreAuthOverrideReason('');
    setSelectedBedId('');
    setBedWardFilter('');
    setWizardError('');
  };

  // ─── Helpers ────────────────────────────────────────────
  const formatDate = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const admissionTypeBadge = (t: string) => {
    const colors: Record<string, string> = { emergency: 'bg-red-100 text-red-800', elective: 'bg-blue-100 text-blue-800', day_care: 'bg-green-100 text-green-800' };
    return colors[t] || 'bg-gray-100 text-gray-800';
  };
  const preAuthBadge = (s: string) => {
    const colors: Record<string, string> = { not_required: 'bg-gray-100 text-gray-600', obtained: 'bg-green-100 text-green-800', override: 'bg-orange-100 text-orange-800' };
    return colors[s] || 'bg-gray-100 text-gray-800';
  };

  const totalPages = Math.ceil(total / 25);

  // ─── RENDER ─────────────────────────────────────────────
  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Admissions</h1>
          <p className="text-sm text-gray-500 mt-1">Manage inpatient admissions, transfers &amp; discharges</p>
        </div>
        <button
          onClick={() => setShowWizard(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium text-sm"
        >
          + New Admission
        </button>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <p className="text-xs text-gray-500 font-medium uppercase">Active</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">{stats.active}</p>
          </div>
          <div className="bg-white rounded-lg border border-red-200 p-4">
            <p className="text-xs text-red-600 font-medium uppercase">Emergency</p>
            <p className="text-2xl font-bold text-red-700 mt-1">{stats.emergency}</p>
          </div>
          <div className="bg-white rounded-lg border border-blue-200 p-4">
            <p className="text-xs text-blue-600 font-medium uppercase">Elective</p>
            <p className="text-2xl font-bold text-blue-700 mt-1">{stats.elective}</p>
          </div>
          <div className="bg-white rounded-lg border border-orange-200 p-4">
            <p className="text-xs text-orange-600 font-medium uppercase">Pre-Auth Overrides</p>
            <p className="text-2xl font-bold text-orange-700 mt-1">{stats.pre_auth_overrides}</p>
          </div>
          <div className="bg-white rounded-lg border border-green-200 p-4">
            <p className="text-xs text-green-600 font-medium uppercase">Admitted Today</p>
            <p className="text-2xl font-bold text-green-700 mt-1">{stats.admitted_today}</p>
          </div>
          <div className="bg-white rounded-lg border border-purple-200 p-4">
            <p className="text-xs text-purple-600 font-medium uppercase">Discharged Today</p>
            <p className="text-2xl font-bold text-purple-700 mt-1">{stats.discharged_today}</p>
          </div>
        </div>
      )}

      {/* Active Admissions Table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-800">Active Admissions</h2>
          <input
            type="text"
            placeholder="Filter by ward code..."
            value={wardFilter}
            onChange={e => { setWardFilter(e.target.value); setPage(1); }}
            className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm w-48 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {loading ? (
          <div className="p-12 text-center text-gray-400">Loading...</div>
        ) : admissions.length === 0 ? (
          <div className="p-12 text-center text-gray-400">No active admissions</div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    <th className="px-6 py-3">Patient</th>
                    <th className="px-6 py-3">UHID</th>
                    <th className="px-6 py-3">Bed</th>
                    <th className="px-6 py-3">Ward</th>
                    <th className="px-6 py-3">Type</th>
                    <th className="px-6 py-3">Chief Complaint</th>
                    <th className="px-6 py-3">Pre-Auth</th>
                    <th className="px-6 py-3">Admitted</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {admissions.map((a) => (
                    <tr key={a.encounter_id} className="hover:bg-gray-50">
                      <td className="px-6 py-3 font-medium text-gray-900">{a.patient_name}</td>
                      <td className="px-6 py-3 text-gray-600 font-mono text-xs">{a.uhid}</td>
                      <td className="px-6 py-3 text-gray-600">{a.bed_code || '—'}</td>
                      <td className="px-6 py-3 text-gray-600">{a.ward_name || '—'}</td>
                      <td className="px-6 py-3">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${admissionTypeBadge(a.admission_type)}`}>
                          {a.admission_type.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="px-6 py-3 text-gray-600 max-w-[200px] truncate">{a.chief_complaint}</td>
                      <td className="px-6 py-3">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${preAuthBadge(a.pre_auth_status)}`}>
                          {a.pre_auth_status.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="px-6 py-3 text-gray-500 text-xs">{formatDate(a.admission_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Pagination */}
            {totalPages > 1 && (
              <div className="px-6 py-3 border-t border-gray-200 flex items-center justify-between text-sm text-gray-600">
                <span>{total} admission{total !== 1 ? 's' : ''}</span>
                <div className="flex gap-2">
                  <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="px-3 py-1 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-40">← Prev</button>
                  <span className="px-3 py-1">Page {page} of {totalPages}</span>
                  <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="px-3 py-1 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-40">Next →</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ─── ADMISSION WIZARD MODAL ──────────────────────── */}
      {showWizard && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
            {/* Wizard Header */}
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between sticky top-0 bg-white rounded-t-2xl z-10">
              <div>
                <h2 className="text-lg font-bold text-gray-900">New Admission</h2>
                <p className="text-xs text-gray-500 mt-0.5">Step {wizardStep} of 4</p>
              </div>
              <button onClick={resetWizard} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>

            {/* Step indicators */}
            <div className="px-6 py-3 border-b border-gray-100 flex gap-2">
              {['Patient & Checklist', 'Clinical', 'Financial', 'Bed & Confirm'].map((label, i) => (
                <div key={label} className={`flex-1 text-center text-xs font-medium py-1.5 rounded-full ${
                  wizardStep === i + 1 ? 'bg-blue-600 text-white' :
                  wizardStep > i + 1 ? 'bg-green-100 text-green-700' :
                  'bg-gray-100 text-gray-400'
                }`}>
                  {wizardStep > i + 1 ? '✓ ' : ''}{label}
                </div>
              ))}
            </div>

            <div className="px-6 py-5">
              {wizardError && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{wizardError}</div>
              )}

              {/* ─── STEP 1: Patient Selection + Checklist ─── */}
              {wizardStep === 1 && (
                <div>
                  <h3 className="text-sm font-semibold text-gray-700 mb-3">Select Patient</h3>
                  {!selectedPatient ? (
                    <div>
                      <div className="flex gap-2 mb-3">
                        <input
                          type="text"
                          placeholder="Search by UHID, name, or phone..."
                          value={patientSearch}
                          onChange={e => setPatientSearch(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && searchPatients()}
                          className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <button onClick={searchPatients} disabled={searchingPatient || patientSearch.length < 2} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200 disabled:opacity-40">
                          {searchingPatient ? 'Searching...' : 'Search'}
                        </button>
                      </div>
                      {patientResults.length > 0 && (
                        <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-60 overflow-y-auto">
                          {patientResults.map(p => (
                            <button
                              key={p.id}
                              onClick={() => selectPatient(p)}
                              className="w-full text-left px-4 py-3 hover:bg-blue-50 transition-colors"
                            >
                              <div className="flex items-center justify-between">
                                <div>
                                  <span className="font-medium text-gray-900 text-sm">{p.name_full}</span>
                                  <span className="ml-2 text-xs text-gray-500 font-mono">{p.uhid}</span>
                                </div>
                                <span className={`text-xs px-2 py-0.5 rounded-full ${p.patient_category === 'insured' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
                                  {p.patient_category}
                                </span>
                              </div>
                              <p className="text-xs text-gray-500 mt-0.5">{p.phone} &middot; {p.gender}{p.dob ? ` · DOB: ${p.dob}` : ''}</p>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="mb-5 p-4 bg-blue-50 border border-blue-200 rounded-lg flex items-center justify-between">
                      <div>
                        <p className="font-semibold text-blue-900">{selectedPatient.name_full}</p>
                        <p className="text-xs text-blue-700 mt-0.5">
                          {selectedPatient.uhid} &middot; {selectedPatient.phone} &middot; {selectedPatient.gender}
                          &middot; <span className="font-medium">{selectedPatient.patient_category}</span>
                        </p>
                      </div>
                      <button onClick={() => { setSelectedPatient(null); setChecklist([]); }} className="text-blue-600 hover:text-blue-800 text-sm underline">
                        Change
                      </button>
                    </div>
                  )}

                  {selectedPatient && checklist.length > 0 && (
                    <div>
                      <h3 className="text-sm font-semibold text-gray-700 mb-3">Pre-Admission Checklist</h3>
                      <div className="space-y-2">
                        {checklist.map((item, i) => (
                          <label key={item.key} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg hover:bg-gray-100 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={item.checked}
                              onChange={() => {
                                const updated = [...checklist];
                                updated[i] = { ...updated[i], checked: !updated[i].checked };
                                setChecklist(updated);
                              }}
                              className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                            />
                            <span className="text-sm text-gray-700 flex-1">{item.label}</span>
                            {item.mandatory && <span className="text-xs text-red-500 font-medium">Required</span>}
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ─── STEP 2: Clinical Handoff ─── */}
              {wizardStep === 2 && (
                <div className="space-y-4">
                  <h3 className="text-sm font-semibold text-gray-700 mb-1">Clinical Details</h3>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Encounter Class</label>
                      <select value={encounterClass} onChange={e => setEncounterClass(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                        <option value="IMP">Inpatient (IMP)</option>
                        <option value="AMB">Ambulatory (AMB)</option>
                        <option value="ED">Emergency (ED)</option>
                        <option value="HH">Home Health (HH)</option>
                        <option value="OBSENC">Observation (OBS)</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Admission Type</label>
                      <select value={admissionType} onChange={e => setAdmissionType(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                        <option value="elective">Elective</option>
                        <option value="emergency">Emergency</option>
                        <option value="day_care">Day Care</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Chief Complaint <span className="text-red-500">*</span></label>
                    <input
                      type="text"
                      value={chiefComplaint}
                      onChange={e => setChiefComplaint(e.target.value)}
                      maxLength={500}
                      placeholder="e.g., Chest pain radiating to left arm"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Preliminary Diagnosis (ICD-10)</label>
                    <input
                      type="text"
                      value={preliminaryDiagnosis}
                      onChange={e => setPreliminaryDiagnosis(e.target.value)}
                      maxLength={500}
                      placeholder="e.g., I20.9 — Angina pectoris, unspecified"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Clinical Notes</label>
                    <textarea
                      value={clinicalNotes}
                      onChange={e => setClinicalNotes(e.target.value)}
                      maxLength={2000}
                      rows={3}
                      placeholder="Relevant history, vitals, handoff notes..."
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Diet Type</label>
                      <input
                        type="text"
                        value={dietType}
                        onChange={e => setDietType(e.target.value)}
                        maxLength={50}
                        placeholder="e.g., Regular, Diabetic, NPO"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Expected LOS (days)</label>
                      <input
                        type="number"
                        value={expectedLosDays}
                        onChange={e => setExpectedLosDays(e.target.value)}
                        min={1}
                        max={365}
                        placeholder="e.g., 5"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* ─── STEP 3: Financial Counselling ─── */}
              {wizardStep === 3 && (
                <div className="space-y-4">
                  <h3 className="text-sm font-semibold text-gray-700 mb-1">Financial &amp; Insurance</h3>

                  {selectedPatient && (
                    <div className={`p-4 rounded-lg border ${
                      selectedPatient.patient_category === 'insured' ? 'bg-blue-50 border-blue-200' : 'bg-gray-50 border-gray-200'
                    }`}>
                      <p className="text-sm font-medium text-gray-700">
                        Patient Category: <span className="font-bold">{selectedPatient.patient_category}</span>
                      </p>
                      {selectedPatient.patient_category === 'insured' && (
                        <p className="text-xs text-blue-700 mt-1">⚠ Insured patients require pre-authorization before admission.</p>
                      )}
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Pre-Authorization Status</label>
                    <select
                      value={preAuthStatus}
                      onChange={e => setPreAuthStatus(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      {selectedPatient?.patient_category !== 'insured' && (
                        <option value="not_required">Not Required</option>
                      )}
                      <option value="obtained">Pre-Auth Obtained</option>
                      <option value="override">Emergency Override</option>
                    </select>
                  </div>

                  {preAuthStatus === 'obtained' && (
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Pre-Auth Number <span className="text-red-500">*</span></label>
                      <input
                        type="text"
                        value={preAuthNumber}
                        onChange={e => setPreAuthNumber(e.target.value)}
                        maxLength={100}
                        placeholder="Enter TPA pre-authorization number"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  )}

                  {preAuthStatus === 'override' && (
                    <div>
                      <div className="p-3 bg-orange-50 border border-orange-200 rounded-lg mb-3">
                        <p className="text-sm text-orange-800 font-medium">⚠ Emergency Override</p>
                        <p className="text-xs text-orange-700 mt-1">This admission will proceed without pre-authorization. Your name will be recorded in the audit trail.</p>
                      </div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Override Reason <span className="text-red-500">*</span></label>
                      <textarea
                        value={preAuthOverrideReason}
                        onChange={e => setPreAuthOverrideReason(e.target.value)}
                        maxLength={500}
                        rows={2}
                        placeholder="Reason for bypassing pre-authorization (e.g., Emergency trauma, life-threatening condition)"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                      />
                    </div>
                  )}
                </div>
              )}

              {/* ─── STEP 4: Bed Selection + Confirm ─── */}
              {wizardStep === 4 && (
                <div>
                  <h3 className="text-sm font-semibold text-gray-700 mb-3">Select Bed</h3>

                  <div className="mb-4">
                    <input
                      type="text"
                      placeholder="Filter by ward code..."
                      value={bedWardFilter}
                      onChange={e => setBedWardFilter(e.target.value)}
                      className="px-3 py-2 border border-gray-300 rounded-lg text-sm w-full focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  {loadingBeds ? (
                    <div className="p-8 text-center text-gray-400">Loading beds...</div>
                  ) : availableBeds.length === 0 ? (
                    <div className="p-8 text-center text-gray-400">No available beds{bedWardFilter ? ` in ward "${bedWardFilter}"` : ''}</div>
                  ) : (
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3 max-h-60 overflow-y-auto">
                      {availableBeds.map(bed => (
                        <button
                          key={bed.id}
                          onClick={() => setSelectedBedId(bed.id)}
                          className={`p-3 rounded-lg border text-left transition-colors ${
                            selectedBedId === bed.id
                              ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-500'
                              : 'border-gray-200 hover:border-blue-300 hover:bg-blue-50/50'
                          }`}
                        >
                          <p className="font-mono font-bold text-sm text-gray-900">{bed.code}</p>
                          <p className="text-xs text-gray-500 mt-0.5">{bed.ward_name}</p>
                          <p className="text-xs mt-1">
                            <span className={`px-1.5 py-0.5 rounded text-xs ${bed.bed_status === 'available' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                              {bed.bed_status}
                            </span>
                          </p>
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Confirmation Summary */}
                  {selectedBedId && selectedPatient && (
                    <div className="mt-5 p-4 bg-gray-50 border border-gray-200 rounded-lg">
                      <h4 className="text-sm font-semibold text-gray-700 mb-2">Admission Summary</h4>
                      <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
                        <p className="text-gray-500">Patient:</p>
                        <p className="text-gray-900 font-medium">{selectedPatient.name_full} ({selectedPatient.uhid})</p>
                        <p className="text-gray-500">Category:</p>
                        <p className="text-gray-900">{selectedPatient.patient_category}</p>
                        <p className="text-gray-500">Type:</p>
                        <p className="text-gray-900">{admissionType.replace('_', ' ')}</p>
                        <p className="text-gray-500">Complaint:</p>
                        <p className="text-gray-900">{chiefComplaint}</p>
                        <p className="text-gray-500">Bed:</p>
                        <p className="text-gray-900 font-mono">{availableBeds.find(b => b.id === selectedBedId)?.code || selectedBedId}</p>
                        <p className="text-gray-500">Pre-Auth:</p>
                        <p className="text-gray-900">{preAuthStatus.replace('_', ' ')}{preAuthNumber ? ` (${preAuthNumber})` : ''}</p>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Wizard Footer */}
            <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between sticky bottom-0 bg-white rounded-b-2xl">
              <button
                onClick={() => wizardStep === 1 ? resetWizard() : setWizardStep(s => s - 1)}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
              >
                {wizardStep === 1 ? 'Cancel' : '← Back'}
              </button>

              {wizardStep < 4 ? (
                <button
                  onClick={() => { setWizardError(''); setWizardStep(s => s + 1); }}
                  disabled={
                    (wizardStep === 1 && !canProceedStep1()) ||
                    (wizardStep === 2 && !canProceedStep2()) ||
                    (wizardStep === 3 && !canProceedStep3())
                  }
                  className="px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Next →
                </button>
              ) : (
                <button
                  onClick={handleSubmit}
                  disabled={!canSubmit() || submitting}
                  className="px-5 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {submitting ? 'Admitting...' : '✓ Confirm Admission'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
