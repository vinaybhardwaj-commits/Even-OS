'use client';

/**
 * SlashResultCard — OC.5b
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
      <div style={{
        border: '1px solid #FCA5A5',
        borderRadius: 8,
        padding: '10px 14px',
        marginTop: 6,
        background: '#FEF2F2',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#991B1B' }}>
          <span>❌</span>
          <span style={{ fontWeight: 600 }}>{metadata.error}</span>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      border: '1px solid #E5E7EB',
      borderRadius: 8,
      padding: '10px 14px',
      marginTop: 6,
      background: '#F9FAFB',
    }}>
      {/* Card title */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        marginBottom: 8,
        paddingBottom: 6,
        borderBottom: '1px solid #E5E7EB',
      }}>
        <span style={{ fontSize: 16 }}>{metadata.card_icon}</span>
        <span style={{ fontWeight: 700, fontSize: 13, color: '#111' }}>{metadata.card_title}</span>
      </div>

      {/* Card content — render with simple markdown-like formatting */}
      <div style={{ fontSize: 12, color: '#333', lineHeight: 1.7 }}>
        {metadata.card_content.split('\n').map((line, i) => {
          // Bold text
          const boldParts = line.split(/\*\*(.+?)\*\*/g);
          const rendered = boldParts.map((part, j) =>
            j % 2 === 1
              ? <strong key={j}>{part}</strong>
              : <span key={j}>{part}</span>
          );

          // Empty line = spacing
          if (line.trim() === '') {
            return <div key={i} style={{ height: 6 }} />;
          }

          return (
            <div key={i} style={{
              paddingLeft: line.startsWith('•') ? 8 : 0,
            }}>
              {rendered}
            </div>
          );
        })}
      </div>

      {/* Timestamp footer */}
      <div style={{
        marginTop: 6,
        paddingTop: 4,
        borderTop: '1px solid #F3F4F6',
        fontSize: 10,
        color: '#9CA3AF',
      }}>
        Live data at {new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
      </div>
    </div>
  );
}
