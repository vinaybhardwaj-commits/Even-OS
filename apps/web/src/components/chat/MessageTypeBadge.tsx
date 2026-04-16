'use client';

/**
 * MessageTypeBadge — OC.3a
 *
 * Color-coded pill for message type: chat, request, update, escalation,
 * fyi, decision_needed, handoff. "chat" type renders nothing (default).
 */

const TYPE_CONFIG: Record<string, { label: string; bg: string; text: string }> = {
  request:         { label: 'Request',         bg: 'bg-blue-100',   text: 'text-blue-700' },
  update:          { label: 'Update',          bg: 'bg-green-100',  text: 'text-green-700' },
  escalation:      { label: 'Escalation',      bg: 'bg-red-100',    text: 'text-red-700' },
  fyi:             { label: 'FYI',             bg: 'bg-gray-100',   text: 'text-gray-600' },
  decision_needed: { label: 'Decision Needed', bg: 'bg-amber-100',  text: 'text-amber-700' },
  handoff:         { label: 'Handoff',         bg: 'bg-purple-100', text: 'text-purple-700' },
  alert:           { label: 'Alert',           bg: 'bg-orange-100', text: 'text-orange-700' },
};

interface MessageTypeBadgeProps {
  type: string;
}

export function MessageTypeBadge({ type }: MessageTypeBadgeProps) {
  // Default "chat" type renders nothing
  if (!type || type === 'chat') return null;

  const config = TYPE_CONFIG[type];
  if (!config) return null;

  return (
    <span
      className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${config.bg} ${config.text}`}
    >
      {config.label}
    </span>
  );
}
