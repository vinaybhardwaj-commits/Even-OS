'use client';

import { useState, useEffect } from 'react';

// ─── TYPES ─────────────────────────────────────────────────────
interface Vital {
  observation_type: string;
  value_quantity: number;
  unit: string;
  effective_datetime: string;
}

interface LatestVitals {
  temperature?: { value: number; unit: string; recorded_at: string };
  pulse?: { value: number; unit: string; recorded_at: string };
  bp_systolic?: { value: number; unit: string; recorded_at: string };
  bp_diastolic?: { value: number; unit: string; recorded_at: string };
  spo2?: { value: number; unit: string; recorded_at: string };
  rr?: { value: number; unit: string; recorded_at: string };
  pain_score?: { value: number; unit: string; recorded_at: string };
  weight?: { value: number; unit: string; recorded_at: string };
  height?: { value: number; unit: string; recorded_at: string };
  bmi?: { value: number; unit: string; recorded_at: string };
}

interface NEWS2Score {
  total_score: number;
  risk_level: 'low' | 'medium' | 'high';
  temperature_score: number;
  systolic_score: number;
  spo2_score: number;
  pulse_score: number;
  rr_score: number;
}

interface IOEntry {
  id: string;
  observation_type: string;
  value_quantity: number;
  unit: string;
  effective_datetime: string;
  io_color?: string;
  io_clarity?: string;
  io_notes?: string;
}

interface IOBalance {
  total_intake_ml: number;
  total_output_ml: number;
  balance_ml: number;
  entries: IOEntry[];
  date: string;
}

interface Alert {
  id: string;
  alert_type: string;
  severity: 'warning' | 'critical';
  message: string;
  actual_value: number;
  unit: string;
  threshold_value: number;
  created_at: string;
  acknowledged_at: string | null;
  acknowledged_by_user_id: string | null;
}

interface Patient {
  id: string;
  uhid: string;
  first_name: string;
  last_name: string;
  date_of_birth: string;
}

// ─── HELPER: Get status color ──────────────────────────────────
function getVitalColor(
  type: string,
  value: number | undefined
): 'green' | 'yellow' | 'red' {
  if (value === undefined) return 'green';

  switch (type) {
    case 'temperature':
      if (value > 39 || value < 35) return 'red';
      if (value > 38.5 || value < 35.5) return 'yellow';
      return 'green';
    case 'pulse':
      if (value > 120) return 'red';
      if (value > 100 || value < 60) return 'yellow';
      return 'green';
    case 'bp_systolic':
      if (value > 180 || value < 90) return 'red';
      if (value > 160 || value < 100) return 'yellow';
      return 'green';
    case 'spo2':
      if (value < 90) return 'red';
      if (value < 95) return 'yellow';
      return 'green';
    case 'rr':
      if (value > 30) return 'red';
      if (value > 24 || value < 12) return 'yellow';
      return 'green';
    case 'pain_score':
      if (value > 7) return 'red';
      if (value > 4) return 'yellow';
      return 'green';
    default:
      return 'green';
  }
}

function getColorClass(color: 'green' | 'yellow' | 'red'): string {
  switch (color) {
    case 'green':
      return 'bg-green-50 border-green-300 text-green-900';
    case 'yellow':
      return 'bg-yellow-50 border-yellow-300 text-yellow-900';
    case 'red':
      return 'bg-red-50 border-red-300 text-red-900';
  }
}

function getAlertBadgeColor(
  severity: 'warning' | 'critical'
): string {
  return severity === 'critical'
    ? 'bg-red-100 text-red-800'
    : 'bg-yellow-100 text-yellow-800';
}

