'use client';

/**
 * DocumentsTab — Patient Document Vault (Sprint N.2)
 *
 * The 12th tab on the patient chart. Doctor-focused surface that lets clinicians:
 *   • Upload external documents (referral letters, ECGs, imaging CDs, old charts, etc.)
 *     via drag-and-drop with a type classifier.
 *   • See all active (non-deleted, non-superseded) documents for the patient.
 *   • Preview PDFs and images in a side pane; download DOCX/DICOM for native apps.
 *   • Mark a document superseded by another, or soft-delete with a required reason.
 *   • Review LLM-extracted chart update proposals (banner at top) — accept / reject / modify.
 *
 * All data is wired to the Sprint N.1 routers:
 *   - mrdDoctor.*        (list, getUploadUrl, registerUpload, getDownloadUrl, markSuperseded, softDelete)
 *   - chartProposals.*   (listPending, acceptProposal, rejectProposal, modifyAndAccept)
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';

// ── tRPC helpers ────────────────────────────────────────────────────────────

async function trpcQuery(path: string, input?: any) {
  const wrapped = input !== undefined ? { json: input } : { json: {} };
  const params = `?input=${encodeURIComponent(JSON.stringify(wrapped))}`;
  const res = await fetch(`/api/trpc/${path}${params}`);
  if (!res.ok) return null;
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
  if (!res.ok) throw new Error(`Mutation failed: ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error?.message || 'Mutation error');
  return json.result?.data?.json;
}

// ── Role gates ──────────────────────────────────────────────────────────────
const DOCTOR_ROLES = new Set([
  'resident', 'senior_resident', 'intern',
  'visiting_consultant', 'hospitalist', 'consultant', 'senior_consultant',
  'specialist_cardiologist', 'specialist_neurologist', 'specialist_orthopedic',
  'surgeon', 'anaesthetist',
  'department_head', 'medical_director', 'hospital_admin', 'super_admin',
]);
function isDoctor(role: string) { return DOCTOR_ROLES.has(role); }

// ── Document type catalog (matches server) ──────────────────────────────────
const DOCUMENT_TYPES: { value: string; label: string; icon: string }[] = [
  { value: 'referral_letter', label: 'Referral letter',   icon: '✉️' },
  { value: 'external_lab',    label: 'External lab',      icon: '🧪' },
  { value: 'old_chart',       label: 'Old chart',         icon: '📋' },
  { value: 'ecg',             label: 'ECG',               icon: '❤️' },
  { value: 'prescription',    label: 'Prescription',      icon: '💊' },
  { value: 'id_document',     label: 'ID document',       icon: '🆔' },
  { value: 'insurance_card',  label: 'Insurance card',    icon: '💳' },
  { value: 'consent',         label: 'Consent',           icon: '✍️' },
  { value: 'imaging_study',   label: 'Imaging study',     icon: '🩻' },
  { value: 'other',           label: 'Other',             icon: '📎' },
];
const DOC_TYPE_LABEL: Record<string, string> = DOCUMENT_TYPES.reduce((acc, t) => { acc[t.value] = t.label; return acc; }, {} as Record<string, string>);
const DOC_TYPE_ICON: Record<string, string>  = DOCUMENT_TYPES.reduce((acc, t) => { acc[t.value] = t.icon;  return acc; }, {} as Record<string, string>);

// ── Types ───────────────────────────────────────────────────────────────────
interface DocumentRow {
  id: string;
  patient_id: string;
  encounter_id: string | null;
  document_type: string;
  content_type: string;
  file_size_bytes: number | string;
  blob_url: string;
  status: string;
  scanned_at: string | null;
  indexed_at: string | null;
  uploaded_by: string;
  storage_tier: string;
  ocr_confidence: number | null;
  ocr_processed_at: string | null;
  deleted_at: string | null;
  deletion_reason: string | null;
  created_at: string;
}

interface ProposalRow {
  id: string;
  patient_id: string;
  encounter_id: string | null;
  source_document: string | null;
  proposal_type: string;
  payload: any;
  confidence: number | null;
  extraction_notes: string | null;
  status: string;
  created_at: string;
}

// ── Formatters ─────────────────────────────────────────────────────────────
function formatBytes(b: number | string): string {
  const n = typeof b === 'string' ? parseInt(b, 10) : b;
  if (!n || isNaN(n)) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return 'Just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function statusPill(status: string): { label: string; color: string; bg: string } {
  const map: Record<string, { label: string; color: string; bg: string }> = {
    pending_ingestion: { label: 'Scanning…',   color: '#6a4700', bg: '#FFF3CD' },
    scanned:           { label: 'Scanned',     color: '#055160', bg: '#CFF4FC' },
    indexed:           { label: 'Indexed',     color: '#0F5132', bg: '#D1E7DD' },
    failed:            { label: 'Failed',      color: '#842029', bg: '#F8D7DA' },
    superseded:        { label: 'Superseded',  color: '#5c5c5c', bg: '#E9ECEF' },
    deleted:           { label: 'Deleted',     color: '#842029', bg: '#F8D7DA' },
  };
  return map[status] ?? { label: status, color: '#333', bg: '#E9ECEF' };
}

function isPreviewableInline(contentType: string): 'pdf' | 'image' | null {
  if (!contentType) return null;
  if (/^image\//.test(contentType)) return 'image';
  if (/pdf/i.test(contentType)) return 'pdf';
  return null;
}

async function sha256OfFile(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function extractFilenameFromUrl(url: string): string {
  if (!url) return '';
  try {
    const clean = url.split('?')[0].replace(/^[^:]+:\/\//, '');
    const last = clean.split('/').pop() ?? '';
    const m = last.match(/^\d+-[a-f0-9-]{36}-(.+)$/i);
    return decodeURIComponent(m?.[1] ?? last);
  } catch {
    return '';
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Main component
// ═══════════════════════════════════════════════════════════════════════════
interface Props {
  patientId: string;
  encounterId?: string | null;
  userRole: string;
  userName?: string;
}

export default function DocumentsTab({ patientId, encounterId = null, userRole }: Props) {
  const canUpload = isDoctor(userRole);
  const canReviewProposals = isDoctor(userRole);

  const [docs, setDocs] = useState<DocumentRow[] | null>(null);
  const [docsLoading, setDocsLoading] = useState(true);
  const [docsError, setDocsError] = useState<string | null>(null);

  const [proposals, setProposals] = useState<ProposalRow[]>([]);
  const [proposalsLoading, setProposalsLoading] = useState(false);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [downloadLoading, setDownloadLoading] = useState(false);

  const [uploadOpen, setUploadOpen] = useState(false);
  const [proposalsOpen, setProposalsOpen] = useState(false);
  const [supersedeFor, setSupersedeFor] = useState<DocumentRow | null>(null);
  const [deleteFor, setDeleteFor] = useState<DocumentRow | null>(null);

  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [showSuperseded, setShowSuperseded] = useState(false);

  const refreshDocs = useCallback(async () => {
    setDocsLoading(true);
    setDocsError(null);
    const rows = await trpcQuery('mrdDoctor.listForPatient', { patient_id: patientId });
    if (!rows) { setDocsError('Could not load documents'); setDocsLoading(false); return; }
    setDocs(rows);
    setDocsLoading(false);
  }, [patientId]);

  const refreshProposals = useCallback(async () => {
    if (!canReviewProposals) return;
    setProposalsLoading(true);
    const rows = await trpcQuery('chartProposals.listPending', { patient_id: patientId });
    setProposals(rows ?? []);
    setProposalsLoading(false);
  }, [patientId, canReviewProposals]);

  useEffect(() => { refreshDocs(); refreshProposals(); }, [refreshDocs, refreshProposals]);

  useEffect(() => {
    if (!docs) return;
    const scanning = docs.some((d) => d.status === 'pending_ingestion' || d.status === 'scanned');
    if (!scanning) return;
    const t = setInterval(() => { refreshDocs(); }, 10_000);
    return () => clearInterval(t);
  }, [docs, refreshDocs]);

  async function openPreview(doc: DocumentRow) {
    setSelectedId(doc.id);
    setDownloadUrl(null);
    setDownloadLoading(true);
    const res = await trpcQuery('mrdDoctor.getDownloadUrl', { id: doc.id });
    setDownloadUrl(res?.download_url ?? res?.blob_url ?? null);
    setDownloadLoading(false);
  }

  const visibleDocs = useMemo(() => {
    if (!docs) return [];
    return docs.filter((d) => {
      if (typeFilter !== 'all' && d.document_type !== typeFilter) return false;
      if (!showSuperseded && d.status === 'superseded') return false;
      return true;
    });
  }, [docs, typeFilter, showSuperseded]);

  const selectedDoc = useMemo(() => docs?.find((d) => d.id === selectedId) ?? null, [docs, selectedId]);

  async function handleMarkSuperseded(oldDoc: DocumentRow, newId: string, reason?: string) {
    try {
      await trpcMutate('mrdDoctor.markSuperseded', { id: oldDoc.id, superseded_by: newId, reason });
      setSupersedeFor(null);
      await refreshDocs();
    } catch (e: any) {
      alert(e.message || 'Could not mark superseded');
    }
  }

  async function handleSoftDelete(doc: DocumentRow, reason: string) {
    try {
      await trpcMutate('mrdDoctor.softDelete', { id: doc.id, reason });
      setDeleteFor(null);
      if (selectedId === doc.id) setSelectedId(null);
      await refreshDocs();
    } catch (e: any) {
      alert(e.message || 'Could not delete document');
    }
  }

  return (
    <div style={{ padding: '20px 24px', background: '#f5f6fa', minHeight: '100vh', paddingBottom: 100 }}>
      {canReviewProposals && proposals.length > 0 && (
        <ProposalsBanner count={proposals.length} onOpen={() => setProposalsOpen(true)} />
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#1a1a1a' }}>Document Vault</h2>
          <div style={{ fontSize: 13, color: '#666', marginTop: 4 }}>
            {docs ? `${visibleDocs.length} of ${docs.length} document${docs.length === 1 ? '' : 's'}` : '…'}
          </div>
        </div>
        {canUpload && (
          <button onClick={() => setUploadOpen(true)} style={{
            padding: '10px 18px', borderRadius: 8, border: 'none',
            background: '#0055FF', color: '#fff', fontWeight: 600, fontSize: 14,
            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <span style={{ fontSize: 18, lineHeight: 1 }}>+</span> Upload document
          </button>
        )}
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}
          style={{ padding: '8px 12px', border: '1px solid #d0d5dd', borderRadius: 6, fontSize: 13, background: '#fff' }}>
          <option value="all">All types</option>
          {DOCUMENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.icon} {t.label}</option>)}
        </select>
        <label style={{ fontSize: 13, color: '#333', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
          <input type="checkbox" checked={showSuperseded} onChange={(e) => setShowSuperseded(e.target.checked)} /> Show superseded
        </label>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: selectedDoc ? 'minmax(0, 1.1fr) minmax(0, 1fr)' : '1fr', gap: 16 }}>
        <div style={{ background: '#fff', borderRadius: 10, boxShadow: '0 1px 3px rgba(0,0,0,0.06)', overflow: 'hidden' }}>
          {docsLoading && <div style={{ padding: 40, textAlign: 'center', color: '#666' }}>Loading documents…</div>}
          {docsError && (
            <div style={{ padding: 40, textAlign: 'center', color: '#842029' }}>
              {docsError}{' '}
              <button onClick={refreshDocs} style={{ background: 'none', border: 'none', color: '#0055FF', cursor: 'pointer', textDecoration: 'underline' }}>Retry</button>
            </div>
          )}
          {!docsLoading && !docsError && visibleDocs.length === 0 && (
            <div style={{ padding: 40, textAlign: 'center', color: '#666' }}>
              {docs && docs.length === 0
                ? 'No documents yet. Upload a referral letter, ECG, or old chart to start building this patient’s vault.'
                : 'No documents match this filter.'}
            </div>
          )}
          {!docsLoading && !docsError && visibleDocs.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: '#f5f6fa', textAlign: 'left', fontWeight: 600, color: '#333' }}>
                    <th style={thStyle}>Type</th>
                    <th style={thStyle}>File</th>
                    <th style={thStyle}>Size</th>
                    <th style={thStyle}>Status</th>
                    <th style={thStyle}>Uploaded</th>
                    {canUpload && <th style={thStyle}>Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {visibleDocs.map((d) => (
                    <tr key={d.id} onClick={() => openPreview(d)}
                      style={{ cursor: 'pointer', background: selectedId === d.id ? '#EFF4FF' : 'transparent', borderTop: '1px solid #eef0f3' }}>
                      <td style={tdStyle}>
                        <span style={{ fontSize: 16, marginRight: 6 }}>{DOC_TYPE_ICON[d.document_type] ?? '📄'}</span>
                        {DOC_TYPE_LABEL[d.document_type] ?? d.document_type}
                      </td>
                      <td style={{ ...tdStyle, color: '#333', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        <span title={d.content_type}>{extractFilenameFromUrl(d.blob_url) || d.content_type}</span>
                      </td>
                      <td style={tdStyle}>{formatBytes(d.file_size_bytes)}</td>
                      <td style={tdStyle}>
                        {(() => {
                          const p = statusPill(d.status);
                          return (
                            <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600, color: p.color, background: p.bg }}>{p.label}</span>
                          );
                        })()}
                      </td>
                      <td style={{ ...tdStyle, color: '#555' }}>{formatDate(d.created_at)}</td>
                      {canUpload && (
                        <td style={tdStyle} onClick={(e) => e.stopPropagation()}>
                          <button onClick={() => setSupersedeFor(d)} disabled={d.status === 'superseded'} style={actionBtnStyle} title="Mark superseded">↻</button>
                          <button onClick={() => setDeleteFor(d)} style={{ ...actionBtnStyle, color: '#B42318' }} title="Delete with reason">🗑</button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {selectedDoc && (
          <DocumentPreview doc={selectedDoc} downloadUrl={downloadUrl} loading={downloadLoading} onClose={() => setSelectedId(null)} />
        )}
      </div>

      {uploadOpen && (
        <UploadDocumentModal
          patientId={patientId}
          encounterId={encounterId}
          onClose={() => setUploadOpen(false)}
          onDone={async () => { setUploadOpen(false); await refreshDocs(); await refreshProposals(); }}
        />
      )}
      {proposalsOpen && (
        <ProposalsDrawer proposals={proposals} loading={proposalsLoading} onClose={() => setProposalsOpen(false)} onRefresh={refreshProposals} />
      )}
      {supersedeFor && docs && (
        <SupersedeModal
          oldDoc={supersedeFor}
          candidates={docs.filter((d) => d.id !== supersedeFor.id && d.status !== 'superseded' && d.status !== 'deleted')}
          onCancel={() => setSupersedeFor(null)}
          onSubmit={(newId, reason) => handleMarkSuperseded(supersedeFor, newId, reason)}
        />
      )}
      {deleteFor && (
        <DeleteReasonModal doc={deleteFor} onCancel={() => setDeleteFor(null)} onSubmit={(reason) => handleSoftDelete(deleteFor, reason)} />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Sub-components
// ═══════════════════════════════════════════════════════════════════════════

function ProposalsBanner({ count, onOpen }: { count: number; onOpen: () => void }) {
  return (
    <div onClick={onOpen} style={{
      background: 'linear-gradient(90deg, #FFF7E6 0%, #FFEFD0 100%)',
      border: '1px solid #F0B849', borderRadius: 10, padding: '12px 16px',
      marginBottom: 14, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ fontSize: 22 }}>🤖</span>
        <div>
          <div style={{ fontWeight: 600, color: '#6A4700', fontSize: 14 }}>
            {count} chart update proposal{count === 1 ? '' : 's'} ready for your review
          </div>
          <div style={{ fontSize: 12, color: '#8A6A1B', marginTop: 2 }}>
            Conditions, allergies or medications extracted from uploaded documents — review before they hit the chart.
          </div>
        </div>
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, color: '#0055FF' }}>Review →</div>
    </div>
  );
}

function DocumentPreview({ doc, downloadUrl, loading, onClose }: { doc: DocumentRow; downloadUrl: string | null; loading: boolean; onClose: () => void }) {
  const kind = isPreviewableInline(doc.content_type);
  return (
    <div style={{ background: '#fff', borderRadius: 10, boxShadow: '0 1px 3px rgba(0,0,0,0.06)', overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 520 }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid #eef0f3', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 14, color: '#1a1a1a' }}>
            {DOC_TYPE_ICON[doc.document_type] ?? '📄'} {DOC_TYPE_LABEL[doc.document_type] ?? doc.document_type}
          </div>
          <div style={{ fontSize: 12, color: '#666', marginTop: 2 }}>
            {doc.content_type} · {formatBytes(doc.file_size_bytes)} · {formatDate(doc.created_at)}
          </div>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#666', padding: 4, lineHeight: 1 }} title="Close preview">×</button>
      </div>
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', alignItems: 'stretch', justifyContent: 'center', background: '#f5f6fa' }}>
        {loading && <div style={{ padding: 40, color: '#666' }}>Loading preview…</div>}
        {!loading && !downloadUrl && <div style={{ padding: 40, color: '#842029' }}>Could not load this document.</div>}
        {!loading && downloadUrl && kind === 'pdf' && (
          <iframe src={downloadUrl} title="Document preview" style={{ width: '100%', height: '100%', minHeight: 480, border: 'none', background: '#fff' }} />
        )}
        {!loading && downloadUrl && kind === 'image' && (
          <img src={downloadUrl} alt="Document preview" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', padding: 12 }} />
        )}
        {!loading && downloadUrl && kind === null && (
          <div style={{ padding: 40, textAlign: 'center' }}>
            <div style={{ fontSize: 32 }}>📎</div>
            <div style={{ fontSize: 14, color: '#333', marginTop: 12 }}>In-browser preview isn’t available for this file type.</div>
            <a href={downloadUrl} target="_blank" rel="noreferrer" style={{ display: 'inline-block', marginTop: 16, padding: '10px 18px', background: '#0055FF', color: '#fff', borderRadius: 6, textDecoration: 'none', fontSize: 13, fontWeight: 600 }}>Download to view</a>
          </div>
        )}
      </div>
    </div>
  );
}

function UploadDocumentModal({ patientId, encounterId, onClose, onDone }: { patientId: string; encounterId: string | null; onClose: () => void; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [docType, setDocType] = useState<string>('referral_letter');
  const [progress, setProgress] = useState<number>(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  function pickFile() { inputRef.current?.click(); }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault(); e.stopPropagation(); setDragActive(false);
    const f = e.dataTransfer?.files?.[0]; if (f) setFile(f);
  }

  async function upload() {
    if (!file) { setErr('Pick a file first'); return; }
    setBusy(true); setErr(null); setProgress(5);
    try {
      const slot = await trpcMutate('mrdDoctor.getUploadUrl', {
        patient_id: patientId,
        filename: file.name,
        content_type: file.type || 'application/octet-stream',
      });
      setProgress(20);

      let blobUrl = '';
      if (slot?.upload_mode === 'direct' && slot.upload_url && slot.token) {
        const put = await fetch(slot.upload_url, {
          method: 'PUT',
          headers: { 'content-type': file.type || 'application/octet-stream', 'x-vercel-blob-token': slot.token },
          body: file,
        });
        if (!put.ok) throw new Error(`Blob PUT failed: ${put.status}`);
        blobUrl = slot.upload_url;
      } else {
        blobUrl = `blob-pending://${slot?.blob_path ?? 'unknown'}`;
      }
      setProgress(65);

      const hash = await sha256OfFile(file);
      setProgress(85);

      await trpcMutate('mrdDoctor.registerUpload', {
        patient_id: patientId,
        encounter_id: encounterId ?? null,
        document_type: docType,
        content_type: file.type || 'application/octet-stream',
        file_size_bytes: file.size,
        blob_url: blobUrl,
        blob_hash: hash,
        filename: file.name,
      });
      setProgress(100);
      setTimeout(onDone, 200);
    } catch (e: any) {
      setErr(e.message || 'Upload failed');
      setBusy(false); setProgress(0);
    }
  }

  return (
    <ModalShell onClose={onClose} title="Upload document" width={560}>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
        onDragLeave={() => setDragActive(false)}
        onDrop={onDrop}
        onClick={pickFile}
        style={{
          border: `2px dashed ${dragActive ? '#0055FF' : '#cfd5e1'}`,
          background: dragActive ? '#EFF4FF' : '#f8f9fc',
          borderRadius: 10, padding: 28, textAlign: 'center', cursor: 'pointer', marginBottom: 16,
        }}
      >
        <input ref={inputRef} type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} style={{ display: 'none' }} />
        {file ? (
          <div>
            <div style={{ fontSize: 28 }}>📄</div>
            <div style={{ fontWeight: 600, fontSize: 14, color: '#1a1a1a', marginTop: 6 }}>{file.name}</div>
            <div style={{ fontSize: 12, color: '#555', marginTop: 4 }}>{formatBytes(file.size)} · {file.type || 'unknown type'}</div>
            <button onClick={(e) => { e.stopPropagation(); setFile(null); }} style={{ marginTop: 10, padding: '4px 10px', border: '1px solid #ddd', background: '#fff', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}>Pick a different file</button>
          </div>
        ) : (
          <div>
            <div style={{ fontSize: 36 }}>📤</div>
            <div style={{ fontWeight: 600, fontSize: 14, color: '#1a1a1a', marginTop: 6 }}>Drop a file here, or click to pick one</div>
            <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>PDF, JPG, PNG, DOCX, DICOM — up to 50 MB</div>
          </div>
        )}
      </div>

      <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#333', marginBottom: 6 }}>Document type</label>
      <select value={docType} onChange={(e) => setDocType(e.target.value)} disabled={busy}
        style={{ width: '100%', padding: '10px 12px', border: '1px solid #d0d5dd', borderRadius: 6, fontSize: 13, background: '#fff', marginBottom: 16 }}>
        {DOCUMENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.icon} {t.label}</option>)}
      </select>

      {busy && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ height: 8, background: '#eef0f3', borderRadius: 999, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${progress}%`, background: progress === 100 ? '#12B76A' : '#0055FF', transition: 'width 0.2s ease' }} />
          </div>
          <div style={{ fontSize: 11, color: '#666', marginTop: 4, textAlign: 'right' }}>{progress === 100 ? 'Done' : `${progress}%`}</div>
        </div>
      )}

      {err && <div style={{ padding: 10, background: '#FEF3F2', color: '#B42318', borderRadius: 6, fontSize: 13, marginBottom: 12 }}>{err}</div>}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={onClose} disabled={busy} style={secondaryBtn}>Cancel</button>
        <button onClick={upload} disabled={busy || !file} style={primaryBtn}>{busy ? 'Uploading…' : 'Upload'}</button>
      </div>
    </ModalShell>
  );
}

function ProposalsDrawer({ proposals, loading, onClose, onRefresh }: { proposals: ProposalRow[]; loading: boolean; onClose: () => void; onRefresh: () => void }) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectFor, setRejectFor] = useState<ProposalRow | null>(null);

  async function accept(p: ProposalRow) {
    setBusyId(p.id);
    try { await trpcMutate('chartProposals.acceptProposal', { id: p.id }); await onRefresh(); }
    catch (e: any) { alert(e.message || 'Could not accept'); }
    finally { setBusyId(null); }
  }
  async function doReject(p: ProposalRow, reason: string) {
    setBusyId(p.id);
    try { await trpcMutate('chartProposals.rejectProposal', { id: p.id, reason }); setRejectFor(null); await onRefresh(); }
    catch (e: any) { alert(e.message || 'Could not reject'); }
    finally { setBusyId(null); }
  }

  return (
    <ModalShell onClose={onClose} title={`Chart update proposals (${proposals.length})`} width={720}>
      {loading && <div style={{ padding: 20, color: '#666' }}>Loading…</div>}
      {!loading && proposals.length === 0 && (
        <div style={{ padding: 20, color: '#666' }}>No pending proposals. New suggestions will appear here when the LLM extracts facts from uploaded documents.</div>
      )}
      <div style={{ maxHeight: 520, overflowY: 'auto', marginTop: 4 }}>
        {proposals.map((p) => (
          <div key={p.id} style={{ border: '1px solid #eef0f3', borderRadius: 8, padding: 12, marginBottom: 10, background: '#fff' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600, color: '#055160', background: '#CFF4FC' }}>{p.proposal_type}</span>
                  {p.confidence !== null && <span style={{ fontSize: 11, color: '#666' }}>Confidence: {Math.round((p.confidence ?? 0) * 100)}%</span>}
                  <span style={{ fontSize: 11, color: '#999' }}>{formatDate(p.created_at)}</span>
                </div>
                <div style={{ fontSize: 13, color: '#1a1a1a', marginTop: 6, fontWeight: 600 }}>{proposalHeadline(p)}</div>
                <pre style={{ fontSize: 11, color: '#555', background: '#f8f9fc', padding: 8, borderRadius: 4, marginTop: 6, overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {JSON.stringify(p.payload, null, 2)}
                </pre>
                {p.extraction_notes && <div style={{ fontSize: 11, color: '#666', marginTop: 4, fontStyle: 'italic' }}>Notes: {p.extraction_notes}</div>}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <button onClick={() => accept(p)} disabled={busyId === p.id} style={{ ...primaryBtn, background: '#12B76A', padding: '6px 14px', fontSize: 12 }}>Accept</button>
                <button onClick={() => setRejectFor(p)} disabled={busyId === p.id} style={{ ...secondaryBtn, padding: '6px 14px', fontSize: 12, color: '#B42318' }}>Reject</button>
              </div>
            </div>
          </div>
        ))}
      </div>
      {rejectFor && <RejectReasonModal proposal={rejectFor} onCancel={() => setRejectFor(null)} onSubmit={(reason) => doReject(rejectFor, reason)} />}
    </ModalShell>
  );
}

function proposalHeadline(p: ProposalRow): string {
  const pl = p.payload ?? {};
  switch (p.proposal_type) {
    case 'condition':
    case 'problem':     return `Add condition: ${pl.label ?? pl.name ?? pl.code ?? 'unnamed'}`;
    case 'allergy':     return `Add allergy: ${pl.allergen ?? pl.substance ?? 'unknown'}`;
    case 'medication':  return `Add medication: ${pl.name ?? pl.drug ?? 'unnamed'}${pl.dose ? ` — ${pl.dose}` : ''}`;
    case 'lab_result':  return `Add lab result: ${pl.test ?? pl.loinc ?? 'unknown'}${pl.value !== undefined ? ` = ${pl.value}` : ''}`;
    case 'procedure':   return `Add procedure: ${pl.name ?? pl.code ?? 'unnamed'}`;
    default:            return p.proposal_type;
  }
}

function RejectReasonModal({ proposal, onCancel, onSubmit }: { proposal: ProposalRow; onCancel: () => void; onSubmit: (r: string) => void }) {
  const [reason, setReason] = useState('');
  return (
    <ModalShell onClose={onCancel} title="Reject proposal" width={460}>
      <div style={{ fontSize: 13, color: '#555', marginBottom: 10 }}>{proposalHeadline(proposal)}</div>
      <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#333', marginBottom: 6 }}>Reason (required)</label>
      <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="e.g. Duplicate of existing condition; Patient denies this medication"
        style={{ width: '100%', padding: 10, border: '1px solid #d0d5dd', borderRadius: 6, fontSize: 13, fontFamily: 'inherit', marginBottom: 12 }} />
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={onCancel} style={secondaryBtn}>Cancel</button>
        <button onClick={() => onSubmit(reason)} disabled={reason.trim().length < 3} style={{ ...primaryBtn, background: '#B42318' }}>Reject</button>
      </div>
    </ModalShell>
  );
}

function SupersedeModal({ oldDoc, candidates, onCancel, onSubmit }: { oldDoc: DocumentRow; candidates: DocumentRow[]; onCancel: () => void; onSubmit: (newId: string, reason?: string) => void }) {
  const [newId, setNewId] = useState<string>('');
  const [reason, setReason] = useState('');
  return (
    <ModalShell onClose={onCancel} title="Mark superseded" width={520}>
      <div style={{ fontSize: 13, color: '#555', marginBottom: 10 }}>
        Mark <b>{DOC_TYPE_LABEL[oldDoc.document_type] ?? oldDoc.document_type}</b> from {formatDate(oldDoc.created_at)} as superseded by a newer version.
      </div>
      <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Superseded by</label>
      <select value={newId} onChange={(e) => setNewId(e.target.value)}
        style={{ width: '100%', padding: 10, border: '1px solid #d0d5dd', borderRadius: 6, fontSize: 13, marginBottom: 12 }}>
        <option value="">Select newer document…</option>
        {candidates.map((c) => (
          <option key={c.id} value={c.id}>{DOC_TYPE_LABEL[c.document_type] ?? c.document_type} · {formatDate(c.created_at)}</option>
        ))}
      </select>
      <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Reason (optional)</label>
      <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2}
        style={{ width: '100%', padding: 10, border: '1px solid #d0d5dd', borderRadius: 6, fontSize: 13, fontFamily: 'inherit', marginBottom: 12 }} />
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={onCancel} style={secondaryBtn}>Cancel</button>
        <button onClick={() => onSubmit(newId, reason || undefined)} disabled={!newId} style={primaryBtn}>Mark superseded</button>
      </div>
    </ModalShell>
  );
}

function DeleteReasonModal({ doc, onCancel, onSubmit }: { doc: DocumentRow; onCancel: () => void; onSubmit: (reason: string) => void }) {
  const [reason, setReason] = useState('');
  return (
    <ModalShell onClose={onCancel} title="Delete document" width={460}>
      <div style={{ fontSize: 13, color: '#555', marginBottom: 10 }}>This is a soft-delete — the document stays in audit history but is hidden from the chart.</div>
      <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Reason (required)</label>
      <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="e.g. Uploaded for wrong patient; Poor scan quality"
        style={{ width: '100%', padding: 10, border: '1px solid #d0d5dd', borderRadius: 6, fontSize: 13, fontFamily: 'inherit', marginBottom: 12 }} />
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={onCancel} style={secondaryBtn}>Cancel</button>
        <button onClick={() => onSubmit(reason)} disabled={reason.trim().length < 3} style={{ ...primaryBtn, background: '#B42318' }}>Delete</button>
      </div>
    </ModalShell>
  );
}

function ModalShell({ onClose, title, width = 520, children }: { onClose: () => void; title: string; width?: number; children: React.ReactNode }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(16, 24, 40, 0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 12, padding: 20, width, maxWidth: '94vw', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div style={{ fontWeight: 700, fontSize: 17, color: '#1a1a1a' }}>{title}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#666', lineHeight: 1 }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ── Style tokens ────────────────────────────────────────────────────────────
const thStyle: React.CSSProperties = { padding: '10px 12px', fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.3 };
const tdStyle: React.CSSProperties = { padding: '10px 12px', verticalAlign: 'middle' };

const primaryBtn: React.CSSProperties = {
  padding: '8px 16px', borderRadius: 6, border: 'none',
  background: '#0055FF', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer',
};
const secondaryBtn: React.CSSProperties = {
  padding: '8px 16px', borderRadius: 6, border: '1px solid #d0d5dd',
  background: '#fff', color: '#333', fontSize: 13, fontWeight: 500, cursor: 'pointer',
};
const actionBtnStyle: React.CSSProperties = {
  background: 'none', border: '1px solid #e5e7eb', borderRadius: 4,
  padding: '2px 8px', cursor: 'pointer', fontSize: 13, marginRight: 4, color: '#333',
};
