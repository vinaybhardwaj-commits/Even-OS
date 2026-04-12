'use client';

import { useState, useEffect, useCallback } from 'react';

// ─── Types ───────────────────────────────────────────────
interface User {
  sub: string;
  hospital_id: string;
  role: string;
  email: string;
  name: string;
}

interface Patient {
  id: string;
  mrn: string;
  first_name: string;
  last_name: string;
  date_of_birth: string;
}

interface MedicationOrder {
  id: string;
  patient_id: string;
  encounter_id: string;
  drug_name: string;
  generic_name: string | null;
  dose_quantity: number;
  dose_unit: string;
  route: string;
  frequency_code: string;
  duration_days: number | null;
  is_prn: boolean;
  prn_indication: string | null;
  is_high_alert: boolean;
  is_lasa: boolean;
  narcotics_class: string | null;
  instructions: string | null;
  prescriber: string;
  status: string;
  ordered_at: string;
  created_at: string;
}

interface DosageRecord {
  id: string;
  medication_order_id: string;
  scheduled_time: string;
  given_time: string | null;
  given_by: string | null;
  dose_given: number;
  unit_given: string;
  notes: string | null;
  status: string;
}

interface LabOrder {
  id: string;
  patient_id: string;
  encounter_id: string;
  order_name: string;
  test_code: string;
  specimen_type: string;
  fasting_required: boolean;
  clinical_indication: string | null;
  priority: string;
  instructions: string | null;
  status: string;
  ordered_at: string;
}

interface LabResult {
  id: string;
  lab_order_id: string;
  result_value: string;
  result_unit: string | null;
  reference_range: string | null;
  status: string;
  recorded_at: string;
  recorded_by: string;
}

interface ImagingOrder {
  id: string;
  patient_id: string;
  encounter_id: string;
  order_name: string;
  modality: string;
  body_part: string;
  contrast_required: boolean;
  pregnancy_check: boolean;
  renal_function_check: boolean;
  clinical_indication: string | null;
  priority: string;
  status: string;
  ordered_at: string;
}

interface DietOrder {
  id: string;
  patient_id: string;
  encounter_id: string;
  diet_type: string;
  custom_description: string | null;
  restrictions: string | null;
  supplements: string | null;
  calorie_target: number | null;
  fluid_restriction_ml: number | null;
  start_date: string;
  status: string;
}

interface NursingOrder {
  id: string;
  patient_id: string;
  encounter_id: string;
  task_type: string;
  description: string;
  frequency_code: string;
  instructions: string | null;
  start_date: string;
  status: string;
}

interface NursingTask {
  id: string;
  nursing_order_id: string;
  scheduled_time: string;
  completed_time: string | null;
  completed_by: string | null;
  status: string;
}

interface CDSAlert {
  id: string;
  patient_id: string;
  alert_type: string;
  message: string;
  severity: string;
  triggering_order_id: string | null;
  triggering_order_type: string | null;
  outcome: string;
  override_reason: string | null;
  created_at: string;
}

// ─── Helpers ──────────────────────────────────────────────
function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDateOnly(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

async function trpcQuery(path: string, input?: Record<string, unknown>) {
  const qs = input ? `?input=${encodeURIComponent(JSON.stringify(input))}` : '';
  const res = await fetch(`/api/trpc/${path}${qs}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || 'Request failed');
  return json.result?.data?.json;
}

async function trpcMutate(path: string, input: Record<string, unknown>) {
  const res = await fetch(`/api/trpc/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ json: input }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || 'Request failed');
  return json.result?.data?.json;
}