// ─── COMPONENT ────────────────────────────────────────────────
export default function VitalsClient() {
  const [activeTab, setActiveTab] = useState<'vitals' | 'io' | 'alerts' | 'ai'>(
    'vitals'
  );
  const [patientSearch, setPatientSearch] = useState('');
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [selectedEncounter, setSelectedEncounter] = useState('');
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Vitals state
  const [latestVitals, setLatestVitals] = useState<LatestVitals | null>(null);
  const [news2Score, setNews2Score] = useState<NEWS2Score | null>(null);
  const [vitalsHistory, setVitalsHistory] = useState<any[]>([]);
  const [vitalFormData, setVitalFormData] = useState({
    temperature: '',
    pulse: '',
    bp_systolic: '',
    bp_diastolic: '',
    spo2: '',
    rr: '',
    pain_score: '',
    weight: '',
    height: '',
    effective_datetime: new Date().toISOString().slice(0, 16),
  });

  // I/O state
  const [ioBalance, setIOBalance] = useState<IOBalance | null>(null);
  const [ioFormData, setIOFormData] = useState({
    observation_type: 'intake_iv',
    value_quantity: '',
    effective_datetime: new Date().toISOString().slice(0, 16),
    io_color: '',
    io_clarity: '',
    io_notes: '',
  });

  // Alerts state
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [unacknowledgedCount, setUnacknowledgedCount] = useState(0);

  // AI state
  const [aiInsights, setAiInsights] = useState<any[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  // Search patients
  useEffect(() => {
    if (patientSearch.length < 2) {
      setPatients([]);
      return;
    }

    const searchPatients = async () => {
      try {
        const response = await fetch('/api/trpc/patients.search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ json: { query: patientSearch, limit: 10 } }),
        });
        const data = await response.json();
        if (data.result?.data?.success) {
          setPatients(data.result.data.patients || []);
        }
      } catch (err) {
        console.error('Search error:', err);
      }
    };

    const timer = setTimeout(searchPatients, 300);
    return () => clearTimeout(timer);
  }, [patientSearch]);

  // Load vitals when patient selected
  useEffect(() => {
    if (!selectedPatient) return;

    const loadVitals = async () => {
      setLoading(true);
      try {
        const [latestRes, alertsRes, ioRes] = await Promise.all([
          fetch('/api/trpc/observations.getLatestVitals', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              json: { patient_id: selectedPatient.id },
            }),
          }),
          fetch('/api/trpc/observations.checkAlerts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              json: { patient_id: selectedPatient.id },
            }),
          }),
          fetch('/api/trpc/observations.getIntakeOutputBalance', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              json: {
                patient_id: selectedPatient.id,
                encounter_id: selectedEncounter || '00000000-0000-0000-0000-000000000000',
              },
            }),
          }),
        ]);

        const latestData = await latestRes.json();
        const alertsData = await alertsRes.json();
        const ioData = await ioRes.json();

        if (latestData.result?.data?.success) {
          setLatestVitals(latestData.result.data.vitals);
        }
        if (alertsData.result?.data?.success) {
          setAlerts(alertsData.result.data.alerts || []);
          setUnacknowledgedCount(alertsData.result.data.unacknowledged_count || 0);
        }
        if (ioData.result?.data?.success) {
          setIOBalance(ioData.result.data);
        }
      } catch (err) {
        setError('Failed to load vitals');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    loadVitals();
  }, [selectedPatient, selectedEncounter]);

  // Submit vitals
  const handleSubmitVitals = async () => {
    if (!selectedPatient) {
      setError('Please select a patient');
      return;
    }

    const input = {
      patient_id: selectedPatient.id,
      encounter_id: selectedEncounter || '00000000-0000-0000-0000-000000000000',
      effective_datetime: new Date(vitalFormData.effective_datetime).toISOString(),
      ...(vitalFormData.temperature && {
        temperature: parseFloat(vitalFormData.temperature),
      }),
      ...(vitalFormData.pulse && { pulse: parseInt(vitalFormData.pulse, 10) }),
      ...(vitalFormData.bp_systolic && {
        bp_systolic: parseInt(vitalFormData.bp_systolic, 10),
      }),
      ...(vitalFormData.bp_diastolic && {
        bp_diastolic: parseInt(vitalFormData.bp_diastolic, 10),
      }),
      ...(vitalFormData.spo2 && { spo2: parseFloat(vitalFormData.spo2) }),
      ...(vitalFormData.rr && { rr: parseInt(vitalFormData.rr, 10) }),
      ...(vitalFormData.pain_score && {
        pain_score: parseInt(vitalFormData.pain_score, 10),
      }),
      ...(vitalFormData.weight && { weight: parseFloat(vitalFormData.weight) }),
      ...(vitalFormData.height && { height: parseFloat(vitalFormData.height) }),
    };

    try {
      const response = await fetch('/api/trpc/observations.createVitals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ json: input }),
      });

      const data = await response.json();

      if (data.result?.data?.success) {
        setVitalFormData({
          temperature: '',
          pulse: '',
          bp_systolic: '',
          bp_diastolic: '',
          spo2: '',
          rr: '',
          pain_score: '',
          weight: '',
          height: '',
          effective_datetime: new Date().toISOString().slice(0, 16),
        });
        // Reload vitals
        if (selectedPatient) {
          const latestRes = await fetch('/api/trpc/observations.getLatestVitals', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              json: { patient_id: selectedPatient.id },
            }),
          });
          const latestData = await latestRes.json();
          if (latestData.result?.data?.success) {
            setLatestVitals(latestData.result.data.vitals);
          }
        }
      }
    } catch (err) {
      setError('Failed to save vitals');
      console.error(err);
    }
  };

  // Submit I/O
  const handleSubmitIO = async () => {
    if (!selectedPatient) {
      setError('Please select a patient');
      return;
    }

    const input = {
      patient_id: selectedPatient.id,
      encounter_id: selectedEncounter || '00000000-0000-0000-0000-000000000000',
      observation_type: ioFormData.observation_type,
      value_quantity: parseFloat(ioFormData.value_quantity),
      effective_datetime: new Date(ioFormData.effective_datetime).toISOString(),
      ...(ioFormData.io_color && { io_color: ioFormData.io_color }),
      ...(ioFormData.io_clarity && { io_clarity: ioFormData.io_clarity }),
      ...(ioFormData.io_notes && { io_notes: ioFormData.io_notes }),
    };

    try {
      const response = await fetch('/api/trpc/observations.createIntakeOutput', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ json: input }),
      });

      const data = await response.json();

      if (data.result?.data?.success) {
        setIOFormData({
          observation_type: 'intake_iv',
          value_quantity: '',
          effective_datetime: new Date().toISOString().slice(0, 16),
          io_color: '',
          io_clarity: '',
          io_notes: '',
        });
        // Reload I/O
        if (selectedPatient) {
          const ioRes = await fetch('/api/trpc/observations.getIntakeOutputBalance', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              json: {
                patient_id: selectedPatient.id,
                encounter_id: selectedEncounter || '00000000-0000-0000-0000-000000000000',
              },
            }),
          });
          const ioData = await ioRes.json();
          if (ioData.result?.data?.success) {
            setIOBalance(ioData.result.data);
          }
        }
      }
    } catch (err) {
      setError('Failed to save I/O entry');
      console.error(err);
    }
  };

  // Acknowledge alert
  const handleAcknowledgeAlert = async (alertId: string) => {
    try {
      const response = await fetch('/api/trpc/observations.acknowledgeAlert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ json: { alert_id: alertId } }),
      });

      const data = await response.json();

      if (data.result?.data?.success) {
        setAlerts(alerts.filter(a => a.id !== alertId));
        setUnacknowledgedCount(Math.max(0, unacknowledgedCount - 1));
      }
    } catch (err) {
      setError('Failed to acknowledge alert');
      console.error(err);
    }
  };

  // Run clinical scan
  const handleRunClinicalScan = async () => {
    if (!selectedPatient) {
      setAiError('Please select a patient');
      return;
    }

    setAiLoading(true);
    setAiError(null);
    try {
      const response = await fetch('/api/trpc/evenAI.runClinicalScan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ json: { patient_id: selectedPatient.id } }),
      });

      if (!response.ok) throw new Error('Failed to run clinical scan');
      const data = await response.json();

      if (data.result?.data?.json) {
        // Fetch insight cards
        const cardsRes = await fetch(
          `/api/trpc/evenAI.getInsightCards?input=${encodeURIComponent(JSON.stringify({ json: { module: 'clinical' } }))}`,
          { method: 'GET', headers: { 'Content-Type': 'application/json' } }
        );
        const cardsData = await cardsRes.json();
        setAiInsights(cardsData.result?.data?.json || []);
      } else {
        setAiError('No insights generated');
      }
    } catch (err: any) {
      setAiError(err.message || 'Failed to run clinical scan');
    } finally {
      setAiLoading(false);
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity?.toLowerCase()) {
      case 'critical':
        return { bg: '#7f1d1d', text: '#fca5a5' };
      case 'high':
        return { bg: '#7c2d12', text: '#fdba74' };
      case 'medium':
        return { bg: '#713f12', text: '#fcd34d' };
      case 'low':
      default:
        return { bg: '#4c1d95', text: '#e9d5ff' };
    }
  };

  // ─── RENDER ─────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50 p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-800 mb-2">
            &#127777; Enhanced Vitals &amp; Observations
          </h1>
          <p className="text-gray-600">
            Monitor patient vital signs, intake/output, and clinical alerts
          </p>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-300 rounded-lg text-red-800">
            {error}
          </div>
        )}

        {/* Patient Selector */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <label className="block text-sm font-semibold text-gray-700 mb-2">
            Select Patient (Search by name or UHID)
          </label>
          <input
            type="text"
            placeholder="Type patient name or UHID..."
            value={patientSearch}
            onChange={e => setPatientSearch(e.target.value)}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 mb-3"
          />

          {patients.length > 0 && (
            <div className="bg-gray-50 rounded border border-gray-300 max-h-64 overflow-y-auto">
              {patients.map(p => (
                <button
                  key={p.id}
                  onClick={() => {
                    setSelectedPatient(p);
                    setPatientSearch('');
                    setPatients([]);
                  }}
                  className="w-full text-left px-4 py-2 hover:bg-indigo-100 border-b border-gray-200 last:border-b-0 transition"
                >
                  <div className="font-semibold text-gray-800">
                    {p.first_name} {p.last_name}
                  </div>
                  <div className="text-sm text-gray-600">UHID: {p.uhid}</div>
                </button>
              ))}
            </div>
          )}

          {selectedPatient && (
            <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <div className="text-sm font-semibold text-blue-900">
                Selected: {selectedPatient.first_name} {selectedPatient.last_name}
              </div>
              <div className="text-xs text-blue-700">UHID: {selectedPatient.uhid}</div>
            </div>
          )}
        </div>

        {selectedPatient && (
          <>
            {/* Tab Navigation */}
            <div className="flex gap-2 mb-6 bg-white rounded-lg shadow-sm p-1">
              {['vitals', 'io', 'alerts', 'ai'].map(tab => (
                <button
                  key={tab}
                  onClick={() =>
                    setActiveTab(tab as 'vitals' | 'io' | 'alerts' | 'ai')
                  }
                  className={`flex-1 py-3 px-4 rounded-md font-semibold transition ${
                    activeTab === tab
                      ? (tab === 'ai' ? 'bg-violet-600 text-white' : 'bg-indigo-600 text-white')
                      : 'text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  {tab === 'vitals' && '&#127777; Vitals'}
                  {tab === 'io' && '&#128167; Intake/Output'}
                  {tab === 'alerts' && `&#9888; Alerts ${unacknowledgedCount > 0 ? `(${unacknowledgedCount})` : ''}`}
                  {tab === 'ai' && '&#128175; AI Alerts'}
                </button>
              ))}
            </div>

            {/* TAB 1: VITALS */}
            {activeTab === 'vitals' && (
              <div className="space-y-6">
                {/* Latest Vitals Display */}
                {latestVitals && (
                  <>
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
                      {/* Temperature */}
                      {latestVitals.temperature && (
                        <div
                          className={`p-4 rounded-lg border-2 ${getColorClass(
                            getVitalColor('temperature', latestVitals.temperature.value)
                          )}`}
                        >
                          <div className="text-xs font-semibold uppercase opacity-75">
                            &#127777; Temperature
                          </div>
                          <div className="text-2xl font-bold mt-1">
                            {latestVitals.temperature.value}
                          </div>
                          <div className="text-xs mt-1 opacity-75">
                            {latestVitals.temperature.unit}
                          </div>
                        </div>
                      )}

                      {/* Pulse */}
                      {latestVitals.pulse && (
                        <div
                          className={`p-4 rounded-lg border-2 ${getColorClass(
                            getVitalColor('pulse', latestVitals.pulse.value)
                          )}`}
                        >
                          <div className="text-xs font-semibold uppercase opacity-75">
                            &#10084; Pulse
                          </div>
                          <div className="text-2xl font-bold mt-1">
                            {latestVitals.pulse.value}
                          </div>
                          <div className="text-xs mt-1 opacity-75">
                            {latestVitals.pulse.unit}
                          </div>
                        </div>
                      )}

                      {/* BP Systolic */}
                      {latestVitals.bp_systolic && (
                        <div
                          className={`p-4 rounded-lg border-2 ${getColorClass(
                            getVitalColor('bp_systolic', latestVitals.bp_systolic.value)
                          )}`}
                        >
                          <div className="text-xs font-semibold uppercase opacity-75">
                            BP Systolic
                          </div>
                          <div className="text-2xl font-bold mt-1">
                            {latestVitals.bp_systolic.value}
                          </div>
                          <div className="text-xs mt-1 opacity-75">
                            {latestVitals.bp_systolic.unit}
                          </div>
                        </div>
                      )}

                      {/* BP Diastolic */}
                      {latestVitals.bp_diastolic && (
                        <div
                          className={`p-4 rounded-lg border-2 ${getColorClass(getVitalColor('bp_diastolic', latestVitals.bp_diastolic?.value))}`}
                        >
                          <div className="text-xs font-semibold uppercase opacity-75">
                            BP Diastolic
                          </div>
                          <div className="text-2xl font-bold mt-1">
                            {latestVitals.bp_diastolic.value}
                          </div>
                          <div className="text-xs mt-1 opacity-75">
                            {latestVitals.bp_diastolic.unit}
                          </div>
                        </div>
                      )}

                      {/* SpO2 */}
                      {latestVitals.spo2 && (
                        <div
                          className={`p-4 rounded-lg border-2 ${getColorClass(
                            getVitalColor('spo2', latestVitals.spo2.value)
                          )}`}
                        >
                          <div className="text-xs font-semibold uppercase opacity-75">
                            SpO2
                          </div>
                          <div className="text-2xl font-bold mt-1">
                            {latestVitals.spo2.value}
                          </div>
                          <div className="text-xs mt-1 opacity-75">
                            {latestVitals.spo2.unit}
                          </div>
                        </div>
                      )}

                      {/* RR */}
                      {latestVitals.rr && (
                        <div
                          className={`p-4 rounded-lg border-2 ${getColorClass(
                            getVitalColor('rr', latestVitals.rr.value)
                          )}`}
                        >
                          <div className="text-xs font-semibold uppercase opacity-75">
                            &#128168; RR
                          </div>
                          <div className="text-2xl font-bold mt-1">
                            {latestVitals.rr.value}
                          </div>
                          <div className="text-xs mt-1 opacity-75">
                            {latestVitals.rr.unit}
                          </div>
                        </div>
                      )}

                      {/* Pain Score */}
                      {latestVitals.pain_score && (
                        <div
                          className={`p-4 rounded-lg border-2 ${getColorClass(
                            getVitalColor('pain_score', latestVitals.pain_score.value)
                          )}`}
                        >
                          <div className="text-xs font-semibold uppercase opacity-75">
                            Pain Score
                          </div>
                          <div className="text-2xl font-bold mt-1">
                            {latestVitals.pain_score.value}
                          </div>
                          <div className="text-xs mt-1 opacity-75">
                            {latestVitals.pain_score.unit}
                          </div>
                        </div>
                      )}

                      {/* Weight */}
                      {latestVitals.weight && (
                        <div className="p-4 rounded-lg border-2 bg-blue-50 border-blue-300 text-blue-900">
                          <div className="text-xs font-semibold uppercase opacity-75">
                            Weight
                          </div>
                          <div className="text-2xl font-bold mt-1">
                            {latestVitals.weight.value}
                          </div>
                          <div className="text-xs mt-1 opacity-75">
                            {latestVitals.weight.unit}
                          </div>
                        </div>
                      )}

                      {/* Height */}
                      {latestVitals.height && (
                        <div className="p-4 rounded-lg border-2 bg-blue-50 border-blue-300 text-blue-900">
                          <div className="text-xs font-semibold uppercase opacity-75">
                            Height
                          </div>
                          <div className="text-2xl font-bold mt-1">
                            {latestVitals.height.value}
                          </div>
                          <div className="text-xs mt-1 opacity-75">
                            {latestVitals.height.unit}
                          </div>
                        </div>
                      )}

                      {/* BMI */}
                      {latestVitals.bmi && (
                        <div className="p-4 rounded-lg border-2 bg-purple-50 border-purple-300 text-purple-900">
                          <div className="text-xs font-semibold uppercase opacity-75">
                            &#128202; BMI
                          </div>
                          <div className="text-2xl font-bold mt-1">
                            {latestVitals.bmi.value.toFixed(1)}
                          </div>
                          <div className="text-xs mt-1 opacity-75">
                            {latestVitals.bmi.unit}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* NEWS2 Score */}
                    {latestVitals.temperature ||
                    latestVitals.pulse ||
                    latestVitals.bp_systolic ||
                    latestVitals.spo2 ||
                    latestVitals.rr ? (
                      <div className="bg-white rounded-lg shadow-md p-6">
                        <h3 className="text-lg font-semibold text-gray-800 mb-4">
                          &#128202; NEWS2 Score
                        </h3>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                          <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
                            <div className="text-xs font-semibold text-gray-600 uppercase">
                              Total Score
                            </div>
                            <div className="text-3xl font-bold text-gray-800 mt-1">
                              {latestVitals.temperature ? '—' : 'N/A'}
                            </div>
                          </div>
                          <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
                            <div className="text-xs font-semibold text-gray-600 uppercase">
                              Risk Level
                            </div>
                            <div className="text-sm font-semibold mt-1">
                              {latestVitals.temperature ? (
                                <span className="inline-block px-3 py-1 rounded-full bg-green-100 text-green-800">
                                  Low
                                </span>
                              ) : (
                                'N/A'
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </>
                )}

                {/* Record Vitals Form */}
                <div className="bg-white rounded-lg shadow-md p-6">
                  <h3 className="text-lg font-semibold text-gray-800 mb-4">
                    Record Vitals
                  </h3>

                  <div className="mb-4">
                    <label className="block text-sm font-semibold text-gray-700 mb-1">
                      Date &amp; Time
                    </label>
                    <input
                      type="datetime-local"
                      value={vitalFormData.effective_datetime}
                      onChange={e =>
                        setVitalFormData({
                          ...vitalFormData,
                          effective_datetime: e.target.value,
                        })
                      }
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-1">
                        &#127777; Temperature (°C)
                      </label>
                      <input
                        type="number"
                        step="0.1"
                        placeholder="e.g., 37.5"
                        value={vitalFormData.temperature}
                        onChange={e =>
                          setVitalFormData({
                            ...vitalFormData,
                            temperature: e.target.value,
                          })
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-1">
                        &#10084; Pulse (bpm)
                      </label>
                      <input
                        type="number"
                        placeholder="e.g., 80"
                        value={vitalFormData.pulse}
                        onChange={e =>
                          setVitalFormData({
                            ...vitalFormData,
                            pulse: e.target.value,
                          })
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-1">
                        BP Sys (mmHg)
                      </label>
                      <input
                        type="number"
                        placeholder="e.g., 120"
                        value={vitalFormData.bp_systolic}
                        onChange={e =>
                          setVitalFormData({
                            ...vitalFormData,
                            bp_systolic: e.target.value,
                          })
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-1">
                        BP Dia (mmHg)
                      </label>
                      <input
                        type="number"
                        placeholder="e.g., 80"
                        value={vitalFormData.bp_diastolic}
                        onChange={e =>
                          setVitalFormData({
                            ...vitalFormData,
                            bp_diastolic: e.target.value,
                          })
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-1">
                        SpO2 (%)
                      </label>
                      <input
                        type="number"
                        placeholder="e.g., 98"
                        value={vitalFormData.spo2}
                        onChange={e =>
                          setVitalFormData({
                            ...vitalFormData,
                            spo2: e.target.value,
                          })
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-1">
                        &#128168; RR (breaths/min)
                      </label>
                      <input
                        type="number"
                        placeholder="e.g., 18"
                        value={vitalFormData.rr}
                        onChange={e =>
                          setVitalFormData({
                            ...vitalFormData,
                            rr: e.target.value,
                          })
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-1">
                        Pain Score (0-10)
                      </label>
                      <input
                        type="number"
                        min="0"
                        max="10"
                        placeholder="e.g., 2"
                        value={vitalFormData.pain_score}
                        onChange={e =>
                          setVitalFormData({
                            ...vitalFormData,
                            pain_score: e.target.value,
                          })
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-1">
                        Weight (kg)
                      </label>
                      <input
                        type="number"
                        step="0.1"
                        placeholder="e.g., 70"
                        value={vitalFormData.weight}
                        onChange={e =>
                          setVitalFormData({
                            ...vitalFormData,
                            weight: e.target.value,
                          })
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-1">
                        Height (cm)
                      </label>
                      <input
                        type="number"
                        placeholder="e.g., 170"
                        value={vitalFormData.height}
                        onChange={e =>
                          setVitalFormData({
                            ...vitalFormData,
                            height: e.target.value,
                          })
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                  </div>

                  <button
                    onClick={handleSubmitVitals}
                    className="mt-6 w-full bg-indigo-600 text-white py-3 rounded-lg font-semibold hover:bg-indigo-700 transition"
                  >
                    Save Vitals
                  </button>
                </div>

                {/* Vitals History */}
                <div className="bg-white rounded-lg shadow-md p-6">
                  <h3 className="text-lg font-semibold text-gray-800 mb-4">
                    Recent Vitals History
                  </h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-100 border-b border-gray-300">
                        <tr>
                          <th className="text-left px-4 py-2 font-semibold">
                            Datetime
                          </th>
                          <th className="text-left px-4 py-2 font-semibold">
                            Temperature
                          </th>
                          <th className="text-left px-4 py-2 font-semibold">
                            Pulse
                          </th>
                          <th className="text-left px-4 py-2 font-semibold">
                            BP
                          </th>
                          <th className="text-left px-4 py-2 font-semibold">
                            SpO2
                          </th>
                          <th className="text-left px-4 py-2 font-semibold">
                            RR
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {vitalsHistory.length > 0 ? (
                          vitalsHistory.map((entry, idx) => (
                            <tr
                              key={idx}
                              className="border-b border-gray-200 hover:bg-gray-50"
                            >
                              <td className="px-4 py-3">
                                {new Date(
                                  entry.effective_datetime
                                ).toLocaleString()}
                              </td>
                              <td className="px-4 py-3">—</td>
                              <td className="px-4 py-3">—</td>
                              <td className="px-4 py-3">—</td>
                              <td className="px-4 py-3">—</td>
                              <td className="px-4 py-3">—</td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td
                              colSpan={6}
                              className="px-4 py-3 text-center text-gray-500"
                            >
                              No vitals recorded yet
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 2: INTAKE/OUTPUT */}
            {activeTab === 'io' && (
              <div className="space-y-6">
                {/* I/O Balance */}
                {ioBalance && (
                  <div className="bg-white rounded-lg shadow-md p-6">
                    <h3 className="text-lg font-semibold text-gray-800 mb-4">
                      24h Intake/Output Balance
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="p-6 bg-blue-50 border-2 border-blue-300 rounded-lg">
                        <div className="text-sm font-semibold text-blue-700 uppercase">
                          Total Intake
                        </div>
                        <div className="text-3xl font-bold text-blue-900 mt-2">
                          {ioBalance.total_intake_ml}
                        </div>
                        <div className="text-xs text-blue-700 mt-1">ml</div>
                      </div>

                      <div className="p-6 bg-orange-50 border-2 border-orange-300 rounded-lg">
                        <div className="text-sm font-semibold text-orange-700 uppercase">
                          Total Output
                        </div>
                        <div className="text-3xl font-bold text-orange-900 mt-2">
                          {ioBalance.total_output_ml}
                        </div>
                        <div className="text-xs text-orange-700 mt-1">ml</div>
                      </div>

                      <div
                        className={`p-6 rounded-lg border-2 ${
                          Math.abs(ioBalance.balance_ml) > 500
                            ? 'bg-red-50 border-red-300'
                            : 'bg-green-50 border-green-300'
                        }`}
                      >
                        <div
                          className={`text-sm font-semibold uppercase ${
                            Math.abs(ioBalance.balance_ml) > 500
                              ? 'text-red-700'
                              : 'text-green-700'
                          }`}
                        >
                          Net Balance
                        </div>
                        <div
                          className={`text-3xl font-bold mt-2 ${
                            Math.abs(ioBalance.balance_ml) > 500
                              ? 'text-red-900'
                              : 'text-green-900'
                          }`}
                        >
                          {ioBalance.balance_ml > 0 ? '+' : ''}
                          {ioBalance.balance_ml}
                        </div>
                        <div
                          className={`text-xs mt-1 ${
                            Math.abs(ioBalance.balance_ml) > 500
                              ? 'text-red-700'
                              : 'text-green-700'
                          }`}
                        >
                          ml
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Record I/O Form */}
                <div className="bg-white rounded-lg shadow-md p-6">
                  <h3 className="text-lg font-semibold text-gray-800 mb-4">
                    Record Intake/Output
                  </h3>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-1">
                        Type
                      </label>
                      <select
                        value={ioFormData.observation_type}
                        onChange={e =>
                          setIOFormData({
                            ...ioFormData,
                            observation_type: e.target.value,
                          })
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      >
                        <option value="intake_iv">IV Intake</option>
                        <option value="intake_oral">Oral Intake</option>
                        <option value="output_urine">Urine Output</option>
                        <option value="output_drain">Drain Output</option>
                        <option value="output_emesis">Emesis Output</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-1">
                        Volume (ml)
                      </label>
                      <input
                        type="number"
                        min="0"
                        placeholder="e.g., 500"
                        value={ioFormData.value_quantity}
                        onChange={e =>
                          setIOFormData({
                            ...ioFormData,
                            value_quantity: e.target.value,
                          })
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-1">
                        Date &amp; Time
                      </label>
                      <input
                        type="datetime-local"
                        value={ioFormData.effective_datetime}
                        onChange={e =>
                          setIOFormData({
                            ...ioFormData,
                            effective_datetime: e.target.value,
                          })
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-1">
                        Color (optional)
                      </label>
                      <input
                        type="text"
                        placeholder="e.g., clear, amber"
                        value={ioFormData.io_color}
                        onChange={e =>
                          setIOFormData({
                            ...ioFormData,
                            io_color: e.target.value,
                          })
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-1">
                        Clarity (optional)
                      </label>
                      <input
                        type="text"
                        placeholder="e.g., clear, cloudy"
                        value={ioFormData.io_clarity}
                        onChange={e =>
                          setIOFormData({
                            ...ioFormData,
                            io_clarity: e.target.value,
                          })
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                  </div>

                  <div className="mb-4">
                    <label className="block text-sm font-semibold text-gray-700 mb-1">
                      Notes (optional)
                    </label>
                    <textarea
                      placeholder="Any additional notes..."
                      value={ioFormData.io_notes}
                      onChange={e =>
                        setIOFormData({
                          ...ioFormData,
                          io_notes: e.target.value,
                        })
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      rows={3}
                    />
                  </div>

                  <button
                    onClick={handleSubmitIO}
                    className="w-full bg-indigo-600 text-white py-3 rounded-lg font-semibold hover:bg-indigo-700 transition"
                  >
                    Record I/O Entry
                  </button>
                </div>

                {/* I/O Log */}
                <div className="bg-white rounded-lg shadow-md p-6">
                  <h3 className="text-lg font-semibold text-gray-800 mb-4">
                    I/O Log
                  </h3>
                  <div className="space-y-2">
                    {ioBalance?.entries && ioBalance.entries.length > 0 ? (
                      ioBalance.entries.map((entry, idx) => (
                        <div
                          key={idx}
                          className="p-3 bg-gray-50 border border-gray-200 rounded-lg"
                        >
                          <div className="flex justify-between items-start">
                            <div>
                              <div className="font-semibold text-gray-800">
                                {entry.observation_type.replace(/_/g, ' ').toUpperCase()}
                              </div>
                              <div className="text-sm text-gray-600">
                                {entry.value_quantity} {entry.unit}
                              </div>
                              {entry.io_color && (
                                <div className="text-xs text-gray-500">
                                  Color: {entry.io_color}
                                </div>
                              )}
                              {entry.io_clarity && (
                                <div className="text-xs text-gray-500">
                                  Clarity: {entry.io_clarity}
                                </div>
                              )}
                              {entry.io_notes && (
                                <div className="text-xs text-gray-500">
                                  Notes: {entry.io_notes}
                                </div>
                              )}
                            </div>
                            <div className="text-xs text-gray-500">
                              {new Date(entry.effective_datetime).toLocaleString()}
                            </div>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="text-center text-gray-500 py-6">
                        No I/O entries recorded yet
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* TAB 3: ALERTS */}
            {activeTab === 'alerts' && (
              <div className="space-y-6">
                <div className="bg-white rounded-lg shadow-md p-6">
                  <h3 className="text-lg font-semibold text-gray-800 mb-4">
                    &#9888; Clinical Alerts ({unacknowledgedCount} Unacknowledged)
                  </h3>

                  {alerts.length > 0 ? (
                    <div className="space-y-3">
                      {alerts.map(alert => (
                        <div
                          key={alert.id}
                          className="p-4 border-l-4 border-gray-300 bg-gray-50 rounded-lg"
                        >
                          <div className="flex justify-between items-start gap-4">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-2">
                                <span
                                  className={`px-3 py-1 rounded-full text-xs font-semibold ${getAlertBadgeColor(
                                    alert.severity
                                  )}`}
                                >
                                  {alert.severity.toUpperCase()}
                                </span>
                                <span className="font-semibold text-gray-800">
                                  {alert.alert_type.replace(/_/g, ' ').toUpperCase()}
                                </span>
                              </div>
                              <div className="text-sm text-gray-700 mb-2">
                                {alert.message}
                              </div>
                              <div className="text-xs text-gray-500">
                                Actual: {alert.actual_value} {alert.unit} | Threshold:{' '}
                                {alert.threshold_value} {alert.unit}
                              </div>
                              <div className="text-xs text-gray-500 mt-1">
                                {new Date(alert.created_at).toLocaleString()}
                              </div>
                            </div>
                            <button
                              onClick={() => handleAcknowledgeAlert(alert.id)}
                              className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-700 transition whitespace-nowrap"
                            >
                              Acknowledge
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center text-gray-500 py-8">
                      &#10003; All alerts acknowledged. Great job!
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}

            {/* TAB 4: AI ALERTS */}
            {activeTab === 'ai' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div style={{ marginBottom: '12px' }}>
                  <button
                    onClick={handleRunClinicalScan}
                    disabled={aiLoading}
                    style={{
                      padding: '12px 24px',
                      backgroundColor: aiLoading ? '#9333ea' : '#7c3aed',
                      border: 'none',
                      borderRadius: '6px',
                      color: '#e9d5ff',
                      cursor: aiLoading ? 'not-allowed' : 'pointer',
                      fontSize: '14px',
                      fontWeight: 600,
                    }}
                  >
                    {aiLoading ? 'Scanning...' : '&#128175; Run Clinical Scan'}
                  </button>
                </div>

                {aiError && (
                  <div style={{ padding: '12px', backgroundColor: '#7f1d1d', border: '1px solid #dc2626', borderRadius: '4px', color: '#fca5a5', fontSize: '13px' }}>
                    {aiError}
                  </div>
                )}

                {aiInsights.length > 0 && (
                  <div>
                    <div style={{ marginBottom: '12px', fontSize: '13px', color: '#666' }}>
                      Found {aiInsights.length} clinical insight{aiInsights.length !== 1 ? 's' : ''}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                      {aiInsights.map((card, idx) => {
                        const colors = getSeverityColor(card.severity);
                        return (
                          <div
                            key={idx}
                            style={{
                              backgroundColor: colors.bg,
                              border: `1px solid ${colors.text}`,
                              borderRadius: '6px',
                              padding: '12px',
                              color: colors.text,
                            }}
                          >
                            <div style={{ fontWeight: 600, marginBottom: '4px', fontSize: '13px' }}>{card.title}</div>
                            <div style={{ fontSize: '12px', lineHeight: '1.5', marginBottom: '8px' }}>{card.description}</div>
                            {card.metadata && (
                              <div style={{ fontSize: '11px', opacity: 0.8 }}>
                                {Object.entries(card.metadata).map(([key, val]) => (
                                  <div key={key}>
                                    {key}: {String(val)}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {aiInsights.length === 0 && !aiLoading && !aiError && (
                  <div style={{ textAlign: 'center', padding: '40px 20px', color: '#999', fontSize: '13px' }}>
                    Click "Run Clinical Scan" to analyze vitals for clinical alerts
                  </div>
                )}
              </div>
            )}
      </div>
    </div>
  );
}
