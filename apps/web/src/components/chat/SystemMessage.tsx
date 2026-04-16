'use client';

/**
 * SystemMessage — OC.3a
 *
 * Compact, gray, centered single-line for system events
 * (e.g. "Dr. Sharma joined the channel", "Channel created").
 */

interface SystemMessageProps {
  content: string;
  timestamp: string;
}

export function SystemMessage({ content, timestamp }: SystemMessageProps) {
  const time = new Date(timestamp);
  const timeStr = time.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });

  return (
    <div className="flex items-center gap-3 py-2 px-4">
      <div className="flex-1 h-px bg-white/10" />
      <span className="text-[11px] text-white/40 whitespace-nowrap">
        {content} · {timeStr}
      </span>
      <div className="flex-1 h-px bg-white/10" />
    </div>
  );
}
