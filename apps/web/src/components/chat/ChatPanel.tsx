'use client';

/**
 * ChatPanel — Sliding chat panel (right sidebar) for hospital communications.
 * Replaces Slack for all caregiver-to-caregiver, patient-thread, department, and broadcast messaging.
 *
 * Fixed position, 380px wide, slides in from right.
 * Groups: My Patients, Department, Coordination, Direct Messages, Broadcast.
 * Click to select channel → shows message thread + composer.
 * Escape or backdrop click to close.
 */

import { useState, useEffect } from 'react';
import ActionableMessage from './ActionableMessage';
import { createActionsForMessage } from '@/lib/chat-actions';

interface Channel {
  group: string;
  type: 'patient-thread' | 'department' | 'cross-functional' | 'direct' | 'ops-broadcast';
  id: string;
  name: string;
  unread: number;
}

interface Message {
  id: string;
  sender: string;
  is_system?: boolean;
  text: string;
  time: string;
  type: 'escalation' | 'update' | 'journey_step' | 'chat';
  /** Action context for actionable messages */
  action_type?: string;
  action_context?: Record<string, string>;
}

interface ChatPanelProps {
  isOpen: boolean;
  onClose: () => void;
  userId: string;
  userRole: string;
  userName: string;
}

const SAMPLE_CHANNELS: Channel[] = [
  { group: 'MY PATIENTS', type: 'patient-thread', id: 'patient-enc-001', name: 'Rajesh Kumar', unread: 1 },
  { group: 'MY PATIENTS', type: 'patient-thread', id: 'patient-enc-002', name: 'Priya Sharma', unread: 0 },
  { group: 'DEPARTMENT', type: 'department', id: 'nursing', name: 'Nursing', unread: 2 },
  { group: 'DEPARTMENT', type: 'department', id: 'pharmacy', name: 'Pharmacy', unread: 0 },
  { group: 'DEPARTMENT', type: 'department', id: 'lab', name: 'Laboratory', unread: 0 },
  { group: 'COORDINATION', type: 'cross-functional', id: 'admission-coordination', name: 'Admission Coordination', unread: 1 },
  { group: 'COORDINATION', type: 'cross-functional', id: 'surgery-coordination', name: 'Surgery Coordination', unread: 0 },
  { group: 'COORDINATION', type: 'cross-functional', id: 'emergency-escalation', name: 'Emergency Escalation', unread: 0 },
  { group: 'DIRECT MESSAGES', type: 'direct', id: 'dm-sharma', name: 'Dr. Vikram Sharma', unread: 0 },
  { group: 'DIRECT MESSAGES', type: 'direct', id: 'dm-priya', name: 'Nurse Priya', unread: 0 },
  { group: 'BROADCAST', type: 'ops-broadcast', id: 'hospital-broadcast', name: 'Hospital Broadcast', unread: 0 },
];

const SAMPLE_MESSAGES: Message[] = [
  { id: '1', sender: 'Even OS', is_system: true, text: '🔔 NEWS2 Escalation: Score 8 for Rajesh Kumar (Bed 3A-04). SpO₂ dropping to 89%. RMO notified.', time: '08:45', type: 'escalation', action_type: 'critical_value', action_context: { patient_id: 'p001', step_id: 's001' } },
  { id: '2', sender: 'Nurse Priya', text: '💊 Metoprolol 25mg PO given to Rajesh Kumar at 08:00', time: '08:00', type: 'update' },
  { id: '3', sender: 'Dr. Sharma', text: 'Rounds complete for Ward 3A. Rajesh Kumar SpO₂ dropping — increasing O₂ to 4L. Monitor closely.', time: '07:30', type: 'chat' },
  { id: '4', sender: 'Even OS', is_system: true, text: '🔄 Shift Handoff: Night → Day shift. SBAR completed for all 6 patients.', time: '06:00', type: 'update' },
  { id: '5', sender: 'Charge Nurse Mary', text: 'Day shift assignments posted. Priya: beds 3A-01 to 3A-06. Deepa: beds 3A-07 to 3A-12.', time: '06:05', type: 'chat' },
  { id: '6', sender: 'Even OS', is_system: true, text: '✅ Step 2.7 Complete — Ward Intimation. New patient Amit Singh → Bed 3A-08. Assign nurse.', time: '05:30', type: 'journey_step', action_type: 'ward_intimation', action_context: { patient_id: 'p002', step_id: 's002' } },
  { id: '7', sender: 'Even OS', is_system: true, text: '💊 Overdue: Metoprolol 50mg for Rajesh Kumar was due at 14:00. 45 min overdue.', time: '14:45', type: 'escalation', action_type: 'overdue_med', action_context: { patient_id: 'p001' } },
  { id: '8', sender: 'Even OS', is_system: true, text: '🚪 Patient Exit: Priya Sharma has left the hospital. Terminal cleaning required for Bed 3A-02.', time: '15:30', type: 'journey_step', action_type: 'patient_exit', action_context: { patient_id: 'p003', step_id: 's003' } },
];

