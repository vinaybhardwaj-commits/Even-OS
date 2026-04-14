'use client';

import { useState, useEffect, useCallback } from 'react';

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
  if (json.error) throw new Error(json.error?.message || 'Mutation failed');
  return json.result?.data?.json;
}

// ── Discharge step definitions ──────────────────────────────────────────────
const DISCHARGE_STEPS = [
  { num: '8.1', name: 'Discharge Planning', role: 'visiting_consultant', icon: '📋', tat: 2880, desc: 'Consultant discusses DC date, post-DC needs, financial implications' },
  { num: '8.2', name: 'Discharge Order', role: 'visiting_consultant', icon: '📝', tat: 60, desc: 'Formal DC order: diagnosis, procedures, follow-up, red flags, med reconciliation' },
  { num: '8.3', name: 'DC Summary', role: 'resident', icon: '📄', tat: 120, desc: 'Discharge summary: findings, procedures, treatment, follow-up, medications' },
  { num: '8.4', name: 'Final Bill', role: 'billing_manager', icon: '💰', tat: 240, desc: 'Itemized final bill prepared. Cash: settle <2h. TPA: claim submitted <4h' },
  { num: '8.5', name: 'Medications', role: 'pharmacist', icon: '💊', tat: 60, desc: 'Pharmacy dispenses, labels, counsels on dosage/schedule/storage' },
  { num: '8.6', name: 'Patient Education', role: 'nurse', icon: '🎓', tat: 30, desc: 'Wound care, activity restrictions, diet, red-flag symptoms, follow-up date' },
  { num: '8.7', name: 'Patient Exit', role: 'ip_coordinator', icon: '🚪', tat: 15, desc: 'Patient signs acknowledgement. Exit recorded. Wristband removed. GDA escorts' },
  { num: '8.8', name: 'Terminal Cleaning', role: 'housekeeping_supervisor', icon: '🧹', tat: 30, desc: 'Terminal cleaning per IPC protocol before next admission' },
];

interface StepData {
  id: string | null;
  step_number: string;
  status: string;
  started_at: string | null;
  completed_at: string | null;
}

interface Props {
  patientId: string;
  encounterId?: string;
  userRole: string;
  userName: string;
}

