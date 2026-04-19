'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ChartNotificationEventRow } from './use-chart-notifications';
import { getEventTypeLabel, getNotificationTarget, type ChartNotificationTarget } from '../../lib/chart/notification-source-mapping';
import { DismissAckModal } from './DismissAckModal';

/**
 * PC.4.B.4 — Slide-over right drawer (480px) listing chart notifications
 * in 3 tabs (Unread / Read / Dismissed), grouped by severity then time.
 *
 * Row click → mark_read + navigate via `onNavigate`.
 * Row kebab → dismiss (critical severity opens DismissAckModal).
 * Header "Mark all read" → patient-scoped bulk mark.
 */
type Tab = 'unread' | 'read' | 'dismissed';

interface NotificationDrawerProps {
  open: boolean;
  onClose: () => void;
  events: ChartNotificationEventRow[];
  status: 'unread' | 'read' | 'dismissed' | 'all';
  setStatus: (s: 'unread' | 'read' | 'dismissed' | 'all') => void;
  loading: boolean;
  error: string | null;
  refreshList: () => Promise<void> | void;
  markRead: (ids: string[]) => Promise<void>;
  markAllRead: () => Promise<void>;
  dismiss: (ids: string[], ackReason?: string) => Promise<void>;
  onNavigate: (target: ChartNotificationTarget, eventId: string) => void;
}

const SEVERITY_ORDER: Array<'critical' | 'high' | 'normal' | 'info'> = [
  'critical', 'high', 'normal', 'info',
];

const SEVERITY_STYLES: Record<string, { bg: string; border: string; text: string; dot: string; label: string }> = {
  critical: { bg: '#fef2f2', border: '#fecaca', text: '#991b1b', dot: '#dc2626', label: 'Critical' },
  high:     { bg: '#fff7ed', border: '#fed7aa', text: '#9a3412', dot: '#ea580c', label: 'High' },
  normal:   { bg: '#f1f5f9', border: '#cbd5e1', text: '#334155', dot: '#64748b', label: 'Normal' },
  info:     { bg: '#eff6ff', border: '#bfdbfe', text: '#1e40af', dot: '#3b82f6', label: 'Info' },
};