export default function ChatPanel({ isOpen, onClose, userId, userRole, userName }: ChatPanelProps) {
  const [selectedChannel, setSelectedChannel] = useState<Channel | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [messageText, setMessageText] = useState('');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(['MY PATIENTS', 'DEPARTMENT', 'COORDINATION', 'DIRECT MESSAGES', 'BROADCAST']));

  // Close on Escape
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    }
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  // Filter channels by search
  const filteredChannels = searchQuery.trim()
    ? SAMPLE_CHANNELS.filter(ch =>
        ch.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        ch.group.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : SAMPLE_CHANNELS;

  // Group channels
  const groupedChannels = filteredChannels.reduce((acc, ch) => {
    if (!acc[ch.group]) {
      acc[ch.group] = [];
    }
    acc[ch.group].push(ch);
    return acc;
  }, {} as Record<string, Channel[]>);

  // Toggle group expansion
  const toggleGroup = (group: string) => {
    const newExpanded = new Set(expandedGroups);
    if (newExpanded.has(group)) {
      newExpanded.delete(group);
    } else {
      newExpanded.add(group);
    }
    setExpandedGroups(newExpanded);
  };

  // Get unread count across all channels
  const totalUnread = SAMPLE_CHANNELS.reduce((sum, ch) => sum + ch.unread, 0);

  // Colors and styles
  const navyColor = '#002054';
  const blueColor = '#0055FF';
  const greenColor = '#0B8A3E';
  const redColor = '#DC2626';
  const redBg = '#FEE2E2';
  const greenBg = '#E6F5EC';
  const grayBorder = '#E5E7EB';
  const grayHover = '#F3F4F6';

  const messageBadgeStyle = (type: Message['type']) => {
    switch (type) {
      case 'escalation':
        return { backgroundColor: redBg, color: redColor };
      case 'update':
        return { backgroundColor: greenBg, color: greenColor };
      case 'journey_step':
        return { backgroundColor: navyColor, color: 'white' };
      default:
        return {};
    }
  };

  if (!isOpen) return null;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1999 }}>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'absolute',
          inset: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.3)',
        }}
      />

      {/* Panel */}
      <div
        style={{
          position: 'fixed',
          right: 0,
          top: 0,
          width: 380,
          height: '100vh',
          backgroundColor: 'white',
          zIndex: 2000,
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '-4px 0 12px rgba(0, 0, 0, 0.1)',
          animation: 'slideIn 300ms cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        <style>{`
          @keyframes slideIn {
            from { transform: translateX(100%); }
            to { transform: translateX(0); }
          }
        `}</style>

        {/* Header */}
        {selectedChannel ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              height: 48,
              paddingLeft: 12,
              paddingRight: 12,
              backgroundColor: navyColor,
              color: 'white',
              borderBottom: `1px solid ${grayBorder}`,
              fontSize: 14,
              fontWeight: 600,
              fontFamily: 'system-ui',
            }}
          >
            <button
              onClick={() => setSelectedChannel(null)}
              style={{
                background: 'none',
                border: 'none',
                color: 'white',
                cursor: 'pointer',
                padding: '4px 8px',
                marginRight: 8,
                fontSize: 16,
                fontWeight: 'bold',
              }}
            >
              ←
            </button>
            <span style={{ flex: 1 }}>
              {selectedChannel.type === 'patient-thread' && '👤 '}
              {selectedChannel.type === 'department' && '# '}
              {selectedChannel.type === 'cross-functional' && '# '}
              {selectedChannel.type === 'direct' && '💬 '}
              {selectedChannel.type === 'ops-broadcast' && '📢 '}
              {selectedChannel.name}
            </span>
            <span style={{ fontSize: 12, opacity: 0.7, marginLeft: 8 }}>
              ({SAMPLE_MESSAGES.length})
            </span>
          </div>
        ) : (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              height: 48,
              paddingLeft: 12,
              paddingRight: 12,
              backgroundColor: navyColor,
              color: 'white',
              borderBottom: `1px solid ${grayBorder}`,
              fontSize: 14,
              fontWeight: 600,
              fontFamily: 'system-ui',
            }}
          >
            MESSAGES
            <button
              onClick={onClose}
              style={{
                background: 'none',
                border: 'none',
                color: 'white',
                cursor: 'pointer',
                padding: '4px 8px',
                fontSize: 18,
                lineHeight: 1,
              }}
            >
              ✕
            </button>
          </div>
        )}

        {/* Content */}
        {selectedChannel ? (
          <>
            {/* Message List */}
            <div
              style={{
                flex: 1,
                overflowY: 'auto',
                padding: '12px',
                fontFamily: 'system-ui',
                fontSize: 13,
              }}
            >
              {SAMPLE_MESSAGES.map((msg) => (
                <div key={msg.id} style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 12, color: '#666', marginBottom: 4, fontWeight: 500 }}>
                    {msg.sender} <span style={{ color: '#999' }}>{msg.time}</span>
                  </div>
                  <div
                    style={{
                      backgroundColor: msg.is_system ? '#F0F4F8' : '#FFFFFF',
                      border: `1px solid ${msg.is_system ? '#D1DCE6' : grayBorder}`,
                      borderRadius: 8,
                      padding: '8px 12px',
                      lineHeight: 1.5,
                      wordWrap: 'break-word',
                    }}
                  >
                    {msg.type !== 'chat' && (
                      <div style={{ ...messageBadgeStyle(msg.type), padding: '2px 8px', borderRadius: 4, display: 'inline-block', fontSize: 11, fontWeight: 600, marginBottom: 6, marginRight: 0 }}>
                        {msg.type === 'escalation' && 'ESCALATION'}
                        {msg.type === 'update' && 'UPDATE'}
                        {msg.type === 'journey_step' && 'JOURNEY STEP'}
                      </div>
                    )}
                    {msg.type !== 'chat' && <div style={{ height: 4 }} />}
                    {msg.text}
                    {/* Actionable buttons */}
                    {msg.action_type && msg.action_context && (
                      <ActionableMessage
                        actions={createActionsForMessage(msg.action_type, msg.action_context)}
                        userName={userName}
                        onNavigate={(url) => { window.location.href = url; }}
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Composer */}
            <div
              style={{
                padding: 12,
                borderTop: `1px solid ${grayBorder}`,
                display: 'flex',
                gap: 8,
                fontFamily: 'system-ui',
              }}
            >
              <textarea
                value={messageText}
                onChange={(e) => setMessageText(e.target.value)}
                placeholder="Type a message..."
                style={{
                  flex: 1,
                  padding: 8,
                  border: `1px solid ${grayBorder}`,
                  borderRadius: 6,
                  fontSize: 13,
                  fontFamily: 'system-ui',
                  resize: 'none',
                  height: 40,
                }}
              />
              <button
                onClick={() => {
                  if (messageText.trim()) {
                    setMessageText('');
                    // TODO: Real integration with GetStream
                  }
                }}
                style={{
                  padding: '8px 16px',
                  backgroundColor: blueColor,
                  color: 'white',
                  border: 'none',
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontWeight: 600,
                  fontSize: 13,
                  fontFamily: 'system-ui',
                  whiteSpace: 'nowrap',
                }}
              >
                Send
              </button>
            </div>
          </>
        ) : (
          <>
            {/* Search Bar */}
            <div style={{ padding: 12, borderBottom: `1px solid ${grayBorder}` }}>
              <input
                type="text"
                placeholder="🔍 Search channels..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  border: `1px solid ${grayBorder}`,
                  borderRadius: 6,
                  fontSize: 13,
                  fontFamily: 'system-ui',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            {/* Channel List */}
            <div
              style={{
                flex: 1,
                overflowY: 'auto',
                padding: '12px 0',
                fontFamily: 'system-ui',
              }}
            >
              {Object.entries(groupedChannels).map(([groupName, channels]) => {
                const isExpanded = expandedGroups.has(groupName);
                const groupUnread = channels.reduce((sum, ch) => sum + ch.unread, 0);

                return (
                  <div key={groupName}>
                    {/* Group Header */}
                    <button
                      onClick={() => toggleGroup(groupName)}
                      style={{
                        width: '100%',
                        textAlign: 'left',
                        padding: '8px 12px',
                        backgroundColor: 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: 11,
                        fontWeight: 700,
                        color: '#666',
                        letterSpacing: 0.5,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                    >
                      <span>
                        {groupName} {isExpanded ? '▼' : '▶'}
                      </span>
                      {groupUnread > 0 && (
                        <span
                          style={{
                            backgroundColor: redColor,
                            color: 'white',
                            borderRadius: '50%',
                            width: 20,
                            height: 20,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 10,
                            fontWeight: 600,
                          }}
                        >
                          {groupUnread}
                        </span>
                      )}
                    </button>

                    {/* Channels in Group */}
                    {isExpanded && channels.map((channel) => (
                      <button
                        key={channel.id}
                        onClick={() => setSelectedChannel(channel)}
                        style={{
                          width: '100%',
                          textAlign: 'left',
                          padding: '10px 12px',
                          paddingLeft: 24,
                          height: 44,
                          backgroundColor: 'transparent',
                          border: 'none',
                          cursor: 'pointer',
                          fontSize: 13,
                          color: '#1F2937',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          transition: 'background-color 200ms',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.backgroundColor = grayHover;
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.backgroundColor = 'transparent';
                        }}
                      >
                        <span style={{ fontWeight: channel.unread > 0 ? 600 : 500 }}>
                          {channel.type === 'patient-thread' && '👤 '}
                          {channel.type === 'department' && '# '}
                          {channel.type === 'cross-functional' && '# '}
                          {channel.type === 'direct' && '💬 '}
                          {channel.type === 'ops-broadcast' && '📢 '}
                          {channel.name}
                        </span>
                        {channel.unread > 0 && (
                          <span
                            style={{
                              backgroundColor: redColor,
                              color: 'white',
                              borderRadius: '50%',
                              width: 20,
                              height: 20,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: 10,
                              fontWeight: 600,
                              flexShrink: 0,
                            }}
                          >
                            {channel.unread}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
