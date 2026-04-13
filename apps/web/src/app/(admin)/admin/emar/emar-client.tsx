'use client';

import { useState, useEffect, useCallback } from 'react';

// ─── Types ───────────────────────────────────────────────
type TabType = 'schedule' | 'administer' | 'held' | 'analytics';

interface Medication {
  request_id: string;
  drug_name: string;
  dose_quantity: number | null;
  dose_unit: string | null;
  route: string | null;
  time_slot: string;
  scheduled_datetime: string;
  administration: {
    id: string;
    status: string;
    administered_datetime: string | null;
    dose_given: number | null;
    route: string | null;
  } | null;
}

interface TimeSlot {
  time_slot: string;
  medications: Medication[];
}

interface AnalyticsData {
  total_administrations: number;
  on_time_rate: number;
  barcode_scan_rate: number;
  top_held_medications: Array<{ drug_name: string; hold_count: number }>;
  refusal_count: number;
}

// ─── tRPC helpers ────────────────────────────────────────
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
    body: JSON.stringify(input),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || 'Request failed');
  return json.result?.data?.json;
}

// ─── Status colors and labels ────────────────────────────
const getStatusColor = (status?: string): string => {
  switch (status) {
    case 'completed':
      return '#10b981';
    case 'pending':
      return '#f59e0b';
    case 'held':
      return '#8b7355';
    case 'not_done':
      return '#f97316';
    case 'overdue':
      return '#ef4444';
    default:
      return '#6b7280';
  }
};

const getStatusLabel = (status?: string): string => {
  switch (status) {
    case 'completed':
      return '&#x2713;';
    case 'pending':
      return '&#x23F0;';
    case 'held':
      return '&#x26A0;';
    case 'not_done':
      return '&#x2717;';
    case 'overdue':
      return '!';
    default:
      return '&#x2192;';
  }
};