function formatMins(mins: number): string {
  if (mins < 60) return `${mins}m`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ${mins % 60}m`;
  return `${Math.floor(mins / 1440)}d ${Math.floor((mins % 1440) / 60)}h`;
}

export default function DischargeChecklist({ patientId, encounterId, userRole, userName }: Props) {
  const [steps, setSteps] = useState<StepData[]>([]);
  const [loading, setLoading] = useState(true);
  const [completing, setCompleting] = useState<string | null>(null);

  const loadSteps = useCallback(async () => {
    const data = await trpcQuery('journeyEngine.getPatientJourney', { patient_id: patientId });
    if (!data?.steps) { setLoading(false); return; }
    const dcSteps = (data.steps as any[]).filter((s: any) =>
      s.step_number?.startsWith('8.')
    );
    setSteps(dcSteps);
    setLoading(false);
  }, [patientId]);

  useEffect(() => { loadSteps(); }, [loadSteps]);

  const handleComplete = async (stepId: string) => {
    setCompleting(stepId);
    try {
      await trpcMutate('journeyEngine.completeStep', {
        step_id: stepId,
        completed_notes: `Completed by ${userName}`,
      });
      await loadSteps();
    } catch (err) {
      console.error('Complete step error:', err);
    } finally {
      setCompleting(null);
    }
  };

  if (loading) return <div style={{ padding: 20, color: '#888', fontSize: 13 }}>Loading discharge steps…</div>;
  if (steps.length === 0) return null; // No discharge steps = discharge not initiated

  const completed = steps.filter(s => s.status === 'completed').length;
  const total = DISCHARGE_STEPS.length;
  const pct = Math.round((completed / total) * 100);

  return (
    <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e0e0e0', padding: 16, marginBottom: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>🏥 Discharge Checklist</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 80, height: 6, borderRadius: 3, background: '#e0e0e0', overflow: 'hidden',
          }}>
            <div style={{
              height: '100%', borderRadius: 3,
              width: `${pct}%`,
              background: pct === 100 ? '#4caf50' : pct >= 50 ? '#ff9800' : '#f44336',
              transition: 'width 0.3s',
            }} />
          </div>
          <span style={{
            fontSize: 12, fontWeight: 700,
            color: pct === 100 ? '#2e7d32' : pct >= 50 ? '#e65100' : '#c62828',
          }}>
            {completed}/{total}
          </span>
        </div>
      </div>

      {/* Steps */}
      {DISCHARGE_STEPS.map((def, idx) => {
        const dbStep = steps.find(s => s.step_number === def.num);
        const status = dbStep?.status || 'not_started';
        const isComplete = status === 'completed';
        const isActive = status === 'in_progress';
        const isPending = status === 'pending';
        const canComplete = dbStep?.id && !isComplete && (
          userRole === def.role || userRole === 'admin' || userRole === 'super_admin'
        );

        const startedAt = dbStep?.started_at ? new Date(dbStep.started_at) : null;
        const elapsed = startedAt ? Math.round((Date.now() - startedAt.getTime()) / 60000) : 0;
        const isOverdue = !isComplete && elapsed > def.tat;

        return (
          <div key={def.num} style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '10px 0',
            borderBottom: idx < DISCHARGE_STEPS.length - 1 ? '1px solid #f0f0f0' : 'none',
            opacity: status === 'not_started' ? 0.5 : 1,
          }}>
            {/* Status icon */}
            <div style={{
              width: 32, height: 32, borderRadius: '50%', display: 'flex',
              alignItems: 'center', justifyContent: 'center', fontSize: 16,
              background: isComplete ? '#e8f5e9' : isActive ? '#e3f2fd' : isOverdue ? '#ffebee' : '#f5f5f5',
              border: `2px solid ${isComplete ? '#4caf50' : isActive ? '#1565c0' : isOverdue ? '#f44336' : '#e0e0e0'}`,
              flexShrink: 0,
            }}>
              {isComplete ? '✅' : def.icon}
            </div>

            {/* Content */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: isComplete ? '#2e7d32' : '#333' }}>
                  {def.num} {def.name}
                </span>
                <span style={{
                  fontSize: 10, padding: '1px 6px', borderRadius: 4, fontWeight: 600,
                  background: isComplete ? '#e8f5e9' : isActive ? '#e3f2fd' : isPending ? '#fff3e0' : '#f5f5f5',
                  color: isComplete ? '#2e7d32' : isActive ? '#1565c0' : isPending ? '#e65100' : '#999',
                }}>
                  {isComplete ? 'Done' : isActive ? 'Active' : isPending ? 'Pending' : 'Not Started'}
                </span>
              </div>
              <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
                {def.desc}
              </div>
              {isActive && (
                <div style={{
                  fontSize: 10, marginTop: 3,
                  color: isOverdue ? '#c62828' : '#1565c0', fontWeight: 600,
                }}>
                  {isOverdue
                    ? `⏰ ${formatMins(elapsed - def.tat)} overdue`
                    : `${formatMins(def.tat - elapsed)} remaining`
                  }
                </div>
              )}
              {isComplete && dbStep?.completed_at && (
                <div style={{ fontSize: 10, color: '#2e7d32', marginTop: 2 }}>
                  ✓ Completed {new Date(dbStep.completed_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                </div>
              )}
            </div>

            {/* Action button */}
            {canComplete && (
              <button
                onClick={() => handleComplete(dbStep!.id!)}
                disabled={completing === dbStep!.id}
                style={{
                  padding: '6px 12px', fontSize: 11, fontWeight: 700,
                  background: completing === dbStep!.id ? '#ccc' : '#1565c0',
                  color: '#fff', border: 'none', borderRadius: 6,
                  cursor: completing === dbStep!.id ? 'default' : 'pointer',
                  whiteSpace: 'nowrap', flexShrink: 0,
                }}
              >
                {completing === dbStep!.id ? '⏳' : '✓ Done'}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
