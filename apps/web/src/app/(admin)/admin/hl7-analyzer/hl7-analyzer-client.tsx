'use client';

import { useState, useEffect, useCallback } from 'react';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface User { sub: string; hospital_id: string; role: string; email: string; name: string; }

type TabType = 'adapters' | 'messages' | 'dead_letters' | 'analytics';
type AdapterStatus = 'active' | 'inactive' | 'error' | 'maintenance';
type MessageStatus = 'received' | 'parsed' | 'mapped' | 'processed' | 'error' | 'ack_sent' | 'nack_sent' | 'retry' | 'dead_letter';

interface Adapter {
  id: string;
  name: string;
  manufacturer: string | null;
  model: string | null;
  serial_number: string | null;
  department: string | null;
  location: string | null;
  protocol: string;
  direction: string;
  host: string | null;
  port: number | null;
  hl7_version: string | null;
  status: AdapterStatus;
  last_heartbeat: string | null;
  last_message_at: string | null;
  messages_today: number;
  errors_today: number;
  uptime_percent: number | null;
  created_at: string;
}

interface Message {
  id: string;
  adapter_id: string;
  message_control_id: string | null;
  message_type: string;
  direction: string;
  status: MessageStatus;
  error_message: string | null;
  ack_code: string | null;
  retry_count: number;
  processing_time_ms: number | null;
  received_at: string;
}

interface FullMessage extends Message {
  raw_message: string | null;
  parsed_segments: unknown;
  mapped_data: unknown;
  error_segment: string | null;
  patient_id: string | null;
  order_id: string | null;
}

interface AdapterEvent {
  id: string;
  adapter_id: string;
  event_type: string;
  severity: string;
  message: string | null;
  recorded_at: string;
}

