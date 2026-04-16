'use client';

/**
 * TaskCard — OC.5a (QA: dark theme fix + always-true fix)
 *
 * Renders inline task assignment card in chat messages.
 * Shows assignee, due date, priority, status, and action buttons.
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

const PRIORITY_STYLES: Record<string, string> = {
  urgent: 'bg-red-500/20 text-red-300',
  high:   'bg-amber-500/20 text-amber-300',
  normal: 'bg-blue-500/20 text-blue-300',
  low:    'bg-white/10 text-white/50',
};

const PRIORITY_LABEL: Record<string, string> = {
  urgent: 'URGENT', high: 'HIGH', normal: 'NORMAL', low: 'LOW',
};

const STATUS_CONFIG: Record<string, { icon: string; label: string; cls: string }> = {
  pending:     { icon: '⏳', label: 'Pending',     cls: 'text-amber-400' },
  in_progress: { icon: '🔄', label: 'In Progress', cls: 'text-blue-400' },
  completed:   { icon: '✅', label: 'Completed',   cls: 'text-emerald-400' },
  overdue:     { icon: '⚠️', label: 'Overdue',     cls: 'text-red-400' },
  reassigned:  { icon: '🔄', label: 'Reassigned',  cls: 'text-violet-400' },
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
  const priorityCls = PRIORITY_STYLES[metadata.priority] || PRIORITY_STYLES.normal;
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
    <div className={`border rounded-lg px-3.5 py-2.5 mt-1.5 border-l-[3px]
      ${isCompleted ? 'border-emerald-500/30 border-l-emerald-500 bg-emerald-500/5' : 'border-white/15 border-l-blue-400 bg-white/5'}`}>
      {/* Header row */}
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-sm">☑️</span>
        <span className="font-semibold text-xs text-white">TASK</span>
        <span className={`px-1.5 py-px rounded text-[10px] font-semibold ${priorityCls}`}>
          {PRIORITY_LABEL[metadata.priority] || 'NORMAL'}
        </span>
        <span className={`ml-auto flex items-center gap-1 text-[11px] font-semibold ${status.cls}`}>
          <span>{status.icon}</span>
          <span>{status.label}</span>
        </span>
      </div>

      {/* Details */}
      <div className="text-xs text-white/60 leading-relaxed">
        <div>
          <span className="text-white/40">Assigned to: </span>
          <span className="font-semibold text-white/80">{metadata.assignee_name}</span>
          {isAssignee && <span className="ml-1 text-[10px] text-blue-400">(you)</span>}
        </div>
        {metadata.due_at && (
          <div>
            <span className="text-white/40">Due: </span>
            <span className="font-medium text-white/70">
              {new Date(metadata.due_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
            </span>
            <span className={`ml-1 text-[11px] ${metadata.status === 'overdue' ? 'text-red-400' : 'text-white/40'}`}>
              ({formatDueDate(metadata.due_at)})
            </span>
          </div>
        )}
        {isCompleted && metadata.completed_by_name && (
          <div className="text-emerald-400 font-medium">
            Completed by {metadata.completed_by_name}
            {metadata.completed_at && ` at ${new Date(metadata.completed_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`}
          </div>
        )}
      </div>

      {/* Action buttons — only assignee can complete */}
      {!isCompleted && (
        <div className="flex gap-2 mt-2">
          {isAssignee && (
            <button
              onClick={handleComplete}
              disabled={completing}
              className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white border-none rounded text-[11px] font-semibold
                cursor-pointer transition-colors disabled:opacity-50"
            >
              {completing ? '...' : '✅ Complete'}
            </button>
          )}
          {onReassign && (
            <button
              onClick={() => onReassign(messageId)}
              className="px-3 py-1 bg-transparent text-white/50 border border-white/20 rounded text-[11px] font-medium
                cursor-pointer hover:bg-white/5 hover:text-white/70 transition-colors"
            >
              🔄 Reassign
            </button>
          )}
        </div>
      )}
    </div>
  );
}