// ─── Main Component ───────────────────────────────────────
export function MedicationOrdersClient({ user }: { user: User }) {
  const [activeTab, setActiveTab] = useState<'medications' | 'lab-imaging' | 'diet-nursing' | 'cds-alerts'>(
    'medications'
  );

  // ──────────── SHARED STATE ─────────────────────────────
  const [patientSearch, setPatientSearch] = useState('');
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [patientSearchResults, setPatientSearchResults] = useState<Patient[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  // ──────────── MEDICATIONS TAB ──────────────────────────
  const [medications, setMedications] = useState<MedicationOrder[]>([]);
  const [medicationStats, setMedicationStats] = useState({
    active_orders: 0,
    pending_doses: 0,
    overdue: 0,
    high_alert: 0,
    narcotics: 0,
  });
  const [loadingMedications, setLoadingMedications] = useState(false);
  const [showMedForm, setShowMedForm] = useState(false);
  const [creatingMedication, setCreatingMedication] = useState(false);
  const [medicationError, setMedicationError] = useState('');
  const [cdsAlerts, setCdsAlerts] = useState<CDSAlert[]>([]);
  const [showCdsOverride, setShowCdsOverride] = useState(false);
  const [cdsOverrideReason, setCdsOverrideReason] = useState('');
  const [expandedMedication, setExpandedMedication] = useState<string | null>(null);
  const [dosageRecords, setDosageRecords] = useState<Record<string, DosageRecord[]>>({});

  const [medFormData, setMedFormData] = useState({
    drug_name: '',
    generic_name: '',
    dose_quantity: '',
    dose_unit: 'mg',
    route: 'oral',
    frequency_code: 'OD',
    duration_days: '',
    is_prn: false,
    prn_indication: '',
    is_high_alert: false,
    is_lasa: false,
    narcotics_class: '',
    instructions: '',
  });

  // ──────────── LAB & IMAGING TAB ────────────────────────
  const [labOrders, setLabOrders] = useState<LabOrder[]>([]);
  const [imagingOrders, setImagingOrders] = useState<ImagingOrder[]>([]);
  const [labResults, setLabResults] = useState<Record<string, LabResult[]>>({});
  const [imagingResults, setImagingResults] = useState<Record<string, string>>({});
  const [loadingLabImaging, setLoadingLabImaging] = useState(false);

  const [showLabForm, setShowLabForm] = useState(false);
  const [showImagingForm, setShowImagingForm] = useState(false);
  const [creatingLabOrder, setCreatingLabOrder] = useState(false);
  const [creatingImagingOrder, setCreatingImagingOrder] = useState(false);

  const [labFormData, setLabFormData] = useState({
    order_name: '',
    test_code: '',
    specimen_type: '',
    fasting_required: false,
    clinical_indication: '',
    priority: 'routine',
    instructions: '',
  });

  const [imagingFormData, setImagingFormData] = useState({
    order_name: '',
    modality: 'xray',
    body_part: '',
    contrast_required: false,
    pregnancy_check: false,
    renal_function_check: false,
    clinical_indication: '',
    priority: 'routine',
  });

  const [showLabResultForm, setShowLabResultForm] = useState<string | null>(null);
  const [labResultFormData, setLabResultFormData] = useState({
    result_value: '',
    result_unit: '',
    reference_range: '',
    status: 'final',
  });

  // ──────────── DIET & NURSING TAB ───────────────────────
  const [dietOrders, setDietOrders] = useState<DietOrder[]>([]);
  const [nursingOrders, setNursingOrders] = useState<NursingOrder[]>([]);
  const [nursingTasks, setNursingTasks] = useState<Record<string, NursingTask[]>>({});
  const [loadingDietNursing, setLoadingDietNursing] = useState(false);

  const [showDietForm, setShowDietForm] = useState(false);
  const [showNursingForm, setShowNursingForm] = useState(false);
  const [creatingDietOrder, setCreatingDietOrder] = useState(false);
  const [creatingNursingOrder, setCreatingNursingOrder] = useState(false);

  const [dietFormData, setDietFormData] = useState({
    diet_type: 'regular',
    custom_description: '',
    restrictions: '',
    supplements: '',
    calorie_target: '',
    fluid_restriction_ml: '',
    start_date: new Date().toISOString().split('T')[0],
  });

  const [nursingFormData, setNursingFormData] = useState({
    task_type: 'wound-care',
    description: '',
    frequency_code: 'OD',
    instructions: '',
    start_date: new Date().toISOString().split('T')[0],
  });

  // ──────────── CDS ALERTS TAB ───────────────────────────
  const [allCdsAlerts, setAllCdsAlerts] = useState<CDSAlert[]>([]);
  const [loadingCdsAlerts, setLoadingCdsAlerts] = useState(false);
  const [overridingAlert, setOverridingAlert] = useState<string | null>(null);
  const [overrideAlertReason, setOverrideAlertReason] = useState('');

  // ──────────── PATIENT SEARCH ──────────────────────────
  useEffect(() => {
    const timer = setTimeout(async () => {
      if (patientSearch.length > 2) {
        setSearchLoading(true);
        try {
          const results = await trpcQuery('patient.list', { search: patientSearch, limit: 10 });
          setPatientSearchResults(results || []);
        } catch (err) {
          console.error('Patient search error:', err);
          setPatientSearchResults([]);
        } finally {
          setSearchLoading(false);
        }
      } else {
        setPatientSearchResults([]);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [patientSearch]);

  const handleSelectPatient = useCallback((patient: Patient) => {
    setSelectedPatient(patient);
    setPatientSearch('');
    setPatientSearchResults([]);
  }, []);

  // ──────────── LOAD MEDICATIONS ──────────────────────
  useEffect(() => {
    if (selectedPatient && activeTab === 'medications') {
      loadMedications();
    }
  }, [selectedPatient, activeTab]);

  const loadMedications = async () => {
    if (!selectedPatient) return;
    setLoadingMedications(true);
    try {
      const data = await trpcQuery('medicationOrders.list', { patient_id: selectedPatient.id });
      setMedications(data?.orders || []);
      setMedicationStats(data?.stats || {});
      setCdsAlerts(data?.cds_alerts || []);
    } catch (err) {
      console.error('Medication load error:', err);
    } finally {
      setLoadingMedications(false);
    }
  };

  const handleCreateMedication = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPatient || !medFormData.drug_name) return;

    setCreatingMedication(true);
    setMedicationError('');
    try {
      const result = await trpcMutate('medicationOrders.create', {
        patient_id: selectedPatient.id,
        encounter_id: 'enc_' + Date.now(),
        drug_name: medFormData.drug_name,
        generic_name: medFormData.generic_name || null,
        dose_quantity: parseFloat(medFormData.dose_quantity),
        dose_unit: medFormData.dose_unit,
        route: medFormData.route,
        frequency_code: medFormData.frequency_code,
        duration_days: medFormData.duration_days ? parseInt(medFormData.duration_days) : null,
        is_prn: medFormData.is_prn,
        prn_indication: medFormData.prn_indication || null,
        is_high_alert: medFormData.is_high_alert,
        is_lasa: medFormData.is_lasa,
        narcotics_class: medFormData.narcotics_class || null,
        instructions: medFormData.instructions || null,
        prescriber: user.name,
      });

      if (result?.cds_alerts && result.cds_alerts.length > 0) {
        setCdsAlerts(result.cds_alerts);
        setShowCdsOverride(true);
        return;
      }

      setShowMedForm(false);
      setMedFormData({
        drug_name: '',
        generic_name: '',
        dose_quantity: '',
        dose_unit: 'mg',
        route: 'oral',
        frequency_code: 'OD',
        duration_days: '',
        is_prn: false,
        prn_indication: '',
        is_high_alert: false,
        is_lasa: false,
        narcotics_class: '',
        instructions: '',
      });
      await loadMedications();
    } catch (err: any) {
      setMedicationError(err.message || 'Failed to create medication order');
    } finally {
      setCreatingMedication(false);
    }
  };

  // ──────────── LOAD LAB & IMAGING ────────────────────
  useEffect(() => {
    if (selectedPatient && activeTab === 'lab-imaging') {
      loadLabImaging();
    }
  }, [selectedPatient, activeTab]);

  const loadLabImaging = async () => {
    if (!selectedPatient) return;
    setLoadingLabImaging(true);
    try {
      const labData = await trpcQuery('labOrders.list', { patient_id: selectedPatient.id });
      setLabOrders(labData?.orders || []);
      setLabResults(labData?.results || {});

      const imagingData = await trpcQuery('imagingOrders.list', { patient_id: selectedPatient.id });
      setImagingOrders(imagingData?.orders || []);
    } catch (err) {
      console.error('Lab/Imaging load error:', err);
    } finally {
      setLoadingLabImaging(false);
    }
  };

  const handleCreateLabOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPatient || !labFormData.order_name) return;

    setCreatingLabOrder(true);
    try {
      await trpcMutate('labOrders.create', {
        patient_id: selectedPatient.id,
        encounter_id: 'enc_' + Date.now(),
        order_name: labFormData.order_name,
        test_code: labFormData.test_code,
        specimen_type: labFormData.specimen_type,
        fasting_required: labFormData.fasting_required,
        clinical_indication: labFormData.clinical_indication || null,
        priority: labFormData.priority,
        instructions: labFormData.instructions || null,
      });

      setShowLabForm(false);
      setLabFormData({
        order_name: '',
        test_code: '',
        specimen_type: '',
        fasting_required: false,
        clinical_indication: '',
        priority: 'routine',
        instructions: '',
      });
      await loadLabImaging();
    } catch (err) {
      console.error('Lab order creation error:', err);
    } finally {
      setCreatingLabOrder(false);
    }
  };

  const handleCreateImagingOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPatient || !imagingFormData.order_name) return;

    setCreatingImagingOrder(true);
    try {
      await trpcMutate('imagingOrders.create', {
        patient_id: selectedPatient.id,
        encounter_id: 'enc_' + Date.now(),
        order_name: imagingFormData.order_name,
        modality: imagingFormData.modality,
        body_part: imagingFormData.body_part,
        contrast_required: imagingFormData.contrast_required,
        pregnancy_check: imagingFormData.pregnancy_check,
        renal_function_check: imagingFormData.renal_function_check,
        clinical_indication: imagingFormData.clinical_indication || null,
        priority: imagingFormData.priority,
      });

      setShowImagingForm(false);
      setImagingFormData({
        order_name: '',
        modality: 'xray',
        body_part: '',
        contrast_required: false,
        pregnancy_check: false,
        renal_function_check: false,
        clinical_indication: '',
        priority: 'routine',
      });
      await loadLabImaging();
    } catch (err) {
      console.error('Imaging order creation error:', err);
    } finally {
      setCreatingImagingOrder(false);
    }
  };

  // ──────────── LOAD DIET & NURSING ──────────────────
  useEffect(() => {
    if (selectedPatient && activeTab === 'diet-nursing') {
      loadDietNursing();
    }
  }, [selectedPatient, activeTab]);

  const loadDietNursing = async () => {
    if (!selectedPatient) return;
    setLoadingDietNursing(true);
    try {
      const dietData = await trpcQuery('dietOrders.list', { patient_id: selectedPatient.id });
      setDietOrders(dietData?.orders || []);

      const nursingData = await trpcQuery('nursingOrders.list', { patient_id: selectedPatient.id });
      setNursingOrders(nursingData?.orders || []);
      setNursingTasks(nursingData?.tasks || {});
    } catch (err) {
      console.error('Diet/Nursing load error:', err);
    } finally {
      setLoadingDietNursing(false);
    }
  };

  const handleCreateDietOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPatient || !dietFormData.diet_type) return;

    setCreatingDietOrder(true);
    try {
      await trpcMutate('dietOrders.create', {
        patient_id: selectedPatient.id,
        encounter_id: 'enc_' + Date.now(),
        diet_type: dietFormData.diet_type,
        custom_description: dietFormData.custom_description || null,
        restrictions: dietFormData.restrictions || null,
        supplements: dietFormData.supplements || null,
        calorie_target: dietFormData.calorie_target ? parseInt(dietFormData.calorie_target) : null,
        fluid_restriction_ml: dietFormData.fluid_restriction_ml ? parseInt(dietFormData.fluid_restriction_ml) : null,
        start_date: dietFormData.start_date,
      });

      setShowDietForm(false);
      setDietFormData({
        diet_type: 'regular',
        custom_description: '',
        restrictions: '',
        supplements: '',
        calorie_target: '',
        fluid_restriction_ml: '',
        start_date: new Date().toISOString().split('T')[0],
      });
      await loadDietNursing();
    } catch (err) {
      console.error('Diet order creation error:', err);
    } finally {
      setCreatingDietOrder(false);
    }
  };

  const handleCreateNursingOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPatient || !nursingFormData.task_type) return;

    setCreatingNursingOrder(true);
    try {
      await trpcMutate('nursingOrders.create', {
        patient_id: selectedPatient.id,
        encounter_id: 'enc_' + Date.now(),
        task_type: nursingFormData.task_type,
        description: nursingFormData.description,
        frequency_code: nursingFormData.frequency_code,
        instructions: nursingFormData.instructions || null,
        start_date: nursingFormData.start_date,
      });

      setShowNursingForm(false);
      setNursingFormData({
        task_type: 'wound-care',
        description: '',
        frequency_code: 'OD',
        instructions: '',
        start_date: new Date().toISOString().split('T')[0],
      });
      await loadDietNursing();
    } catch (err) {
      console.error('Nursing order creation error:', err);
    } finally {
      setCreatingNursingOrder(false);
    }
  };

  // ──────────── LOAD CDS ALERTS ──────────────────────
  useEffect(() => {
    if (selectedPatient && activeTab === 'cds-alerts') {
      loadCdsAlerts();
    }
  }, [selectedPatient, activeTab]);

  const loadCdsAlerts = async () => {
    if (!selectedPatient) return;
    setLoadingCdsAlerts(true);
    try {
      const data = await trpcQuery('cdsAlerts.list', { patient_id: selectedPatient.id });
      setAllCdsAlerts(data?.alerts || []);
    } catch (err) {
      console.error('CDS alerts load error:', err);
    } finally {
      setLoadingCdsAlerts(false);
    }
  };

  const handleOverrideAlert = async (alertId: string) => {
    if (!overrideAlertReason) return;

    setOverridingAlert(alertId);
    try {
      await trpcMutate('cdsAlerts.override', {
        alert_id: alertId,
        override_reason: overrideAlertReason,
      });

      setOverrideAlertReason('');
      await loadCdsAlerts();
    } catch (err) {
      console.error('Alert override error:', err);
    } finally {
      setOverridingAlert(null);
    }
  };

  // ──────────── RENDER ───────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-6 py-6">
          <h1 className="text-3xl font-bold text-gray-900">Medication Orders</h1>
          <p className="text-gray-600 mt-2">Manage medications, labs, imaging, diet, nursing orders and CDS alerts</p>
        </div>
      </div>

      {/* Patient Selector */}
      <div className="max-w-7xl mx-auto px-6 py-6">
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">Select Patient</label>
          <div className="relative">
            <input
              type="text"
              placeholder="Search by name or MRN..."
              value={patientSearch}
              onChange={(e) => setPatientSearch(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {patientSearch && patientSearchResults.length > 0 && (
              <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                {patientSearchResults.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => handleSelectPatient(p)}
                    className="w-full text-left px-4 py-2 hover:bg-blue-50 border-b border-gray-100 last:border-b-0"
                  >
                    <div className="font-medium text-gray-900">
                      {p.first_name} {p.last_name}
                    </div>
                    <div className="text-sm text-gray-500">MRN: {p.mrn}</div>
                  </button>
                ))}
              </div>
            )}
            {searchLoading && <div className="absolute right-4 top-2.5 text-gray-400 text-sm">Loading...</div>}
          </div>

          {selectedPatient && (
            <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <div className="font-medium text-blue-900">
                {selectedPatient.first_name} {selectedPatient.last_name}
              </div>
              <div className="text-sm text-blue-700">MRN: {selectedPatient.mrn}</div>
              <button
                onClick={() => {
                  setSelectedPatient(null);
                  setPatientSearch('');
                }}
                className="mt-2 text-sm text-blue-600 hover:text-blue-800 underline"
              >
                Change Patient
              </button>
            </div>
          )}
        </div>
      </div>

      {!selectedPatient ? (
        <div className="max-w-7xl mx-auto px-6 py-12 text-center text-gray-500">
          Please select a patient to begin
        </div>
      ) : (
        <>
          {/* Tabs */}
          <div className="max-w-7xl mx-auto px-6 mt-6">
            <div className="bg-white border-b border-gray-200 rounded-t-lg">
              <div className="flex space-x-1 px-6">
                {(
                  [
                    { id: 'medications', label: '&#x1F48A; Medications' },
                    { id: 'lab-imaging', label: '&#x1F52C; Lab & Imaging' },
                    { id: 'diet-nursing', label: '&#x1F37D; Diet & Nursing' },
                    { id: 'cds-alerts', label: '&#x26A0; CDS Alerts' },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`px-6 py-4 font-medium border-b-2 transition-colors ${
                      activeTab === tab.id
                        ? 'border-blue-600 text-blue-600'
                        : 'border-transparent text-gray-600 hover:text-gray-900'
                    }`}
                    dangerouslySetInnerHTML={{ __html: tab.label }}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* TAB: MEDICATIONS */}
          {activeTab === 'medications' && (
            <div className="max-w-7xl mx-auto px-6 py-6">
              {/* Stats Row */}
              <div className="grid grid-cols-5 gap-4 mb-6">
                <div className="bg-white rounded-lg border border-gray-200 p-4">
                  <div className="text-sm font-medium text-gray-600">Active Orders</div>
                  <div className="text-2xl font-bold text-blue-600 mt-2">{medicationStats.active_orders}</div>
                </div>
                <div className="bg-white rounded-lg border border-gray-200 p-4">
                  <div className="text-sm font-medium text-gray-600">Pending Doses</div>
                  <div className="text-2xl font-bold text-yellow-600 mt-2">{medicationStats.pending_doses}</div>
                </div>
                <div className="bg-white rounded-lg border border-gray-200 p-4">
                  <div className="text-sm font-medium text-gray-600">Overdue</div>
                  <div className="text-2xl font-bold text-orange-600 mt-2">{medicationStats.overdue}</div>
                </div>
                <div className="bg-white rounded-lg border border-gray-200 p-4">
                  <div className="text-sm font-medium text-gray-600">High-Alert</div>
                  <div className="text-2xl font-bold text-red-600 mt-2">{medicationStats.high_alert}</div>
                </div>
                <div className="bg-white rounded-lg border border-gray-200 p-4">
                  <div className="text-sm font-medium text-gray-600">Narcotics</div>
                  <div className="text-2xl font-bold text-red-600 mt-2">{medicationStats.narcotics}</div>
                </div>
              </div>

              {/* New Medication Button */}
              <button
                onClick={() => setShowMedForm(!showMedForm)}
                className="mb-6 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium transition-colors"
              >
                + New Medication Order
              </button>

              {/* Medication Form */}
              {showMedForm && (
                <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
                  <h3 className="text-lg font-bold text-gray-900 mb-4">New Medication Order</h3>
                  {medicationError && (
                    <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
                      {medicationError}
                    </div>
                  )}

                  {showCdsOverride && cdsAlerts.length > 0 && (
                    <div className="mb-4 p-4 bg-red-50 border border-red-300 rounded-lg">
                      <div className="font-medium text-red-900 mb-2">CDS Alerts:</div>
                      {cdsAlerts.map((alert) => (
                        <div key={alert.id} className="text-sm text-red-800 mb-2">
                          &#x26A0; {alert.message}
                        </div>
                      ))}
                      <div className="mt-4">
                        <input
                          type="text"
                          placeholder="Override reason..."
                          value={cdsOverrideReason}
                          onChange={(e) => setCdsOverrideReason(e.target.value)}
                          className="w-full px-3 py-2 border border-red-300 rounded-lg mb-3 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={async () => {
                              await handleCreateMedication(new Event('submit') as any);
                              setShowCdsOverride(false);
                            }}
                            className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm font-medium"
                          >
                            Proceed with Override
                          </button>
                          <button
                            onClick={() => {
                              setShowCdsOverride(false);
                              setCdsAlerts([]);
                            }}
                            className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 text-sm font-medium"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  <form onSubmit={handleCreateMedication} className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Drug Name *</label>
                        <input
                          type="text"
                          required
                          value={medFormData.drug_name}
                          onChange={(e) => setMedFormData({ ...medFormData, drug_name: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Generic Name</label>
                        <input
                          type="text"
                          value={medFormData.generic_name}
                          onChange={(e) => setMedFormData({ ...medFormData, generic_name: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-4 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Dose Quantity *</label>
                        <input
                          type="number"
                          step="0.1"
                          required
                          value={medFormData.dose_quantity}
                          onChange={(e) => setMedFormData({ ...medFormData, dose_quantity: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Unit *</label>
                        <select
                          value={medFormData.dose_unit}
                          onChange={(e) => setMedFormData({ ...medFormData, dose_unit: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          <option>mg</option>
                          <option>g</option>
                          <option>ml</option>
                          <option>mcg</option>
                          <option>IU</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Route *</label>
                        <select
                          value={medFormData.route}
                          onChange={(e) => setMedFormData({ ...medFormData, route: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="oral">Oral</option>
                          <option value="iv">IV</option>
                          <option value="im">IM</option>
                          <option value="sc">SC</option>
                          <option value="topical">Topical</option>
                          <option value="inhalation">Inhalation</option>
                          <option value="sublingual">Sublingual</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Frequency *</label>
                        <select
                          value={medFormData.frequency_code}
                          onChange={(e) => setMedFormData({ ...medFormData, frequency_code: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="OD">OD</option>
                          <option value="BD">BD</option>
                          <option value="TDS">TDS</option>
                          <option value="QID">QID</option>
                          <option value="Q4H">Q4H</option>
                          <option value="Q6H">Q6H</option>
                          <option value="Q8H">Q8H</option>
                          <option value="STAT">STAT</option>
                          <option value="HS">HS</option>
                          <option value="PRN">PRN</option>
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Duration (days)</label>
                        <input
                          type="number"
                          value={medFormData.duration_days}
                          onChange={(e) => setMedFormData({ ...medFormData, duration_days: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Narcotics Class</label>
                        <select
                          value={medFormData.narcotics_class}
                          onChange={(e) => setMedFormData({ ...medFormData, narcotics_class: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="">None</option>
                          <option value="Schedule1">Schedule 1</option>
                          <option value="Schedule2">Schedule 2</option>
                          <option value="Schedule3">Schedule 3</option>
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-4">
                      <label className="flex items-center space-x-2">
                        <input
                          type="checkbox"
                          checked={medFormData.is_prn}
                          onChange={(e) => setMedFormData({ ...medFormData, is_prn: e.target.checked })}
                          className="w-4 h-4 rounded border-gray-300"
                        />
                        <span className="text-sm font-medium text-gray-700">PRN</span>
                      </label>
                      <label className="flex items-center space-x-2">
                        <input
                          type="checkbox"
                          checked={medFormData.is_high_alert}
                          onChange={(e) => setMedFormData({ ...medFormData, is_high_alert: e.target.checked })}
                          className="w-4 h-4 rounded border-gray-300"
                        />
                        <span className="text-sm font-medium text-gray-700">High Alert</span>
                      </label>
                      <label className="flex items-center space-x-2">
                        <input
                          type="checkbox"
                          checked={medFormData.is_lasa}
                          onChange={(e) => setMedFormData({ ...medFormData, is_lasa: e.target.checked })}
                          className="w-4 h-4 rounded border-gray-300"
                        />
                        <span className="text-sm font-medium text-gray-700">LASA</span>
                      </label>
                    </div>

                    {medFormData.is_prn && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">PRN Indication</label>
                        <input
                          type="text"
                          value={medFormData.prn_indication}
                          onChange={(e) => setMedFormData({ ...medFormData, prn_indication: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                    )}

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Instructions</label>
                      <textarea
                        value={medFormData.instructions}
                        onChange={(e) => setMedFormData({ ...medFormData, instructions: e.target.value })}
                        rows={3}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>

                    <div className="flex gap-2">
                      <button
                        type="submit"
                        disabled={creatingMedication}
                        className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium disabled:opacity-50"
                      >
                        {creatingMedication ? 'Creating...' : 'Create Order'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowMedForm(false)}
                        className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 font-medium"
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {/* Medications List */}
              {loadingMedications ? (
                <div className="text-center text-gray-500 py-12">Loading medications...</div>
              ) : medications.length === 0 ? (
                <div className="text-center text-gray-500 py-12">No medication orders found</div>
              ) : (
                <div className="space-y-4">
                  {medications.map((med) => (
                    <div key={med.id} className="bg-white rounded-lg border border-gray-200 p-4">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="font-bold text-lg text-gray-900">{med.drug_name}</span>
                            {med.is_high_alert && (
                              <span className="px-2 py-1 bg-red-100 text-red-700 text-xs font-medium rounded-full">
                                &#x26A0; High Alert
                              </span>
                            )}
                            {med.is_lasa && (
                              <span className="px-2 py-1 bg-orange-100 text-orange-700 text-xs font-medium rounded-full">
                                LASA
                              </span>
                            )}
                            {med.narcotics_class && (
                              <span className="px-2 py-1 bg-red-100 text-red-700 text-xs font-medium rounded-full">
                                {med.narcotics_class}
                              </span>
                            )}
                            <span
                              className={`px-2 py-1 text-xs font-medium rounded-full ${
                                med.status === 'active'
                                  ? 'bg-green-100 text-green-700'
                                  : med.status === 'pending'
                                    ? 'bg-yellow-100 text-yellow-700'
                                    : 'bg-gray-100 text-gray-700'
                              }`}
                            >
                              {med.status}
                            </span>
                          </div>
                          <div className="text-sm text-gray-600 mb-2">
                            <span className="font-medium">Dose:</span> {med.dose_quantity} {med.dose_unit} {med.route} {med.frequency_code}
                          </div>
                          <div className="text-sm text-gray-600">
                            <span className="font-medium">Prescribed by:</span> {med.prescriber} on{' '}
                            {formatDate(med.ordered_at)}
                          </div>
                        </div>
                        <button
                          onClick={() =>
                            setExpandedMedication(expandedMedication === med.id ? null : med.id)
                          }
                          className="px-3 py-1 text-blue-600 hover:text-blue-800 text-sm font-medium"
                        >
                          {expandedMedication === med.id ? 'Collapse' : 'Expand'}
                        </button>
                      </div>

                      {expandedMedication === med.id && (
                        <div className="mt-4 pt-4 border-t border-gray-200">
                          <div className="mb-4 p-3 bg-gray-50 rounded-lg text-sm">
                            {med.instructions && (
                              <div className="mb-2">
                                <span className="font-medium text-gray-700">Instructions:</span> {med.instructions}
                              </div>
                            )}
                            {med.is_prn && (
                              <div>
                                <span className="font-medium text-gray-700">PRN Indication:</span> {med.prn_indication}
                              </div>
                            )}
                          </div>

                          <div className="mb-4">
                            <h4 className="font-medium text-gray-900 mb-2">Administration Schedule</h4>
                            {dosageRecords[med.id] && dosageRecords[med.id].length > 0 ? (
                              <div className="space-y-2 text-sm">
                                {dosageRecords[med.id].map((record) => (
                                  <div key={record.id} className="p-2 bg-gray-50 rounded-lg flex justify-between">
                                    <div>
                                      <span className="font-medium">{formatDate(record.scheduled_time)}</span>
                                      {record.status === 'given' && (
                                        <span className="ml-2 text-green-600">✓ Given</span>
                                      )}
                                    </div>
                                    <span className="text-gray-600">
                                      {record.dose_given} {record.unit_given}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="text-sm text-gray-500">No dosage records yet</div>
                            )}
                          </div>

                          <button className="w-full px-3 py-2 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-lg text-sm font-medium transition-colors">
                            Record Administration
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB: LAB & IMAGING */}
          {activeTab === 'lab-imaging' && (
            <div className="max-w-7xl mx-auto px-6 py-6">
              {/* Lab Orders Section */}
              <div className="mb-8">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-xl font-bold text-gray-900">Lab Orders</h3>
                  <button
                    onClick={() => setShowLabForm(!showLabForm)}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium"
                  >
                    + New Lab Order
                  </button>
                </div>

                {showLabForm && (
                  <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
                    <h4 className="font-bold text-gray-900 mb-4">New Lab Order</h4>
                    <form onSubmit={handleCreateLabOrder} className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Order Name *</label>
                          <input
                            type="text"
                            required
                            value={labFormData.order_name}
                            onChange={(e) => setLabFormData({ ...labFormData, order_name: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Test Code</label>
                          <input
                            type="text"
                            value={labFormData.test_code}
                            onChange={(e) => setLabFormData({ ...labFormData, test_code: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Specimen Type</label>
                          <input
                            type="text"
                            value={labFormData.specimen_type}
                            onChange={(e) => setLabFormData({ ...labFormData, specimen_type: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
                          <select
                            value={labFormData.priority}
                            onChange={(e) => setLabFormData({ ...labFormData, priority: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                          >
                            <option value="routine">Routine</option>
                            <option value="urgent">Urgent</option>
                            <option value="stat">STAT</option>
                          </select>
                        </div>
                      </div>

                      <label className="flex items-center space-x-2">
                        <input
                          type="checkbox"
                          checked={labFormData.fasting_required}
                          onChange={(e) => setLabFormData({ ...labFormData, fasting_required: e.target.checked })}
                          className="w-4 h-4 rounded border-gray-300"
                        />
                        <span className="text-sm font-medium text-gray-700">Fasting Required</span>
                      </label>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Clinical Indication</label>
                        <textarea
                          value={labFormData.clinical_indication}
                          onChange={(e) => setLabFormData({ ...labFormData, clinical_indication: e.target.value })}
                          rows={2}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Instructions</label>
                        <textarea
                          value={labFormData.instructions}
                          onChange={(e) => setLabFormData({ ...labFormData, instructions: e.target.value })}
                          rows={2}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>

                      <div className="flex gap-2">
                        <button
                          type="submit"
                          disabled={creatingLabOrder}
                          className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium disabled:opacity-50"
                        >
                          {creatingLabOrder ? 'Creating...' : 'Create Order'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowLabForm(false)}
                          className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 font-medium"
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  </div>
                )}

                {loadingLabImaging ? (
                  <div className="text-center text-gray-500 py-12">Loading lab orders...</div>
                ) : labOrders.length === 0 ? (
                  <div className="text-center text-gray-500 py-6">No lab orders found</div>
                ) : (
                  <div className="space-y-4">
                    {labOrders.map((lab) => (
                      <div key={lab.id} className="bg-white rounded-lg border border-gray-200 p-4">
                        <div className="flex items-start justify-between mb-3">
                          <div className="flex-1">
                            <h4 className="font-bold text-gray-900">{lab.order_name}</h4>
                            <p className="text-sm text-gray-600">Code: {lab.test_code}</p>
                          </div>
                          <span
                            className={`px-2 py-1 text-xs font-medium rounded-full ${
                              lab.status === 'pending'
                                ? 'bg-yellow-100 text-yellow-700'
                                : lab.status === 'preliminary'
                                  ? 'bg-blue-100 text-blue-700'
                                  : lab.status === 'final'
                                    ? 'bg-green-100 text-green-700'
                                    : 'bg-red-100 text-red-700'
                            }`}
                          >
                            {lab.status}
                          </span>
                        </div>

                        <div className="text-sm text-gray-600 space-y-1 mb-4">
                          <div>
                            <span className="font-medium">Specimen:</span> {lab.specimen_type}
                          </div>
                          <div>
                            <span className="font-medium">Ordered:</span> {formatDate(lab.ordered_at)}
                          </div>
                          {lab.fasting_required && (
                            <div className="text-orange-600">
                              &#x26A0; Fasting required
                            </div>
                          )}
                        </div>

                        {labResults[lab.id]?.length > 0 && (
                          <div className="mb-3 p-3 bg-gray-50 rounded-lg text-sm space-y-2">
                            {labResults[lab.id].map((result) => (
                              <div key={result.id}>
                                <span className="font-medium">{result.result_value}</span>
                                {result.result_unit && <span className="text-gray-600"> {result.result_unit}</span>}
                                {result.reference_range && (
                                  <span className="text-gray-600"> (ref: {result.reference_range})</span>
                                )}
                              </div>
                            ))}
                          </div>
                        )}

                        <button
                          onClick={() =>
                            setShowLabResultForm(showLabResultForm === lab.id ? null : lab.id)
                          }
                          className="w-full px-3 py-2 text-sm text-blue-600 hover:text-blue-800 font-medium hover:bg-blue-50 rounded-lg transition-colors"
                        >
                          {showLabResultForm === lab.id ? 'Hide Result Form' : '+ Add Result'}
                        </button>

                        {showLabResultForm === lab.id && (
                          <form
                            onSubmit={async (e) => {
                              e.preventDefault();
                              // Add result API call would go here
                              setShowLabResultForm(null);
                            }}
                            className="mt-3 pt-3 border-t border-gray-200 space-y-3"
                          >
                            <input
                              type="text"
                              placeholder="Result value"
                              value={labResultFormData.result_value}
                              onChange={(e) =>
                                setLabResultFormData({ ...labResultFormData, result_value: e.target.value })
                              }
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                            <input
                              type="text"
                              placeholder="Unit"
                              value={labResultFormData.result_unit}
                              onChange={(e) =>
                                setLabResultFormData({ ...labResultFormData, result_unit: e.target.value })
                              }
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                            <button
                              type="submit"
                              className="w-full px-3 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700"
                            >
                              &#x2705; Add Result
                            </button>
                          </form>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Imaging Orders Section */}
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-xl font-bold text-gray-900">Imaging Orders</h3>
                  <button
                    onClick={() => setShowImagingForm(!showImagingForm)}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium"
                  >
                    + New Imaging Order
                  </button>
                </div>

                {showImagingForm && (
                  <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
                    <h4 className="font-bold text-gray-900 mb-4">New Imaging Order</h4>
                    <form onSubmit={handleCreateImagingOrder} className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Order Name *</label>
                          <input
                            type="text"
                            required
                            value={imagingFormData.order_name}
                            onChange={(e) => setImagingFormData({ ...imagingFormData, order_name: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Modality *</label>
                          <select
                            value={imagingFormData.modality}
                            onChange={(e) => setImagingFormData({ ...imagingFormData, modality: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                          >
                            <option value="xray">X-Ray</option>
                            <option value="ct">CT</option>
                            <option value="mri">MRI</option>
                            <option value="ultrasound">Ultrasound</option>
                            <option value="pet">PET</option>
                            <option value="fluoroscopy">Fluoroscopy</option>
                          </select>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Body Part</label>
                          <input
                            type="text"
                            value={imagingFormData.body_part}
                            onChange={(e) => setImagingFormData({ ...imagingFormData, body_part: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
                          <select
                            value={imagingFormData.priority}
                            onChange={(e) => setImagingFormData({ ...imagingFormData, priority: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                          >
                            <option value="routine">Routine</option>
                            <option value="urgent">Urgent</option>
                            <option value="stat">STAT</option>
                          </select>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <label className="flex items-center space-x-2">
                          <input
                            type="checkbox"
                            checked={imagingFormData.contrast_required}
                            onChange={(e) =>
                              setImagingFormData({ ...imagingFormData, contrast_required: e.target.checked })
                            }
                            className="w-4 h-4 rounded border-gray-300"
                          />
                          <span className="text-sm font-medium text-gray-700">Contrast Required</span>
                        </label>
                        <label className="flex items-center space-x-2">
                          <input
                            type="checkbox"
                            checked={imagingFormData.pregnancy_check}
                            onChange={(e) =>
                              setImagingFormData({ ...imagingFormData, pregnancy_check: e.target.checked })
                            }
                            className="w-4 h-4 rounded border-gray-300"
                          />
                          <span className="text-sm font-medium text-gray-700">Pregnancy Check</span>
                        </label>
                        <label className="flex items-center space-x-2">
                          <input
                            type="checkbox"
                            checked={imagingFormData.renal_function_check}
                            onChange={(e) =>
                              setImagingFormData({
                                ...imagingFormData,
                                renal_function_check: e.target.checked,
                              })
                            }
                            className="w-4 h-4 rounded border-gray-300"
                          />
                          <span className="text-sm font-medium text-gray-700">Renal Function Check</span>
                        </label>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Clinical Indication</label>
                        <textarea
                          value={imagingFormData.clinical_indication}
                          onChange={(e) =>
                            setImagingFormData({ ...imagingFormData, clinical_indication: e.target.value })
                          }
                          rows={2}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>

                      <div className="flex gap-2">
                        <button
                          type="submit"
                          disabled={creatingImagingOrder}
                          className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium disabled:opacity-50"
                        >
                          {creatingImagingOrder ? 'Creating...' : 'Create Order'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowImagingForm(false)}
                          className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 font-medium"
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  </div>
                )}

                {imagingOrders.length === 0 ? (
                  <div className="text-center text-gray-500 py-6">No imaging orders found</div>
                ) : (
                  <div className="space-y-4">
                    {imagingOrders.map((imaging) => (
                      <div key={imaging.id} className="bg-white rounded-lg border border-gray-200 p-4">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <h4 className="font-bold text-gray-900">{imaging.order_name}</h4>
                            <p className="text-sm text-gray-600">
                              {imaging.modality.toUpperCase()} - {imaging.body_part}
                            </p>
                          </div>
                          <span
                            className={`px-2 py-1 text-xs font-medium rounded-full ${
                              imaging.status === 'pending'
                                ? 'bg-yellow-100 text-yellow-700'
                                : 'bg-green-100 text-green-700'
                            }`}
                          >
                            {imaging.status}
                          </span>
                        </div>

                        <div className="text-sm text-gray-600 space-y-1 mt-3">
                          {imaging.contrast_required && (
                            <div className="text-orange-600">
                              Contrast required
                            </div>
                          )}
                          <div>
                            <span className="font-medium">Ordered:</span> {formatDate(imaging.ordered_at)}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB: DIET & NURSING */}
          {activeTab === 'diet-nursing' && (
            <div className="max-w-7xl mx-auto px-6 py-6">
              {/* Diet Section */}
              <div className="mb-8">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-xl font-bold text-gray-900">Diet Orders</h3>
                  <button
                    onClick={() => setShowDietForm(!showDietForm)}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium"
                  >
                    + New Diet Order
                  </button>
                </div>

                {showDietForm && (
                  <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
                    <h4 className="font-bold text-gray-900 mb-4">New Diet Order</h4>
                    <form onSubmit={handleCreateDietOrder} className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Diet Type *</label>
                        <select
                          value={dietFormData.diet_type}
                          onChange={(e) => setDietFormData({ ...dietFormData, diet_type: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="regular">Regular</option>
                          <option value="soft">Soft</option>
                          <option value="liquid">Liquid</option>
                          <option value="diabetic">Diabetic</option>
                          <option value="renal">Renal</option>
                          <option value="low-sodium">Low Sodium</option>
                          <option value="high-protein">High Protein</option>
                          <option value="custom">Custom</option>
                        </select>
                      </div>

                      {dietFormData.diet_type === 'custom' && (
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            Custom Description
                          </label>
                          <textarea
                            value={dietFormData.custom_description}
                            onChange={(e) => setDietFormData({ ...dietFormData, custom_description: e.target.value })}
                            rows={2}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                      )}

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Restrictions</label>
                        <input
                          type="text"
                          value={dietFormData.restrictions}
                          onChange={(e) => setDietFormData({ ...dietFormData, restrictions: e.target.value })}
                          placeholder="e.g., No sugar, Gluten-free"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Supplements</label>
                        <input
                          type="text"
                          value={dietFormData.supplements}
                          onChange={(e) => setDietFormData({ ...dietFormData, supplements: e.target.value })}
                          placeholder="e.g., Protein powder, Vitamins"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Calorie Target</label>
                          <input
                            type="number"
                            value={dietFormData.calorie_target}
                            onChange={(e) => setDietFormData({ ...dietFormData, calorie_target: e.target.value })}
                            placeholder="e.g., 2000"
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            Fluid Restriction (ml)
                          </label>
                          <input
                            type="number"
                            value={dietFormData.fluid_restriction_ml}
                            onChange={(e) =>
                              setDietFormData({ ...dietFormData, fluid_restriction_ml: e.target.value })
                            }
                            placeholder="e.g., 800"
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
                        <input
                          type="date"
                          value={dietFormData.start_date}
                          onChange={(e) => setDietFormData({ ...dietFormData, start_date: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>

                      <div className="flex gap-2">
                        <button
                          type="submit"
                          disabled={creatingDietOrder}
                          className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium disabled:opacity-50"
                        >
                          {creatingDietOrder ? 'Creating...' : 'Create Order'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowDietForm(false)}
                          className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 font-medium"
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  </div>
                )}

                {loadingDietNursing ? (
                  <div className="text-center text-gray-500 py-12">Loading diet orders...</div>
                ) : dietOrders.length === 0 ? (
                  <div className="text-center text-gray-500 py-6">No diet orders found</div>
                ) : (
                  <div className="space-y-4">
                    {dietOrders.map((diet) => (
                      <div key={diet.id} className="bg-white rounded-lg border border-gray-200 p-4">
                        <div className="flex items-start justify-between mb-2">
                          <h4 className="font-bold text-gray-900">{diet.diet_type.toUpperCase()}</h4>
                          <span className="px-2 py-1 bg-green-100 text-green-700 text-xs font-medium rounded-full">
                            &#x2705; {diet.status}
                          </span>
                        </div>

                        <div className="text-sm text-gray-600 space-y-1">
                          {diet.restrictions && (
                            <div>
                              <span className="font-medium">Restrictions:</span> {diet.restrictions}
                            </div>
                          )}
                          {diet.supplements && (
                            <div>
                              <span className="font-medium">Supplements:</span> {diet.supplements}
                            </div>
                          )}
                          {diet.calorie_target && (
                            <div>
                              <span className="font-medium">Calorie Target:</span> {diet.calorie_target} kcal
                            </div>
                          )}
                          {diet.fluid_restriction_ml && (
                            <div>
                              <span className="font-medium">Fluid Restriction:</span> {diet.fluid_restriction_ml} ml
                            </div>
                          )}
                          <div>
                            <span className="font-medium">Start Date:</span> {formatDateOnly(diet.start_date)}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Nursing Section */}
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-xl font-bold text-gray-900">Nursing Orders</h3>
                  <button
                    onClick={() => setShowNursingForm(!showNursingForm)}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium"
                  >
                    + New Nursing Order
                  </button>
                </div>

                {showNursingForm && (
                  <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
                    <h4 className="font-bold text-gray-900 mb-4">New Nursing Order</h4>
                    <form onSubmit={handleCreateNursingOrder} className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Task Type *</label>
                        <select
                          value={nursingFormData.task_type}
                          onChange={(e) => setNursingFormData({ ...nursingFormData, task_type: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="wound-care">Wound Care</option>
                          <option value="catheter-care">Catheter Care</option>
                          <option value="bed-sore-prevention">Bed Sore Prevention</option>
                          <option value="vital-signs">Vital Signs Monitoring</option>
                          <option value="physical-therapy">Physical Therapy</option>
                          <option value="hygiene">Hygiene Assistance</option>
                          <option value="bladder-care">Bladder Care</option>
                          <option value="bowel-care">Bowel Care</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Description *</label>
                        <textarea
                          required
                          value={nursingFormData.description}
                          onChange={(e) => setNursingFormData({ ...nursingFormData, description: e.target.value })}
                          rows={2}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Frequency</label>
                        <select
                          value={nursingFormData.frequency_code}
                          onChange={(e) => setNursingFormData({ ...nursingFormData, frequency_code: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="OD">Once Daily</option>
                          <option value="BD">Twice Daily</option>
                          <option value="TDS">Three Times Daily</option>
                          <option value="QID">Four Times Daily</option>
                          <option value="Q4H">Every 4 Hours</option>
                          <option value="Q6H">Every 6 Hours</option>
                          <option value="Q8H">Every 8 Hours</option>
                          <option value="STAT">As Needed</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Instructions</label>
                        <textarea
                          value={nursingFormData.instructions}
                          onChange={(e) => setNursingFormData({ ...nursingFormData, instructions: e.target.value })}
                          rows={2}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
                        <input
                          type="date"
                          value={nursingFormData.start_date}
                          onChange={(e) => setNursingFormData({ ...nursingFormData, start_date: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>

                      <div className="flex gap-2">
                        <button
                          type="submit"
                          disabled={creatingNursingOrder}
                          className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium disabled:opacity-50"
                        >
                          {creatingNursingOrder ? 'Creating...' : 'Create Order'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowNursingForm(false)}
                          className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 font-medium"
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  </div>
                )}

                {nursingOrders.length === 0 ? (
                  <div className="text-center text-gray-500 py-6">No nursing orders found</div>
                ) : (
                  <div className="space-y-4">
                    {nursingOrders.map((nursing) => (
                      <div key={nursing.id} className="bg-white rounded-lg border border-gray-200 p-4">
                        <div className="flex items-start justify-between mb-2">
                          <div>
                            <h4 className="font-bold text-gray-900">{nursing.task_type.replace('-', ' ').toUpperCase()}</h4>
                            <p className="text-sm text-gray-600 mt-1">{nursing.description}</p>
                          </div>
                          <span className="px-2 py-1 bg-blue-100 text-blue-700 text-xs font-medium rounded-full">
                            {nursing.frequency_code}
                          </span>
                        </div>

                        <div className="text-sm text-gray-600 mt-3">
                          {nursing.instructions && (
                            <div className="mb-2">
                              <span className="font-medium">Instructions:</span> {nursing.instructions}
                            </div>
                          )}
                          <div>
                            <span className="font-medium">Started:</span> {formatDateOnly(nursing.start_date)}
                          </div>
                        </div>

                        {nursingTasks[nursing.id]?.length > 0 && (
                          <div className="mt-3 p-3 bg-gray-50 rounded-lg">
                            <div className="text-sm font-medium text-gray-700 mb-2">Recent Tasks:</div>
                            <div className="space-y-1">
                              {nursingTasks[nursing.id].slice(0, 3).map((task) => (
                                <div key={task.id} className="text-xs text-gray-600">
                                  {task.status === 'completed' ? '✓' : '○'} {formatDate(task.scheduled_time)}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        <button className="mt-3 w-full px-3 py-2 bg-green-50 text-green-600 hover:bg-green-100 rounded-lg text-sm font-medium transition-colors">
                          &#x2705; Complete Task
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB: CDS ALERTS */}
          {activeTab === 'cds-alerts' && (
            <div className="max-w-7xl mx-auto px-6 py-6">
              {loadingCdsAlerts ? (
                <div className="text-center text-gray-500 py-12">Loading CDS alerts...</div>
              ) : allCdsAlerts.length === 0 ? (
                <div className="text-center text-gray-500 py-12">No CDS alerts found</div>
              ) : (
                <div className="space-y-4">
                  {['critical', 'warning', 'info']
                    .map((severity) => allCdsAlerts.filter((a) => a.severity === severity))
                    .filter((group) => group.length > 0)
                    .map((alerts, idx) => (
                      <div key={idx}>
                        <h3 className="text-lg font-bold text-gray-900 mb-3 capitalize">{alerts[0].severity} Alerts</h3>
                        <div className="space-y-3">
                          {alerts.map((alert) => (
                            <div
                              key={alert.id}
                              className={`rounded-lg border p-4 ${
                                alert.severity === 'critical'
                                  ? 'bg-red-50 border-red-300'
                                  : alert.severity === 'warning'
                                    ? 'bg-yellow-50 border-yellow-300'
                                    : 'bg-blue-50 border-blue-300'
                              }`}
                            >
                              <div className="flex items-start justify-between mb-2">
                                <div className="flex items-start gap-2">
                                  {alert.severity === 'critical' && (
                                    <span className="text-red-600 text-lg">&#x26A0;</span>
                                  )}
                                  {alert.severity === 'warning' && (
                                    <span className="text-yellow-600 text-lg">!</span>
                                  )}
                                  <div>
                                    <span
                                      className={`inline-block px-2 py-1 text-xs font-medium rounded-full mb-2 ${
                                        alert.severity === 'critical'
                                          ? 'bg-red-200 text-red-800'
                                          : alert.severity === 'warning'
                                            ? 'bg-yellow-200 text-yellow-800'
                                            : 'bg-blue-200 text-blue-800'
                                      }`}
                                    >
                                      {alert.alert_type}
                                    </span>
                                    <p
                                      className={`text-sm font-medium ${
                                        alert.severity === 'critical'
                                          ? 'text-red-900'
                                          : alert.severity === 'warning'
                                            ? 'text-yellow-900'
                                            : 'text-blue-900'
                                      }`}
                                    >
                                      {alert.message}
                                    </p>
                                  </div>
                                </div>
                                <span
                                  className={`px-2 py-1 text-xs font-medium rounded-full ${
                                    alert.outcome === 'accepted'
                                      ? 'bg-green-100 text-green-700'
                                      : alert.outcome === 'overridden'
                                        ? 'bg-orange-100 text-orange-700'
                                        : 'bg-gray-100 text-gray-700'
                                  }`}
                                >
                                  {alert.outcome}
                                </span>
                              </div>

                              {alert.override_reason && (
                                <div
                                  className={`text-xs mb-3 p-2 rounded ${
                                    alert.severity === 'critical'
                                      ? 'bg-red-100 text-red-800'
                                      : alert.severity === 'warning'
                                        ? 'bg-yellow-100 text-yellow-800'
                                        : 'bg-blue-100 text-blue-800'
                                  }`}
                                >
                                  <span className="font-medium">Override reason:</span> {alert.override_reason}
                                </div>
                              )}

                              {alert.outcome === 'pending' && (
                                <div className="mt-3">
                                  {overridingAlert === alert.id ? (
                                    <div className="space-y-2">
                                      <textarea
                                        value={overrideAlertReason}
                                        onChange={(e) => setOverrideAlertReason(e.target.value)}
                                        placeholder="Reason for override..."
                                        rows={2}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                                      />
                                      <div className="flex gap-2">
                                        <button
                                          onClick={() => handleOverrideAlert(alert.id)}
                                          className="flex-1 px-3 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700"
                                        >
                                          Confirm Override
                                        </button>
                                        <button
                                          onClick={() => setOverridingAlert(null)}
                                          className="flex-1 px-3 py-2 bg-gray-200 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-300"
                                        >
                                          Cancel
                                        </button>
                                      </div>
                                    </div>
                                  ) : (
                                    <button
                                      onClick={() => setOverridingAlert(alert.id)}
                                      className="w-full px-3 py-2 bg-red-100 text-red-700 hover:bg-red-200 rounded-lg text-sm font-medium transition-colors"
                                    >
                                      Override Alert
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