// ─── Main component ──────────────────────────────────────
export function EmarClient() {
  const [activeTab, setActiveTab] = useState<TabType>('schedule');
  const [encounterId, setEncounterId] = useState('');
  const [patientId, setPatientId] = useState('');
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);

  // Schedule state
  const [schedule, setSchedule] = useState<TimeSlot[]>([]);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [scheduleError, setScheduleError] = useState('');

  // Administer form state
  const [selectedMedication, setSelectedMedication] = useState<Medication | null>(null);
  const [rightPatientConfirmed, setRightPatientConfirmed] = useState(false);
  const [rightDrugConfirmed, setRightDrugConfirmed] = useState(false);
  const [rightDoseConfirmed, setRightDoseConfirmed] = useState(false);
  const [rightRouteConfirmed, setRightRouteConfirmed] = useState(false);
  const [rightTimeConfirmed, setRightTimeConfirmed] = useState(false);
  const [doseGiven, setDoseGiven] = useState('');
  const [administrationSite, setAdministrationSite] = useState('');
  const [notes, setNotes] = useState('');
  const [patientBarcodeScanned, setPatientBarcodeScanned] = useState(false);
  const [medicationBarcodeScanned, setMedicationBarcodeScanned] = useState(false);
  const [recordingLoading, setRecordingLoading] = useState(false);

  // Analytics state
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsError, setAnalyticsError] = useState('');

  // Load schedule when encounter and date change
  useEffect(() => {
    if (!encounterId) return;

    const loadSchedule = async () => {
      setScheduleLoading(true);
      setScheduleError('');
      try {
        const data = await trpcQuery('medicationOrders.emarSchedule', {
          encounter_id: encounterId,
          date: selectedDate,
        });
        setSchedule(Array.isArray(data) ? data : []);
      } catch (err) {
        setScheduleError(err instanceof Error ? err.message : 'Failed to load schedule');
      } finally {
        setScheduleLoading(false);
      }
    };

    loadSchedule();
  }, [encounterId, selectedDate]);

  // Load analytics when tab is active
  useEffect(() => {
    if (activeTab !== 'analytics') return;

    const loadAnalytics = async () => {
      setAnalyticsLoading(true);
      setAnalyticsError('');
      try {
        const data = await trpcQuery('medicationOrders.emarAnalytics');
        setAnalytics(data || null);
      } catch (err) {
        setAnalyticsError(err instanceof Error ? err.message : 'Failed to load analytics');
      } finally {
        setAnalyticsLoading(false);
      }
    };

    loadAnalytics();
  }, [activeTab]);

  const handleRecordAdministration = async () => {
    if (!selectedMedication || !encounterId || !patientId) return;

    setRecordingLoading(true);
    try {
      await trpcMutate('medicationOrders.emarRecord', {
        medication_request_id: selectedMedication.request_id,
        encounter_id: encounterId,
        patient_id: patientId,
        scheduled_datetime: selectedMedication.scheduled_datetime,
        dose_given: parseFloat(doseGiven) || 0,
        dose_unit: selectedMedication.dose_unit || '',
        route: selectedMedication.route || '',
        patient_barcode_scanned: patientBarcodeScanned,
        medication_barcode_scanned: medicationBarcodeScanned,
        administration_site: administrationSite || undefined,
        notes: notes || undefined,
      });

      // Reset form
      setSelectedMedication(null);
      setDoseGiven('');
      setAdministrationSite('');
      setNotes('');
      setRightPatientConfirmed(false);
      setRightDrugConfirmed(false);
      setRightDoseConfirmed(false);
      setRightRouteConfirmed(false);
      setRightTimeConfirmed(false);
      setPatientBarcodeScanned(false);
      setMedicationBarcodeScanned(false);

      // Reload schedule
      if (encounterId) {
        const data = await trpcQuery('medicationOrders.emarSchedule', {
          encounter_id: encounterId,
          date: selectedDate,
        });
        setSchedule(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error('Failed to record administration:', err);
    } finally {
      setRecordingLoading(false);
    }
  };

  const handleHoldMedication = async (med: Medication) => {
    if (!encounterId || !patientId) return;

    try {
      await trpcMutate('medicationOrders.emarHold', {
        medication_request_id: med.request_id,
        encounter_id: encounterId,
        patient_id: patientId,
        scheduled_datetime: med.scheduled_datetime,
        hold_reason: 'Held by nurse',
      });

      // Reload schedule
      const data = await trpcQuery('medicationOrders.emarSchedule', {
        encounter_id: encounterId,
        date: selectedDate,
      });
      setSchedule(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to hold medication:', err);
    }
  };

  const handleRefuseMedication = async (med: Medication) => {
    if (!encounterId || !patientId) return;

    try {
      await trpcMutate('medicationOrders.emarRefuse', {
        medication_request_id: med.request_id,
        encounter_id: encounterId,
        patient_id: patientId,
        scheduled_datetime: med.scheduled_datetime,
        not_done_reason: 'Patient refused',
      });

      // Reload schedule
      const data = await trpcQuery('medicationOrders.emarSchedule', {
        encounter_id: encounterId,
        date: selectedDate,
      });
      setSchedule(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to refuse medication:', err);
    }
  };

  // ─── Dark theme colors ──────────────────────────────────
  const containerStyle = { backgroundColor: '#16213e', color: '#e0e0e0', minHeight: '100vh' };
  const headerStyle = { backgroundColor: '#0f3460', borderBottom: '1px solid #1a1a2e', padding: '24px' };
  const cardStyle = { backgroundColor: '#1a1a2e', border: '1px solid #0f3460', borderRadius: '6px' };
  const inputStyle = {
    backgroundColor: '#16213e',
    border: '1px solid #0f3460',
    color: '#e0e0e0',
    borderRadius: '4px',
    padding: '8px 12px',
    fontSize: '14px',
  };
  const buttonStyle = (variant: 'primary' | 'secondary' | 'danger' = 'primary') => ({
    padding: '8px 16px',
    borderRadius: '4px',
    fontSize: '14px',
    fontWeight: '500',
    border: 'none',
    cursor: 'pointer',
    transition: 'all 0.2s',
    ...(variant === 'primary' && { backgroundColor: '#0f3460', color: '#e0e0e0' }),
    ...(variant === 'secondary' && { backgroundColor: '#2a3f5f', color: '#e0e0e0' }),
    ...(variant === 'danger' && { backgroundColor: '#dc2626', color: '#fff' }),
  });

  return (
    <div style={containerStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <h1 style={{ fontSize: '28px', fontWeight: 'bold', margin: '0 0 8px 0' }}>
          Electronic Medication Administration Record
        </h1>
        <p style={{ fontSize: '14px', color: '#a0a0a0', margin: '0' }}>
          Manage and track medication administration
        </p>
      </div>

      {/* Tabs */}
      <div style={{ backgroundColor: '#0f3460', borderBottom: '1px solid #1a1a2e', padding: '0' }}>
        <div style={{ display: 'flex', gap: '2px', padding: '0 24px' }}>
          {(['schedule', 'administer', 'held', 'analytics'] as TabType[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                padding: '12px 16px',
                border: 'none',
                backgroundColor: activeTab === tab ? '#1a1a2e' : 'transparent',
                color: activeTab === tab ? '#e0e0e0' : '#888',
                cursor: 'pointer',
                borderBottom: activeTab === tab ? '2px solid #10b981' : 'none',
                fontSize: '14px',
                fontWeight: activeTab === tab ? '500' : '400',
              }}
            >
              {tab === 'schedule' && 'MAR Schedule'}
              {tab === 'administer' && 'Administer'}
              {tab === 'held' && 'Held/Refused'}
              {tab === 'analytics' && 'Analytics'}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      <div style={{ padding: '24px' }}>
        {/* TAB 1: Schedule */}
        {activeTab === 'schedule' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            {/* Filters */}
            <div style={{ ...cardStyle, padding: '16px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
              <div>
                <label style={{ fontSize: '12px', fontWeight: '600', display: 'block', marginBottom: '8px', textTransform: 'uppercase', color: '#a0a0a0' }}>
                  Patient ID
                </label>
                <input
                  type="text"
                  placeholder="Enter patient UUID"
                  value={patientId}
                  onChange={(e) => setPatientId(e.target.value)}
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={{ fontSize: '12px', fontWeight: '600', display: 'block', marginBottom: '8px', textTransform: 'uppercase', color: '#a0a0a0' }}>
                  Encounter ID
                </label>
                <input
                  type="text"
                  placeholder="Enter encounter UUID"
                  value={encounterId}
                  onChange={(e) => setEncounterId(e.target.value)}
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={{ fontSize: '12px', fontWeight: '600', display: 'block', marginBottom: '8px', textTransform: 'uppercase', color: '#a0a0a0' }}>
                  Date
                </label>
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  style={inputStyle}
                />
              </div>
            </div>

            {/* Loading state */}
            {scheduleLoading && (
              <div style={{ ...cardStyle, padding: '48px', textAlign: 'center', color: '#888' }}>
                Loading schedule...
              </div>
            )}

            {/* Error state */}
            {scheduleError && (
              <div style={{ ...cardStyle, padding: '16px', border: '1px solid #dc2626', backgroundColor: '#1a1a2e' }}>
                <p style={{ color: '#f87171', fontSize: '14px', margin: '0' }}>Error: {scheduleError}</p>
              </div>
            )}

            {/* Empty state */}
            {!scheduleLoading && schedule.length === 0 && !scheduleError && (
              <div style={{ ...cardStyle, padding: '48px', textAlign: 'center', color: '#888' }}>
                No medications scheduled for this encounter on {selectedDate}
              </div>
            )}

            {/* Table */}
            {schedule.length > 0 && (
              <div style={{ ...cardStyle, overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #0f3460' }}>
                      <th style={{ padding: '12px', textAlign: 'left', fontSize: '12px', fontWeight: '600', textTransform: 'uppercase', color: '#a0a0a0' }}>
                        Time
                      </th>
                      <th style={{ padding: '12px', textAlign: 'left', fontSize: '12px', fontWeight: '600', textTransform: 'uppercase', color: '#a0a0a0' }}>
                        Drug
                      </th>
                      <th style={{ padding: '12px', textAlign: 'left', fontSize: '12px', fontWeight: '600', textTransform: 'uppercase', color: '#a0a0a0' }}>
                        Dose
                      </th>
                      <th style={{ padding: '12px', textAlign: 'left', fontSize: '12px', fontWeight: '600', textTransform: 'uppercase', color: '#a0a0a0' }}>
                        Route
                      </th>
                      <th style={{ padding: '12px', textAlign: 'left', fontSize: '12px', fontWeight: '600', textTransform: 'uppercase', color: '#a0a0a0' }}>
                        Status
                      </th>
                      <th style={{ padding: '12px', textAlign: 'left', fontSize: '12px', fontWeight: '600', textTransform: 'uppercase', color: '#a0a0a0' }}>
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {schedule.map((slot) =>
                      slot.medications.map((med, idx) => (
                        <tr
                          key={`${slot.time_slot}-${med.request_id}-${idx}`}
                          style={{ borderBottom: '1px solid #0f3460' }}
                        >
                          <td style={{ padding: '12px', fontSize: '14px', fontFamily: 'monospace' }}>
                            {slot.time_slot}
                          </td>
                          <td style={{ padding: '12px', fontSize: '14px' }}>{med.drug_name}</td>
                          <td style={{ padding: '12px', fontSize: '14px', color: '#a0a0a0' }}>
                            {med.dose_quantity} {med.dose_unit}
                          </td>
                          <td style={{ padding: '12px', fontSize: '14px', color: '#a0a0a0' }}>
                            {med.route?.toUpperCase()}
                          </td>
                          <td style={{ padding: '12px' }}>
                            <div
                              style={{
                                width: '24px',
                                height: '24px',
                                borderRadius: '4px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: '12px',
                                fontWeight: 'bold',
                                backgroundColor: getStatusColor(med.administration?.status),
                                color: '#fff',
                              }}
                              dangerouslySetInnerHTML={{ __html: getStatusLabel(med.administration?.status) }}
                            />
                          </td>
                          <td style={{ padding: '12px', display: 'flex', gap: '8px' }}>
                            {!med.administration || med.administration.status === 'pending' ? (
                              <>
                                <button
                                  onClick={() => setSelectedMedication(med)}
                                  style={{ ...buttonStyle('primary'), fontSize: '12px', padding: '6px 12px' }}
                                >
                                  Give
                                </button>
                                <button
                                  onClick={() => handleHoldMedication(med)}
                                  style={{ ...buttonStyle('secondary'), fontSize: '12px', padding: '6px 12px' }}
                                >
                                  Hold
                                </button>
                              </>
                            ) : null}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: Administer */}
        {activeTab === 'administer' && (
          <div>
            {!selectedMedication ? (
              <div style={{ ...cardStyle, padding: '48px', textAlign: 'center', color: '#888' }}>
                Select a medication from the MAR Schedule tab to administer
              </div>
            ) : (
              <div style={{ ...cardStyle, padding: '24px', maxWidth: '600px' }}>
                {/* Selected med display */}
                <div style={{ ...cardStyle, padding: '12px', marginBottom: '24px', backgroundColor: '#0f3460' }}>
                  <p style={{ fontSize: '12px', fontWeight: '600', textTransform: 'uppercase', color: '#a0a0a0', margin: '0 0 8px 0' }}>
                    Selected Medication
                  </p>
                  <p style={{ fontSize: '14px', margin: '0' }}>
                    {selectedMedication.drug_name} {selectedMedication.dose_quantity} {selectedMedication.dose_unit} {selectedMedication.route?.toUpperCase()}
                  </p>
                </div>

                {/* 5 Rights */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '24px' }}>
                  <h3 style={{ fontSize: '14px', fontWeight: '600', textTransform: 'uppercase', margin: '0', color: '#a0a0a0' }}>
                    5 Rights Verification
                  </h3>

                  {/* Right 1: Patient */}
                  <div style={{ border: '1px solid #0f3460', borderRadius: '4px', padding: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                      <input
                        type="checkbox"
                        id="right_patient"
                        checked={rightPatientConfirmed}
                        onChange={(e) => setRightPatientConfirmed(e.target.checked)}
                        style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                      />
                      <label htmlFor="right_patient" style={{ flex: 1, fontSize: '14px', fontWeight: '500', cursor: 'pointer', margin: '0' }}>
                        Right Patient
                      </label>
                    </div>
                    <label style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '8px', color: '#a0a0a0', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={patientBarcodeScanned}
                        onChange={(e) => setPatientBarcodeScanned(e.target.checked)}
                        style={{ width: '14px', height: '14px', cursor: 'pointer' }}
                      />
                      Patient barcode scanned
                    </label>
                  </div>

                  {/* Right 2: Drug */}
                  <div style={{ border: '1px solid #0f3460', borderRadius: '4px', padding: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                      <input
                        type="checkbox"
                        id="right_drug"
                        checked={rightDrugConfirmed}
                        onChange={(e) => setRightDrugConfirmed(e.target.checked)}
                        style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                      />
                      <label htmlFor="right_drug" style={{ flex: 1, fontSize: '14px', fontWeight: '500', cursor: 'pointer', margin: '0' }}>
                        Right Drug
                      </label>
                    </div>
                    <p style={{ fontSize: '12px', color: '#a0a0a0', margin: '0 0 8px 0' }}>
                      Drug: {selectedMedication.drug_name}
                    </p>
                    <label style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '8px', color: '#a0a0a0', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={medicationBarcodeScanned}
                        onChange={(e) => setMedicationBarcodeScanned(e.target.checked)}
                        style={{ width: '14px', height: '14px', cursor: 'pointer' }}
                      />
                      Medication barcode scanned
                    </label>
                  </div>

                  {/* Right 3: Dose */}
                  <div style={{ border: '1px solid #0f3460', borderRadius: '4px', padding: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                      <input
                        type="checkbox"
                        id="right_dose"
                        checked={rightDoseConfirmed}
                        onChange={(e) => setRightDoseConfirmed(e.target.checked)}
                        style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                      />
                      <label htmlFor="right_dose" style={{ flex: 1, fontSize: '14px', fontWeight: '500', cursor: 'pointer', margin: '0' }}>
                        Right Dose
                      </label>
                    </div>
                    <p style={{ fontSize: '12px', color: '#a0a0a0', margin: '0 0 12px 0' }}>
                      Prescribed: {selectedMedication.dose_quantity} {selectedMedication.dose_unit}
                    </p>
                    <input
                      type="number"
                      step="0.1"
                      placeholder="Dose actually given"
                      value={doseGiven}
                      onChange={(e) => setDoseGiven(e.target.value)}
                      style={inputStyle}
                    />
                  </div>

                  {/* Right 4: Route */}
                  <div style={{ border: '1px solid #0f3460', borderRadius: '4px', padding: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                      <input
                        type="checkbox"
                        id="right_route"
                        checked={rightRouteConfirmed}
                        onChange={(e) => setRightRouteConfirmed(e.target.checked)}
                        style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                      />
                      <label htmlFor="right_route" style={{ flex: 1, fontSize: '14px', fontWeight: '500', cursor: 'pointer', margin: '0' }}>
                        Right Route
                      </label>
                    </div>
                    <p style={{ fontSize: '12px', color: '#a0a0a0', margin: '0' }}>
                      Route: {selectedMedication.route?.toUpperCase()}
                    </p>
                  </div>

                  {/* Right 5: Time */}
                  <div style={{ border: '1px solid #0f3460', borderRadius: '4px', padding: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                      <input
                        type="checkbox"
                        id="right_time"
                        checked={rightTimeConfirmed}
                        onChange={(e) => setRightTimeConfirmed(e.target.checked)}
                        style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                      />
                      <label htmlFor="right_time" style={{ flex: 1, fontSize: '14px', fontWeight: '500', cursor: 'pointer', margin: '0' }}>
                        Right Time
                      </label>
                    </div>
                    <p style={{ fontSize: '12px', color: '#a0a0a0', margin: '0' }}>
                      Scheduled: {selectedMedication.time_slot} | Current: {new Date().toLocaleTimeString()}
                    </p>
                  </div>
                </div>

                {/* Additional fields */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '24px', paddingTop: '24px', borderTop: '1px solid #0f3460' }}>
                  <div>
                    <label style={{ fontSize: '12px', fontWeight: '600', display: 'block', marginBottom: '8px', textTransform: 'uppercase', color: '#a0a0a0' }}>
                      Administration Site (Optional)
                    </label>
                    <input
                      type="text"
                      placeholder="e.g., Left Arm, Right Buttock"
                      value={administrationSite}
                      onChange={(e) => setAdministrationSite(e.target.value)}
                      style={inputStyle}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '12px', fontWeight: '600', display: 'block', marginBottom: '8px', textTransform: 'uppercase', color: '#a0a0a0' }}>
                      Notes (Optional)
                    </label>
                    <textarea
                      placeholder="Any additional notes about administration"
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      rows={3}
                      style={{ ...inputStyle, fontFamily: 'inherit', resize: 'vertical' }}
                    />
                  </div>
                </div>

                {/* Buttons */}
                <div style={{ display: 'flex', gap: '12px', paddingTop: '24px', borderTop: '1px solid #0f3460' }}>
                  <button
                    onClick={() => setSelectedMedication(null)}
                    style={{ ...buttonStyle('secondary'), flex: 0 }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleRecordAdministration}
                    disabled={
                      !rightPatientConfirmed ||
                      !rightDrugConfirmed ||
                      !rightDoseConfirmed ||
                      !rightRouteConfirmed ||
                      !rightTimeConfirmed ||
                      !doseGiven ||
                      !patientId ||
                      !encounterId ||
                      recordingLoading
                    }
                    style={{
                      ...buttonStyle('primary'),
                      flex: 1,
                      backgroundColor:
                        !rightPatientConfirmed ||
                        !rightDrugConfirmed ||
                        !rightDoseConfirmed ||
                        !rightRouteConfirmed ||
                        !rightTimeConfirmed ||
                        !doseGiven ||
                        !patientId ||
                        !encounterId
                          ? '#555'
                          : '#10b981',
                      opacity:
                        !rightPatientConfirmed ||
                        !rightDrugConfirmed ||
                        !rightDoseConfirmed ||
                        !rightRouteConfirmed ||
                        !rightTimeConfirmed ||
                        !doseGiven ||
                        !patientId ||
                        !encounterId
                          ? '0.5'
                          : '1',
                      cursor:
                        !rightPatientConfirmed ||
                        !rightDrugConfirmed ||
                        !rightDoseConfirmed ||
                        !rightRouteConfirmed ||
                        !rightTimeConfirmed ||
                        !doseGiven ||
                        !patientId ||
                        !encounterId
                          ? 'not-allowed'
                          : 'pointer',
                    }}
                  >
                    {recordingLoading ? 'Recording...' : 'Record Administration'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 3: Held/Refused */}
        {activeTab === 'held' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            {/* Filters */}
            <div style={{ ...cardStyle, padding: '16px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
              <div>
                <label style={{ fontSize: '12px', fontWeight: '600', display: 'block', marginBottom: '8px', textTransform: 'uppercase', color: '#a0a0a0' }}>
                  Patient ID
                </label>
                <input
                  type="text"
                  placeholder="Enter patient UUID"
                  value={patientId}
                  onChange={(e) => setPatientId(e.target.value)}
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={{ fontSize: '12px', fontWeight: '600', display: 'block', marginBottom: '8px', textTransform: 'uppercase', color: '#a0a0a0' }}>
                  Encounter ID
                </label>
                <input
                  type="text"
                  placeholder="Enter encounter UUID"
                  value={encounterId}
                  onChange={(e) => setEncounterId(e.target.value)}
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={{ fontSize: '12px', fontWeight: '600', display: 'block', marginBottom: '8px', textTransform: 'uppercase', color: '#a0a0a0' }}>
                  Date
                </label>
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  style={inputStyle}
                />
              </div>
            </div>

            {/* Held list */}
            {schedule.length === 0 ? (
              <div style={{ ...cardStyle, padding: '48px', textAlign: 'center', color: '#888' }}>
                No data loaded
              </div>
            ) : (
              <div style={cardStyle}>
                <h3 style={{ fontSize: '14px', fontWeight: '600', padding: '16px', borderBottom: '1px solid #0f3460', margin: '0' }}>
                  Held & Refused Medications
                </h3>
                <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {schedule
                    .flatMap((slot) =>
                      slot.medications.filter(
                        (med) =>
                          med.administration &&
                          (med.administration.status === 'held' || med.administration.status === 'not_done')
                      )
                    )
                    .map((med) => (
                      <div
                        key={`${med.request_id}-${med.scheduled_datetime}`}
                        style={{ border: '1px solid #0f3460', borderRadius: '4px', padding: '12px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px' }}
                      >
                        <div>
                          <p style={{ fontSize: '11px', fontWeight: '600', textTransform: 'uppercase', color: '#a0a0a0', margin: '0 0 4px 0' }}>
                            Drug
                          </p>
                          <p style={{ fontSize: '14px', margin: '0' }}>{med.drug_name}</p>
                        </div>
                        <div>
                          <p style={{ fontSize: '11px', fontWeight: '600', textTransform: 'uppercase', color: '#a0a0a0', margin: '0 0 4px 0' }}>
                            Time
                          </p>
                          <p style={{ fontSize: '14px', margin: '0' }}>{med.time_slot}</p>
                        </div>
                        <div>
                          <p style={{ fontSize: '11px', fontWeight: '600', textTransform: 'uppercase', color: '#a0a0a0', margin: '0 0 4px 0' }}>
                            Status
                          </p>
                          <span
                            style={{
                              display: 'inline-block',
                              padding: '4px 8px',
                              borderRadius: '3px',
                              fontSize: '12px',
                              fontWeight: '600',
                              backgroundColor: med.administration?.status === 'held' ? '#2a2a4a' : '#4a2a2a',
                              color: med.administration?.status === 'held' ? '#a78bfa' : '#fca5a5',
                            }}
                          >
                            {med.administration?.status === 'held' ? 'Held' : 'Refused'}
                          </span>
                        </div>
                        <div>
                          <p style={{ fontSize: '11px', fontWeight: '600', textTransform: 'uppercase', color: '#a0a0a0', margin: '0 0 4px 0' }}>
                            Date
                          </p>
                          <p style={{ fontSize: '14px', margin: '0' }}>
                            {new Date(med.scheduled_datetime).toLocaleDateString()}
                          </p>
                        </div>
                      </div>
                    ))}
                  {schedule
                    .flatMap((slot) =>
                      slot.medications.filter(
                        (med) =>
                          med.administration &&
                          (med.administration.status === 'held' || med.administration.status === 'not_done')
                      )
                    )
                    .length === 0 && (
                    <p style={{ textAlign: 'center', color: '#888', margin: '16px 0' }}>
                      No held or refused medications
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 4: Analytics */}
        {activeTab === 'analytics' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            {analyticsLoading && (
              <div style={{ ...cardStyle, padding: '48px', textAlign: 'center', color: '#888' }}>
                Loading analytics...
              </div>
            )}

            {analyticsError && (
              <div style={{ ...cardStyle, padding: '16px', border: '1px solid #dc2626' }}>
                <p style={{ color: '#f87171', fontSize: '14px', margin: '0' }}>Error: {analyticsError}</p>
              </div>
            )}

            {analytics && (
              <>
                {/* Metric cards */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
                  <div style={cardStyle}>
                    <div style={{ padding: '16px' }}>
                      <p style={{ fontSize: '12px', fontWeight: '600', textTransform: 'uppercase', color: '#a0a0a0', margin: '0 0 8px 0' }}>
                        Total Administrations
                      </p>
                      <p style={{ fontSize: '28px', fontWeight: '700', margin: '0' }}>
                        {analytics.total_administrations}
                      </p>
                      <p style={{ fontSize: '11px', color: '#888', margin: '8px 0 0 0' }}>Today</p>
                    </div>
                  </div>

                  <div style={cardStyle}>
                    <div style={{ padding: '16px' }}>
                      <p style={{ fontSize: '12px', fontWeight: '600', textTransform: 'uppercase', color: '#a0a0a0', margin: '0 0 8px 0' }}>
                        On-Time Rate
                      </p>
                      <p style={{ fontSize: '28px', fontWeight: '700', margin: '0', color: '#10b981' }}>
                        {analytics.on_time_rate}%
                      </p>
                      <div style={{ width: '100%', height: '4px', backgroundColor: '#0f3460', borderRadius: '2px', marginTop: '8px' }}>
                        <div
                          style={{
                            width: `${analytics.on_time_rate}%`,
                            height: '100%',
                            backgroundColor: '#10b981',
                            borderRadius: '2px',
                          }}
                        />
                      </div>
                    </div>
                  </div>

                  <div style={cardStyle}>
                    <div style={{ padding: '16px' }}>
                      <p style={{ fontSize: '12px', fontWeight: '600', textTransform: 'uppercase', color: '#a0a0a0', margin: '0 0 8px 0' }}>
                        Barcode Compliance
                      </p>
                      <p style={{ fontSize: '28px', fontWeight: '700', margin: '0', color: '#3b82f6' }}>
                        {analytics.barcode_scan_rate}%
                      </p>
                      <div style={{ width: '100%', height: '4px', backgroundColor: '#0f3460', borderRadius: '2px', marginTop: '8px' }}>
                        <div
                          style={{
                            width: `${analytics.barcode_scan_rate}%`,
                            height: '100%',
                            backgroundColor: '#3b82f6',
                            borderRadius: '2px',
                          }}
                        />
                      </div>
                    </div>
                  </div>

                  <div style={cardStyle}>
                    <div style={{ padding: '16px' }}>
                      <p style={{ fontSize: '12px', fontWeight: '600', textTransform: 'uppercase', color: '#a0a0a0', margin: '0 0 8px 0' }}>
                        Refusals/Holds
                      </p>
                      <p style={{ fontSize: '28px', fontWeight: '700', margin: '0', color: '#f97316' }}>
                        {analytics.refusal_count}
                      </p>
                      <p style={{ fontSize: '11px', color: '#888', margin: '8px 0 0 0' }}>Not completed</p>
                    </div>
                  </div>
                </div>

                {/* Top held medications */}
                {analytics.top_held_medications.length > 0 && (
                  <div style={cardStyle}>
                    <h3 style={{ fontSize: '14px', fontWeight: '600', padding: '16px', borderBottom: '1px solid #0f3460', margin: '0' }}>
                      Top Held Medications
                    </h3>
                    <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {analytics.top_held_medications.map((med, idx) => (
                        <div
                          key={idx}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            padding: '8px',
                            backgroundColor: '#0f3460',
                            borderRadius: '4px',
                          }}
                        >
                          <span style={{ fontSize: '14px', fontWeight: '500' }}>{med.drug_name}</span>
                          <span
                            style={{
                              fontSize: '12px',
                              fontWeight: '600',
                              padding: '4px 8px',
                              borderRadius: '3px',
                              backgroundColor: '#5f3f1a',
                              color: '#fbbf24',
                            }}
                          >
                            {med.hold_count} holds
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
