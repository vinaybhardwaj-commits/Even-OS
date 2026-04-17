'use client';

/**
 * SlashCommandMenu — SC.2
 *
 * Autocomplete dropdown that appears when user types "/" in the composer.
 * - Filters commands by role (pre-filtered server-side, client-side search)
 * - Shows role-specific action labels (e.g., "Order Medication" vs "eMAR")
 * - Indicates form-backed vs read-only commands with visual badges
 * - Keyboard navigation: Arrow Up/Down, Tab/Enter to select, Escape to close
 */

import { useState, useEffect, useMemo, useRef } from 'react';

export interface SlashCommandDef {
  name: string;
  description: string;
  usage: string;
  icon: string;
  type: 'form' | 'read_only' | 'task';
  actionLabel?: string;
  formDefinitionId?: string;
  formSlug?: string;
  requiresPatient?: boolean;
}

interface SlashCommandMenuProps {
  query: string;
  commands: SlashCommandDef[];
  onSelect: (command: SlashCommandDef) => void;
  onClose: () => void;
  visible: boolean;
}

export function SlashCommandMenu({ query, commands, onSelect, onClose, visible }: SlashCommandMenuProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  const filtered = useMemo(() => {
    if (!query) return commands;
    const q = query.toLowerCase();
    return commands.filter(c =>
      c.name.toLowerCase().startsWith(q) ||
      c.description.toLowerCase().includes(q) ||
      (c.actionLabel && c.actionLabel.toLowerCase().includes(q))
    );
  }, [query, commands]);

  // Reset selection when filtered list changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [filtered.length]);

  // Keyboard navigation
  const handlerRef = useRef<(e: KeyboardEvent) => void>(() => {});
  handlerRef.current = (e: KeyboardEvent) => {
    if (!visible || filtered.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(i => (i + 1) % filtered.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(i => (i - 1 + filtered.length) % filtered.length);
    } else if (e.key === 'Tab' || e.key === 'Enter') {
      if (filtered.length > 0) {
        e.preventDefault();
        onSelect(filtered[selectedIndex]);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  useEffect(() => {
    if (!visible) return;
    const listener = (e: KeyboardEvent) => handlerRef.current(e);
    window.addEventListener('keydown', listener, true);
    return () => window.removeEventListener('keydown', listener, true);
  }, [visible]);

  if (!visible || filtered.length === 0) return null;

  return (
    <div style={{
      position: 'absolute',
      bottom: '100%',
      left: 0,
      right: 0,
      marginBottom: 4,
      background: '#1A2A40',
      border: '1px solid rgba(255,255,255,0.1)',
      borderRadius: 8,
      boxShadow: '0 -4px 20px rgba(0,0,0,0.3)',
      maxHeight: 320,
      overflowY: 'auto',
      zIndex: 100,
    }}>
      <div style={{
        padding: '8px 12px 4px',
        fontSize: 10,
        fontWeight: 600,
        color: 'rgba(255,255,255,0.3)',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
      }}>
        Slash Commands
      </div>
      {filtered.map((cmd, idx) => (
        <button
          key={`${cmd.name}-${cmd.formDefinitionId || 'ro'}`}
          onClick={() => onSelect(cmd)}
          onMouseEnter={() => setSelectedIndex(idx)}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '8px 12px',
            border: 'none',
            background: idx === selectedIndex ? 'rgba(255,255,255,0.08)' : 'transparent',
            cursor: 'pointer',
            textAlign: 'left',
            transition: 'background 0.1s',
          }}
        >
          <span style={{ fontSize: 18, flexShrink: 0 }}>{cmd.icon}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{
                fontSize: 13,
                fontWeight: 600,
                color: 'white',
              }}>
                /{cmd.name}
              </span>
              {/* Type badge */}
              {cmd.type === 'form' && (
                <span style={{
                  fontSize: 9,
                  fontWeight: 700,
                  color: '#60a5fa',
                  background: 'rgba(96,165,250,0.15)',
                  padding: '1px 5px',
                  borderRadius: 3,
                  letterSpacing: 0.3,
                  textTransform: 'uppercase',
                }}>
                  Form
                </span>
              )}
              {cmd.type === 'task' && (
                <span style={{
                  fontSize: 9,
                  fontWeight: 700,
                  color: '#a78bfa',
                  background: 'rgba(167,139,250,0.15)',
                  padding: '1px 5px',
                  borderRadius: 3,
                  letterSpacing: 0.3,
                  textTransform: 'uppercase',
                }}>
                  Task
                </span>
              )}
            </div>
            <div style={{
              fontSize: 11,
              color: 'rgba(255,255,255,0.45)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}>
              {/* Show action label if available, otherwise description */}
              {cmd.actionLabel || cmd.description}
            </div>
          </div>
          {/* Right side: usage hint or action label */}
          <div style={{
            fontSize: 10,
            color: cmd.actionLabel ? 'rgba(96,165,250,0.6)' : 'rgba(255,255,255,0.25)',
            flexShrink: 0,
            textAlign: 'right',
            maxWidth: 120,
          }}>
            {cmd.actionLabel ? cmd.actionLabel : cmd.usage}
          </div>
        </button>
      ))}
    </div>
  );
}
