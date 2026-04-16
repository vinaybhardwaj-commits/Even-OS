'use client';

/**
 * SlashResultCard — OC.5b (QA: dark theme fix)
 *
 * Renders formatted response cards from slash command results.
 * Displayed inline in chat messages with type='slash_result'.
 */

interface SlashResultCardProps {
  metadata: {
    card_title: string;
    card_content: string;
    card_icon: string;
    error?: string;
    success: boolean;
  };
}

export function SlashResultCard({ metadata }: SlashResultCardProps) {
  if (!metadata.success && metadata.error) {
    return (
      <div className="border border-red-500/30 rounded-lg px-3.5 py-2.5 mt-1.5 bg-red-500/10">
        <div className="flex items-center gap-1.5 text-xs text-red-300">
          <span>❌</span>
          <span className="font-semibold">{metadata.error}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="border border-white/15 rounded-lg px-3.5 py-2.5 mt-1.5 bg-white/5">
      {/* Card title */}
      <div className="flex items-center gap-1.5 mb-2 pb-1.5 border-b border-white/10">
        <span className="text-base">{metadata.card_icon}</span>
        <span className="font-bold text-[13px] text-white">{metadata.card_title}</span>
      </div>

      {/* Card content — render with simple markdown-like formatting */}
      <div className="text-xs text-white/70 leading-relaxed">
        {metadata.card_content.split('\n').map((line, i) => {
          // Bold text
          const boldParts = line.split(/\*\*(.+?)\*\*/g);
          const rendered = boldParts.map((part, j) =>
            j % 2 === 1
              ? <strong key={j} className="text-white font-semibold">{part}</strong>
              : <span key={j}>{part}</span>
          );

          // Empty line = spacing
          if (line.trim() === '') {
            return <div key={i} className="h-1.5" />;
          }

          return (
            <div key={i} className={line.startsWith('•') ? 'pl-2' : ''}>
              {rendered}
            </div>
          );
        })}
      </div>

      {/* Timestamp footer */}
      <div className="mt-1.5 pt-1 border-t border-white/5 text-[10px] text-white/30">
        Live data at {new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
      </div>
    </div>
  );
}
