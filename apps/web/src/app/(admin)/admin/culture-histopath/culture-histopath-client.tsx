'use client';

import { useState, useEffect, useCallback } from 'react';

// ============================================================
// tRPC helpers
// ============================================================
async function trpcQuery(path: string, input?: Record<string, unknown>) {
  const params = input ? `?input=${encodeURIComponent(JSON.stringify(input))}` : '';
  const res = await fetch(`/api/trpc/${path}${params}`);
  const json = await res.json();
  return json.result?.data;
}

async function trpcMutate(path: string, input: Record<string, unknown>) {
  const res = await fetch(`/api/trpc/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || 'Mutation failed');
  return json.result?.data;
}

// ============================================================
// Types
// ============================================================
type TabType = 'cultures' | 'histopath' | 'analytics';

interface User { sub: string; hospital_id: string; role: string; name: string; }

interface Culture {
  id: string; culture_number: string; status: string; specimen_source: string | null;
  patient_id: string; collection_date: string | null; media_used: string[] | null;
  incubation_temp: string | null; incubation_hours: number | null;
  clinical_notes: string | null; created_at: string;
}

interface Organism {
  id: string; organism_name: string; snomed_code: string | null; gram_stain: string | null;
  morphology: string | null; identification_method: string | null; colony_count: string | null;
  is_significant: boolean; is_contaminant: boolean; notes: string | null;
  sensitivities: Sensitivity[];
}

interface Sensitivity {
  id: string; antibiotic_name: string; antibiotic_code: string | null;
  antibiotic_class: string | null; result: string; mic_value: string | null;
  zone_diameter_mm: number | null;
}

interface HpCase {
  id: string; case_number: string; specimen_type: string; stage: string;
  patient_id: string; specimen_description: string | null; specimen_site: string | null;
  clinical_history: string | null; clinical_diagnosis: string | null;
  gross_description: string | null; gross_at: string | null; cassette_count: number | null;
  microscopy_findings: string | null; microscopy_at: string | null;
  special_stains: { stain_name: string; result: string }[] | null;
  ihc_markers: { marker: string; result: string }[] | null;
  diagnosis_text: string | null; icd10_code: string | null; icd10_description: string | null;
  tumor_grade: string | null; margin_status: string | null;
  diagnosed_at: string | null; tat_hours: number | null; created_at: string;
}

interface Stats {
  active_cultures: number; pending_sensitivity: number; total_organisms: number;
  active_hp_cases: number; pending_diagnosis: number; total_hp_cases: number;
}

// ============================================================
// Main
// ============================================================
export default function CultureHistopathClient({ user }: { user: User }) {
  const [tab, setTab] = useState<TabType>('cultures');
  const [stats, setStats] = useState<Stats | null>(null);

  const loadStats = useCallback(async () => {
    try {
      const data = await trpcQuery('cultureHistopath.stats', { hospital_id: user.hospital_id });
      setStats(data);
    } catch { /* ignore */ }
  }, [user.hospital_id]);

  useEffect(() => { loadStats(); }, [loadStats]);

  const tabs: { key: TabType; label: string }[] = [
    { key: 'cultures', label: 'Culture & Sensitivity' },
    { key: 'histopath', label: 'Histopathology' },
    { key: 'analytics', label: 'Analytics' },
  ];

  return (
    <div style={{ minHeight: '100vh', background: '#0f172a', color: '#e2e8f0' }}>
      <div style={{ background: '#1e293b', borderBottom: '1px solid #334155', padding: '16px 24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 style={{ fontSize: '20px', fontWeight: 700, margin: 0 }}>Culture &amp; Sensitivity / Histopathology</h1>
            <p style={{ fontSize: '13px', color: '#94a3b8', margin: '4px 0 0' }}>
              Microbiology cultures, antibiograms, and histopathology workflow
            </p>
          </div>
          <a href="/dashboard" style={{ color: '#60a5fa', fontSize: '13px', textDecoration: 'none' }}>← Dashboard</a>
        </div>
      </div>

      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '12px', padding: '16px 24px' }}>
          {[
            { label: 'Active Cultures', value: stats.active_cultures, color: '#f59e0b' },
            { label: 'Pending Sensitivity', value: stats.pending_sensitivity, color: '#ef4444' },
            { label: 'Organisms Found', value: stats.total_organisms, color: '#10b981' },
            { label: 'Active HP Cases', value: stats.active_hp_cases, color: '#8b5cf6' },
            { label: 'Pending Diagnosis', value: stats.pending_diagnosis, color: '#3b82f6' },
            { label: 'Total HP Cases', value: stats.total_hp_cases, color: '#06b6d4' },
          ].map((s) => (
            <div key={s.label} style={{ background: '#1e293b', borderRadius: '8px', padding: '12px 16px', borderLeft: `3px solid ${s.color}` }}>
              <div style={{ fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase' }}>{s.label}</div>
              <div style={{ fontSize: '24px', fontWeight: 700, color: s.color }}>{s.value}</div>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: '0', borderBottom: '1px solid #334155', padding: '0 24px' }}>
        {tabs.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            padding: '10px 20px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
            background: 'transparent', border: 'none',
            color: tab === t.key ? '#60a5fa' : '#94a3b8',
            borderBottom: tab === t.key ? '2px solid #60a5fa' : '2px solid transparent',
          }}>{t.label}</button>
        ))}
      </div>

      <div style={{ padding: '24px' }}>
        {tab === 'cultures' && <CulturesTab user={user} onUpdate={loadStats} />}
        {tab === 'histopath' && <HistopathTab user={user} onUpdate={loadStats} />}
        {tab === 'analytics' && <AnalyticsTab stats={stats} />}
      </div>
    </div>
  );
}

// ============================================================
// CULTURES TAB
// ============================================================
function CulturesTab({ user, onUpdate }: { user: User; onUpdate: () => void }) {
  const [cultures, setCultures] = useState<Culture[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ culture: Culture; organisms: Organism[] } | null>(null);

  // Organism form
  const [showOrgForm, setShowOrgForm] = useState(false);
  const [orgForm, setOrgForm] = useState({ organism_name: '', snomed_code: '', gram_stain: '', morphology: '', identification_method: '', colony_count: '' });

  // Sensitivity form
  const [showSensForm, setShowSensForm] = useState<string | null>(null);
  const [sensForm, setSensForm] = useState({ antibiotic_name: '', antibiotic_class: '', result: 'S' as string, mic_value: '' });

  const loadCultures = useCallback(async () => {
    setLoading(true);
    try {
      const input: Record<string, unknown> = { hospital_id: user.hospital_id };
      if (statusFilter) input.status = statusFilter;
      const data = await trpcQuery('cultureHistopath.listCultures', input);
      setCultures(data?.cultures ?? []);
    } catch { /* ignore */ }
    setLoading(false);
  }, [user.hospital_id, statusFilter]);

  useEffect(() => { loadCultures(); }, [loadCultures]);

  const loadDetail = async (cultureId: string) => {
    try {
      const data = await trpcQuery('cultureHistopath.getCultureDetail', { culture_id: cultureId });
      setDetail(data);
    } catch { /* ignore */ }
  };

  const handleExpand = (id: string) => {
    if (expanded === id) { setExpanded(null); setDetail(null); }
    else { setExpanded(id); loadDetail(id); }
  };

  const handleAddOrganism = async (cultureId: string) => {
    try {
      await trpcMutate('cultureHistopath.recordOrganism', {
        culture_id: cultureId,
        organism_name: orgForm.organism_name,
        snomed_code: orgForm.snomed_code || undefined,
        gram_stain: orgForm.gram_stain || undefined,
        morphology: orgForm.morphology || undefined,
        identification_method: orgForm.identification_method || undefined,
        colony_count: orgForm.colony_count || undefined,
      });
      setShowOrgForm(false);
      setOrgForm({ organism_name: '', snomed_code: '', gram_stain: '', morphology: '', identification_method: '', colony_count: '' });
      loadDetail(cultureId);
      loadCultures();
      onUpdate();
    } catch (err) { alert(err instanceof Error ? err.message : 'Failed'); }
  };

  const handleAddSensitivity = async (organismId: string, cultureId: string) => {
    try {
      await trpcMutate('cultureHistopath.addSensitivity', {
        organism_id: organismId,
        antibiotic_name: sensForm.antibiotic_name,
        antibiotic_class: sensForm.antibiotic_class || undefined,
        result: sensForm.result,
        mic_value: sensForm.mic_value || undefined,
      });
      setShowSensForm(null);
      setSensForm({ antibiotic_name: '', antibiotic_class: '', result: 'S', mic_value: '' });
      loadDetail(cultureId);
      onUpdate();
    } catch (err) { alert(err instanceof Error ? err.message : 'Failed'); }
  };

  const statusColors: Record<string, string> = {
    inoculated: '#64748b', growing: '#f59e0b', organism_identified: '#10b981',
    sensitivity_in_progress: '#3b82f6', sensitivity_complete: '#8b5cf6',
    no_growth: '#94a3b8', cancelled: '#ef4444',
  };

  const sirColors: Record<string, string> = { S: '#10b981', I: '#f59e0b', R: '#ef4444' };

  if (loading) return <div style={{ color: '#94a3b8', padding: '40px', textAlign: 'center' }}>Loading cultures...</div>;

  return (
    <div>
      <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={inputStyle}>
          <option value="">All Statuses</option>
          <option value="inoculated">Inoculated</option>
          <option value="growing">Growing</option>
          <option value="organism_identified">Organism Identified</option>
          <option value="sensitivity_in_progress">Sensitivity In Progress</option>
          <option value="sensitivity_complete">Complete</option>
          <option value="no_growth">No Growth</option>
        </select>
      </div>

      {cultures.length === 0 ? (
        <div style={{ color: '#94a3b8', padding: '40px', textAlign: 'center' }}>No cultures found.</div>
      ) : cultures.map((c) => (
        <div key={c.id} style={{ background: '#1e293b', borderRadius: '8px', marginBottom: '8px', border: '1px solid #334155', overflow: 'hidden' }}>
          <div onClick={() => handleExpand(c.id)} style={{ padding: '12px 20px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
              <span style={{ fontFamily: 'monospace', fontSize: '13px', color: '#60a5fa' }}>{c.culture_number}</span>
              <span style={{ fontSize: '11px', fontWeight: 600, padding: '2px 8px', borderRadius: '10px', background: statusColors[c.status] ?? '#64748b', color: '#fff' }}>
                {c.status.replace(/_/g, ' ')}
              </span>
              {c.specimen_source && <span style={{ fontSize: '12px', color: '#94a3b8' }}>{c.specimen_source}</span>}
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <span style={{ fontSize: '11px', color: '#64748b' }}>{new Date(c.created_at).toLocaleDateString()}</span>
              <span style={{ color: '#64748b' }}>{expanded === c.id ? '▼' : '▶'}</span>
            </div>
          </div>

          {expanded === c.id && detail && (
            <div style={{ borderTop: '1px solid #334155', padding: '16px 20px' }}>
              {/* Culture info */}
              <div style={{ display: 'flex', gap: '24px', fontSize: '12px', color: '#94a3b8', marginBottom: '12px' }}>
                {c.media_used && <span>Media: {(c.media_used as string[]).join(', ')}</span>}
                <span>Temp: {c.incubation_temp ?? '37°C'}</span>
                <span>Incubation: {c.incubation_hours ?? 24}h</span>
              </div>

              {/* Organisms */}
              <div style={{ fontSize: '13px', fontWeight: 600, color: '#e2e8f0', marginBottom: '8px' }}>
                Organisms ({detail.organisms.length})
              </div>

              {detail.organisms.map((org) => (
                <div key={org.id} style={{ background: '#0f172a', borderRadius: '6px', padding: '12px', marginBottom: '8px', border: '1px solid #334155' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                      <span style={{ fontWeight: 600, fontSize: '14px', color: org.is_contaminant ? '#64748b' : '#10b981' }}>
                        {org.organism_name}
                      </span>
                      {org.gram_stain && <span style={{ fontSize: '11px', color: '#94a3b8' }}>{org.gram_stain}</span>}
                      {org.colony_count && <span style={{ fontSize: '11px', color: '#f59e0b' }}>{org.colony_count}</span>}
                      {org.is_contaminant && <span style={{ fontSize: '11px', color: '#ef4444' }}>CONTAMINANT</span>}
                    </div>
                    <button onClick={() => setShowSensForm(showSensForm === org.id ? null : org.id)} style={{ ...smallBtnStyle, background: '#3b82f6' }}>
                      + Antibiotic
                    </button>
                  </div>

                  {/* Sensitivity Panel */}
                  {org.sensitivities.length > 0 && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px 80px 80px', gap: '0', fontSize: '12px' }}>
                      <div style={{ padding: '4px 0', color: '#64748b', fontWeight: 600 }}>Antibiotic</div>
                      <div style={{ padding: '4px 0', color: '#64748b', fontWeight: 600 }}>Class</div>
                      <div style={{ padding: '4px 0', color: '#64748b', fontWeight: 600 }}>Result</div>
                      <div style={{ padding: '4px 0', color: '#64748b', fontWeight: 600 }}>MIC</div>
                      {org.sensitivities.map((s) => (
                        <div key={s.id} style={{ display: 'contents' }}>
                          <div style={{ padding: '4px 0', borderTop: '1px solid #1e293b' }}>{s.antibiotic_name}</div>
                          <div style={{ padding: '4px 0', borderTop: '1px solid #1e293b', color: '#94a3b8' }}>{s.antibiotic_class ?? '—'}</div>
                          <div style={{ padding: '4px 0', borderTop: '1px solid #1e293b', fontWeight: 700, color: sirColors[s.result] ?? '#94a3b8' }}>{s.result}</div>
                          <div style={{ padding: '4px 0', borderTop: '1px solid #1e293b', color: '#94a3b8' }}>{s.mic_value ?? '—'}</div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Add Sensitivity Form */}
                  {showSensForm === org.id && (
                    <div style={{ marginTop: '8px', display: 'flex', gap: '6px', alignItems: 'center' }}>
                      <input placeholder="Antibiotic" value={sensForm.antibiotic_name} onChange={(e) => setSensForm({ ...sensForm, antibiotic_name: e.target.value })} style={inputStyle} />
                      <input placeholder="Class" value={sensForm.antibiotic_class} onChange={(e) => setSensForm({ ...sensForm, antibiotic_class: e.target.value })} style={inputStyle} />
                      <select value={sensForm.result} onChange={(e) => setSensForm({ ...sensForm, result: e.target.value })} style={inputStyle}>
                        <option value="S">S (Susceptible)</option>
                        <option value="I">I (Intermediate)</option>
                        <option value="R">R (Resistant)</option>
                      </select>
                      <input placeholder="MIC" value={sensForm.mic_value} onChange={(e) => setSensForm({ ...sensForm, mic_value: e.target.value })} style={{ ...inputStyle, width: '80px' }} />
                      <button onClick={() => handleAddSensitivity(org.id, c.id)} style={{ ...smallBtnStyle, background: '#10b981' }}>Add</button>
                    </div>
                  )}
                </div>
              ))}

              {/* Add Organism */}
              {!showOrgForm ? (
                <button onClick={() => setShowOrgForm(true)} style={{ ...btnStyle, background: '#1e40af', fontSize: '12px' }}>+ Identify Organism</button>
              ) : (
                <div style={{ background: '#0f172a', borderRadius: '6px', padding: '12px', border: '1px solid #334155' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '6px', marginBottom: '6px' }}>
                    <input placeholder="Organism Name *" value={orgForm.organism_name} onChange={(e) => setOrgForm({ ...orgForm, organism_name: e.target.value })} style={inputStyle} />
                    <input placeholder="SNOMED Code" value={orgForm.snomed_code} onChange={(e) => setOrgForm({ ...orgForm, snomed_code: e.target.value })} style={inputStyle} />
                    <select value={orgForm.gram_stain} onChange={(e) => setOrgForm({ ...orgForm, gram_stain: e.target.value })} style={inputStyle}>
                      <option value="">Gram Stain...</option>
                      <option value="gram_positive">Gram Positive</option>
                      <option value="gram_negative">Gram Negative</option>
                      <option value="yeast">Yeast</option>
                      <option value="acid_fast">Acid Fast</option>
                    </select>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '6px', marginBottom: '8px' }}>
                    <input placeholder="Morphology" value={orgForm.morphology} onChange={(e) => setOrgForm({ ...orgForm, morphology: e.target.value })} style={inputStyle} />
                    <input placeholder="ID Method" value={orgForm.identification_method} onChange={(e) => setOrgForm({ ...orgForm, identification_method: e.target.value })} style={inputStyle} />
                    <input placeholder="Colony Count" value={orgForm.colony_count} onChange={(e) => setOrgForm({ ...orgForm, colony_count: e.target.value })} style={inputStyle} />
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button onClick={() => handleAddOrganism(c.id)} style={{ ...btnStyle, background: '#10b981' }}>Add Organism</button>
                    <button onClick={() => setShowOrgForm(false)} style={{ ...btnStyle, background: '#475569' }}>Cancel</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ============================================================
// HISTOPATH TAB
// ============================================================
function HistopathTab({ user, onUpdate }: { user: User; onUpdate: () => void }) {
  const [cases, setCases] = useState<HpCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [stageFilter, setStageFilter] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  // Stage forms
  const [grossForm, setGrossForm] = useState({ gross_description: '', cassette_count: '' });
  const [microForm, setMicroForm] = useState({ microscopy_findings: '' });
  const [diagForm, setDiagForm] = useState({ diagnosis_text: '', icd10_code: '', icd10_description: '', tumor_grade: '', margin_status: '' });
  const [activeForm, setActiveForm] = useState<string | null>(null);

  const loadCases = useCallback(async () => {
    setLoading(true);
    try {
      const input: Record<string, unknown> = { hospital_id: user.hospital_id };
      if (stageFilter) input.stage = stageFilter;
      const data = await trpcQuery('cultureHistopath.listCases', input);
      setCases(data?.cases ?? []);
    } catch { /* ignore */ }
    setLoading(false);
  }, [user.hospital_id, stageFilter]);

  useEffect(() => { loadCases(); }, [loadCases]);

  const handleGrossing = async (caseId: string) => {
    try {
      await trpcMutate('cultureHistopath.recordGrossing', {
        case_id: caseId, gross_description: grossForm.gross_description,
        cassette_count: grossForm.cassette_count ? Number(grossForm.cassette_count) : undefined,
      });
      setActiveForm(null); loadCases(); onUpdate();
    } catch (err) { alert(err instanceof Error ? err.message : 'Failed'); }
  };

  const handleMicroscopy = async (caseId: string) => {
    try {
      await trpcMutate('cultureHistopath.recordMicroscopy', {
        case_id: caseId, microscopy_findings: microForm.microscopy_findings,
      });
      setActiveForm(null); loadCases(); onUpdate();
    } catch (err) { alert(err instanceof Error ? err.message : 'Failed'); }
  };

  const handleDiagnosis = async (caseId: string) => {
    try {
      await trpcMutate('cultureHistopath.recordDiagnosis', {
        case_id: caseId, diagnosis_text: diagForm.diagnosis_text,
        icd10_code: diagForm.icd10_code || undefined,
        icd10_description: diagForm.icd10_description || undefined,
        tumor_grade: diagForm.tumor_grade || undefined,
        margin_status: diagForm.margin_status || undefined,
      });
      setActiveForm(null); loadCases(); onUpdate();
    } catch (err) { alert(err instanceof Error ? err.message : 'Failed'); }
  };

  const stageColors: Record<string, string> = {
    accessioned: '#64748b', grossing: '#f59e0b', processing: '#06b6d4',
    embedding: '#06b6d4', sectioning: '#06b6d4', staining: '#06b6d4',
    microscopy: '#3b82f6', diagnosis: '#8b5cf6', reported: '#10b981', amended: '#f97316',
  };

  const stageOrder = ['accessioned', 'grossing', 'processing', 'embedding', 'sectioning', 'staining', 'microscopy', 'diagnosis', 'reported'];

  if (loading) return <div style={{ color: '#94a3b8', padding: '40px', textAlign: 'center' }}>Loading cases...</div>;

  return (
    <div>
      <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
        <select value={stageFilter} onChange={(e) => setStageFilter(e.target.value)} style={inputStyle}>
          <option value="">All Stages</option>
          {stageOrder.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {cases.length === 0 ? (
        <div style={{ color: '#94a3b8', padding: '40px', textAlign: 'center' }}>No histopathology cases found.</div>
      ) : cases.map((hp) => (
        <div key={hp.id} style={{ background: '#1e293b', borderRadius: '8px', marginBottom: '8px', border: '1px solid #334155', overflow: 'hidden' }}>
          <div onClick={() => setExpanded(expanded === hp.id ? null : hp.id)} style={{ padding: '12px 20px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
              <span style={{ fontFamily: 'monospace', fontSize: '13px', color: '#60a5fa' }}>{hp.case_number}</span>
              <span style={{ fontSize: '11px', fontWeight: 600, padding: '2px 8px', borderRadius: '10px', background: stageColors[hp.stage] ?? '#64748b', color: '#fff' }}>
                {hp.stage}
              </span>
              <span style={{ fontSize: '12px', color: '#94a3b8' }}>{hp.specimen_type}</span>
              {hp.specimen_site && <span style={{ fontSize: '12px', color: '#64748b' }}>{hp.specimen_site}</span>}
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              {hp.tat_hours && <span style={{ fontSize: '11px', color: '#f59e0b' }}>TAT: {hp.tat_hours}h</span>}
              <span style={{ fontSize: '11px', color: '#64748b' }}>{new Date(hp.created_at).toLocaleDateString()}</span>
              <span style={{ color: '#64748b' }}>{expanded === hp.id ? '▼' : '▶'}</span>
            </div>
          </div>

          {expanded === hp.id && (
            <div style={{ borderTop: '1px solid #334155', padding: '16px 20px' }}>
              {/* Stage Progress Bar */}
              <div style={{ display: 'flex', gap: '4px', marginBottom: '16px' }}>
                {stageOrder.map((s) => {
                  const idx = stageOrder.indexOf(s);
                  const currentIdx = stageOrder.indexOf(hp.stage);
                  const done = idx <= currentIdx;
                  return (
                    <div key={s} style={{ flex: 1, height: '4px', borderRadius: '2px', background: done ? (stageColors[hp.stage] ?? '#64748b') : '#334155' }} />
                  );
                })}
              </div>

              {/* Specimen Info */}
              {hp.specimen_description && (
                <div style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '8px' }}>
                  <span style={{ color: '#64748b' }}>Specimen: </span>{hp.specimen_description}
                </div>
              )}
              {hp.clinical_history && (
                <div style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '8px' }}>
                  <span style={{ color: '#64748b' }}>History: </span>{hp.clinical_history}
                </div>
              )}

              {/* Grossing */}
              {hp.gross_description && (
                <div style={{ background: '#0f172a', borderRadius: '6px', padding: '10px 12px', marginBottom: '8px', borderLeft: '3px solid #f59e0b' }}>
                  <div style={{ fontSize: '11px', fontWeight: 600, color: '#f59e0b', marginBottom: '4px' }}>GROSSING</div>
                  <div style={{ fontSize: '13px' }}>{hp.gross_description}</div>
                  {hp.cassette_count && <div style={{ fontSize: '11px', color: '#64748b', marginTop: '4px' }}>Cassettes: {hp.cassette_count}</div>}
                </div>
              )}

              {/* Microscopy */}
              {hp.microscopy_findings && (
                <div style={{ background: '#0f172a', borderRadius: '6px', padding: '10px 12px', marginBottom: '8px', borderLeft: '3px solid #3b82f6' }}>
                  <div style={{ fontSize: '11px', fontWeight: 600, color: '#3b82f6', marginBottom: '4px' }}>MICROSCOPY</div>
                  <div style={{ fontSize: '13px' }}>{hp.microscopy_findings}</div>
                  {hp.special_stains && hp.special_stains.length > 0 && (
                    <div style={{ marginTop: '4px', fontSize: '12px', color: '#94a3b8' }}>
                      Stains: {hp.special_stains.map((s) => `${s.stain_name}: ${s.result}`).join(', ')}
                    </div>
                  )}
                </div>
              )}

              {/* Diagnosis */}
              {hp.diagnosis_text && (
                <div style={{ background: '#0f172a', borderRadius: '6px', padding: '10px 12px', marginBottom: '8px', borderLeft: '3px solid #8b5cf6' }}>
                  <div style={{ fontSize: '11px', fontWeight: 600, color: '#8b5cf6', marginBottom: '4px' }}>DIAGNOSIS</div>
                  <div style={{ fontSize: '13px', fontWeight: 600 }}>{hp.diagnosis_text}</div>
                  {hp.icd10_code && <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '4px' }}>ICD-10: {hp.icd10_code} — {hp.icd10_description}</div>}
                  {hp.tumor_grade && <div style={{ fontSize: '12px', color: '#94a3b8' }}>Grade: {hp.tumor_grade}</div>}
                  {hp.margin_status && <div style={{ fontSize: '12px', color: hp.margin_status === 'involved' ? '#ef4444' : '#10b981' }}>Margins: {hp.margin_status}</div>}
                </div>
              )}

              {/* Action buttons based on stage */}
              <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                {hp.stage === 'accessioned' && (
                  <button onClick={() => setActiveForm(activeForm === `gross-${hp.id}` ? null : `gross-${hp.id}`)} style={{ ...btnStyle, background: '#f59e0b' }}>Record Grossing</button>
                )}
                {hp.stage === 'grossing' && (
                  <button onClick={() => setActiveForm(activeForm === `micro-${hp.id}` ? null : `micro-${hp.id}`)} style={{ ...btnStyle, background: '#3b82f6' }}>Record Microscopy</button>
                )}
                {hp.stage === 'microscopy' && (
                  <button onClick={() => setActiveForm(activeForm === `diag-${hp.id}` ? null : `diag-${hp.id}`)} style={{ ...btnStyle, background: '#8b5cf6' }}>Record Diagnosis</button>
                )}
              </div>

              {/* Grossing Form */}
              {activeForm === `gross-${hp.id}` && (
                <div style={{ marginTop: '12px', background: '#0f172a', borderRadius: '6px', padding: '12px', border: '1px solid #334155' }}>
                  <textarea placeholder="Gross description *" value={grossForm.gross_description} onChange={(e) => setGrossForm({ ...grossForm, gross_description: e.target.value })} rows={3} style={{ ...inputStyle, width: '100%', resize: 'vertical', marginBottom: '8px' }} />
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input placeholder="Cassette count" value={grossForm.cassette_count} onChange={(e) => setGrossForm({ ...grossForm, cassette_count: e.target.value })} style={inputStyle} />
                    <button onClick={() => handleGrossing(hp.id)} style={{ ...btnStyle, background: '#10b981' }}>Save</button>
                    <button onClick={() => setActiveForm(null)} style={{ ...btnStyle, background: '#475569' }}>Cancel</button>
                  </div>
                </div>
              )}

              {/* Microscopy Form */}
              {activeForm === `micro-${hp.id}` && (
                <div style={{ marginTop: '12px', background: '#0f172a', borderRadius: '6px', padding: '12px', border: '1px solid #334155' }}>
                  <textarea placeholder="Microscopy findings *" value={microForm.microscopy_findings} onChange={(e) => setMicroForm({ ...microForm, microscopy_findings: e.target.value })} rows={3} style={{ ...inputStyle, width: '100%', resize: 'vertical', marginBottom: '8px' }} />
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button onClick={() => handleMicroscopy(hp.id)} style={{ ...btnStyle, background: '#10b981' }}>Save</button>
                    <button onClick={() => setActiveForm(null)} style={{ ...btnStyle, background: '#475569' }}>Cancel</button>
                  </div>
                </div>
              )}

              {/* Diagnosis Form */}
              {activeForm === `diag-${hp.id}` && (
                <div style={{ marginTop: '12px', background: '#0f172a', borderRadius: '6px', padding: '12px', border: '1px solid #334155' }}>
                  <textarea placeholder="Diagnosis text *" value={diagForm.diagnosis_text} onChange={(e) => setDiagForm({ ...diagForm, diagnosis_text: e.target.value })} rows={3} style={{ ...inputStyle, width: '100%', resize: 'vertical', marginBottom: '8px' }} />
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 1fr 1fr', gap: '6px', marginBottom: '8px' }}>
                    <input placeholder="ICD-10 Code" value={diagForm.icd10_code} onChange={(e) => setDiagForm({ ...diagForm, icd10_code: e.target.value })} style={inputStyle} />
                    <input placeholder="ICD-10 Description" value={diagForm.icd10_description} onChange={(e) => setDiagForm({ ...diagForm, icd10_description: e.target.value })} style={inputStyle} />
                    <input placeholder="Grade" value={diagForm.tumor_grade} onChange={(e) => setDiagForm({ ...diagForm, tumor_grade: e.target.value })} style={inputStyle} />
                    <select value={diagForm.margin_status} onChange={(e) => setDiagForm({ ...diagForm, margin_status: e.target.value })} style={inputStyle}>
                      <option value="">Margins...</option>
                      <option value="clear">Clear</option>
                      <option value="close">Close</option>
                      <option value="involved">Involved</option>
                    </select>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button onClick={() => handleDiagnosis(hp.id)} style={{ ...btnStyle, background: '#10b981' }}>Save Diagnosis</button>
                    <button onClick={() => setActiveForm(null)} style={{ ...btnStyle, background: '#475569' }}>Cancel</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ============================================================
// ANALYTICS TAB
// ============================================================
function AnalyticsTab({ stats }: { stats: Stats | null }) {
  if (!stats) return <div style={{ color: '#94a3b8', padding: '40px', textAlign: 'center' }}>Loading...</div>;

  const metrics = [
    { label: 'Active Cultures', value: stats.active_cultures, color: '#f59e0b', desc: 'Cultures in progress (inoculated → sensitivity)' },
    { label: 'Pending Sensitivity', value: stats.pending_sensitivity, color: '#ef4444', desc: 'Awaiting antibiotic sensitivity testing' },
    { label: 'Organisms Identified', value: stats.total_organisms, color: '#10b981', desc: 'Total organisms identified all-time' },
    { label: 'Active HP Cases', value: stats.active_hp_cases, color: '#8b5cf6', desc: 'Histopath cases not yet reported' },
    { label: 'Pending Diagnosis', value: stats.pending_diagnosis, color: '#3b82f6', desc: 'Microscopy complete, awaiting pathologist' },
    { label: 'Total HP Cases', value: stats.total_hp_cases, color: '#06b6d4', desc: 'All-time histopathology cases' },
  ];

  return (
    <div>
      <h2 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '16px' }}>Microbiology &amp; Pathology Analytics</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
        {metrics.map((m) => (
          <div key={m.label} style={{ background: '#1e293b', borderRadius: '8px', padding: '20px', border: '1px solid #334155', borderLeft: `4px solid ${m.color}` }}>
            <div style={{ fontSize: '12px', color: '#94a3b8', textTransform: 'uppercase' }}>{m.label}</div>
            <div style={{ fontSize: '36px', fontWeight: 700, color: m.color, margin: '8px 0 4px' }}>{m.value}</div>
            <div style={{ fontSize: '12px', color: '#64748b' }}>{m.desc}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// Shared Styles
// ============================================================
const inputStyle: React.CSSProperties = {
  padding: '6px 10px', borderRadius: '4px',
  background: '#0f172a', border: '1px solid #334155', color: '#e2e8f0', fontSize: '13px',
};

const btnStyle: React.CSSProperties = {
  padding: '6px 14px', borderRadius: '6px', border: 'none',
  color: '#fff', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
};

const smallBtnStyle: React.CSSProperties = {
  padding: '3px 8px', borderRadius: '4px', border: 'none',
  color: '#fff', fontSize: '11px', fontWeight: 600, cursor: 'pointer',
};
