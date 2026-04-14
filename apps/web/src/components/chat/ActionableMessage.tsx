'use client';

import { useState } from 'react';
import { ChatAction, executeAction, ActionResult } from '@/lib/chat-actions';

interface Props {
  actions: ChatAction[];
  userName: string;
  onNavigate?: (url: string) => void;
}

/**
 * ActionableMessage renders a row of action buttons below a chat message.
 * Each button executes a tRPC mutation and shows a confirmation inline.
 * Buttons disable after click to prevent double-execution.
 */
export default function ActionableMessage({ actions, userName, onNavigate }: Props) {
  const [executing, setExecuting] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, ActionResult>>({});

  if (actions.length === 0) return null;

  const handleClick = async (action: ChatAction) => {
    const key = `${action.type}-${JSON.stringify(action.payload)}`;
    if (results[key]) return; // Already executed

    setExecuting(key);
    try {
      const result = await executeAction(action, userName);
      setResults(prev => ({ ...prev, [key]: result }));
      if (result.navigateTo && onNavigate) {
        onNavigate(result.navigateTo);
      }
    } catch {
      setResults(prev => ({
        ...prev,
        [key]: { success: false, message: '❌ Action failed' },
      }));
    } finally {
      setExecuting(null);
    }
  };

  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {actions.map((action) => {
          const key = `${action.type}-${JSON.stringify(action.payload)}`;
          const result = results[key];
          const isExecuting = executing === key;
          const isDone = !!result;

          return (
            <button
              key={key}
              onClick={() => handleClick(action)}
              disabled={isExecuting || isDone}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '5px 12px', fontSize: 11, fontWeight: 700,
                borderRadius: 6, border: 'none', cursor: isExecuting || isDone ? 'default' : 'pointer',
                background: isDone
                  ? (result.success ? '#e8f5e9' : '#ffebee')
                  : isExecuting ? '#e0e0e0' : action.color,
                color: isDone
                  ? (result.success ? '#2e7d32' : '#c62828')
                  : isExecuting ? '#888' : '#fff',
                transition: 'all 0.2s',
              }}
            >
              {isExecuting ? '⏳' : action.icon} {isDone ? (result.success ? '✓' : '✗') : action.label}
            </button>
          );
        })}
      </div>

      {/* Result messages */}
      {Object.values(results).map((result, i) => (
        <div key={i} style={{
          fontSize: 10, marginTop: 3,
          color: result.success ? '#2e7d32' : '#c62828',
        }}>
          {result.message}
        </div>
      ))}
    </div>
  );
}
