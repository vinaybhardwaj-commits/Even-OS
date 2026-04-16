'use client';

/**
 * TaskCard — OC.5a
 *
 * Renders inline task assignment card in chat messages.
 * Shows assignee, due date, priority, status, and action buttons
 * (Complete, Reassign, Snooze).
 */

import { useState, useCallback } from 'react';

interface TaskMetadata {
  task_id: string;
  assignee_id: string;
  assignee_name: string;
  due_at: string | null;
  priority: 'urgent' | 'high' | 'normal' | 'low';
  status: 'pending' | 'in_progress' | 'completed' | 'overdue' | 'reassigned';
  completed_at?: string;
  completed_by_name?: string;
}

interface TaskCardProps {
  messageId: number;
  metadata: TaskMetadata;
  currentUserId: string;
  onComplete?: (messageId: number) => Promise<void>;
  onReassign?: (messageId: number) => void;
}

const PRIORITY_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  urgent: { bg: '#FEE2E2', text: '#991B1B', label: 'URGENT' },
  high:   { bg: '#FEF3C7', text: '#92400E', label: 'HIGH' },
  normal: { bg: '#E0E7FF', text: '#3730A3', label: 'NORMAL' },
  low:    { bg: '#F3F4F6', text: '#6B7280', label: 'LOW' },
};

const STATUS_CONFIG: Record<string, { icon: string; label: string; color: string }> = {
  pending:     { icon: '⏳', label: 'Pending',    color: '#F59E0B' },
  in_progress: { icon: '🔄', label: 'In Progress', color: '#3B82F6' },
  completed:   { icon: '✅', label: 'Completed',  color: '#10B981' },
  overdue:     { icon: '⚠️', label: 'Overdue',    color: '#EF4444' },
  reassigned:  { icon: '🔄', label: 'Reassigned', color: '#8B5CF6' },
};

function formatDueDate(dueAt: string | null): string {
  if (!dueAt) return '';
  const d = new Date(dueAt);
  const now = new Date();
  const diffMin = Math.round((d.getTime() - now.getTime()) / 60000);

  if (diffMin < 0) return `${Math.abs(diffMin)}min overdue`;
  if (diffMin < 60) return `${diffMin}min`;
  if (diffMin < 1440) return `${Math.round(diffMin / 60)}h`;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

export function TaskCard({ messageId, metadata, currentUserId, onComplete, onReassign }: TaskCardProps) {
  const [completing, setCompleting] = useState(false);
  const priority = PRIORITY_COLORS[metadata.priority] || PRIORITY_COLORS.normal;
  const status = STATUS_CONFIG[metadata.status] || STATUS_CONFIG.pending;
  const isAssignee = metadata.assignee_id === currentUserId;
  const isCompleted = metadata.status === 'completed';

  const handleComplete = useCallback(async () => {
    if (!onComplete || completing) return;
    setCompleting(true);
    try {
      await onComplete(messageId);
    } finally {
      setCompleting(false);
    }
  }, [messageId, onComplete, completing]);

  return (
    <div style={{
      border: `1px solid ${isCompleted ? '#D1FAE5' : '#E5E7EB'}`,
      borderLeft: `3px solid ${status.color}`,
      borderRadius: 8,
      padding: '10px 14px',
      marginTop: 6,
      background: isCompleted ? '#F0FDF4' : '#F9FAFB',
    }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 14 }}>☑️</span>
        <span style={{ fontWeight: 600, fontSize: 12, color: '#111' }}>TASK</span>
        <span style={{
          padding: '1px 6px',
          borderRadius: 4,
          fontSize: 10,
          fontWeight: 600,
          background: priority.bg,
          color: priority.text,
        }}>
          {priority.label}
        </span>
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: status.color }}>
          <span>{status.icon}</span>
          <span style={{ fontWeight: 600 }}>{status.label}</span>
        </span>
      </div>

      {/* Details */}
      <div style={{ fontSize: 12, color: '#444', lineHeight: 1.6 }}>
        <div>
          <span style={{ color: '#666' }}>Assigned to: </span>
          <span style={{ fontWeight: 600 }}>{metadata.assignee_name}</span>
          {isAssignee && <span style={{ marginLeft: 4, fontSize: 10, color: '#3B82F6' }}>(you)</span>}
        </div>
        {metadata.due_at && (
          <div>
            <span style={{ color: '#666' }}>Due: </span>
            <span style={{ fontWeight: 500 }}>
              {new Date(metadata.due_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
            </span>
            <span style={{ marginLeft: 4, fontSize: 11, color: metadata.status === 'overdue' ? '#EF4444' : '#666' }}>
              ({formatDueDate(metadata.due_at)})
            </span>
          </div>
        )}
        {isCompleted && metadata.completed_by_name && (
          <div style={{ color: '#10B981', fontWeight: 500 }}>
            Completed by {metadata.completed_by_name}
            {metadata.completed_at && ` at ${new Date(metadata.completed_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`}
          </div>
        )}
      </div>

      {/* Action buttons */}
      {!isCompleted && (
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          {(isAssignee || true) && (
            <button
              onClick={handleComplete}
              disabled={completing}
              style={{
                padding: '5px 12px',
                background: '#10B981',
                color: 'white',
                border: 'none',
                borderRadius: 5,
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
                opacity: completing ? 0.6 : 1,
              }}
            >
              {completing ? '...' : '✅ Complete'}
            </button>
          )}
          {onReassign && (
            <button
              onClick={() => onReassign(messageId)}
              style={{
                padding: '5px 12px',
                background: 'transparent',
                color: '#6B7280',
                border: '1px solid #D1D5DB',
                borderRadius: 5,
                fontSize: 11,
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              🔄 Reassign
            </button>
          )}
        </div>
      )}
    </div>
  );
}