function formatRelative(iso: string): string {
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return '';
  const diffMs = Date.now() - d;
  const m = Math.floor(diffMs / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function formatPayloadSummary(row: ChartNotificationEventRow): string {
  const p = row.payload;
  if (!p || typeof p !== 'object') return getEventTypeLabel(row.event_type);
  const pp = p as Record<string, unknown>;
  if (row.event_type === 'critical_vital' && typeof pp.vital_name === 'string') {
    return `${pp.vital_name}${typeof pp.value !== 'undefined' ? ': ' + String(pp.value) : ''}`;
  }
  if (row.event_type === 'critical_lab' && typeof pp.test_name === 'string') {
    return `${pp.test_name}${typeof pp.value !== 'undefined' ? ': ' + String(pp.value) : ''}`;
  }
  if (row.event_type === 'calc_red_band' && typeof pp.calc_name === 'string') {
    return `${pp.calc_name}${typeof pp.score !== 'undefined' ? ' = ' + String(pp.score) : ''}`;
  }
  if (row.event_type === 'llm_proposal_new' && typeof pp.proposal_type === 'string') {
    return `New ${pp.proposal_type} proposal`;
  }
  if (row.event_type === 'cosign_overdue' && typeof pp.note_title === 'string') {
    return `Co-sign overdue: ${pp.note_title}`;
  }
  if (row.event_type === 'encounter_transition' && typeof pp.to_stage === 'string') {
    return `Encounter → ${pp.to_stage}`;
  }
  if (row.event_type === 'edit_lock_override' && typeof pp.resource === 'string') {
    return `Edit-lock override: ${pp.resource}`;
  }
  return getEventTypeLabel(row.event_type);
}

export function NotificationDrawer(props: NotificationDrawerProps) {
  const {
    open, onClose, events, status, setStatus, loading, error,
    refreshList, markRead, markAllRead, dismiss, onNavigate,
  } = props;

  const [ackModal, setAckModal] = useState<{ eventIds: string[]; criticalCount: number } | null>(null);
  const [openKebab, setOpenKebab] = useState<string | null>(null);

  useEffect(() => {
    if (open) refreshList();
  }, [open, status]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const grouped = useMemo(() => {
    const by: Record<string, ChartNotificationEventRow[]> = {};
    for (const row of events) {
      const key = row.severity ?? 'info';
      (by[key] ??= []).push(row);
    }
    for (const k of Object.keys(by)) {
      by[k].sort((a, b) => (a.fired_at < b.fired_at ? 1 : -1));
    }
    return by;
  }, [events]);

  if (!open) return null;

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'unread', label: 'Unread' },
    { id: 'read', label: 'Read' },
    { id: 'dismissed', label: 'Dismissed' },
  ];

  const handleRowClick = async (row: ChartNotificationEventRow) => {
    if (row.read_state !== 'dismissed') {
      // only mark read if currently unread
      if (row.read_state !== 'read') {
        await markRead([row.id]);
      }
    }
    const target = getNotificationTarget(row.event_type, row.payload);
    onNavigate(target, row.id);
    if (target.tab !== null) onClose();
  };

  const handleDismiss = async (row: ChartNotificationEventRow) => {
    setOpenKebab(null);
    if (row.severity === 'critical') {
      setAckModal({ eventIds: [row.id], criticalCount: 1 });
      return;
    }
    await dismiss([row.id]);
  };

  const anyUnread = events.some((r) => r.read_state !== 'read' && r.read_state !== 'dismissed');

  return (
    <>
      <div
        aria-hidden
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.35)', zIndex: 990,
        }}
      />
      <aside
        role="dialog"
        aria-label="Chart notifications"
        style={{
          position: 'fixed',
          top: 0, right: 0, bottom: 0,
          width: 480,
          maxWidth: '100vw',
          background: '#ffffff',
          zIndex: 995,
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '-12px 0 40px rgba(15,23,42,0.2)',
          animation: 'chartDrawerIn 160ms ease-out',
        }}
      >
        <style>{`@keyframes chartDrawerIn { from { transform: translateX(100%); } to { transform: translateX(0); } }`}</style>
        {/* header */}
        <div
          style={{
            padding: '14px 18px 10px',
            borderBottom: '1px solid #e2e8f0',
            display: 'flex', flexDirection: 'column', gap: 10,
            flex: '0 0 auto',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 18 }}>🔔</span>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#0f172a' }}>
                Chart notifications
              </h3>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close notifications"
              style={{
                background: 'transparent',
                border: 'none',
                color: '#64748b',
                fontSize: 18,
                cursor: 'pointer',
                padding: 4,
                lineHeight: 1,
              }}
            >
              ✕
            </button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <div style={{ display: 'flex', gap: 4 }}>
              {tabs.map((t) => {
                const active = status === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setStatus(t.id)}
                    style={{
                      padding: '5px 12px',
                      borderRadius: 6,
                      border: active ? '1px solid #1e293b' : '1px solid #e2e8f0',
                      background: active ? '#0f172a' : '#ffffff',
                      color: active ? '#ffffff' : '#334155',
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>
            {status === 'unread' && anyUnread ? (
              <button
                type="button"
                onClick={() => markAllRead()}
                style={{
                  padding: '5px 10px',
                  borderRadius: 6,
                  border: '1px solid #cbd5e1',
                  background: '#ffffff',
                  color: '#334155',
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Mark all read
              </button>
            ) : null}
          </div>
        </div>

        {/* body */}
        <div style={{ flex: '1 1 auto', overflow: 'auto', padding: '8px 0' }}>
          {loading && events.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', color: '#64748b', fontSize: 13 }}>
              Loading…
            </div>
          ) : error ? (
            <div style={{ padding: 32, textAlign: 'center', color: '#b91c1c', fontSize: 13 }}>
              {error}
            </div>
          ) : events.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', color: '#64748b', fontSize: 13 }}>
              No {status} notifications for this chart.
            </div>
          ) : (
            SEVERITY_ORDER.filter((s) => grouped[s]?.length).map((sev) => {
              const rows = grouped[sev];
              const sty = SEVERITY_STYLES[sev];
              return (
                <div key={sev} style={{ padding: '0 12px 12px' }}>
                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: 0.6,
                      color: sty.text,
                      padding: '10px 4px 6px',
                    }}
                  >
                    {sty.label} · {rows.length}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {rows.map((row) => {
                      const target = getNotificationTarget(row.event_type, row.payload);
                      const clickable = row.read_state !== 'dismissed';
                      const isKebabOpen = openKebab === row.id;
                      return (
                        <div
                          key={row.id}
                          style={{
                            background: sty.bg,
                            border: `1px solid ${sty.border}`,
                            borderRadius: 8,
                            padding: '10px 12px',
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: 10,
                            position: 'relative',
                            cursor: clickable ? 'pointer' : 'default',
                          }}
                          onClick={() => {
                            if (clickable) handleRowClick(row);
                          }}
                        >
                          <span
                            style={{
                              width: 8, height: 8, borderRadius: 8,
                              background: sty.dot,
                              marginTop: 6, flex: '0 0 auto',
                            }}
                          />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div
                              style={{
                                fontSize: 13,
                                fontWeight: 600,
                                color: sty.text,
                                lineHeight: 1.35,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                              }}
                            >
                              {formatPayloadSummary(row)}
                            </div>
                            <div
                              style={{
                                fontSize: 11,
                                color: '#64748b',
                                marginTop: 2,
                                display: 'flex',
                                gap: 6,
                                alignItems: 'center',
                              }}
                            >
                              <span>{getEventTypeLabel(row.event_type)}</span>
                              <span>·</span>
                              <span>{formatRelative(row.fired_at)}</span>
                              {target.tab ? (
                                <>
                                  <span>·</span>
                                  <span style={{ textTransform: 'capitalize' }}>→ {target.tab}</span>
                                </>
                              ) : null}
                            </div>
                            {row.read_state === 'dismissed' && row.ack_reason ? (
                              <div
                                style={{
                                  fontSize: 11, color: '#475569', marginTop: 6,
                                  background: '#ffffff', border: '1px dashed #cbd5e1',
                                  borderRadius: 6, padding: '4px 8px',
                                }}
                              >
                                Ack: {row.ack_reason}
                              </div>
                            ) : null}
                          </div>
                          {row.read_state !== 'dismissed' ? (
                            <div style={{ position: 'relative' }} onClick={(e) => e.stopPropagation()}>
                              <button
                                type="button"
                                aria-label="Row actions"
                                onClick={() => setOpenKebab(isKebabOpen ? null : row.id)}
                                style={{
                                  background: 'transparent',
                                  border: 'none',
                                  color: '#64748b',
                                  padding: '2px 6px',
                                  cursor: 'pointer',
                                  fontSize: 16,
                                  lineHeight: 1,
                                }}
                              >
                                ⋯
                              </button>
                              {isKebabOpen ? (
                                <div
                                  style={{
                                    position: 'absolute',
                                    top: 22,
                                    right: 0,
                                    background: '#ffffff',
                                    border: '1px solid #e2e8f0',
                                    borderRadius: 8,
                                    boxShadow: '0 8px 20px rgba(15,23,42,0.18)',
                                    zIndex: 5,
                                    minWidth: 140,
                                  }}
                                >
                                  <button
                                    type="button"
                                    onClick={() => handleDismiss(row)}
                                    style={{
                                      display: 'block',
                                      width: '100%',
                                      textAlign: 'left',
                                      padding: '8px 12px',
                                      background: 'transparent',
                                      border: 'none',
                                      color: '#b91c1c',
                                      fontSize: 12,
                                      fontWeight: 600,
                                      cursor: 'pointer',
                                    }}
                                  >
                                    Dismiss
                                  </button>
                                </div>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </aside>

      <DismissAckModal
        open={ackModal !== null}
        eventIds={ackModal?.eventIds ?? []}
        criticalCount={ackModal?.criticalCount ?? 0}
        onClose={() => setAckModal(null)}
        onConfirm={async (ackReason) => {
          if (!ackModal) return;
          await dismiss(ackModal.eventIds, ackReason);
        }}
      />
    </>
  );
}
