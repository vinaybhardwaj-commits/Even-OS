'use client';

/**
 * Communications Page — OC.4d
 *
 * Full chat transcript view for a patient encounter.
 * Features:
 *  - Filter bar: by message type, date range, sender
 *  - Full message history with system events
 *  - Inline file/attachment previews
 *  - Print transcript as PDF
 *  - Back link to patient chart
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';

// ── Types ─────────────────────────────────────────────────

interface Props {
  patientId: string;
  encounterId: string;
  userId: string;
  userName: string;
  userRole: string;
  hospitalId: string;
}

interface Message {
  id: number;
  channel_id: number;
  sender_id: string | null;
  sender_name: string | null;
  sender_role: string | null;
  sender_department: string | null;
  message_type: string;
  priority: string;
  content: string;
  metadata: any;
  is_deleted: boolean;
  is_retracted: boolean;
  retraction_reason: string | null;
  created_at: string;
  attachments?: { file_name: string; file_type: string; file_url: string; file_size: number }[];
}

interface PatientInfo {
  name: string;
  uhid: string;
  encounter_id: string;
  bed_label: string | null;
}

// ── Helpers ───────────────────────────────────────────────

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function formatDateTime(dateStr: string): string {
  return `${formatDate(dateStr)} ${formatTime(dateStr)}`;
}

function getTypeColor(type: string): string {
  const colors: Record<string, string> = {
    chat: '#6B7280',
    request: '#3B82F6',
    update: '#10B981',
    escalation: '#EF4444',
    fyi: '#9CA3AF',
    decision_needed: '#F59E0B',
    handoff: '#8B5CF6',
    system: '#6B7280',
  };
  return colors[type] || '#6B7280';
}

function getTypeIcon(type: string): string {
  const icons: Record<string, string> = {
    chat: '💬', request: '📋', update: '📢', escalation: '🚨',
    fyi: 'ℹ️', decision_needed: '⚖️', handoff: '🤝', system: '⚙️',
  };
  return icons[type] || '💬';
}

const MESSAGE_TYPE_FILTERS = [
  { value: 'all', label: 'All Messages' },
  { value: 'chat', label: 'Chat' },
  { value: 'system', label: 'System Events' },
  { value: 'request', label: 'Requests' },
  { value: 'update', label: 'Updates' },
  { value: 'escalation', label: 'Escalations' },
  { value: 'handoff', label: 'Handoffs' },
  { value: 'decision_needed', label: 'Decisions' },
];

// ── Component ─────────────────────────────────────────────

export default function CommsClient({ patientId, encounterId, userId, userName, userRole, hospitalId }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [patientInfo, setPatientInfo] = useState<PatientInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const printRef = useRef<HTMLDivElement>(null);

  // ── Load data ──────────────────────────────────────────
  const loadData = useCallback(async () => {
    if (!encounterId) return;
    setLoading(true);

    try {
      // Load patient info
      const patientParams = `?input=${encodeURIComponent(JSON.stringify({ json: { id: patientId } }))}`;
      const patientRes = await fetch(`/api/trpc/patients.getById${patientParams}`);
      const patientJson = await patientRes.json();
      const p = patientJson.result?.data?.json;
      if (p) {
        setPatientInfo({
          name: p.name_full || p.full_name || `${p.name_given || ''} ${p.name_family || ''}`.trim() || 'Patient',
          uhid: p.uhid || '',
          encounter_id: encounterId,
          bed_label: null,
        });
      }

      // Load messages from the patient channel
      const channelId = `patient-${encounterId}`;
      const msgParams = `?input=${encodeURIComponent(JSON.stringify({ json: { channelId, limit: 500 } }))}`;
      const msgRes = await fetch(`/api/trpc/chat.listMessages${msgParams}`);
      const msgJson = await msgRes.json();
      const msgs = msgJson.result?.data?.json || [];
      setMessages(msgs);
    } catch (err) {
      console.error('[Comms] Failed to load data:', err);
    } finally {
      setLoading(false);
    }
  }, [patientId, encounterId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ── Filtering ──────────────────────────────────────────
  const filteredMessages = useMemo(() => {
    return messages.filter(m => {
      // Type filter
      if (typeFilter !== 'all' && m.message_type !== typeFilter) return false;

      // Search filter
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const matchContent = m.content?.toLowerCase().includes(q);
        const matchSender = m.sender_name?.toLowerCase().includes(q);
        if (!matchContent && !matchSender) return false;
      }

      // Date range filter
      if (dateFrom) {
        const msgDate = new Date(m.created_at);
        const from = new Date(dateFrom);
        if (msgDate < from) return false;
      }
      if (dateTo) {
        const msgDate = new Date(m.created_at);
        const to = new Date(dateTo + 'T23:59:59');
        if (msgDate > to) return false;
      }

      return true;
    });
  }, [messages, typeFilter, searchQuery, dateFrom, dateTo]);

  // ── Group by date ──────────────────────────────────────
  const groupedMessages = useMemo(() => {
    const groups: { date: string; messages: Message[] }[] = [];
    let currentDate = '';

    for (const msg of filteredMessages) {
      const msgDate = formatDate(msg.created_at);
      if (msgDate !== currentDate) {
        currentDate = msgDate;
        groups.push({ date: msgDate, messages: [] });
      }
      groups[groups.length - 1].messages.push(msg);
    }

    return groups;
  }, [filteredMessages]);

  // ── Print transcript ───────────────────────────────────
  const handlePrint = useCallback(() => {
    window.print();
  }, []);

  // ── Render ─────────────────────────────────────────────

  if (!encounterId) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: '#666' }}>
        <h2 style={{ fontSize: 18, fontWeight: 600 }}>No encounter selected</h2>
        <p style={{ marginTop: 8 }}>This page requires an active encounter to display communications.</p>
        <a href={`/care/patient/${patientId}`} style={{ color: '#0055FF', marginTop: 16, display: 'inline-block' }}>
          ← Back to Patient Chart
        </a>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#F8FAFC' }}>
      {/* ── Header ──────────────────────────────────────────── */}
      <header style={{
        background: '#002054',
        color: 'white',
        padding: '16px 24px',
        display: 'flex',
        alignItems: 'center',
        gap: 16,
      }}>
        <a
          href={`/care/patient/${patientId}`}
          style={{ color: 'white', textDecoration: 'none', fontSize: 20 }}
          title="Back to Patient Chart"
        >
          ←
        </a>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>
            💬 Communications
          </div>
          {patientInfo && (
            <div style={{ fontSize: 12, opacity: 0.7, marginTop: 2 }}>
              {patientInfo.name} ({patientInfo.uhid}) · Encounter {encounterId.slice(0, 8)}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={handlePrint}
            style={{
              background: 'rgba(255,255,255,0.1)',
              color: 'white',
              border: '1px solid rgba(255,255,255,0.2)',
              padding: '8px 16px',
              borderRadius: 6,
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            🖨 Print Transcript
          </button>
          <span style={{
            background: '#10B981',
            padding: '8px 12px',
            borderRadius: 6,
            fontSize: 13,
            fontWeight: 600,
          }}>
            {filteredMessages.length} messages
          </span>
        </div>
      </header>

      {/* ── Filter Bar ──────────────────────────────────────── */}
      <div className="no-print" style={{
        background: 'white',
        borderBottom: '1px solid #e0e0e0',
        padding: '12px 24px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexWrap: 'wrap',
      }}>
        {/* Type filter */}
        <select
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value)}
          style={{
            padding: '8px 12px',
            border: '1px solid #ddd',
            borderRadius: 6,
            fontSize: 13,
            background: 'white',
          }}
        >
          {MESSAGE_TYPE_FILTERS.map(f => (
            <option key={f.value} value={f.value}>{f.label}</option>
          ))}
        </select>

        {/* Search */}
        <input
          type="text"
          placeholder="Search messages..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          style={{
            padding: '8px 12px',
            border: '1px solid #ddd',
            borderRadius: 6,
            fontSize: 13,
            minWidth: 200,
            flex: 1,
          }}
        />

        {/* Date range */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 12, color: '#666' }}>From:</span>
          <input
            type="date"
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
            style={{
              padding: '6px 8px',
              border: '1px solid #ddd',
              borderRadius: 6,
              fontSize: 12,
            }}
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 12, color: '#666' }}>To:</span>
          <input
            type="date"
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
            style={{
              padding: '6px 8px',
              border: '1px solid #ddd',
              borderRadius: 6,
              fontSize: 12,
            }}
          />
        </div>

        {/* Clear filters */}
        {(typeFilter !== 'all' || searchQuery || dateFrom || dateTo) && (
          <button
            onClick={() => {
              setTypeFilter('all');
              setSearchQuery('');
              setDateFrom('');
              setDateTo('');
            }}
            style={{
              padding: '6px 12px',
              background: '#fee2e2',
              color: '#991b1b',
              border: 'none',
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Clear Filters
          </button>
        )}
      </div>

      {/* ── Message Transcript ──────────────────────────────── */}
      <div ref={printRef} style={{ padding: '24px', maxWidth: 900, margin: '0 auto' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 60, color: '#666' }}>
            <div style={{ fontSize: 24, marginBottom: 8 }}>⏳</div>
            <div>Loading communications...</div>
          </div>
        ) : filteredMessages.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 60, color: '#666' }}>
            <div style={{ fontSize: 24, marginBottom: 8 }}>💬</div>
            <div>No messages found{typeFilter !== 'all' ? ' for this filter' : ''}.</div>
          </div>
        ) : (
          groupedMessages.map((group) => (
            <div key={group.date} style={{ marginBottom: 24 }}>
              {/* Date separator */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                margin: '16px 0 12px',
              }}>
                <div style={{ flex: 1, height: 1, background: '#ddd' }} />
                <span style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: '#666',
                  background: '#F8FAFC',
                  padding: '2px 12px',
                }}>
                  {group.date}
                </span>
                <div style={{ flex: 1, height: 1, background: '#ddd' }} />
              </div>

              {/* Messages */}
              {group.messages.map((msg) => (
                <div key={msg.id} style={{ marginBottom: 8 }}>
                  {msg.message_type === 'system' ? (
                    /* System message */
                    <div style={{
                      textAlign: 'center',
                      padding: '8px 16px',
                      fontSize: 12,
                      color: '#666',
                      fontStyle: 'italic',
                    }}>
                      {msg.content}
                      <span style={{ marginLeft: 8, color: '#999', fontSize: 11 }}>
                        {formatTime(msg.created_at)}
                      </span>
                    </div>
                  ) : (
                    /* Regular message */
                    <div style={{
                      background: 'white',
                      border: '1px solid #e5e7eb',
                      borderRadius: 8,
                      padding: '12px 16px',
                      borderLeft: `3px solid ${getTypeColor(msg.message_type)}`,
                    }}>
                      {/* Header row */}
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        marginBottom: 6,
                      }}>
                        <span style={{
                          fontWeight: 600,
                          fontSize: 13,
                          color: '#111',
                        }}>
                          {msg.sender_name || 'Unknown'}
                        </span>
                        {msg.sender_role && (
                          <span style={{
                            background: '#f0f0f0',
                            padding: '1px 6px',
                            borderRadius: 4,
                            fontSize: 10,
                            color: '#666',
                            fontWeight: 500,
                          }}>
                            {msg.sender_role.replace(/_/g, ' ')}
                          </span>
                        )}
                        {msg.sender_department && (
                          <span style={{ fontSize: 11, color: '#999' }}>
                            {msg.sender_department}
                          </span>
                        )}
                        <span style={{ marginLeft: 'auto', fontSize: 11, color: '#999' }}>
                          {formatTime(msg.created_at)}
                        </span>
                      </div>

                      {/* Type badge (non-chat only) */}
                      {msg.message_type !== 'chat' && (
                        <div style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          background: `${getTypeColor(msg.message_type)}15`,
                          color: getTypeColor(msg.message_type),
                          padding: '2px 8px',
                          borderRadius: 4,
                          fontSize: 11,
                          fontWeight: 600,
                          marginBottom: 6,
                        }}>
                          <span>{getTypeIcon(msg.message_type)}</span>
                          <span>{msg.message_type.replace(/_/g, ' ').toUpperCase()}</span>
                          {msg.priority && msg.priority !== 'normal' && (
                            <span style={{ marginLeft: 4, fontWeight: 700 }}>
                              [{msg.priority.toUpperCase()}]
                            </span>
                          )}
                        </div>
                      )}

                      {/* Content — immutable: no deletion, retracted shows strikethrough */}
                      {msg.is_retracted ? (
                        <div>
                          <div style={{
                            fontSize: 13,
                            color: '#999',
                            lineHeight: 1.5,
                            whiteSpace: 'pre-wrap',
                            textDecoration: 'line-through',
                            textDecorationColor: '#F59E0B',
                          }}>
                            {msg.content}
                          </div>
                          <div style={{
                            fontSize: 11,
                            color: '#92400E',
                            marginTop: 4,
                          }}>
                            ⏪ Retracted: {msg.retraction_reason || 'No reason given'}
                          </div>
                        </div>
                      ) : (
                        <div style={{
                          fontSize: 13,
                          color: '#333',
                          lineHeight: 1.5,
                          whiteSpace: 'pre-wrap',
                        }}>
                          {msg.content}
                        </div>
                      )}

                      {/* Attachments */}
                      {msg.attachments && msg.attachments.length > 0 && (
                        <div style={{
                          display: 'flex',
                          flexWrap: 'wrap',
                          gap: 8,
                          marginTop: 8,
                        }}>
                          {msg.attachments.map((att, i) => (
                            <div key={i} style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 8,
                              background: '#f5f5f5',
                              border: '1px solid #e0e0e0',
                              borderRadius: 6,
                              padding: '8px 12px',
                            }}>
                              {att.file_type.startsWith('image/') ? (
                                <img
                                  src={att.file_url}
                                  alt={att.file_name}
                                  style={{
                                    width: 48,
                                    height: 48,
                                    borderRadius: 4,
                                    objectFit: 'cover',
                                  }}
                                />
                              ) : (
                                <span style={{ fontSize: 24 }}>
                                  {att.file_type === 'application/pdf' ? '📄' : '📎'}
                                </span>
                              )}
                              <div>
                                <div style={{ fontSize: 12, fontWeight: 600, color: '#333' }}>
                                  {att.file_name}
                                </div>
                                <div style={{ fontSize: 11, color: '#999' }}>
                                  {(att.file_size / 1024).toFixed(1)} KB
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ))
        )}

        {/* Print footer */}
        <div className="print-only" style={{ display: 'none', marginTop: 40, borderTop: '1px solid #ddd', paddingTop: 16, fontSize: 11, color: '#999' }}>
          <p>Printed from Even OS Communications · {patientInfo?.name} ({patientInfo?.uhid}) · Encounter {encounterId.slice(0, 8)}</p>
          <p>Generated: {new Date().toLocaleString('en-IN')}</p>
          <p>This document is part of the patient&apos;s medical record. 30-year retention applies.</p>
        </div>
      </div>

      {/* Print styles */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .print-only { display: block !important; }
          header { background: white !important; color: black !important; border-bottom: 2px solid black; }
          header a { color: black !important; }
          header button { display: none !important; }
          body { background: white !important; }
        }
      `}</style>
    </div>
  );
}
