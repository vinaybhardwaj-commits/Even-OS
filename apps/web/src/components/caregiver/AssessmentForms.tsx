'use client';

import { useState } from 'react';

// ── tRPC helpers ────────────────────────────────────────────────────────────
async function trpcQuery(path: string, input?: any) {
  const wrapped = input !== undefined ? { json: input } : { json: {} };
  const params = `?input=${encodeURIComponent(JSON.stringify(wrapped))}`;
  const res = await fetch(`/api/trpc/${path}${params}`);
  const json = await res.json();
  if (json.error) return null;
  return json.result?.data?.json;
}

async function trpcMutate(path: string, input: any) {
  const res = await fetch(`/api/trpc/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ json: input }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error?.message || 'Failed');
  return json.result?.data?.json;
}

// ── Assessment Definitions ───────────────────────────────────────────────────

const ASSESSMENTS = [
  { key: 'pain', label: 'Pain Assessment (NRS)', icon: '😣', frequency_hours: 4, required: true },
  { key: 'morse_falls', label: 'Morse Fall Scale', icon: '🦿', frequency_hours: 8, required: true },
  { key: 'braden', label: 'Braden Pressure Injury', icon: '🩹', frequency_hours: 24, required: true },
  { key: 'restraint', label: 'Restraint Check', icon: '🔒', frequency_hours: 2, required: false },
  { key: 'skin', label: 'Skin Assessment', icon: '🔍', frequency_hours: 8, required: true },
  { key: 'general', label: 'General Nursing Note', icon: '📝', frequency_hours: 0, required: false },
];

function getStatus(latestAssessment: any, frequencyHours: number): { status: 'done' | 'overdue' | 'due' | 'not_due'; label: string; color: string } {
  if (!latestAssessment) {
    return frequencyHours > 0
      ? { status: 'due', label: 'Not yet done', color: '#F59E0B' }
      : { status: 'not_due', label: 'Optional', color: '#6B7280' };
  }
  if (frequencyHours === 0) {
    return { status: 'done', label: 'Done', color: '#22C55E' };
  }
  const age = (Date.now() - new Date(latestAssessment.created_at).getTime()) / 3600000;
  if (age > frequencyHours) {
    return { status: 'overdue', label: 'Overdue', color: '#DC2626' };
  }
  if (age > frequencyHours * 0.75) {
    return { status: 'due', label: 'Due soon', color: '#F59E0B' };
  }
  return { status: 'done', label: `Done ${Math.round(age)}h ago`, color: '#22C55E' };
}

// ── Props ────────────────────────────────────────────────────────────────────

interface AssessmentFormsProps {
  patientId: string;
  encounterId: string;
  assignmentId?: string;
}

// ── Component ────────────────────────────────────────────────────────────────

export default function AssessmentForms({ patientId, encounterId, assignmentId }: AssessmentFormsProps) {
  const [latestByKey, setLatestByKey] = useState<Record<string, any>>({});
  const [loaded, setLoaded] = useState(false);
  const [activeForm, setActiveForm] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [historyKey, setHistoryKey] = useState<string | null>(null);
  const [historyRows, setHistoryRows] = useState<any[]>([]);

  // Form-specific state
  const [painScore, setPainScore] = useState(0);
  const [painData, setPainData] = useState({ location: '', character: '', interventions: '' });
  const [morseData, setMorseData] = useState({
    history_of_falling: false, secondary_diagnosis: false,
    ambulatory_aid: 'none', iv_or_heparin_lock: false,
    gait: 'normal', mental_status: 'oriented',
  });
  const [bradenData, setBradenData] = useState({
    sensory_perception: 4, moisture: 4, activity: 4,
    mobility: 4, nutrition: 4, friction_shear: 3,
  });
  const [restraintData, setRestraintData] = useState({
    restraint_type: '', circulation_status: 'adequate',
    skin_integrity: 'intact', restraint_continues: true, notes: '',
  });
  const [skinData, setSkinData] = useState({
    integrity: 'intact', areas_of_concern: '', wound_count: 0,
    iv_site_status: '', notes: '',
  });
  const [generalNotes, setGeneralNotes] = useState('');

  // Load latest assessments
  const loadLatest = async () => {
    const data = await trpcQuery('nursingAssessments.latest', {
      patient_id: patientId, encounter_id: encounterId,
    });
    setLatestByKey(data || {});
    setLoaded(true);
  };

  if (!loaded) loadLatest();

  // Load history
  const loadHistory = async (key: string) => {
    setHistoryKey(key);
    const data = await trpcQuery('nursingAssessments.history', {
      patient_id: patientId, encounter_id: encounterId, assessment_key: key,
    });
    setHistoryRows(data || []);
  };

  // Submit handler
  const handleSubmit = async () => {
    setSaving(true);
    setSaveResult(null);
    try {
      const base = {
        patient_id: patientId,
        encounter_id: encounterId,
        assignment_id: assignmentId,
        assessment_type: 'routine' as const,
        assessment_key: activeForm!,
      };

      let payload: any = { ...base };

      switch (activeForm) {
        case 'pain':
          payload.pain_score = painScore;
          payload.assessment_data = painData;
          payload.notes = `Pain: ${painScore}/10 at ${painData.location || 'unspecified'}`;
          break;
        case 'morse_falls':
          payload.assessment_data = morseData;
          break;
        case 'braden':
          payload.assessment_data = bradenData;
          break;
        case 'restraint':
          payload.assessment_data = restraintData;
          payload.notes = restraintData.notes;
          break;
        case 'skin':
          payload.assessment_data = skinData;
          payload.wound_status = skinData.wound_count > 0 ? `${skinData.wound_count} wounds` : 'none';
          payload.iv_site_status = skinData.iv_site_status;
          payload.notes = skinData.notes;
          break;
        case 'general':
          payload.notes = generalNotes;
          payload.assessment_data = { notes: generalNotes };
          break;
      }

      const result = await trpcMutate('nursingAssessments.submit', payload);
      setSaveResult({ type: 'success', msg: `Assessment saved${result.scores?.score !== undefined ? ` (Score: ${result.scores.score})` : ''}` });
      setActiveForm(null);
      await loadLatest();
    } catch (err: any) {
      setSaveResult({ type: 'error', msg: err.message || 'Failed to save' });
    } finally {
      setSaving(false);
    }
  };

  // ── Assessment List View ───────────────────────────────────────────────
  if (!activeForm && !historyKey) {
    return (
      <div className="space-y-3">
        <h3 className="text-base font-semibold" style={{ color: 'var(--care-text)' }}>
          Nursing Assessments
        </h3>

        {saveResult && (
          <div className={`text-sm p-2 rounded ${saveResult.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
            {saveResult.msg}
          </div>
        )}

        {ASSESSMENTS.map(a => {
          const latest = latestByKey[a.key];
          const s = getStatus(latest, a.frequency_hours);
          return (
            <div key={a.key} className="rounded-lg border p-3 flex items-center gap-3"
              style={{ backgroundColor: 'var(--care-surface)', borderColor: 'var(--care-border)' }}>
              <span className="text-2xl">{a.icon}</span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold" style={{ color: 'var(--care-text)' }}>{a.label}</div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: s.color }} />
                  <span className="text-xs" style={{ color: s.color }}>{s.label}</span>
                  {latest && (
                    <button onClick={() => loadHistory(a.key)}
                      className="text-xs underline ml-1" style={{ color: 'var(--care-primary)' }}>
                      History
                    </button>
                  )}
                </div>
                {/* Show latest score if available */}
                {latest && a.key === 'pain' && latest.pain_score !== null && (
                  <div className="text-xs mt-0.5" style={{ color: 'var(--care-text-muted)' }}>
                    Last: {latest.pain_score}/10
                  </div>
                )}
                {latest && a.key === 'morse_falls' && latest.fall_risk_score !== null && (
                  <div className="text-xs mt-0.5" style={{ color: 'var(--care-text-muted)' }}>
                    Last: {latest.fall_risk_score} ({(latest.assessment_data as any)?._scores?.risk || 'unknown'})
                  </div>
                )}
                {latest && a.key === 'braden' && latest.braden_score !== null && (
                  <div className="text-xs mt-0.5" style={{ color: 'var(--care-text-muted)' }}>
                    Last: {latest.braden_score}/23 ({(latest.assessment_data as any)?._scores?.risk || 'unknown'})
                  </div>
                )}
              </div>
              <button onClick={() => { setActiveForm(a.key); setSaveResult(null); }}
                className="px-3 py-2 rounded-lg text-sm font-medium text-white touch-manipulation"
                style={{ backgroundColor: s.status === 'overdue' ? '#DC2626' : 'var(--care-primary)' }}>
                {s.status === 'overdue' ? 'Do Now' : 'Start'}
              </button>
            </div>
          );
        })}
      </div>
    );
  }

  // ── History View ───────────────────────────────────────────────────────
  if (historyKey) {
    const def = ASSESSMENTS.find(a => a.key === historyKey);
    return (
      <div className="space-y-3">
        <button onClick={() => setHistoryKey(null)}
          className="text-sm font-medium flex items-center gap-1" style={{ color: 'var(--care-primary)' }}>
          ← Back to Assessments
        </button>
        <h3 className="text-base font-semibold" style={{ color: 'var(--care-text)' }}>
          {def?.icon} {def?.label} History
        </h3>
        {historyRows.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--care-text-muted)' }}>No history found.</p>
        ) : (
          <div className="space-y-2">
            {historyRows.map((row: any) => (
              <div key={row.id} className="rounded-lg border p-3"
                style={{ backgroundColor: 'var(--care-surface)', borderColor: 'var(--care-border)' }}>
                <div className="flex items-center justify-between">
                  <span className="text-xs" style={{ color: 'var(--care-text-muted)' }}>
                    {new Date(row.created_at).toLocaleString('en-IN')}
                  </span>
                  {row.is_flagged && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700">Flagged</span>
                  )}
                </div>
                {row.pain_score !== null && (
                  <div className="text-sm font-medium mt-1" style={{ color: 'var(--care-text)' }}>Pain: {row.pain_score}/10</div>
                )}
                {row.fall_risk_score !== null && (
                  <div className="text-sm font-medium mt-1" style={{ color: 'var(--care-text)' }}>Morse: {row.fall_risk_score}</div>
                )}
                {row.braden_score !== null && (
                  <div className="text-sm font-medium mt-1" style={{ color: 'var(--care-text)' }}>Braden: {row.braden_score}/23</div>
                )}
                {row.notes && (
                  <div className="text-xs mt-1" style={{ color: 'var(--care-text-secondary)' }}>{row.notes}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── Individual Assessment Forms ────────────────────────────────────────

  return (
    <div className="space-y-4">
      <button onClick={() => setActiveForm(null)}
        className="text-sm font-medium flex items-center gap-1" style={{ color: 'var(--care-primary)' }}>
        ← Back to Assessments
      </button>

      {/* ═══ PAIN ASSESSMENT ═══ */}
      {activeForm === 'pain' && (
        <div className="space-y-4">
          <h3 className="text-base font-semibold" style={{ color: 'var(--care-text)' }}>😣 Pain Assessment (NRS)</h3>
          <div>
            <label className="block text-xs font-medium mb-2" style={{ color: 'var(--care-text-secondary)' }}>Pain Score (0-10)</label>
            <div className="flex gap-1.5">
              {Array.from({ length: 11 }, (_, i) => (
                <button key={i} onClick={() => setPainScore(i)}
                  className={`flex-1 h-12 rounded-lg text-sm font-bold transition-colors touch-manipulation`}
                  style={{
                    backgroundColor: painScore === i
                      ? (i <= 3 ? '#22C55E' : i <= 6 ? '#F59E0B' : '#DC2626')
                      : 'var(--care-surface-hover)',
                    color: painScore === i ? 'white' : 'var(--care-text)',
                  }}>
                  {i}
                </button>
              ))}
            </div>
            <div className="flex justify-between text-[10px] mt-1 px-1" style={{ color: 'var(--care-text-muted)' }}>
              <span>No pain</span><span>Moderate</span><span>Worst pain</span>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--care-text-secondary)' }}>Location</label>
            <input type="text" value={painData.location}
              onChange={(e) => setPainData({ ...painData, location: e.target.value })}
              placeholder="e.g. Lower back, Right knee"
              className="w-full h-12 rounded-lg border px-3 text-sm touch-manipulation"
              style={{ borderColor: 'var(--care-border)', backgroundColor: 'white' }}
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--care-text-secondary)' }}>Character</label>
            <div className="flex flex-wrap gap-2">
              {['Sharp', 'Dull', 'Throbbing', 'Burning', 'Aching', 'Cramping', 'Stabbing'].map(c => (
                <button key={c} onClick={() => setPainData({ ...painData, character: c.toLowerCase() })}
                  className={`px-3 py-2 rounded-lg text-xs font-medium border touch-manipulation ${
                    painData.character === c.toLowerCase() ? 'border-blue-500 bg-blue-50' : ''
                  }`}
                  style={{ borderColor: painData.character === c.toLowerCase() ? undefined : 'var(--care-border)' }}>
                  {c}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--care-text-secondary)' }}>Interventions</label>
            <textarea value={painData.interventions}
              onChange={(e) => setPainData({ ...painData, interventions: e.target.value })}
              placeholder="e.g. Position change, ice pack, medication given"
              rows={2}
              className="w-full rounded-lg border px-3 py-2 text-sm touch-manipulation"
              style={{ borderColor: 'var(--care-border)', backgroundColor: 'white' }}
            />
          </div>
        </div>
      )}

      {/* ═══ MORSE FALL SCALE ═══ */}
      {activeForm === 'morse_falls' && (
        <div className="space-y-3">
          <h3 className="text-base font-semibold" style={{ color: 'var(--care-text)' }}>🦿 Morse Fall Scale</h3>
          {[
            { key: 'history_of_falling', label: 'History of falling (past 3 months)', points: 25, type: 'bool' },
            { key: 'secondary_diagnosis', label: 'Secondary diagnosis (≥2 medical diagnoses)', points: 15, type: 'bool' },
            { key: 'ambulatory_aid', label: 'Ambulatory aid', points: '0/15/30', type: 'select',
              options: [{ v: 'none', l: 'None / bed rest / nurse assist (0)' }, { v: 'furniture', l: 'Furniture (15)' }, { v: 'crutches_cane_walker', l: 'Crutches / cane / walker (30)' }] },
            { key: 'iv_or_heparin_lock', label: 'IV / heparin lock', points: 20, type: 'bool' },
            { key: 'gait', label: 'Gait', points: '0/10/20', type: 'select',
              options: [{ v: 'normal', l: 'Normal / bed rest / immobile (0)' }, { v: 'impaired', l: 'Impaired (10)' }, { v: 'weak', l: 'Weak (20)' }] },
            { key: 'mental_status', label: 'Mental status', points: '0/15', type: 'select',
              options: [{ v: 'oriented', l: 'Oriented to own ability (0)' }, { v: 'forgets_limitations', l: 'Forgets limitations (15)' }] },
          ].map(item => (
            <div key={item.key} className="flex items-center justify-between py-2 border-b"
              style={{ borderColor: 'var(--care-border)' }}>
              <div className="flex-1">
                <div className="text-sm" style={{ color: 'var(--care-text)' }}>{item.label}</div>
                <div className="text-[10px]" style={{ color: 'var(--care-text-muted)' }}>+{item.points} pts</div>
              </div>
              {item.type === 'bool' ? (
                <button onClick={() => setMorseData({ ...morseData, [item.key]: !(morseData as any)[item.key] })}
                  className={`w-14 h-8 rounded-full transition-colors ${
                    (morseData as any)[item.key] ? 'bg-red-500' : 'bg-gray-300'
                  }`}>
                  <div className={`w-6 h-6 rounded-full bg-white shadow transition-transform ${
                    (morseData as any)[item.key] ? 'translate-x-7' : 'translate-x-1'
                  }`} />
                </button>
              ) : (
                <select value={(morseData as any)[item.key]}
                  onChange={(e) => setMorseData({ ...morseData, [item.key]: e.target.value })}
                  className="text-sm rounded-lg border px-2 py-1.5"
                  style={{ borderColor: 'var(--care-border)' }}>
                  {item.options!.map((o: any) => (
                    <option key={o.v} value={o.v}>{o.l}</option>
                  ))}
                </select>
              )}
            </div>
          ))}
          {/* Live score preview */}
          <div className="rounded-lg p-3 text-center" style={{ backgroundColor: 'var(--care-surface-hover)' }}>
            <div className="text-xs" style={{ color: 'var(--care-text-muted)' }}>Predicted Score</div>
            <div className="text-2xl font-bold" style={{ color: 'var(--care-text)' }}>
              {(() => {
                let s = 0;
                if (morseData.history_of_falling) s += 25;
                if (morseData.secondary_diagnosis) s += 15;
                if (morseData.ambulatory_aid === 'furniture') s += 15;
                else if (morseData.ambulatory_aid === 'crutches_cane_walker') s += 30;
                if (morseData.iv_or_heparin_lock) s += 20;
                if (morseData.gait === 'impaired') s += 10;
                else if (morseData.gait === 'weak') s += 20;
                if (morseData.mental_status === 'forgets_limitations') s += 15;
                return s;
              })()}
            </div>
            <div className="text-xs" style={{ color: (() => {
              let s = 0;
              if (morseData.history_of_falling) s += 25;
              if (morseData.secondary_diagnosis) s += 15;
              if (morseData.ambulatory_aid === 'furniture') s += 15;
              else if (morseData.ambulatory_aid === 'crutches_cane_walker') s += 30;
              if (morseData.iv_or_heparin_lock) s += 20;
              if (morseData.gait === 'impaired') s += 10;
              else if (morseData.gait === 'weak') s += 20;
              if (morseData.mental_status === 'forgets_limitations') s += 15;
              return s >= 45 ? '#DC2626' : s >= 25 ? '#F59E0B' : '#22C55E';
            })() }}>
              {(() => {
                let s = 0;
                if (morseData.history_of_falling) s += 25;
                if (morseData.secondary_diagnosis) s += 15;
                if (morseData.ambulatory_aid === 'furniture') s += 15;
                else if (morseData.ambulatory_aid === 'crutches_cane_walker') s += 30;
                if (morseData.iv_or_heparin_lock) s += 20;
                if (morseData.gait === 'impaired') s += 10;
                else if (morseData.gait === 'weak') s += 20;
                if (morseData.mental_status === 'forgets_limitations') s += 15;
                return s >= 45 ? 'HIGH RISK' : s >= 25 ? 'MODERATE RISK' : 'LOW RISK';
              })()}
            </div>
          </div>
        </div>
      )}

      {/* ═══ BRADEN SCALE ═══ */}
      {activeForm === 'braden' && (
        <div className="space-y-3">
          <h3 className="text-base font-semibold" style={{ color: 'var(--care-text)' }}>🩹 Braden Pressure Injury Scale</h3>
          {[
            { key: 'sensory_perception', label: 'Sensory Perception', max: 4,
              options: ['Completely Limited (1)', 'Very Limited (2)', 'Slightly Limited (3)', 'No Impairment (4)'] },
            { key: 'moisture', label: 'Moisture', max: 4,
              options: ['Constantly Moist (1)', 'Very Moist (2)', 'Occasionally Moist (3)', 'Rarely Moist (4)'] },
            { key: 'activity', label: 'Activity', max: 4,
              options: ['Bedfast (1)', 'Chairfast (2)', 'Walks Occasionally (3)', 'Walks Frequently (4)'] },
            { key: 'mobility', label: 'Mobility', max: 4,
              options: ['Completely Immobile (1)', 'Very Limited (2)', 'Slightly Limited (3)', 'No Limitations (4)'] },
            { key: 'nutrition', label: 'Nutrition', max: 4,
              options: ['Very Poor (1)', 'Probably Inadequate (2)', 'Adequate (3)', 'Excellent (4)'] },
            { key: 'friction_shear', label: 'Friction & Shear', max: 3,
              options: ['Problem (1)', 'Potential Problem (2)', 'No Apparent Problem (3)'] },
          ].map(item => (
            <div key={item.key} className="border-b pb-3" style={{ borderColor: 'var(--care-border)' }}>
              <div className="text-sm font-medium mb-2" style={{ color: 'var(--care-text)' }}>{item.label}</div>
              <div className="flex flex-col gap-1">
                {item.options.map((opt, i) => (
                  <button key={i} onClick={() => setBradenData({ ...bradenData, [item.key]: i + 1 })}
                    className={`text-left px-3 py-2 rounded-lg text-xs border transition-colors touch-manipulation ${
                      (bradenData as any)[item.key] === i + 1 ? 'border-blue-500 bg-blue-50 font-semibold' : ''
                    }`}
                    style={{ borderColor: (bradenData as any)[item.key] === i + 1 ? undefined : 'var(--care-border)' }}>
                    {opt}
                  </button>
                ))}
              </div>
            </div>
          ))}
          {/* Live score */}
          <div className="rounded-lg p-3 text-center" style={{ backgroundColor: 'var(--care-surface-hover)' }}>
            <div className="text-xs" style={{ color: 'var(--care-text-muted)' }}>Total Score</div>
            <div className="text-2xl font-bold" style={{ color: 'var(--care-text)' }}>
              {bradenData.sensory_perception + bradenData.moisture + bradenData.activity + bradenData.mobility + bradenData.nutrition + bradenData.friction_shear}/23
            </div>
            <div className="text-xs" style={{ color: (() => {
              const s = bradenData.sensory_perception + bradenData.moisture + bradenData.activity + bradenData.mobility + bradenData.nutrition + bradenData.friction_shear;
              return s <= 12 ? '#DC2626' : s <= 14 ? '#F59E0B' : '#22C55E';
            })() }}>
              {(() => {
                const s = bradenData.sensory_perception + bradenData.moisture + bradenData.activity + bradenData.mobility + bradenData.nutrition + bradenData.friction_shear;
                return s <= 9 ? 'VERY HIGH RISK' : s <= 12 ? 'HIGH RISK' : s <= 14 ? 'MODERATE RISK' : s <= 18 ? 'MILD RISK' : 'NO RISK';
              })()}
            </div>
          </div>
        </div>
      )}

      {/* ═══ RESTRAINT CHECK ═══ */}
      {activeForm === 'restraint' && (
        <div className="space-y-3">
          <h3 className="text-base font-semibold" style={{ color: 'var(--care-text)' }}>🔒 Restraint Check</h3>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--care-text-secondary)' }}>Restraint Type</label>
            <select value={restraintData.restraint_type}
              onChange={(e) => setRestraintData({ ...restraintData, restraint_type: e.target.value })}
              className="w-full h-12 rounded-lg border px-3 text-sm"
              style={{ borderColor: 'var(--care-border)', backgroundColor: 'white' }}>
              <option value="">Select type...</option>
              <option value="wrist">Wrist Restraint</option>
              <option value="vest">Vest Restraint</option>
              <option value="mitt">Mitt Restraint</option>
              <option value="bed_rails">Bed Rails</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--care-text-secondary)' }}>Circulation Status</label>
            <div className="flex gap-2">
              {['adequate', 'compromised'].map(v => (
                <button key={v} onClick={() => setRestraintData({ ...restraintData, circulation_status: v })}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium border ${
                    restraintData.circulation_status === v ? 'border-blue-500 bg-blue-50' : ''
                  }`}
                  style={{ borderColor: restraintData.circulation_status === v ? undefined : 'var(--care-border)' }}>
                  {v.charAt(0).toUpperCase() + v.slice(1)}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--care-text-secondary)' }}>Skin Integrity</label>
            <div className="flex gap-2">
              {['intact', 'redness', 'breakdown'].map(v => (
                <button key={v} onClick={() => setRestraintData({ ...restraintData, skin_integrity: v })}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium border ${
                    restraintData.skin_integrity === v ? 'border-blue-500 bg-blue-50' : ''
                  }`}
                  style={{ borderColor: restraintData.skin_integrity === v ? undefined : 'var(--care-border)' }}>
                  {v.charAt(0).toUpperCase() + v.slice(1)}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--care-text-secondary)' }}>Notes</label>
            <textarea value={restraintData.notes}
              onChange={(e) => setRestraintData({ ...restraintData, notes: e.target.value })}
              rows={2} placeholder="Additional observations..."
              className="w-full rounded-lg border px-3 py-2 text-sm"
              style={{ borderColor: 'var(--care-border)', backgroundColor: 'white' }}
            />
          </div>
        </div>
      )}

      {/* ═══ SKIN ASSESSMENT ═══ */}
      {activeForm === 'skin' && (
        <div className="space-y-3">
          <h3 className="text-base font-semibold" style={{ color: 'var(--care-text)' }}>🔍 Skin Assessment</h3>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--care-text-secondary)' }}>Skin Integrity</label>
            <div className="flex gap-2">
              {['intact', 'impaired', 'at_risk'].map(v => (
                <button key={v} onClick={() => setSkinData({ ...skinData, integrity: v })}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium border ${
                    skinData.integrity === v ? 'border-blue-500 bg-blue-50' : ''
                  }`}
                  style={{ borderColor: skinData.integrity === v ? undefined : 'var(--care-border)' }}>
                  {v.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--care-text-secondary)' }}>Areas of Concern</label>
            <input type="text" value={skinData.areas_of_concern}
              onChange={(e) => setSkinData({ ...skinData, areas_of_concern: e.target.value })}
              placeholder="e.g. Sacrum, heels, elbows"
              className="w-full h-12 rounded-lg border px-3 text-sm"
              style={{ borderColor: 'var(--care-border)', backgroundColor: 'white' }}
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--care-text-secondary)' }}>Wound Count</label>
            <input type="number" min="0" value={skinData.wound_count}
              onChange={(e) => setSkinData({ ...skinData, wound_count: parseInt(e.target.value) || 0 })}
              className="w-full h-12 rounded-lg border px-3 text-lg font-medium"
              style={{ borderColor: 'var(--care-border)', backgroundColor: 'white', color: 'var(--care-text)' }}
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--care-text-secondary)' }}>IV Site Status</label>
            <input type="text" value={skinData.iv_site_status}
              onChange={(e) => setSkinData({ ...skinData, iv_site_status: e.target.value })}
              placeholder="e.g. Right hand, no redness, patent"
              className="w-full h-12 rounded-lg border px-3 text-sm"
              style={{ borderColor: 'var(--care-border)', backgroundColor: 'white' }}
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--care-text-secondary)' }}>Notes</label>
            <textarea value={skinData.notes}
              onChange={(e) => setSkinData({ ...skinData, notes: e.target.value })}
              rows={2} placeholder="Additional observations..."
              className="w-full rounded-lg border px-3 py-2 text-sm"
              style={{ borderColor: 'var(--care-border)', backgroundColor: 'white' }}
            />
          </div>
        </div>
      )}

      {/* ═══ GENERAL NURSING NOTE ═══ */}
      {activeForm === 'general' && (
        <div className="space-y-3">
          <h3 className="text-base font-semibold" style={{ color: 'var(--care-text)' }}>📝 General Nursing Note</h3>
          <textarea value={generalNotes}
            onChange={(e) => setGeneralNotes(e.target.value)}
            rows={6} placeholder="Document your nursing observations, patient response to treatment, communications with physicians, family updates, etc."
            className="w-full rounded-lg border px-3 py-2 text-sm"
            style={{ borderColor: 'var(--care-border)', backgroundColor: 'white' }}
          />
        </div>
      )}

      {/* Save button */}
      <button onClick={handleSubmit} disabled={saving}
        className="w-full h-14 rounded-xl text-white font-bold text-lg transition-colors touch-manipulation disabled:opacity-50"
        style={{ backgroundColor: 'var(--care-primary)' }}>
        {saving ? 'Saving...' : 'Submit Assessment'}
      </button>
    </div>
  );
}