interface Stats {
  total_adapters: number;
  active_adapters: number;
  error_adapters: number;
  messages_today: number;
  errors_today: number;
  dead_letters: number;
  pending_retry: number;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const ADAPTER_STATUS_COLORS: Record<AdapterStatus, string> = {
  active: '#22c55e', inactive: '#6b7280', error: '#ef4444', maintenance: '#f59e0b',
};
const MSG_STATUS_COLORS: Record<string, string> = {
  received: '#94a3b8', parsed: '#3b82f6', mapped: '#a855f7', processed: '#22c55e',
  error: '#ef4444', ack_sent: '#22c55e', nack_sent: '#ef4444', retry: '#f59e0b', dead_letter: '#dc2626',
};
const SEVERITY_COLORS: Record<string, string> = {
  info: '#3b82f6', warning: '#f59e0b', error: '#ef4444', critical: '#dc2626',
};

function fmtDateTime(d: string | null) { return d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'; }
function timeAgo(d: string | null) {
  if (!d) return 'never';
  const ms = Date.now() - new Date(d).getTime();
  if (ms < 60000) return `${Math.floor(ms / 1000)}s ago`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ago`;
  if (ms < 86400000) return `${Math.floor(ms / 3600000)}h ago`;
  return `${Math.floor(ms / 86400000)}d ago`;
}

async function api(path: string, body?: unknown) {
  const res = await fetch(path, body !== undefined ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error((e as Record<string, string>).message || res.statusText); }
  return res.json();
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export default function Hl7AnalyzerClient({ user }: { user: User }) {
  const [tab, setTab] = useState<TabType>('adapters');

  const tabs: { key: TabType; label: string }[] = [
    { key: 'adapters', label: 'Analyzers' },
    { key: 'messages', label: 'Message Log' },
    { key: 'dead_letters', label: 'Dead Letters' },
    { key: 'analytics', label: 'Dashboard' },
  ];

  return (
    <div style={{ minHeight: '100vh', background: '#0f172a', color: '#e2e8f0', padding: 24 }}>
      <div style={{ maxWidth: 1400, margin: '0 auto' }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 4 }}>HL7 Analyzer Integration</h1>
        <p style={{ color: '#94a3b8', marginBottom: 24 }}>Adapter management, message routing, health monitoring, dead-letter queue</p>

        <div style={{ display: 'flex', gap: 4, marginBottom: 24, borderBottom: '1px solid #334155', paddingBottom: 2 }}>
          {tabs.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              style={{ padding: '8px 20px', borderRadius: '6px 6px 0 0', background: tab === t.key ? '#1e293b' : 'transparent',
                color: tab === t.key ? '#f1f5f9' : '#94a3b8', fontWeight: tab === t.key ? 600 : 400, border: 'none', cursor: 'pointer', fontSize: 14 }}>
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'adapters' && <AdaptersTab user={user} />}
        {tab === 'messages' && <MessagesTab user={user} />}
        {tab === 'dead_letters' && <DeadLettersTab user={user} />}
        {tab === 'analytics' && <AnalyticsTab user={user} />}
      </div>
    </div>
  );
}

/* ================================================================== */
/*  TAB 1 — Adapters (Analyzer Health Grid)                            */
/* ================================================================== */

function AdaptersTab({ user }: { user: User }) {
  const [adapters, setAdapters] = useState<Adapter[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [selectedAdapter, setSelectedAdapter] = useState<Adapter | null>(null);
  const [events, setEvents] = useState<AdapterEvent[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api(`/api/trpc/hl7Analyzer.listAdapters?input=${encodeURIComponent(JSON.stringify({ hospital_id: user.hospital_id }))}`);
      setAdapters(r.result?.data ?? []);
    } catch { /* ignore */ }
    setLoading(false);
  }, [user.hospital_id]);

  const loadEvents = useCallback(async (adapterId: string) => {
    try {
      const r = await api(`/api/trpc/hl7Analyzer.listEvents?input=${encodeURIComponent(JSON.stringify({ adapter_id: adapterId, limit: 20 }))}`);
      setEvents(r.result?.data ?? []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <div style={{ background: '#1e293b', borderRadius: 8, padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600 }}>Analyzer Adapters</h2>
          <button onClick={() => setShowAdd(!showAdd)}
            style={{ padding: '8px 16px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>
            + Register Analyzer
          </button>
        </div>

        {showAdd && <AddAdapterForm user={user} onDone={() => { setShowAdd(false); load(); }} />}

        {loading ? <p style={{ color: '#64748b' }}>Loading...</p> : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
            {adapters.length === 0 ? (
              <p style={{ color: '#64748b', gridColumn: '1 / -1', textAlign: 'center', padding: 20 }}>No analyzers registered</p>
            ) : adapters.map(a => (
              <div key={a.id} onClick={() => { setSelectedAdapter(a); loadEvents(a.id); }}
                style={{ background: '#0f172a', borderRadius: 8, padding: 16, border: `1px solid ${ADAPTER_STATUS_COLORS[a.status]}33`,
                  cursor: 'pointer', transition: 'border-color 0.2s' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                  <div>
                    <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 2 }}>{a.name}</h3>
                    <p style={{ fontSize: 12, color: '#94a3b8' }}>{[a.manufacturer, a.model].filter(Boolean).join(' ') || 'Unknown model'}</p>
                  </div>
                  <span style={{ padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600,
                    background: ADAPTER_STATUS_COLORS[a.status] + '22', color: ADAPTER_STATUS_COLORS[a.status] }}>
                    {a.status}
                  </span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 12 }}>
                  <div><span style={{ color: '#64748b' }}>Protocol:</span> <span style={{ color: '#94a3b8' }}>{a.protocol.toUpperCase()}</span></div>
                  <div><span style={{ color: '#64748b' }}>Direction:</span> <span style={{ color: '#94a3b8' }}>{a.direction}</span></div>
                  <div><span style={{ color: '#64748b' }}>Heartbeat:</span> <span style={{ color: a.last_heartbeat && (Date.now() - new Date(a.last_heartbeat).getTime() < 300000) ? '#22c55e' : '#ef4444' }}>{timeAgo(a.last_heartbeat)}</span></div>
                  <div><span style={{ color: '#64748b' }}>Last msg:</span> <span style={{ color: '#94a3b8' }}>{timeAgo(a.last_message_at)}</span></div>
                  <div><span style={{ color: '#64748b' }}>Msgs today:</span> <span style={{ fontWeight: 600 }}>{a.messages_today}</span></div>
                  <div><span style={{ color: '#64748b' }}>Errors:</span> <span style={{ color: a.errors_today > 0 ? '#ef4444' : '#22c55e', fontWeight: 600 }}>{a.errors_today}</span></div>
                </div>

                {a.host && a.port && (
                  <div style={{ marginTop: 8, fontSize: 11, color: '#475569', fontFamily: 'monospace' }}>
                    {a.host}:{a.port} (HL7 v{a.hl7_version})
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Event log for selected adapter */}
      {selectedAdapter && (
        <div style={{ background: '#1e293b', borderRadius: 8, padding: 20, marginTop: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h3 style={{ fontSize: 16, fontWeight: 600 }}>Events — {selectedAdapter.name}</h3>
            <button onClick={() => setSelectedAdapter(null)} style={{ color: '#94a3b8', background: 'none', border: 'none', cursor: 'pointer', fontSize: 12 }}>Close</button>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #334155' }}>
                {['Time', 'Type', 'Severity', 'Message'].map(h =>
                  <th key={h} style={{ textAlign: 'left', padding: 8, color: '#94a3b8', fontWeight: 500 }}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {events.length === 0 ? (
                <tr><td colSpan={4} style={{ padding: 16, textAlign: 'center', color: '#64748b' }}>No events</td></tr>
              ) : events.map(ev => (
                <tr key={ev.id} style={{ borderBottom: '1px solid #1e293b' }}>
                  <td style={{ padding: 8, fontSize: 12 }}>{fmtDateTime(ev.recorded_at)}</td>
                  <td style={{ padding: 8, fontFamily: 'monospace', fontSize: 12 }}>{ev.event_type}</td>
                  <td style={{ padding: 8 }}>
                    <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600,
                      background: (SEVERITY_COLORS[ev.severity] ?? '#94a3b8') + '22', color: SEVERITY_COLORS[ev.severity] ?? '#94a3b8' }}>
                      {ev.severity}
                    </span>
                  </td>
                  <td style={{ padding: 8, color: '#94a3b8' }}>{ev.message ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Add Adapter Form                                                   */
/* ------------------------------------------------------------------ */

function AddAdapterForm({ user, onDone }: { user: User; onDone: () => void }) {
  const [form, setForm] = useState({
    name: '', manufacturer: '', model: '', serial_number: '',
    department: '', location: '',
    protocol: 'mllp', direction: 'bidirectional',
    host: '', port: '2575', hl7_version: '2.5.1',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    if (!form.name) { setError('Analyzer name required'); return; }
    setSaving(true); setError('');
    try {
      await api('/api/trpc/hl7Analyzer.createAdapter', {
        hospital_id: user.hospital_id,
        name: form.name,
        manufacturer: form.manufacturer || undefined,
        model: form.model || undefined,
        serial_number: form.serial_number || undefined,
        department: form.department || undefined,
        location: form.location || undefined,
        protocol: form.protocol,
        direction: form.direction,
        host: form.host || undefined,
        port: form.port ? parseInt(form.port) : undefined,
        hl7_version: form.hl7_version,
      });
      onDone();
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
    setSaving(false);
  };

  const inputStyle = { padding: '6px 10px', background: '#0f172a', color: '#e2e8f0', border: '1px solid #334155', borderRadius: 6, fontSize: 13, width: '100%' };

  return (
    <div style={{ background: '#0f172a', borderRadius: 8, padding: 16, marginBottom: 16, border: '1px solid #3b82f6' }}>
      <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>Register New Analyzer</h3>
      {error && <div style={{ background: '#7f1d1d', color: '#fca5a5', padding: 8, borderRadius: 6, marginBottom: 12, fontSize: 13 }}>{error}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
        <div><label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 4 }}>Name *</label>
          <input value={form.name} onChange={e => setForm({...form, name: e.target.value})} style={inputStyle} placeholder="e.g. Beckman AU5800 #1" /></div>
        <div><label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 4 }}>Manufacturer</label>
          <input value={form.manufacturer} onChange={e => setForm({...form, manufacturer: e.target.value})} style={inputStyle} /></div>
        <div><label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 4 }}>Model</label>
          <input value={form.model} onChange={e => setForm({...form, model: e.target.value})} style={inputStyle} /></div>
        <div><label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 4 }}>Serial #</label>
          <input value={form.serial_number} onChange={e => setForm({...form, serial_number: e.target.value})} style={inputStyle} /></div>
        <div><label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 4 }}>Department</label>
          <input value={form.department} onChange={e => setForm({...form, department: e.target.value})} style={inputStyle} /></div>
        <div><label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 4 }}>Location</label>
          <input value={form.location} onChange={e => setForm({...form, location: e.target.value})} style={inputStyle} /></div>
        <div><label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 4 }}>Protocol</label>
          <select value={form.protocol} onChange={e => setForm({...form, protocol: e.target.value})} style={inputStyle}>
            <option value="mllp">MLLP</option><option value="http">HTTP</option><option value="file_drop">File Drop</option>
            <option value="serial">Serial</option><option value="astm">ASTM</option>
          </select></div>
        <div><label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 4 }}>Direction</label>
          <select value={form.direction} onChange={e => setForm({...form, direction: e.target.value})} style={inputStyle}>
            <option value="bidirectional">Bidirectional</option><option value="inbound">Inbound only</option><option value="outbound">Outbound only</option>
          </select></div>
        <div><label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 4 }}>Host</label>
          <input value={form.host} onChange={e => setForm({...form, host: e.target.value})} style={inputStyle} placeholder="192.168.1.100" /></div>
        <div><label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 4 }}>Port</label>
          <input type="number" value={form.port} onChange={e => setForm({...form, port: e.target.value})} style={inputStyle} /></div>
        <div><label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 4 }}>HL7 Version</label>
          <select value={form.hl7_version} onChange={e => setForm({...form, hl7_version: e.target.value})} style={inputStyle}>
            <option value="2.3.1">2.3.1</option><option value="2.5">2.5</option><option value="2.5.1">2.5.1</option><option value="2.7">2.7</option>
          </select></div>
      </div>
      <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
        <button onClick={save} disabled={saving}
          style={{ padding: '8px 20px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 13, opacity: saving ? 0.6 : 1 }}>
          {saving ? 'Saving...' : 'Register'}
        </button>
        <button onClick={onDone} style={{ padding: '8px 20px', background: '#334155', color: '#e2e8f0', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>Cancel</button>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  TAB 2 — Message Log                                                */
/* ================================================================== */

function MessagesTab({ user }: { user: User }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [total, setTotal] = useState(0);
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<FullMessage | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, unknown> = { hospital_id: user.hospital_id, limit: 100 };
      if (filterStatus) params.status = filterStatus;
      const r = await api(`/api/trpc/hl7Analyzer.listMessages?input=${encodeURIComponent(JSON.stringify(params))}`);
      const d = r.result?.data;
      setMessages(d?.messages ?? []);
      setTotal(d?.total ?? 0);
    } catch { /* ignore */ }
    setLoading(false);
  }, [user.hospital_id, filterStatus]);

  const viewDetail = async (id: string) => {
    try {
      const r = await api(`/api/trpc/hl7Analyzer.getMessage?input=${encodeURIComponent(JSON.stringify({ message_id: id }))}`);
      setDetail(r.result?.data ?? null);
    } catch { /* ignore */ }
  };

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <div style={{ background: '#1e293b', borderRadius: 8, padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600 }}>Message Log ({total} total)</h2>
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
            style={{ padding: '6px 12px', background: '#0f172a', color: '#e2e8f0', border: '1px solid #334155', borderRadius: 6, fontSize: 13 }}>
            <option value="">All Statuses</option>
            {['received','parsed','mapped','processed','error','ack_sent','nack_sent','retry','dead_letter'].map(s =>
              <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
          </select>
        </div>

        {loading ? <p style={{ color: '#64748b' }}>Loading...</p> : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #334155' }}>
                {['Control ID', 'Type', 'Direction', 'Status', 'ACK', 'Retries', 'Time (ms)', 'Received', ''].map(h =>
                  <th key={h} style={{ textAlign: 'left', padding: 8, color: '#94a3b8', fontWeight: 500 }}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {messages.length === 0 ? (
                <tr><td colSpan={9} style={{ padding: 20, textAlign: 'center', color: '#64748b' }}>No messages</td></tr>
              ) : messages.map(m => (
                <tr key={m.id} style={{ borderBottom: '1px solid #1e293b' }}>
                  <td style={{ padding: 8, fontFamily: 'monospace', fontSize: 11 }}>{m.message_control_id ?? '—'}</td>
                  <td style={{ padding: 8, fontFamily: 'monospace', fontSize: 12, fontWeight: 600 }}>{m.message_type}</td>
                  <td style={{ padding: 8, fontSize: 12 }}>{m.direction}</td>
                  <td style={{ padding: 8 }}>
                    <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600,
                      background: (MSG_STATUS_COLORS[m.status] ?? '#94a3b8') + '22', color: MSG_STATUS_COLORS[m.status] ?? '#94a3b8' }}>
                      {m.status.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td style={{ padding: 8, fontFamily: 'monospace', fontSize: 12, color: m.ack_code === 'AA' ? '#22c55e' : m.ack_code ? '#ef4444' : '#475569' }}>
                    {m.ack_code ?? '—'}
                  </td>
                  <td style={{ padding: 8, textAlign: 'center', color: m.retry_count > 0 ? '#f59e0b' : '#475569' }}>{m.retry_count}</td>
                  <td style={{ padding: 8, fontFamily: 'monospace', fontSize: 11, color: '#94a3b8' }}>
                    {m.processing_time_ms != null ? `${m.processing_time_ms}ms` : '—'}
                  </td>
                  <td style={{ padding: 8, fontSize: 12, color: '#94a3b8' }}>{fmtDateTime(m.received_at)}</td>
                  <td style={{ padding: 8 }}>
                    <button onClick={() => viewDetail(m.id)}
                      style={{ color: '#3b82f6', background: 'none', border: 'none', cursor: 'pointer', fontSize: 11 }}>
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Message detail panel */}
      {detail && (
        <div style={{ background: '#1e293b', borderRadius: 8, padding: 20, marginTop: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h3 style={{ fontSize: 16, fontWeight: 600 }}>Message Detail — {detail.message_control_id}</h3>
            <button onClick={() => setDetail(null)} style={{ color: '#94a3b8', background: 'none', border: 'none', cursor: 'pointer', fontSize: 12 }}>Close</button>
          </div>

          {detail.error_message && (
            <div style={{ background: '#7f1d1d', color: '#fca5a5', padding: 10, borderRadius: 6, marginBottom: 12, fontSize: 13 }}>
              Error{detail.error_segment ? ` (${detail.error_segment})` : ''}: {detail.error_message}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <h4 style={{ fontSize: 13, color: '#94a3b8', marginBottom: 8 }}>Raw HL7 Message</h4>
              <pre style={{ background: '#0f172a', padding: 12, borderRadius: 6, fontSize: 11, fontFamily: 'monospace',
                color: '#e2e8f0', whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 300, overflow: 'auto' }}>
                {detail.raw_message ?? 'No raw message'}
              </pre>
            </div>
            <div>
              <h4 style={{ fontSize: 13, color: '#94a3b8', marginBottom: 8 }}>Parsed Segments</h4>
              <pre style={{ background: '#0f172a', padding: 12, borderRadius: 6, fontSize: 11, fontFamily: 'monospace',
                color: '#e2e8f0', whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 300, overflow: 'auto' }}>
                {JSON.stringify(detail.parsed_segments, null, 2)}
              </pre>
            </div>
          </div>

          {Boolean(detail.mapped_data) && (
            <div style={{ marginTop: 12 }}>
              <h4 style={{ fontSize: 13, color: '#94a3b8', marginBottom: 8 }}>Mapped Data</h4>
              <pre style={{ background: '#0f172a', padding: 12, borderRadius: 6, fontSize: 11, fontFamily: 'monospace',
                color: '#22c55e', whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto' }}>
                {JSON.stringify(detail.mapped_data, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ================================================================== */
/*  TAB 3 — Dead-Letter Queue                                         */
/* ================================================================== */

function DeadLettersTab({ user }: { user: User }) {
  const [deadLetters, setDeadLetters] = useState<FullMessage[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api(`/api/trpc/hl7Analyzer.listDeadLetters?input=${encodeURIComponent(JSON.stringify({ hospital_id: user.hospital_id, limit: 50 }))}`);
      setDeadLetters(r.result?.data ?? []);
    } catch { /* ignore */ }
    setLoading(false);
  }, [user.hospital_id]);

  const retryMsg = async (id: string) => {
    try {
      await api('/api/trpc/hl7Analyzer.retryMessage', { message_id: id });
      load();
    } catch { /* ignore */ }
  };

  useEffect(() => { load(); }, [load]);

  return (
    <div style={{ background: '#1e293b', borderRadius: 8, padding: 20 }}>
      <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>Dead-Letter Queue</h2>
      <p style={{ color: '#94a3b8', fontSize: 13, marginBottom: 16 }}>Messages that exceeded retry limits. Review, fix the issue, then retry.</p>

      {loading ? <p style={{ color: '#64748b' }}>Loading...</p> : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #334155' }}>
              {['Control ID', 'Type', 'Adapter', 'Error', 'Retries', 'Received', ''].map(h =>
                <th key={h} style={{ textAlign: 'left', padding: 8, color: '#94a3b8', fontWeight: 500 }}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {deadLetters.length === 0 ? (
              <tr><td colSpan={7} style={{ padding: 20, textAlign: 'center', color: '#22c55e' }}>No dead letters — all clear</td></tr>
            ) : deadLetters.map(dl => (
              <tr key={dl.id} style={{ borderBottom: '1px solid #1e293b' }}>
                <td style={{ padding: 8, fontFamily: 'monospace', fontSize: 11 }}>{dl.message_control_id ?? '—'}</td>
                <td style={{ padding: 8, fontFamily: 'monospace', fontSize: 12 }}>{dl.message_type}</td>
                <td style={{ padding: 8, fontFamily: 'monospace', fontSize: 11 }}>{dl.adapter_id.slice(0, 8)}...</td>
                <td style={{ padding: 8, color: '#ef4444', fontSize: 12 }}>{dl.error_message ?? '—'}</td>
                <td style={{ padding: 8, textAlign: 'center' }}>{dl.retry_count}</td>
                <td style={{ padding: 8, color: '#94a3b8', fontSize: 12 }}>{fmtDateTime(dl.received_at)}</td>
                <td style={{ padding: 8 }}>
                  <button onClick={() => retryMsg(dl.id)}
                    style={{ padding: '4px 12px', background: '#f59e0b', color: '#000', border: 'none', borderRadius: 4, cursor: 'pointer', fontWeight: 600, fontSize: 11 }}>
                    Retry
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/* ================================================================== */
/*  TAB 4 — Analytics Dashboard                                        */
/* ================================================================== */

function AnalyticsTab({ user }: { user: User }) {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await api(`/api/trpc/hl7Analyzer.stats?input=${encodeURIComponent(JSON.stringify({ hospital_id: user.hospital_id }))}`);
        setStats(r.result?.data ?? null);
      } catch { /* ignore */ }
    })();
  }, [user.hospital_id]);

  if (!stats) return <p style={{ color: '#64748b' }}>Loading analytics...</p>;

  const cards: { label: string; value: number; color: string; sub?: string }[] = [
    { label: 'Total Adapters', value: stats.total_adapters, color: '#3b82f6' },
    { label: 'Active', value: stats.active_adapters, color: '#22c55e' },
    { label: 'In Error', value: stats.error_adapters, color: stats.error_adapters > 0 ? '#ef4444' : '#22c55e' },
    { label: 'Messages Today', value: stats.messages_today, color: '#a855f7' },
    { label: 'Errors Today', value: stats.errors_today, color: stats.errors_today > 0 ? '#ef4444' : '#22c55e' },
    { label: 'Dead Letters', value: stats.dead_letters, color: stats.dead_letters > 0 ? '#dc2626' : '#22c55e' },
    { label: 'Pending Retry', value: stats.pending_retry, color: stats.pending_retry > 0 ? '#f59e0b' : '#22c55e' },
  ];

  const successRate = stats.messages_today > 0
    ? (((stats.messages_today - stats.errors_today) / stats.messages_today) * 100).toFixed(1)
    : '100.0';

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 16, marginBottom: 24 }}>
        {cards.map(c => (
          <div key={c.label} style={{ background: '#1e293b', borderRadius: 8, padding: 20 }}>
            <div style={{ color: '#94a3b8', fontSize: 13, marginBottom: 8 }}>{c.label}</div>
            <div style={{ fontSize: 32, fontWeight: 700, color: c.color }}>{c.value}</div>
          </div>
        ))}
      </div>

      <div style={{ background: '#1e293b', borderRadius: 8, padding: 20 }}>
        <div style={{ color: '#94a3b8', fontSize: 13, marginBottom: 8 }}>Message Success Rate (Today)</div>
        <div style={{ fontSize: 48, fontWeight: 700, color: parseFloat(successRate) >= 95 ? '#22c55e' : parseFloat(successRate) >= 80 ? '#f59e0b' : '#ef4444' }}>
          {successRate}%
        </div>
        <div style={{ background: '#0f172a', borderRadius: 4, height: 8, marginTop: 12, overflow: 'hidden' }}>
          <div style={{ background: parseFloat(successRate) >= 95 ? '#22c55e' : '#f59e0b', height: '100%', width: `${successRate}%`, borderRadius: 4 }} />
        </div>
      </div>

      {/* Protocol reference */}
      <div style={{ background: '#1e293b', borderRadius: 8, padding: 20, marginTop: 20 }}>
        <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Supported Protocols</h3>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #334155' }}>
              {['Protocol', 'Port', 'Use Case'].map(h =>
                <th key={h} style={{ textAlign: 'left', padding: 8, color: '#94a3b8' }}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {[
              ['MLLP', '2575', 'Standard HL7 v2 over TCP — most lab analyzers'],
              ['HTTP', '80/443', 'REST/SOAP wrapper — cloud-connected analyzers'],
              ['File Drop', 'N/A', 'Shared folder polling — legacy systems, PACS'],
              ['Serial', 'COM/ttyS', 'RS-232 direct — older point-of-care devices'],
              ['ASTM', '15200', 'ASTM E1381/1394 — some chemistry/hematology analyzers'],
            ].map(([proto, port, use]) => (
              <tr key={proto} style={{ borderBottom: '1px solid #1e293b' }}>
                <td style={{ padding: 8, fontWeight: 600 }}>{proto}</td>
                <td style={{ padding: 8, fontFamily: 'monospace', color: '#94a3b8' }}>{port}</td>
                <td style={{ padding: 8, color: '#94a3b8' }}>{use}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
