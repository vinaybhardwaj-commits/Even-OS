'use client';

/**
 * ChatIcon — Chat button for top navigation bar.
 * Shows 💬 icon with red unread badge in top-right.
 * Click to open/close ChatPanel.
 */

interface ChatIconProps {
  unreadCount: number;
  onClick: () => void;
}

export default function ChatIcon({ unreadCount, onClick }: ChatIconProps) {
  const redColor = '#DC2626';
  const redBg = '#FEE2E2';
  const navyColor = '#002054';

  return (
    <button
      onClick={onClick}
      style={{
        position: 'relative',
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        padding: '8px 12px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 20,
        lineHeight: 1,
        color: navyColor,
        transition: 'opacity 200ms',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.opacity = '0.7';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.opacity = '1';
      }}
      title={`Chat (${unreadCount} unread)`}
    >
      💬
      {unreadCount > 0 && (
        <span
          style={{
            position: 'absolute',
            top: 4,
            right: 4,
            backgroundColor: redColor,
            color: 'white',
            borderRadius: '50%',
            width: 18,
            height: 18,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 10,
            fontWeight: 700,
            lineHeight: 1,
            minWidth: 18,
          }}
        >
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
    </button>
  );
}
