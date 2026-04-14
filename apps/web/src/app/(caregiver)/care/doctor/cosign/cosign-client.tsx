'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { ConfirmModal, EmptyState } from '@/components/caregiver';

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
  if (json.error) throw new Error(json.error?.message || JSON.stringify(json.error));
  return json.result?.data?.json;
}

// ── Types ───────────────────────────────────────────────────────────────────
interface CosignItem {
  note_id: string;
  note_type: string;
  status: string;
  created_at: string;
  excerpt: string;
  author_name: string;
  patient_name: string;
  patient_uhid: string;
  encounter_id: string;
  patient_id: string;
  bed_label: string | null;
}

interface DischargeItem {
  encounter_id: string;
  patient_id: string;
  patient_name: string;
  patient_uhid: string;
  ward_name: string | null;
  bed_label: string | null;
  chief_complaint: string | null;
  primary_diagnosis: string | null;
  admission_datetime: string | null;
  planned_discharge_date: string | null;
}

type TabKey = 'cosign' | 'discharge';

interface Props {
  userId: string;
  userRole: string;
  userName: string;
}

// ── Component ───────────────────────────────────────────────────────────────
export default function CosignClient({ userId, userRole, userName }: Props) {
  const router = useRouter();

  const [activeTab, setActiveTab] = useState<TabKey>('cosign');
  const [loading, setLoading] = useState(true);
  const [cosignItems, setCosignItems] = useState<CosignItem[]>([]);
  const [dischargeItems, setDischargeItems] = useState<DischargeItem[]>([]);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [expandedItem, setExpandedItem] = useState<string | null>(null);
  const [actionModal, setActionModal] = useState<{ type: 'approve' | 'reject' | 'addendum' | 'discharge'; item?: any } | null>(null);
  const [actionText, setActionText] = useState('');
  const [processing, setProcessing] = useState(false);

  // Discharge form state
  const [dcSummary, setDcSummary] = useState('');
  const [dcFollowup, setDcFollowup] = useState('');
  const [dcMeds, setDcMeds] = useState('');

  // ── Load data ─────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    try {
      const [cosign, dc] = await Promise.all([
        trpcQuery('doctorDashboard.cosignQueue'),
        trpcQuery('doctorDashboard.dischargeDue'),
      ]);
      setCosignItems(cosign || []);
      setDischargeItems(dc || []);
    } catch (err) {
      console.error('Cosign load error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    const iv = setInterval(loadData, 60_000);
    return () => clearInterval(iv);
  }, [loadData]);

  // ── Co-sign actions ───────────────────────────────────────────────────
  const toggleSelect = (noteId: string) => {
    setSelectedItems(prev => {
      const next = new Set(prev);
      if (next.has(noteId)) next.delete(noteId); else next.add(noteId);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedItems.size === cosignItems.length) {
      setSelectedItems(new Set());
    } else {
      setSelectedItems(new Set(cosignItems.map(i => i.note_id)));
    }
  };

  const batchApprove = async () => {
    if (selectedItems.size === 0) return;
    setProcessing(true);
    try {
      for (const noteId of selectedItems) {
        await trpcMutate('clinicalNotes.signNote', { note_id: noteId });
      }
      setSelectedItems(new Set());
      await loadData();
    } catch (err) {
      alert('Failed to sign some notes');
    } finally {
      setProcessing(false);
    }
  };

  const approveOne = async (noteId: string) => {
    setProcessing(true);
    try {
      await trpcMutate('clinicalNotes.signNote', { note_id: noteId });
      await loadData();
    } catch (err) {
      alert('Failed to sign note');
    } finally {
      setProcessing(false);
      setActionModal(null);
    }
  };

  const rejectNote = async (noteId: string) => {
    if (!actionText.trim()) { alert('Reason is required.'); return; }
    setProcessing(true);
    try {
      await trpcMutate('clinicalNotes.updateNote', {
        note_id: noteId,
        status: 'entered_in_error',
        addendum: `[REJECTED] ${actionText.trim()}`,
      });
      await loadData();
    } catch (err) {
      alert('Failed to reject note');
    } finally {
      setProcessing(false);
      setActionModal(null);
      setActionText('');
    }
  };

  const addAddendum = async (noteId: string) => {
    if (!actionText.trim()) { alert('Addendum text is required.'); return; }
    setProcessing(true);
    try {
      await trpcMutate('clinicalNotes.updateNote', {
        note_id: noteId,
        addendum: actionText.trim(),
      });
      // Then sign it
      await trpcMutate('clinicalNotes.signNote', { note_id: noteId });
      await loadData();
    } catch (err) {
      alert('Failed to add addendum');
    } finally {
      setProcessing(false);
      setActionModal(null);
      setActionText('');
    }
  };

  // ── Discharge action ──────────────────────────────────────────────────
  const initiateDischarge = async (encounter: DischargeItem) => {
    if (!dcSummary.trim()) { alert('Discharge summary is required.'); return; }
    setProcessing(true);
    try {
      // Create discharge note
      await trpcMutate('clinicalNotes.createDischarge', {
        patient_id: encounter.patient_id,
        encounter_id: encounter.encounter_id,
        note_type: 'discharge_summary',
        content: [
          `Discharge Summary`,
          `Patient: ${encounter.patient_name} (${encounter.patient_uhid})`,
          `Admission: ${encounter.admission_datetime ? new Date(encounter.admission_datetime).toLocaleDateString('en-IN') : 'N/A'}`,
          `Diagnosis: ${encounter.primary_diagnosis || encounter.chief_complaint || 'N/A'}`,
          '',
          `Summary: ${dcSummary.trim()}`,
          dcFollowup.trim() ? `Follow-up: ${dcFollowup.trim()}` : '',
          dcMeds.trim() ? `Discharge Medications: ${dcMeds.trim()}` : '',
        ].filter(Boolean).join('\n'),
      });
      setDcSummary('');
      setDcFollowup('');
      setDcMeds('');
      setActionModal(null);
      await loadData();
    } catch (err) {
      alert('Failed to create discharge summary');
    } finally {
      setProcessing(false);
    }
  };

  // ── Helpers ───────────────────────────────────────────────────────────
  const timeAgo = (dt: string | null) => {
    if (!dt) return '';
    const mins = Math.floor((Date.now() - new Date(dt).getTime()) / 60000);
    if (mins < 60) return `${mins}m ago`;
    if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
    return `${Math.floor(mins / 1440)}d ago`;
  };

  // ── Render ────────────────────────────────────────────────────────────
  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center', fontFamily: 'system-ui' }}><p style={{ color: '#666' }}>Loading…</p></div>;
  }

  return (
    <div className="caregiver-theme" style={{ fontFamily: 'system-ui', background: '#f5f6fa', minHeight: '100vh' }}>

      {/* Header */}
      <header style={{
        background: '#fff', borderBottom: '1px solid #e0e0e0',
        padding: '12px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>
            {activeTab === 'cosign' ? '✍️ Co-Sign Queue' : '🏥 Discharge'}
          </h1>
          <p style={{ fontSize: 12, color: '#888', margin: '2px 0 0' }}>
            {activeTab === 'cosign' ? `${cosignItems.length} pending` : `${dischargeItems.length} due today`}
          </p>
        </div>
      </header>

      {/* Tab bar */}
      <div style={{
        display: 'flex', background: '#fff', borderBottom: '1px solid #e0e0e0',
      }}>
        {([
          { key: 'cosign' as TabKey, label: `✍️ Co-Sign (${cosignItems.length})` },
          { key: 'discharge' as TabKey, label: `🏥 Discharge (${dischargeItems.length})` },
        ]).map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)} style={{
            flex: 1, padding: '10px 0', fontSize: 14, fontWeight: 600, border: 'none',
            borderBottom: activeTab === tab.key ? '3px solid #1565c0' : '3px solid transparent',
            background: 'transparent', color: activeTab === tab.key ? '#1565c0' : '#888',
            cursor: 'pointer',
          }}>{tab.label}</button>
        ))}
      </div>

      {/* Content */}
      <div style={{ padding: '16px 24px 120px', maxWidth: 900, margin: '0 auto' }}>

        {/* ═══ CO-SIGN TAB ═════════════════════════════════════════════ */}
        {activeTab === 'cosign' && (
          <>
            {/* Batch action bar */}
            {cosignItems.length > 0 && (
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                marginBottom: 12, padding: '8px 12px', background: '#fff',
                borderRadius: 8, border: '1px solid #e0e0e0',
              }}>
                <button onClick={selectAll} style={{
                  fontSize: 13, color: '#1565c0', background: 'none', border: 'none',
                  cursor: 'pointer', fontWeight: 600,
                }}>
                  {selectedItems.size === cosignItems.length ? '☑ Deselect All' : '☐ Select All'}
                </button>
                {selectedItems.size > 0 && (
                  <button onClick={batchApprove} disabled={processing} style={{
                    padding: '6px 16px', fontSize: 13, fontWeight: 600,
                    background: processing ? '#ccc' : '#2e7d32', color: '#fff',
                    border: 'none', borderRadius: 6, cursor: 'pointer',
                  }}>
                    {processing ? 'Signing…' : `✅ Sign ${selectedItems.size} selected`}
                  </button>
                )}
              </div>
            )}

            {cosignItems.length === 0 ? (
              <EmptyState title="All Clear" message="No notes pending your co-signature." icon="✅" />
            ) : (
              cosignItems.map(item => {
                const isExpanded = expandedItem === item.note_id;
                const isChecked = selectedItems.has(item.note_id);

                return (
                  <div key={item.note_id} style={{
                    background: '#fff', border: `1px solid ${isChecked ? '#90caf9' : '#e0e0e0'}`,
                    borderRadius: 8, marginBottom: 8, overflow: 'hidden',
                  }}>
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '10px 14px', cursor: 'pointer',
                    }} onClick={() => setExpandedItem(isExpanded ? null : item.note_id)}>
                      {/* Checkbox */}
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleSelect(item.note_id)}
                        onClick={e => e.stopPropagation()}
                        style={{ width: 18, height: 18, cursor: 'pointer' }}
                      />
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          {item.bed_label && (
                            <span style={{ fontSize: 11, fontWeight: 700, background: '#1565c0', color: '#fff', borderRadius: 4, padding: '1px 6px' }}>
                              {item.bed_label}
                            </span>
                          )}
                          <span style={{ fontSize: 14, fontWeight: 600 }}>{item.patient_name}</span>
                          <span style={{ fontSize: 12, color: '#888' }}>{item.patient_uhid}</span>
                        </div>
                        <div style={{ fontSize: 12, color: '#666', marginTop: 2 }}>
                          {item.note_type?.replace(/_/g, ' ')} by {item.author_name} · {timeAgo(item.created_at)}
                        </div>
                      </div>
                      <span style={{ fontSize: 16 }}>{isExpanded ? '▲' : '▼'}</span>
                    </div>

                    {/* Expanded detail */}
                    {isExpanded && (
                      <div style={{ padding: '0 14px 14px', borderTop: '1px solid #f0f0f0' }}>
                        <div style={{
                          padding: 10, background: '#fafafa', borderRadius: 6,
                          fontSize: 13, whiteSpace: 'pre-wrap', marginTop: 8, marginBottom: 10,
                          borderLeft: '3px solid #e0e0e0',
                        }}>
                          {item.excerpt || 'No content available'}
                        </div>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button onClick={() => approveOne(item.note_id)}
                            style={actionBtn('#2e7d32')}>✅ Approve</button>
                          <button onClick={() => { setActionModal({ type: 'addendum', item }); setActionText(''); }}
                            style={actionBtn('#1565c0')}>📝 Add Addendum</button>
                          <button onClick={() => { setActionModal({ type: 'reject', item }); setActionText(''); }}
                            style={actionBtn('#c62828')}>❌ Reject</button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </>
        )}

        {/* ═══ DISCHARGE TAB ═══════════════════════════════════════════ */}
        {activeTab === 'discharge' && (
          <>
            {dischargeItems.length === 0 ? (
              <EmptyState title="No Discharges Due" message="No patients have planned discharge today." icon="🏥" />
            ) : (
              dischargeItems.map(item => (
                <div key={item.encounter_id} style={{
                  background: '#fff', border: '1px solid #e0e0e0',
                  borderRadius: 8, marginBottom: 8, padding: '12px 16px',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        {item.bed_label && (
                          <span style={{ fontSize: 11, fontWeight: 700, background: '#1565c0', color: '#fff', borderRadius: 4, padding: '1px 6px' }}>
                            {item.bed_label}
                          </span>
                        )}
                        <span style={{ fontSize: 15, fontWeight: 600 }}>{item.patient_name}</span>
                      </div>
                      <div style={{ fontSize: 12, color: '#666', marginTop: 2 }}>
                        {item.patient_uhid} · {item.primary_diagnosis || item.chief_complaint || 'No diagnosis'}
                        · {item.ward_name || ''}
                      </div>
                      <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>
                        Admitted {item.admission_datetime ? new Date(item.admission_datetime).toLocaleDateString('en-IN') : 'N/A'}
                        · Planned D/C {item.planned_discharge_date ? new Date(item.planned_discharge_date).toLocaleDateString('en-IN') : 'today'}
                      </div>
                    </div>
                    <button
                      onClick={() => setActionModal({ type: 'discharge', item })}
                      style={{
                        padding: '8px 16px', fontSize: 13, fontWeight: 600,
                        background: '#4caf50', color: '#fff', border: 'none',
                        borderRadius: 8, cursor: 'pointer',
                      }}
                    >🏥 Initiate Discharge</button>
                  </div>
                </div>
              ))
            )}
          </>
        )}
      </div>

      {/* ═══ ACTION MODALS ═════════════════════════════════════════════ */}

      {/* Reject modal */}
      {actionModal?.type === 'reject' && (
        <ModalOverlay onClose={() => setActionModal(null)}>
          <h3 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 12px' }}>❌ Reject Note</h3>
          <p style={{ fontSize: 13, color: '#666', margin: '0 0 8px' }}>
            Note by {actionModal.item.author_name} for {actionModal.item.patient_name}
          </p>
          <textarea
            value={actionText}
            onChange={e => setActionText(e.target.value)}
            placeholder="Reason for rejection (required)…"
            rows={3}
            style={textareaStyle}
            autoFocus
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button onClick={() => rejectNote(actionModal.item.note_id)} disabled={processing}
              style={{ ...submitBtn, background: processing ? '#ccc' : '#c62828' }}>
              {processing ? 'Rejecting…' : 'Reject'}
            </button>
            <button onClick={() => setActionModal(null)}
              style={{ ...submitBtn, background: '#e0e0e0', color: '#333' }}>Cancel</button>
          </div>
        </ModalOverlay>
      )}

      {/* Addendum modal */}
      {actionModal?.type === 'addendum' && (
        <ModalOverlay onClose={() => setActionModal(null)}>
          <h3 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 12px' }}>📝 Add Addendum & Approve</h3>
          <p style={{ fontSize: 13, color: '#666', margin: '0 0 8px' }}>
            Note by {actionModal.item.author_name} for {actionModal.item.patient_name}
          </p>
          <textarea
            value={actionText}
            onChange={e => setActionText(e.target.value)}
            placeholder="Your addendum…"
            rows={3}
            style={textareaStyle}
            autoFocus
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button onClick={() => addAddendum(actionModal.item.note_id)} disabled={processing}
              style={{ ...submitBtn, background: processing ? '#ccc' : '#1565c0' }}>
              {processing ? 'Saving…' : 'Add & Approve'}
            </button>
            <button onClick={() => setActionModal(null)}
              style={{ ...submitBtn, background: '#e0e0e0', color: '#333' }}>Cancel</button>
          </div>
        </ModalOverlay>
      )}

      {/* Discharge modal */}
      {actionModal?.type === 'discharge' && (
        <ModalOverlay onClose={() => setActionModal(null)}>
          <h3 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 12px' }}>🏥 Discharge Summary</h3>
          <div style={{ fontSize: 13, color: '#666', marginBottom: 12 }}>
            <strong>{actionModal.item.patient_name}</strong> ({actionModal.item.patient_uhid})
            · {actionModal.item.primary_diagnosis || actionModal.item.chief_complaint || ''}
          </div>
          <label style={labelStyle}>Discharge Summary *</label>
          <textarea value={dcSummary} onChange={e => setDcSummary(e.target.value)}
            placeholder="Final assessment, course in hospital, outcome…"
            rows={4} style={textareaStyle} autoFocus />
          <label style={labelStyle}>Follow-up Instructions</label>
          <textarea value={dcFollowup} onChange={e => setDcFollowup(e.target.value)}
            placeholder="Follow-up date, investigations, when to return…"
            rows={2} style={textareaStyle} />
          <label style={labelStyle}>Discharge Medications</label>
          <textarea value={dcMeds} onChange={e => setDcMeds(e.target.value)}
            placeholder="Medications to take home…"
            rows={2} style={textareaStyle} />
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button onClick={() => initiateDischarge(actionModal.item)} disabled={processing}
              style={{ ...submitBtn, background: processing ? '#ccc' : '#4caf50' }}>
              {processing ? 'Processing…' : '🏥 Complete Discharge'}
            </button>
            <button onClick={() => setActionModal(null)}
              style={{ ...submitBtn, background: '#e0e0e0', color: '#333' }}>Cancel</button>
          </div>
        </ModalOverlay>
      )}

      {/* ── Bottom Tab Bar ──────────────────────────────────────────────── */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        display: 'flex', background: '#fff', borderTop: '1px solid #e0e0e0',
        zIndex: 30, padding: '6px 0 env(safe-area-inset-bottom)',
      }}>
        {[
          { key: 'home', label: 'Patients', icon: '🩺', href: '/care/doctor' },
          { key: 'rounds', label: 'Rounds', icon: '📋', href: '/care/doctor/rounds' },
          { key: 'notes', label: 'Notes', icon: '📝', href: '/care/doctor/note' },
          { key: 'cosign', label: 'Co-Sign', icon: '✍️', href: '/care/doctor/cosign' },
          { key: 'more', label: 'More', icon: '⋯', href: '/care/home' },
        ].map(tab => (
          <a key={tab.key} href={tab.href} style={{
            flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
            padding: '4px 0', textDecoration: 'none', fontSize: 10,
            color: tab.key === 'cosign' ? '#1565c0' : '#888',
            fontWeight: tab.key === 'cosign' ? 700 : 400,
          }}>
            <span style={{ fontSize: 20 }}>{tab.icon}</span>
            {tab.label}
          </a>
        ))}
      </div>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────
function ModalOverlay({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50,
    }} onClick={onClose}>
      <div style={{
        background: '#fff', borderRadius: 12, padding: 24,
        maxWidth: 520, width: '90%', maxHeight: '80vh', overflow: 'auto',
      }} onClick={e => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

function actionBtn(color: string): React.CSSProperties {
  return {
    padding: '6px 14px', fontSize: 12, fontWeight: 600,
    background: `${color}15`, color, border: `1px solid ${color}40`,
    borderRadius: 6, cursor: 'pointer',
  };
}

const textareaStyle: React.CSSProperties = {
  width: '100%', padding: 10, fontSize: 14, borderRadius: 8,
  border: '1px solid #d0d0d0', resize: 'vertical', fontFamily: 'system-ui',
  marginBottom: 8,
};

const submitBtn: React.CSSProperties = {
  flex: 1, padding: '10px 0', fontSize: 14, fontWeight: 600,
  color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer',
};

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 4,
};
